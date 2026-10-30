import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import staticFiles from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BSON, MongoError, type Document, type AbstractCursor } from 'mongodb';
import { z } from 'zod';
import type { Config } from './config.js';
import { AppError } from './errors.js';
import { Store, type SessionRow, type QueryRow, type AuditAction } from './store.js';
import { decrypt, digest, encrypt } from './security.js';
import { accountRoutes, publicAccountRoutes } from './accounts.js';
import { MailDelivery, MailDeliveryError } from './mail.js';
import { MongoGateway, parseDocument, parseFilter, parsePipeline } from './mongo.js';

declare module 'fastify' {
  interface FastifyRequest {
    identity: SessionRow | null;
    auditUserId: string | null;
    audited: boolean;
    auditAction: AuditAction | null;
  }
}

const connectionInput = z
  .object({
    name: z.string().trim().min(1).max(60),
    uri: z.string().min(10).max(4096),
    readOnly: z.boolean().default(true),
  })
  .strict();
const resourceParams = z.object({
  id: z.uuid(),
  database: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[^/\\. "$*<>:|?]+$/)
    .refine((name) => !name.includes(String.fromCharCode(0))),
  collection: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[^$]+$/)
    .refine((name) => !name.includes(String.fromCharCode(0))),
});
const queryInput = z
  .object({
    mode: z.enum(['find', 'aggregate']),
    text: z.string().max(32000),
    sort: z.string().max(4000).default('{}'),
    limit: z.number().int().min(1).max(200).default(50),
    skip: z.number().int().min(0).max(10000).default(0),
  })
  .strict();
const idInput = z.object({ id: z.uuid() });
const queryPath = '/api/connections/:id/databases/:database/collections/:collection';

async function readCursor(cursor: AbstractCursor) {
  const documents: Document[] = [];
  let size = 0;
  try {
    for await (const document of cursor) {
      size += Buffer.byteLength(BSON.EJSON.stringify(document, { relaxed: false }));
      if (size > 1024 * 1024)
        throw new AppError(413, 'Resultado excede 1 MB. Reduza o limite ou refine a consulta.');
      documents.push(document);
    }
    return BSON.EJSON.serialize(documents, { relaxed: false });
  } finally {
    await cursor.close();
  }
}

