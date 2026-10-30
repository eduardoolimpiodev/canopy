import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.js';
import { AppError } from './errors.js';
import { digest, hashPassword, token, verifyPassword } from './security.js';
import { Store, type AccountPurpose, type UserRow } from './store.js';
import { MailDelivery } from './mail.js';
import type { MongoGateway } from './mongo.js';

const emailInput = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
const passwordInput = z.string().min(12).max(128);
const credentials = z.object({ email: emailInput, password: passwordInput }).strict();
const tokenInput = z.string().regex(/^[a-f\d]{64}$/);
export const publicAccountRoutes = new Set([
  '/api/auth/options',
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/verify-email',
  '/api/auth/resend-verification',
]);

export async function accountRoutes(
  app: FastifyInstance,
  store: Store,
  mail: MailDelivery,
  mongo: MongoGateway,
  config: Config,
  cookieName: string,
) {
  const dummyPassword = await hashPassword(token());
  const authLimit = { rateLimit: { max: 10, timeWindow: '15 minutes', groupId: 'authentication' } };
  const recoveryLimit = {
    rateLimit: { max: 10, timeWindow: '15 minutes', groupId: 'account-recovery' },
  };
  const emailFlowsAvailable = config.mail.mode !== 'disabled';
  function requireEmailDelivery() {
    if (!emailFlowsAvailable)
      throw new AppError(
        503,
        'Novos cadastros e recuperação de senha estão temporariamente indisponíveis. Entre com uma conta já configurada.',
      );
  }
  const receipt = {
    message:
      'Se o endereço corresponder a uma conta elegível, a solicitação de e-mail foi registrada. Confira sua caixa de entrada e spam. Aguarde um minuto antes de solicitar outro link.',
  };
  function publicUser(user: UserRow) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.email_verified_at !== null,
    };
  }
  function queueLink(user: UserRow, purpose: AccountPurpose) {
    const recent = store.db
      .prepare('SELECT created_at FROM account_tokens WHERE user_id = ? AND purpose = ?')
      .get(user.id, purpose);
    if (recent && Number(recent.created_at) > Date.now() - 60000) return;
    const value = token();
    const id = randomUUID();
    const expires = Date.now() + (purpose === 'verify' ? 86400000 : 30 * 60000);
    const link = `${config.origin}/#${purpose === 'verify' ? 'verify-email' : 'reset-password'}=${value}`;
    const payload = mail.payload(id, user.id, {
      to: user.email,
      subject:
        purpose === 'verify' ? 'Confirme seu e-mail no Canopy' : 'Redefina sua senha no Canopy',
      text: `${purpose === 'verify' ? 'Confirme seu e-mail para acessar os bancos.' : 'Você solicitou a redefinição da sua senha.'}\n\n${link}\n\nEste link é de uso único e expira em ${purpose === 'verify' ? '24 horas' : '30 minutos'}. Se não solicitou esta ação, ignore esta mensagem.`,
    });
    store.db
      .prepare('DELETE FROM account_tokens WHERE user_id = ? AND purpose = ?')
      .run(user.id, purpose);
    store.db
      .prepare(
        "UPDATE account_mail SET status = 'cancelled', payload = '' WHERE user_id = ? AND kind = ? AND status IN ('pending', 'failed')",
      )
      .run(user.id, purpose);
    store.db
      .prepare('INSERT INTO account_tokens VALUES (?, ?, ?, ?, ?)')
      .run(digest(value), user.id, purpose, expires, Date.now());
    store.addMail(id, user.id, purpose, payload);
  }
  function clearCookie(reply: FastifyReply) {
    reply.clearCookie(cookieName, {
      path: '/',
      httpOnly: true,
      secure: config.production,
      sameSite: 'strict',
    });
  }
  function startSession(user: UserRow, request: FastifyRequest, reply: FastifyReply) {
    const value = token();
    const csrf = token();
    store.transaction(() => {
      const old = request.cookies[cookieName];
      if (old) store.db.prepare('DELETE FROM sessions WHERE hash = ?').run(digest(old));
      store.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
      store.db
        .prepare(
          'DELETE FROM sessions WHERE user_id = ? AND hash NOT IN (SELECT hash FROM sessions WHERE user_id = ? ORDER BY expires_at DESC LIMIT 4)',
        )
        .run(user.id, user.id);
      store.db
        .prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)')
        .run(digest(value), user.id, csrf, Date.now() + 7 * 86400000);
    });
    request.auditUserId = user.id;
    reply.setCookie(cookieName, value, {
      httpOnly: true,
      secure: config.production,
      sameSite: 'strict',
      path: '/',
      maxAge: 7 * 86400,
    });
    return { user: publicUser(user), csrf };
  }
  function validToken(value: string, purpose: AccountPurpose) {
    const row = store.db
      .prepare(
        'SELECT user_id FROM account_tokens WHERE hash = ? AND purpose = ? AND expires_at > ?',
      )
      .get(digest(value), purpose, Date.now());
    if (!row)
      throw new AppError(400, 'Link inválido, expirado ou já utilizado. Solicite um novo link.');
    return String(row.user_id);
  }

  app.get('/api/auth/options', async () => ({ emailFlowsAvailable }));
  app.post('/api/auth/register', { config: authLimit }, async (request, reply) => {
    requireEmailDelivery();
    const input = credentials
      .extend({ name: z.string().trim().min(2).max(60) })
      .parse(request.body);
    if (store.userByEmail(input.email))
      throw new AppError(409, 'Não foi possível criar a conta com este e-mail.');
    const password = await hashPassword(input.password);
    const id = randomUUID();
    try {
      store.transaction(() => {
        store.db
          .prepare(
            'INSERT INTO users(id, email, name, password, created_at) VALUES (?, ?, ?, ?, ?)',
          )
          .run(id, input.email, input.name, password, Date.now());
        queueLink(store.user(id)!, 'verify');
      });
    } catch (error) {
      if (store.userByEmail(input.email))
        throw new AppError(409, 'Não foi possível criar a conta com este e-mail.');
      throw error;
    }
    const user = store.user(id)!;
    reply.code(201);
    return startSession(user, request, reply);
  });
  app.post('/api/auth/login', { config: authLimit }, async (request, reply) => {
    const input = credentials.parse(request.body);
    const user = store.userByEmail(input.email);
    const valid = await verifyPassword(input.password, user?.password ?? dummyPassword);
    if (!user || !valid || store.user(user.id)?.password !== user.password)
      throw new AppError(401, 'E-mail ou senha inválidos.');
    return startSession(user, request, reply);
  });
  app.get('/api/auth/me', async (request) => {
    const user = store.user(request.identity!.user_id)!;
    return {
      user: publicUser(user),
      csrf: request.identity!.csrf,
      verificationDelivery: store.mailStatus(user.id),
      mailChannel: config.mail.mode,
    };
  });
  app.post('/api/auth/logout', async (request, reply) => {
    store.db
      .prepare('DELETE FROM sessions WHERE hash = ?')
      .run(digest(request.cookies[cookieName]!));
    clearCookie(reply);
    return { ok: true };
  });
  for (const [route, purpose] of [
    ['forgot-password', 'reset'],
    ['resend-verification', 'verify'],
  ] as const) {
    app.post(`/api/auth/${route}`, { config: recoveryLimit }, async (request, reply) => {
      requireEmailDelivery();
      const { email } = z.object({ email: emailInput }).strict().parse(request.body);
      const user = store.userByEmail(email);
      if (user && (purpose === 'reset' || user.email_verified_at === null))
        store.transaction(() => queueLink(user, purpose));
      return reply.code(202).send(receipt);
    });
  }
  app.post('/api/auth/verify-email', { config: recoveryLimit }, async (request) => {
    const { token: value, password } = z
      .object({ token: tokenInput, password: passwordInput })
      .strict()
      .parse(request.body);
    const user = store.user(validToken(value, 'verify'))!;
    const valid = await verifyPassword(password, user.password);
    if (!valid || store.user(user.id)?.password !== user.password)
      throw new AppError(
        403,
        'Confirme a senha escolhida ao criar a conta. Se não reconhece este cadastro, use a recuperação de senha.',
      );
    const userId = store.transaction(() => {
      const id = validToken(value, 'verify');
      store.db.prepare('UPDATE users SET email_verified_at = ? WHERE id = ?').run(Date.now(), id);
      store.db
        .prepare("DELETE FROM account_tokens WHERE user_id = ? AND purpose = 'verify'")
        .run(id);
      return id;
    });
    request.auditUserId = userId;
    return { ok: true };
  });
  app.post('/api/auth/reset-password', { config: recoveryLimit }, async (request) => {
    requireEmailDelivery();
    const input = z
      .object({ token: tokenInput, password: passwordInput })
      .strict()
      .parse(request.body);
    validToken(input.token, 'reset');
    const password = await hashPassword(input.password);
    const userId = store.transaction(() => {
      const id = validToken(input.token, 'reset');
      const user = store.user(id)!;
      store.db
        .prepare(
          'UPDATE users SET password = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?',
        )
        .run(password, Date.now(), id);
      store.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      store.db.prepare('DELETE FROM account_tokens WHERE user_id = ?').run(id);
      store.db
        .prepare(
          "UPDATE account_mail SET status = 'cancelled', payload = '' WHERE user_id = ? AND status IN ('pending', 'failed')",
        )
        .run(id);
      const mailId = randomUUID();
      store.addMail(
        mailId,
        id,
        'password-changed',
        mail.payload(mailId, id, {
          to: user.email,
          subject: 'Sua senha do Canopy foi alterada',
          text: 'Sua senha foi redefinida e todas as sessões foram encerradas. Se não foi você, use a recuperação de senha para retomar o acesso à sua conta.',
        }),
      );
      return id;
    });
    request.auditUserId = userId;
    await mongo.cancelOwner(userId);
    return { ok: true };
  });
  app.get('/api/account/activity', async (request) => {
    const input = z
      .object({
        before: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
      })
      .strict()
      .parse(request.query);
    const events = store.db
      .prepare(
        'SELECT id, method, route, action, connection_id AS connectionId, database_name AS databaseName, collection_name AS collectionName, status, created_at AS createdAt FROM audit_events WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT 51',
      )
      .all(request.identity!.user_id, input.before ?? Number.MAX_SAFE_INTEGER);
    return { events: events.slice(0, 50), nextBefore: events.length > 50 ? events[49].id : null };
  });
  app.delete('/api/account', { config: authLimit }, async (request, reply) => {
    const input = z
      .object({ password: passwordInput, confirmation: z.literal('EXCLUIR MINHA CONTA') })
      .strict()
      .parse(request.body);
    const userId = request.identity!.user_id;
    const user = store.user(userId)!;
    const valid = await verifyPassword(input.password, user.password);
    if (
      !valid ||
      store.user(userId)?.password !== user.password ||
      !store.session(digest(request.cookies[cookieName]!))
    )
      throw new AppError(403, 'Confirme sua senha atual para excluir a conta.');
    const files = store.db.prepare('SELECT id FROM account_mail WHERE user_id = ?').all(userId);
    store.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    request.identity = null;
    request.auditUserId = null;
    clearCookie(reply);
    await mongo.cancelOwner(userId);
    if (config.mail.mode === 'file')
      for (const file of files) await mail.removeFile(String(file.id));
    return { ok: true };
  });
}
