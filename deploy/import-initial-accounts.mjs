import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { Store } from '../dist/server/store.js';
import { readConfig } from '../dist/server/config.js';
import { token, digest } from '../dist/server/security.js';
import { randomUUID } from 'node:crypto';
import { MailDelivery } from '../dist/server/mail.js';

const userInput = z
  .object({
    id: z.uuid(),
    email: z.email().max(254),
    name: z.string().min(2).max(60),
    password: z.string().regex(/^[a-f\d]{32}:[a-f\d]{128}$/),
    created_at: z.number().int().nonnegative(),
    email_verified_at: z.number().int().nonnegative().nullable(),
  })
  .strict();
const input = z
  .object({ users: z.array(userInput).min(1).max(10) })
  .strict()
  .parse(JSON.parse(readFileSync(0, 'utf8')));
const config = readConfig(process.env);
if (!config.production || config.mail.mode !== 'disabled')
  throw new Error(
    'A importação inicial exige produção com os fluxos de e-mail explicitamente suspensos.',
  );
const store = new Store(config.dataDir);
const delivery = new MailDelivery(store, config);
try {
  const links = [];
  store.transaction(() => {
    if (Number(store.db.prepare('SELECT count(*) AS n FROM users').get().n) !== 0)
      throw new Error('A base de destino já contém contas; nenhum cadastro será sobrescrito.');
    for (const user of input.users) {
      store.db
        .prepare(
          'INSERT INTO users(id,email,name,password,created_at,email_verified_at) VALUES (?,?,?,?,?,?)',
        )
        .run(
          user.id,
          user.email,
          user.name,
          user.password,
          user.created_at,
          user.email_verified_at,
        );
      if (user.email_verified_at === null) {
        const value = token();
        const expires = Date.now() + 86400000;
        store.db
          .prepare('INSERT INTO account_tokens VALUES (?,?,?,?,?)')
          .run(digest(value), user.id, 'verify', expires, Date.now());
        const link = {
          email: user.email,
          url: config.origin + '/#verify-email=' + value,
          expiresAt: expires,
        };
        const mailId = randomUUID();
        store.addMail(
          mailId,
          user.id,
          'verify',
          delivery.payload(mailId, user.id, {
            to: user.email,
            subject: 'Confirmação inicial da instalação Canopy',
            text: link.url,
          }),
        );
        store.db.prepare("UPDATE account_mail SET status = 'operator' WHERE id = ?").run(mailId);
        links.push(link);
      }
    }
  });
  const passwordHashesPreserved = input.users.every(
    (user) => store.user(user.id).password === user.password,
  );
  if (!passwordHashesPreserved) throw new Error('Falha ao conferir os hashes importados.');
  process.stdout.write(
    JSON.stringify({
      imported: input.users.map(({ id, email }) => ({ id, email })),
      passwordHashesPreserved,
      initialLinks: links,
    }),
  );
} finally {
  await delivery.close();
  store.close();
}