export async function createApp(config: Config, options: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 256 * 1024,
    requestTimeout: 20000,
    connectionTimeout: 20000,
    trustProxy: config.trustedProxies.length ? config.trustedProxies : false,
  });
  const store = new Store(config.dataDir);
  const mongo = new MongoGateway(config);
  const cookieName = config.production ? '__Host-canopy' : 'canopy-session';
  const mail = new MailDelivery(store, config);
  app.decorateRequest('identity', null);
  app.decorateRequest('auditUserId', null);
  app.decorateRequest('audited', false);
  app.decorateRequest('auditAction', null);
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        upgradeInsecureRequests: config.production ? [] : null,
      },
    },
  });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: 'Muitas solicitações. Aguarde antes de tentar novamente.',
    }),
  });
  app.addHook('onReady', async () => {
    mail.start((error) =>
      app.log.error(
        {
          errorType: error instanceof Error ? error.name : 'Unknown',
          ...(error instanceof MailDeliveryError ? error.details : {}),
        },
        'Entrega de e-mail falhou; consulte a fila persistida.',
      ),
    );
  });
  app.addHook('onClose', async () => {
    try {
      await mail.close();
    } finally {
      store.close();
    }
  });
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (
      mutation &&
      (request.headers.origin !== config.origin ||
        request.headers['sec-fetch-site'] === 'cross-site')
    )
      throw new AppError(403, 'Origem da solicitação não autorizada.');
  });
  app.addHook('preHandler', async (request) => {
    if (!request.url.startsWith('/api/')) return;
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    const route = request.url.split('?')[0];
    const publicRoute = route === '/api/health' || publicAccountRoutes.has(route);
    if (publicRoute) return;
    const value = request.cookies[cookieName];
    const session = value && /^[a-f\d]{64}$/.test(value) ? store.session(digest(value)) : undefined;
    if (!session) throw new AppError(401, 'Entre na sua conta para continuar.');
    request.identity = session;
    if (mutation && request.headers['x-csrf-token'] !== session.csrf)
      throw new AppError(403, 'Sessão desatualizada. Recarregue a página.');
    if (
      session.email_verified_at === null &&
      !route.startsWith('/api/auth/') &&
      !['/api/account', '/api/account/activity'].includes(route)
    )
      throw new AppError(403, 'Confirme seu e-mail antes de acessar os bancos.');
  });
  app.addHook('onSend', async (request, reply, payload) => {
    const userId = request.auditUserId ?? request.identity?.user_id;
    if (!request.audited && userId && store.user(userId) && request.routeOptions.url) {
      request.audited = true;
      const params = request.params as Record<string, unknown> | undefined;
      const target = (key: string, max: number) =>
        typeof params?.[key] === 'string' && params[key].length <= max ? params[key] : undefined;
      store.audit(userId, {
        method: request.method,
        route: request.routeOptions.url,
        connectionId: target('id', 36),
        database: target('database', 63),
        collection: target('collection', 120),
        action: request.auditAction,
        status: reply.statusCode,
      });
    }
    return payload;
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError)
      return reply.code(error.statusCode).send({ error: error.message });
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      });
    if (error instanceof MongoError) {
      request.log.warn(
        {
          errorType: error.name,
          mongoCode: typeof error.code === 'number' ? error.code : undefined,
        },
        'Operação MongoDB falhou',
      );
      const code = typeof error.code === 'number' ? ` Código MongoDB: ${error.code}.` : '';
      return reply.code(502).send({
        error: `O MongoDB recusou a operação ou não respondeu no prazo. Confira a consulta, as permissões e a conectividade.${code}`,
      });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500)
      return reply
        .code(status)
        .send({ error: status === 413 ? 'Solicitação excede 256 KB.' : 'Solicitação inválida.' });
    request.log.error(
      {
        errorType: error instanceof Error ? error.name : 'Unknown',
        frames:
          error instanceof Error ? error.stack?.split('\n').slice(1, 8).join('\n') : undefined,
        requestId: request.id,
      },
      'Falha interna',
    );
    return reply.code(500).send({ error: `Falha interna. Referência: ${request.id}.` });
  });

  function ownConnection(userId: string, id: string) {
    const connection = store.connection(userId, id);
    if (!connection) throw new AppError(404, 'Conexão não encontrada.');
    return connection;
  }
  function connectionUri(userId: string, id: string) {
    const row = ownConnection(userId, id);
    return { row, uri: decrypt(row.uri, config.encryptionKey, `${userId}:${id}`) };
  }
  const publicConnection = (row: ReturnType<typeof ownConnection>) => ({
    id: row.id,
    name: row.name,
    host: row.host,
    readOnly: !!row.read_only,
    createdAt: row.created_at,
  });
  app.get('/api/health', async () => ({ status: 'ok' }));
  await accountRoutes(app, store, mail, mongo, config, cookieName);

  app.get('/api/connections', async (request) => ({
    connections: store.connections(request.identity!.user_id).map(publicConnection),
  }));
  app.post('/api/connections', async (request, reply) => {
    const userId = request.identity!.user_id;
    const input = connectionInput.parse(request.body);
    if (store.connections(userId).length >= 10)
      throw new AppError(409, 'Limite de 10 conexões por conta.');
    const host = await mongo.use(userId, input.uri, async (client, plan) => {
      await client.db().command({ ping: 1 });
      return plan.host;
    });
    if (!store.user(userId)) throw new AppError(401, 'Conta encerrada durante a operação.');
    if (store.connections(userId).length >= 10)
      throw new AppError(409, 'Limite de 10 conexões por conta.');
    const id = randomUUID();
    store.db
      .prepare('INSERT INTO connections VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(
        id,
        userId,
        input.name,
        host,
        encrypt(input.uri, config.encryptionKey, `${userId}:${id}`),
        Number(input.readOnly),
        Date.now(),
      );
    reply.code(201);
    return { connection: publicConnection(ownConnection(userId, id)) };
  });
  app.delete('/api/connections/:id', async (request) => {
    const { id } = idInput.parse(request.params);
    ownConnection(request.identity!.user_id, id);
    store.db
      .prepare('DELETE FROM connections WHERE id = ? AND user_id = ?')
      .run(id, request.identity!.user_id);
    return { ok: true };
  });
  app.get('/api/connections/:id/databases', async (request) => {
    const { id } = idInput.parse(request.params);
    const userId = request.identity!.user_id;
    const { uri } = connectionUri(userId, id);
    return mongo.use(userId, uri, async (client) => ({
      databases: (
        await client
          .db()
          .admin()
          .listDatabases({ nameOnly: true, authorizedDatabases: true, maxTimeMS: 5000 })
      ).databases
        .map((database) => database.name)
        .sort(),
    }));
  });
  app.get('/api/connections/:id/databases/:database/collections', async (request) => {
    const { id, database } = resourceParams.omit({ collection: true }).parse(request.params);
    const userId = request.identity!.user_id;
    const { uri } = connectionUri(userId, id);
    return mongo.use(userId, uri, async (client) => {
      const cursor = client
        .db(database)
        .listCollections({}, { nameOnly: true, authorizedCollections: true, maxTimeMS: 5000 });
      try {
        const collections: string[] = [];
        for await (const collection of cursor) {
          if (collections.length >= 500)
            throw new AppError(413, 'Banco excede o limite de 500 coleções desta versão.');
          collections.push(collection.name);
        }
        return { collections: collections.sort() };
      } finally {
        await cursor.close();
      }
    });
  });
  app.post(`${queryPath}/query`, async (request) => {
    const { id, database, collection } = resourceParams.parse(request.params);
    const input = queryInput.parse(request.body);
    request.auditAction = input.mode;
    const filter = input.mode === 'find' ? parseFilter(input.text) : undefined;
    const pipeline = input.mode === 'aggregate' ? parsePipeline(input.text) : undefined;
    let sortValue: unknown;
    try {
      sortValue = JSON.parse(input.sort);
    } catch {
      throw new AppError(400, 'Ordenação inválida. Use um documento JSON com valores 1 ou -1.');
    }
    const sort = z.record(z.string(), z.union([z.literal(1), z.literal(-1)])).parse(sortValue);
    const userId = request.identity!.user_id;
    const { uri } = connectionUri(userId, id);
    const started = performance.now();
    const documents = await mongo.use(userId, uri, async (client) => {
      const target = client.db(database).collection(collection);
      const cursor = filter
        ? target
            .find(filter, { maxTimeMS: 5000, promoteValues: false })
            .sort(sort)
            .skip(input.skip)
            .limit(input.limit + 1)
        : target.aggregate([...pipeline!, { $skip: input.skip }, { $limit: input.limit + 1 }], {
            maxTimeMS: 5000,
            allowDiskUse: false,
            promoteValues: false,
          });
      return (await readCursor(cursor)) as Document[];
    });
    const hasMore = documents.length > input.limit;
    return {
      documents: documents.slice(0, input.limit),
      hasMore,
      durationMs: Math.round(performance.now() - started),
    };
  });
  app.get(`${queryPath}/indexes`, async (request) => {
    const { id, database, collection } = resourceParams.parse(request.params);
    const userId = request.identity!.user_id;
    const { uri } = connectionUri(userId, id);
    return mongo.use(userId, uri, async (client) => ({
      indexes: await readCursor(
        client.db(database).collection(collection).listIndexes({ maxTimeMS: 5000 }),
      ),
    }));
  });
  app.post(`${queryPath}/documents`, async (request) => {
    const { id, database, collection } = resourceParams.parse(request.params);
    const input = z
      .object({
        action: z.enum(['insert', 'replace', 'delete']),
        document: z.string().max(64000).optional(),
        id: z.string().max(4000).optional(),
        original: z.string().max(64000).optional(),
      })
      .strict()
      .parse(request.body);
    request.auditAction = input.action;
    const userId = request.identity!.user_id;
    const { uri, row } = connectionUri(userId, id);
    if (row.read_only) throw new AppError(403, 'Esta conexão permite apenas leitura.');
    const document =
      input.action !== 'delete' ? parseDocument(z.string().parse(input.document)) : undefined;
    const selector =
      input.action !== 'insert' ? parseDocument(z.string().parse(input.id)) : undefined;
    if (
      selector &&
      (Object.keys(selector).length !== 1 || !('_id' in selector) || selector._id === undefined)
    )
      throw new AppError(400, 'Selecione um documento pelo _id.');
    if (
      selector &&
      selector._id !== null &&
      typeof selector._id === 'object' &&
      Object.keys(selector._id).some((key) => key.startsWith('$'))
    )
      throw new AppError(400, '_id não pode conter operadores de consulta.');
    const original =
      input.action !== 'insert' ? parseDocument(z.string().parse(input.original)) : undefined;
    if (original && !('_id' in original))
      throw new AppError(400, 'O documento original deve conter _id.');
    return mongo.use(userId, uri, async (client) => {
      const target = client.db(database).collection(collection);
      if (input.action === 'insert') {
        const result = await target.insertOne(document!, { timeoutMS: 5000 });
        return { ok: true, insertedId: BSON.EJSON.serialize(result.insertedId) };
      }
      const condition = {
        $and: [selector!, { $expr: { $eq: ['$$ROOT', { $literal: original }] } }],
      };
      const result =
        input.action === 'replace'
          ? await target.replaceOne(condition, document!, { timeoutMS: 5000 })
          : await target.deleteOne(condition, { timeoutMS: 5000 });
      const affected = 'matchedCount' in result ? result.matchedCount : result.deletedCount;
      if (!affected)
        throw new AppError(
          409,
          'O documento foi alterado ou removido. Consulte novamente antes de salvar.',
        );
      return { ok: true };
    });
  });
  app.get('/api/connections/:id/queries', async (request) => {
    const { id } = idInput.parse(request.params);
    const userId = request.identity!.user_id;
    ownConnection(userId, id);
    const rows = store.db
      .prepare(
        'SELECT id, name, payload, created_at FROM queries WHERE user_id = ? AND connection_id = ? ORDER BY created_at DESC',
      )
      .all(userId, id) as unknown as QueryRow[];
    return {
      queries: rows.map((row) => ({
        id: row.id,
        name: row.name,
        ...JSON.parse(decrypt(row.payload, config.encryptionKey, `${userId}:${row.id}`)),
      })),
    };
  });
  app.post('/api/connections/:id/queries', async (request, reply) => {
    const { id } = idInput.parse(request.params);
    const input = z
      .object({
        name: z.string().trim().min(1).max(80),
        database: resourceParams.shape.database,
        collection: resourceParams.shape.collection,
        query: queryInput,
      })
      .strict()
      .parse(request.body);
    const userId = request.identity!.user_id;
    ownConnection(userId, id);
    const count = store.db
      .prepare('SELECT COUNT(*) AS count FROM queries WHERE user_id = ?')
      .get(userId) as { count: number };
    if (count.count >= 50) throw new AppError(409, 'Limite de 50 consultas salvas por conta.');
    const queryId = randomUUID();
    store.db
      .prepare('INSERT INTO queries VALUES (?, ?, ?, ?, ?, ?)')
      .run(
        queryId,
        userId,
        id,
        input.name,
        encrypt(JSON.stringify(input), config.encryptionKey, `${userId}:${queryId}`),
        Date.now(),
      );
    reply.code(201);
    return { id: queryId };
  });
  app.delete('/api/connections/:id/queries/:queryId', async (request) => {
    const { id, queryId } = idInput.extend({ queryId: z.uuid() }).parse(request.params);
    const userId = request.identity!.user_id;
    ownConnection(userId, id);
    const result = store.db
      .prepare('DELETE FROM queries WHERE id = ? AND connection_id = ? AND user_id = ?')
      .run(queryId, id, userId);
    if (!result.changes) throw new AppError(404, 'Consulta não encontrada.');
    return { ok: true };
  });

  const clientDirectory = resolve('dist/client');
  if (existsSync(clientDirectory)) {
    await app.register(staticFiles, { root: clientDirectory });
    app.setNotFoundHandler((request, reply) =>
      request.url.startsWith('/api/')
        ? reply.code(404).send({ error: 'Rota não encontrada.' })
        : reply.sendFile('index.html'),
    );
  }
  return app;
}
