import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { MongoClient } from 'mongodb';
import { request as httpRequest } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/server/app.js';
import { readConfig } from '../src/server/config.js';
import { Store } from '../src/server/store.js';
import { digest } from '../src/server/security.js';

const origin = 'http://localhost:4310';
const password = 'Initial-account-password-2026';
const newPassword = 'Recovered-account-password-2026';
const email = 'owner@example.test';
type Session = { cookie: string; csrf: string };
let app: FastifyInstance;
let directory: string;
let store: Store;
let config: ReturnType<typeof readConfig>;
let fixture: MongoClient;
let owner: Session;
let other: Session;
let ownerId: string;
let connectionId: string;
let verification: string;
let address = 10;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function session(response: Awaited<ReturnType<FastifyInstance['inject']>>): Session {
  return {
    cookie: (response.headers['set-cookie'] as string).split(';')[0],
    csrf: response.json().csrf,
  };
}
function call(
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  payload?: unknown,
  identity?: Session,
) {
  return app.inject({
    method,
    url,
    remoteAddress: `192.0.2.${address++}`,
    headers: {
      origin,
      ...(identity ? { cookie: identity.cookie, 'x-csrf-token': identity.csrf } : {}),
    },
    ...(method === 'GET' ? {} : { payload: payload ?? {} }),
  });
}
async function delivered(to: string, kind: string, excluded = '') {
  for (let attempt = 0; attempt < 150; attempt++) {
    const files = await readdir(join(directory, 'mail')).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const file of files) {
      const mail = JSON.parse(await readFile(join(directory, 'mail', file), 'utf8'));
      const value = mail.text.match(new RegExp(`${kind}=([a-f\\d]{64})`))?.[1];
      if (mail.to === to && value && value !== excluded) return value as string;
    }
    await delay(40);
  }
  assert.fail(`O worker não entregou ${kind} para ${to}.`);
}
before(async () => {
  assert.ok(process.env.TEST_MONGO_URI);
  directory = await mkdtemp(join(tmpdir(), 'canopy-account-'));
  config = readConfig({
    APP_ORIGIN: origin,
    ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    DATA_DIR: directory,
    NODE_ENV: 'test',
    MONGO_ALLOWED_LOCAL_HOSTS: '127.0.0.1',
  });
  store = new Store(directory);
  app = await createApp(config);
  await app.ready();
  fixture = new MongoClient(process.env.TEST_MONGO_URI!, { serverSelectionTimeoutMS: 15000 });
  await fixture.connect();
  await fixture.db('canopy_accounts').collection('preserved').insertOne({ keep: true });
});
after(async () => {
  await app?.close();
  store?.close();
  await fixture?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('cadastro exige confirmação, persiste apenas hash do token e rejeita link expirado ou de outra finalidade', async () => {
  const response = await call('POST', '/api/auth/register', { email, name: 'Owner', password });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().user.emailVerified, false);
  owner = session(response);
  ownerId = response.json().user.id;
  assert.equal((await call('GET', '/api/connections', undefined, owner)).statusCode, 403);
  verification = await delivered(email, 'verify-email');
  const row = store.db.prepare('SELECT hash FROM account_tokens WHERE user_id = ?').get(ownerId)!;
  assert.notEqual(row.hash, verification);
  assert.equal(response.body.includes(verification), false);
  assert.equal(
    (await call('POST', '/api/auth/reset-password', { token: verification, password: newPassword }))
      .statusCode,
    400,
  );
  store.db
    .prepare('UPDATE account_tokens SET expires_at = ?, created_at = ? WHERE user_id = ?')
    .run(Date.now() - 1, Date.now() - 61000, ownerId);
  assert.equal(
    (await call('POST', '/api/auth/verify-email', { token: verification, password })).statusCode,
    400,
  );
  assert.equal(
    (await call('GET', '/api/auth/me', undefined, owner)).json().user.emailVerified,
    false,
  );
});

test('reenvio tem cooldown, invalida o link anterior e confirmação é de uso único', async () => {
  assert.equal((await call('POST', '/api/auth/resend-verification', { email })).statusCode, 202);
  const hash = store.db
    .prepare('SELECT hash FROM account_tokens WHERE user_id = ?')
    .get(ownerId)!.hash;
  await call('POST', '/api/auth/resend-verification', { email });
  assert.equal(
    store.db.prepare('SELECT hash FROM account_tokens WHERE user_id = ?').get(ownerId)!.hash,
    hash,
  );
  const next = await delivered(email, 'verify-email', verification);
  assert.equal(
    (await call('POST', '/api/auth/verify-email', { token: verification, password })).statusCode,
    400,
  );
  assert.equal(
    (
      await call('POST', '/api/auth/verify-email', {
        token: next,
        password: 'not-the-registration-password',
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await call('POST', '/api/auth/verify-email', { token: next, password })).statusCode,
    200,
  );
  assert.equal(
    (await call('POST', '/api/auth/verify-email', { token: next, password })).statusCode,
    400,
  );
  assert.equal((await call('GET', '/api/connections', undefined, owner)).statusCode, 200);
});

test('fila sobrevive ao reinício; recuperação responde igualmente para contas existentes/ausentes e troca atômica revoga todas as sessões', async () => {
  const second = await call('POST', '/api/auth/login', { email, password });
  assert.equal(second.statusCode, 200, second.body);
  const oldSession = session(second);
  const pendingConnection = await call(
    'POST',
    '/api/connections',
    { name: 'Pending body target', uri: process.env.TEST_MONGO_URI, readOnly: true },
    owner,
  );
  assert.equal(pendingConnection.statusCode, 201, pendingConnection.body);
  const unknown = await call('POST', '/api/auth/forgot-password', {
    email: 'missing@example.test',
  });
  const known = await call('POST', '/api/auth/forgot-password', { email });
  assert.equal(known.statusCode, 202);
  assert.deepEqual(known.json(), unknown.json());
  assert.equal(known.body.includes('token'), false);
  const queued = store.db
    .prepare("SELECT status FROM account_mail WHERE user_id = ? AND kind = 'reset'")
    .get(ownerId)!;
  assert.ok(['pending', 'sending', 'sent'].includes(String(queued.status)));
  await app.close();
  app = await createApp(config);
  const arrived = deferred<void>();
  app.addHook('preParsing', async (request, _reply, payload) => {
    if (request.headers['x-delayed-body'] === 'yes') arrived.resolve();
    return payload;
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const reset = await delivered(email, 'reset-password');
  const body = JSON.stringify({
    name: 'Must not survive revocation',
    database: 'canopy_accounts',
    collection: 'preserved',
    query: { mode: 'find', text: '{}' },
  });
  const late = deferred<{ status: number; body: string }>();
  const request = httpRequest(
    {
      host: '127.0.0.1',
      port: (app.server.address() as { port: number }).port,
      path: `/api/connections/${pendingConnection.json().connection.id}/queries`,
      method: 'POST',
      headers: {
        origin,
        cookie: oldSession.cookie,
        'x-csrf-token': oldSession.csrf,
        'x-delayed-body': 'yes',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    (response) => {
      let text = '';
      response.on('data', (chunk) => {
        text += chunk.toString();
      });
      response.on('end', () => late.resolve({ status: response.statusCode!, body: text }));
    },
  );
  request.on('error', late.reject);
  request.flushHeaders();
  await arrived.promise;
  const results = await Promise.all([
    call('POST', '/api/auth/reset-password', { token: reset, password: newPassword }),
    call('POST', '/api/auth/reset-password', { token: reset, password: newPassword }),
  ]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 400]);
  request.end(body);
  const rejected = await late.promise;
  assert.equal(rejected.status, 401, rejected.body);
  assert.equal(
    store.db
      .prepare('SELECT count(*) AS n FROM queries WHERE name = ?')
      .get('Must not survive revocation')!.n,
    0,
  );
  assert.equal((await call('GET', '/api/auth/me', undefined, owner)).statusCode, 401);
  assert.equal((await call('GET', '/api/auth/me', undefined, oldSession)).statusCode, 401);
  assert.equal((await call('POST', '/api/auth/login', { email, password })).statusCode, 401);
  const login = await call('POST', '/api/auth/login', { email, password: newPassword });
  assert.equal(login.statusCode, 200, login.body);
  owner = session(login);
  assert.equal(login.json().user.emailVerified, true);
  assert.equal(
    (await call('POST', '/api/auth/reset-password', { token: reset, password })).statusCode,
    400,
  );
  assert.equal(
    store.db.prepare('SELECT count(*) AS n FROM account_tokens WHERE user_id = ?').get(ownerId)!.n,
    0,
  );
});

test('atividade registra alvo e falhas, limita retenção e nunca inclui documento, URI ou eventos de outra conta', async () => {
  const created = await call(
    'POST',
    '/api/connections',
    { name: 'Metadata only', uri: process.env.TEST_MONGO_URI, readOnly: false },
    owner,
  );
  assert.equal(created.statusCode, 201, created.body);
  connectionId = created.json().connection.id;
  const path = `/api/connections/${connectionId}/databases/canopy_accounts/collections/preserved/query`;
  assert.equal(
    (
      await call(
        'POST',
        path,
        { mode: 'find', text: '{"sensitive-field":"private-content"}' },
        owner,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (await call('POST', path, { mode: 'find', text: 'invalid' }, owner)).statusCode,
    400,
  );
  const otherResponse = await call('POST', '/api/auth/register', {
    email: 'other@example.test',
    name: 'Other',
    password,
  });
  other = session(otherResponse);
  const activity = await call('GET', '/api/account/activity', undefined, owner);
  const events = activity.json().events;
  assert.ok(
    events.some(
      (event: { status: number; collectionName: string }) =>
        event.status === 400 && event.collectionName === 'preserved',
    ),
  );
  assert.ok(events.some((event: { action: string }) => event.action === 'find'));
  assert.equal(activity.body.includes('private-content'), false);
  assert.equal(activity.body.includes(process.env.TEST_MONGO_URI!), false);
  assert.equal(activity.body.includes(newPassword), false);
  const foreign = await call('GET', `/api/account/activity?userId=${ownerId}`, undefined, other);
  assert.equal(foreign.statusCode, 400);
  assert.equal(
    (await call('GET', '/api/account/activity', undefined, other)).body.includes(connectionId),
    false,
  );
  const saved = await call(
    'POST',
    `/api/connections/${connectionId}/queries`,
    {
      name: 'To delete',
      database: 'canopy_accounts',
      collection: 'preserved',
      query: { mode: 'find', text: '{}' },
    },
    owner,
  );
  assert.equal(saved.statusCode, 201, saved.body);
  store.transaction(() => {
    const insert = store.db.prepare(
      'INSERT INTO audit_events(user_id,method,route,status,created_at) VALUES (?,?,?,?,?)',
    );
    insert.run(ownerId, 'GET', '/expired', 200, Date.now() - 31 * 86400000);
    for (let n = 0; n < 1002; n++) insert.run(ownerId, 'GET', '/recent', 200, Date.now());
  });
  const page = await call('GET', '/api/account/activity', undefined, owner);
  assert.equal(page.json().events.length, 50);
  assert.ok(page.json().nextBefore);
  assert.equal(
    store.db.prepare('SELECT count(*) AS n FROM audit_events WHERE user_id = ?').get(ownerId)!.n,
    1000,
  );
  assert.equal(
    store.db.prepare("SELECT count(*) AS n FROM audit_events WHERE route = '/expired'").get()!.n,
    0,
  );
  const next = await call(
    'GET',
    `/api/account/activity?before=${page.json().nextBefore}`,
    undefined,
    owner,
  );
  assert.ok(next.json().events.every((event: { id: number }) => event.id < page.json().nextBefore));
});

test('exclusão exige senha e confirmação, remove metadados próprios e mantém MongoDB e outra conta', async () => {
  assert.equal(
    (await call('DELETE', '/api/account', { password: newPassword, confirmation: 'wrong' }, owner))
      .statusCode,
    400,
  );
  assert.equal(
    (await call('DELETE', '/api/account', { password, confirmation: 'EXCLUIR MINHA CONTA' }, owner))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await call(
        'DELETE',
        '/api/account',
        { password: newPassword, confirmation: 'EXCLUIR MINHA CONTA', userId: 'another' },
        owner,
      )
    ).statusCode,
    400,
  );
  const deleted = await call(
    'DELETE',
    '/api/account',
    { password: newPassword, confirmation: 'EXCLUIR MINHA CONTA' },
    owner,
  );
  assert.equal(deleted.statusCode, 200, deleted.body);
  assert.equal(store.user(ownerId), undefined);
  for (const table of [
    'sessions',
    'connections',
    'queries',
    'account_tokens',
    'account_mail',
    'audit_events',
  ])
    assert.equal(
      store.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id = ?`).get(ownerId)!.n,
      0,
      table,
    );
  assert.equal((await call('GET', '/api/auth/me', undefined, owner)).statusCode, 401);
  assert.equal((await call('GET', '/api/auth/me', undefined, other)).statusCode, 200);
  assert.equal(
    await fixture.db('canopy_accounts').collection('preserved').countDocuments({ keep: true }),
    1,
  );
});

test('usuário MongoDB restrito vê apenas banco/coleção concedidos e o servidor recusa leitura e escrita proibidas', async () => {
  await fixture
    .db('canopy_restricted')
    .collection('allowed')
    .insertOne({ label: 'public-to-role' });
  await fixture.db('canopy_restricted').collection('denied').insertOne({ label: 'secret' });
  await fixture.db('canopy_restricted').command({
    createRole: 'only_allowed',
    privileges: [
      {
        resource: { db: 'canopy_restricted', collection: 'allowed' },
        actions: ['find', 'listIndexes'],
      },
    ],
    roles: [],
  });
  await fixture.db('canopy_restricted').command({
    createUser: 'limited',
    pwd: password,
    mechanisms: ['SCRAM-SHA-256'],
    roles: ['only_allowed'],
  });
  const verifyOther = await delivered('other@example.test', 'verify-email');
  assert.equal(
    (await call('POST', '/api/auth/verify-email', { token: verifyOther, password })).statusCode,
    200,
  );
  const uri = new URL(process.env.TEST_MONGO_URI!);
  uri.username = 'limited';
  uri.password = password;
  uri.searchParams.set('authSource', 'canopy_restricted');
  const created = await call(
    'POST',
    '/api/connections',
    { name: 'Restricted', uri: uri.toString(), readOnly: false },
    other,
  );
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().connection.id;
  const databases = await call('GET', `/api/connections/${id}/databases`, undefined, other);
  assert.deepEqual(databases.json().databases, ['canopy_restricted']);
  const collections = await call(
    'GET',
    `/api/connections/${id}/databases/canopy_restricted/collections`,
    undefined,
    other,
  );
  assert.deepEqual(collections.json().collections, ['allowed']);
  const target = `/api/connections/${id}/databases/canopy_restricted/collections`;
  assert.equal(
    (await call('POST', `${target}/allowed/query`, { mode: 'find', text: '{}' }, other)).statusCode,
    200,
  );
  assert.equal(
    (await call('POST', `${target}/denied/query`, { mode: 'find', text: '{}' }, other)).statusCode,
    502,
  );
  assert.equal(
    (
      await call(
        'POST',
        `${target}/allowed/documents`,
        { action: 'insert', document: '{"label":"forbidden"}' },
        other,
      )
    ).statusCode,
    502,
  );
  assert.equal(await fixture.db('canopy_restricted').collection('allowed').countDocuments(), 1);
  await fixture.db('canopy_restricted').command({
    createUser: 'legacy_scram',
    pwd: password,
    mechanisms: ['SCRAM-SHA-1'],
    roles: ['only_allowed'],
  });
  uri.username = 'legacy_scram';
  const sha1 = await call(
    'POST',
    '/api/connections',
    { name: 'SCRAM SHA1', uri: uri.toString(), readOnly: true },
    other,
  );
  assert.equal(sha1.statusCode, 201, sha1.body);
  uri.password = 'wrong-MongoDB-password';
  assert.equal(
    (
      await call(
        'POST',
        '/api/connections',
        { name: 'Wrong password', uri: uri.toString(), readOnly: true },
        other,
      )
    ).statusCode,
    502,
  );
  uri.password = password;
  uri.searchParams.set('authSource', 'admin');
  assert.equal(
    (
      await call(
        'POST',
        '/api/connections',
        { name: 'Wrong authSource', uri: uri.toString(), readOnly: true },
        other,
      )
    ).statusCode,
    502,
  );
});

test('produção sem SMTP mantém login e confirmação inicial, bloqueia fluxos de e-mail e preserva dados', async () => {
  const initialId = randomUUID();
  const initialToken = randomBytes(32).toString('hex');
  const existing = store.userByEmail('other@example.test')!;
  store.db
    .prepare('INSERT INTO users(id,email,name,password,created_at) VALUES (?,?,?,?,?)')
    .run(initialId, 'initial@example.test', 'Initial owner', existing.password, Date.now());
  store.db
    .prepare('INSERT INTO account_tokens VALUES (?,?,?,?,?)')
    .run(digest(initialToken), initialId, 'verify', Date.now() + 60000, Date.now());
  await app.close();
  const productionOrigin = 'https://canopy.example';
  app = await createApp(
    readConfig({
      APP_ORIGIN: productionOrigin,
      DATA_DIR: directory,
      ENCRYPTION_KEY: config.encryptionKey.toString('hex'),
      NODE_ENV: 'production',
      MAIL_MODE: 'disabled',
    }),
  );
  await app.ready();
  const options = await app.inject('/api/auth/options');
  assert.equal(options.statusCode, 200);
  assert.deepEqual(options.json(), { emailFlowsAvailable: false });
  assert.equal((await app.inject('/api/connections')).statusCode, 401);
  const post = (url: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url, headers: { origin: productionOrigin }, payload });
  const login = await post('/api/auth/login', { email: 'other@example.test', password });
  assert.equal(login.statusCode, 200, login.body);
  assert.match(login.headers['set-cookie'] as string, /^__Host-canopy=/);
  assert.match(login.headers['set-cookie'] as string, /; Secure/);
  const identity = session(login);
  const headers = {
    origin: productionOrigin,
    cookie: identity.cookie,
    'x-csrf-token': identity.csrf,
  };
  const catalog = await app.inject({ url: '/api/connections', headers });
  assert.equal(catalog.statusCode, 200, catalog.body);
  assert.ok(catalog.json().connections.length >= 2);
  const beforeUsers = store.db.prepare('SELECT count(*) AS n FROM users').get()!.n;
  const beforeMail = store.db.prepare('SELECT count(*) AS n FROM account_mail').get()!.n;
  for (const [route, payload] of [
    ['/api/auth/register', { email: 'new@example.test', name: 'New user', password }],
    ['/api/auth/forgot-password', { email: 'other@example.test' }],
    ['/api/auth/resend-verification', { email: 'initial@example.test' }],
    ['/api/auth/reset-password', { token: 'a'.repeat(64), password: newPassword }],
  ] as const) {
    const response = await post(route, payload);
    assert.equal(response.statusCode, 503, response.body);
    assert.match(response.json().error, /temporariamente indisponíveis/);
  }
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM users').get()!.n, beforeUsers);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM account_mail').get()!.n, beforeMail);
  const initialLogin = await post('/api/auth/login', { email: 'initial@example.test', password });
  assert.equal(initialLogin.statusCode, 200, initialLogin.body);
  const unverified = session(initialLogin);
  assert.equal(
    (await app.inject({ url: '/api/connections', headers: { cookie: unverified.cookie } }))
      .statusCode,
    403,
  );
  const verified = await post('/api/auth/verify-email', { token: initialToken, password });
  assert.equal(verified.statusCode, 200, verified.body);
  assert.equal(
    (await post('/api/auth/verify-email', { token: initialToken, password })).statusCode,
    400,
  );
  assert.equal(
    (await app.inject({ url: '/api/connections', headers: { cookie: unverified.cookie } }))
      .statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/auth/logout', headers, payload: {} }))
      .statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ url: '/api/auth/me', headers: { cookie: identity.cookie } })).statusCode,
    401,
  );
});
