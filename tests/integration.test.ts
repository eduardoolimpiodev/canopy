import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { MongoClient, ObjectId, Long, Decimal128, BSON } from 'mongodb';
import { createApp } from '../src/server/app.js';
import { readConfig } from '../src/server/config.js';
import type { FastifyInstance } from 'fastify';

const origin = 'http://localhost:4310';
const password = 'Testing-only-passphrase-2026';
let app: FastifyInstance;
let directory: string;
let fixture: MongoClient;
let connectionId: string;
let readonlyId: string;
let original: Record<string, unknown>;
let alice: { cookie: string; csrf: string };
let bob: { cookie: string; csrf: string };
let config: ReturnType<typeof readConfig>;

async function register(email: string, name: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    headers: { origin },
    payload: { email, name, password },
  });
  assert.equal(response.statusCode, 201, response.body);
  assert.match(response.headers['set-cookie'] as string, /HttpOnly/);
  assert.match(response.headers['set-cookie'] as string, /SameSite=Strict/);
  let verification = '';
  for (let attempt = 0; attempt < 100 && !verification; attempt++) {
    for (const file of await readdir(join(directory, 'mail')).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    })) {
      const mail = JSON.parse(await readFile(join(directory, 'mail', file), 'utf8'));
      if (mail.to === email)
        verification = mail.text.match(/verify-email=([a-f\d]{64})/)?.[1] ?? '';
    }
    if (!verification) await delay(50);
  }
  assert.ok(verification, 'O worker precisa entregar a confirmação na caixa local.');
  const verified = await app.inject({
    method: 'POST',
    url: '/api/auth/verify-email',
    headers: { origin },
    payload: { token: verification, password },
  });
  assert.equal(verified.statusCode, 200, verified.body);
  return {
    cookie: (response.headers['set-cookie'] as string).split(';')[0],
    csrf: response.json().csrf,
  };
}
function call(
  session: typeof alice,
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: { origin, cookie: session.cookie, 'x-csrf-token': session.csrf },
    ...(method !== 'GET' ? { payload: payload ?? {} } : {}),
  });
}
const target = () => `/api/connections/${connectionId}/databases/canopy_test/collections/records`;

before(async () => {
  assert.ok(process.env.TEST_MONGO_URI, 'Use npm test para criar o MongoDB descartável.');
  directory = await mkdtemp(join(tmpdir(), 'canopy-test-'));
  config = readConfig({
    APP_ORIGIN: origin,
    ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    DATA_DIR: directory,
    NODE_ENV: 'test',
    MONGO_ALLOWED_LOCAL_HOSTS: '127.0.0.1',
  });
  fixture = new MongoClient(process.env.TEST_MONGO_URI!, { serverSelectionTimeoutMS: 15000 });
  await fixture.connect();
  await fixture
    .db('canopy_test')
    .collection('records')
    .insertMany([
      {
        _id: new ObjectId(),
        name: 'Alpha',
        count: Long.fromString('9007199254740993'),
        amount: Decimal128.fromString('12.30'),
        date: new Date('2026-10-29T12:00:00Z'),
        active: true,
      },
      { _id: new ObjectId(), name: 'Beta', active: false },
    ]);
  app = await createApp(config);
  await app.ready();
  alice = await register('alice@example.test', 'Alice');
  bob = await register('bob@example.test', 'Bob');
});
after(async () => {
  await app?.close();
  await fixture?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('sessão autentica, rejeita CSRF/origem e não expõe hash de senha', async () => {
  assert.equal((await app.inject('/api/connections')).statusCode, 401);
  const me = await call(alice, 'GET', '/api/auth/me');
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().user.email, 'alice@example.test');
  assert.equal(me.body.includes('password'), false);
  const csrf = await app.inject({
    method: 'POST',
    url: '/api/connections',
    headers: { origin, cookie: alice.cookie },
    payload: {},
  });
  assert.equal(csrf.statusCode, 403);
  const foreign = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: 'https://attacker.test' },
    payload: { email: 'alice@example.test', password },
  });
  assert.equal(foreign.statusCode, 403);
  const wrong = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin },
    payload: { email: 'alice@example.test', password: 'wrong-password-value' },
  });
  assert.equal(wrong.statusCode, 401);
});

test('conecta em MongoDB real, criptografa URI e lista apenas as conexões do dono', async () => {
  const created = await call(alice, 'POST', '/api/connections', {
    name: 'MongoDB de teste',
    uri: process.env.TEST_MONGO_URI,
    readOnly: false,
  });
  assert.equal(created.statusCode, 201, created.body);
  connectionId = created.json().connection.id;
  assert.equal(created.json().connection.uri, undefined);
  const second = await call(alice, 'POST', '/api/connections', {
    name: 'Somente leitura',
    uri: process.env.TEST_MONGO_URI,
    readOnly: true,
  });
  assert.equal(second.statusCode, 201, second.body);
  readonlyId = second.json().connection.id;
  assert.equal((await call(alice, 'GET', '/api/connections')).json().connections.length, 2);
  assert.deepEqual((await call(bob, 'GET', '/api/connections')).json().connections, []);
  const dbBytes = await readFile(join(directory, 'canopy.sqlite-wal'));
  assert.equal(dbBytes.includes(Buffer.from(process.env.TEST_MONGO_URI!)), false);
  assert.equal(dbBytes.includes(Buffer.from(password)), false);
});

test('outra conta não consegue ler, consultar, salvar, escrever ou remover a conexão alheia', async () => {
  for (const [method, url, payload] of [
    ['GET', `/api/connections/${connectionId}/databases`, undefined],
    ['GET', `/api/connections/${connectionId}/databases/canopy_test/collections`, undefined],
    ['POST', `${target()}/query`, { mode: 'find', text: '{}' }],
    ['GET', `${target()}/indexes`, undefined],
    ['POST', `${target()}/documents`, { action: 'insert', document: '{"name":"Intruder"}' }],
    ['GET', `/api/connections/${connectionId}/queries`, undefined],
    [
      'POST',
      `/api/connections/${connectionId}/queries`,
      {
        name: 'Intruder',
        database: 'canopy_test',
        collection: 'records',
        query: { mode: 'find', text: '{}' },
      },
    ],
    ['DELETE', `/api/connections/${connectionId}`, {}],
  ] as const) {
    const response = await call(bob, method, url, payload);
    assert.equal(response.statusCode, 404, `${method} ${url}: ${response.body}`);
  }
  assert.equal(await fixture.db('canopy_test').collection('records').countDocuments(), 2);
});

test('consulta real pagina e preserva ObjectId, Long, Decimal128 e Date em Extended JSON', async () => {
  const databases = await call(alice, 'GET', `/api/connections/${connectionId}/databases`);
  assert.ok(databases.json().databases.includes('canopy_test'));
  const collections = await call(
    alice,
    'GET',
    `/api/connections/${connectionId}/databases/canopy_test/collections`,
  );
  assert.ok(collections.json().collections.includes('records'));
  const response = await call(alice, 'POST', `${target()}/query`, {
    mode: 'find',
    text: '{}',
    sort: '{"name":1}',
    limit: 1,
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().hasMore, true);
  original = response.json().documents[0];
  assert.deepEqual(original.count, { $numberLong: '9007199254740993' });
  assert.deepEqual(original.amount, { $numberDecimal: '12.30' });
  assert.ok((original._id as Record<string, unknown>).$oid);
  assert.ok(original.date);
  const next = await call(alice, 'POST', `${target()}/query`, {
    mode: 'find',
    text: '{}',
    sort: '{"name":1}',
    limit: 1,
    skip: 1,
  });
  assert.equal(next.json().documents[0].name, 'Beta');
  assert.equal(next.json().hasMore, false);
});

test('agregação executa no MongoDB, índices são reais e erros de entrada permanecem explícitos', async () => {
  const response = await call(alice, 'POST', `${target()}/query`, {
    mode: 'aggregate',
    text: '[{"$match":{"active":true}},{"$count":"total"}]',
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(BSON.EJSON.deserialize(response.json().documents[0]).total, 1);
  const indexes = await call(alice, 'GET', `${target()}/indexes`);
  assert.equal(indexes.statusCode, 200, indexes.body);
  assert.equal(indexes.json().indexes[0].name, '_id_');
  for (const input of [
    { mode: 'find', text: 'not JSON' },
    { mode: 'find', text: '{"$date":"2026-10-29T00:00:00Z"}' },
    { mode: 'find', text: '{}', sort: 'bad' },
    { mode: 'aggregate', text: '[{"$out":"other"}]' },
  ]) {
    const failed = await call(alice, 'POST', `${target()}/query`, input);
    assert.equal(failed.statusCode, 400, failed.body);
  }
});

test('somente leitura bloqueia escrita e alterações concorrentes não sobrescrevem documentos', async () => {
  const denied = await call(
    alice,
    'POST',
    `/api/connections/${readonlyId}/databases/canopy_test/collections/records/documents`,
    { action: 'insert', document: '{"name":"Denied"}' },
  );
  assert.equal(denied.statusCode, 403);
  const altered = { ...original, name: 'Alpha edited' };
  const saved = await call(alice, 'POST', `${target()}/documents`, {
    action: 'replace',
    id: JSON.stringify({ _id: original._id }),
    original: JSON.stringify(original),
    document: JSON.stringify(altered),
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const stale = await call(alice, 'POST', `${target()}/documents`, {
    action: 'replace',
    id: JSON.stringify({ _id: original._id }),
    original: JSON.stringify(original),
    document: JSON.stringify({ ...original, name: 'Lost update' }),
  });
  assert.equal(stale.statusCode, 409, stale.body);
  const id = BSON.EJSON.deserialize({ _id: original._id })._id;
  const record = await fixture.db('canopy_test').collection('records').findOne({ _id: id });
  assert.equal(record!.name, 'Alpha edited');
  assert.equal(record!.count.toString(), '9007199254740993');
});

test('inserção e exclusão afetam o banco real; seletor com operador é rejeitado', async () => {
  const inserted = await call(alice, 'POST', `${target()}/documents`, {
    action: 'insert',
    document: '{"name":"Temporary"}',
  });
  assert.equal(inserted.statusCode, 200, inserted.body);
  const selector = JSON.stringify({ _id: inserted.json().insertedId });
  const record = await fixture
    .db('canopy_test')
    .collection('records')
    .findOne({ name: 'Temporary' });
  assert.ok(record);
  const exploit = await call(alice, 'POST', `${target()}/documents`, {
    action: 'delete',
    id: '{"_id":{"$ne":null}}',
    original: JSON.stringify(BSON.EJSON.serialize(record)),
  });
  assert.equal(exploit.statusCode, 400, exploit.body);
  const deleted = await call(alice, 'POST', `${target()}/documents`, {
    action: 'delete',
    id: selector,
    original: JSON.stringify(BSON.EJSON.serialize(record, { relaxed: false })),
  });
  assert.equal(deleted.statusCode, 200, deleted.body);
  assert.equal(
    await fixture.db('canopy_test').collection('records').countDocuments({ name: 'Temporary' }),
    0,
  );
  const activity = (await call(alice, 'GET', '/api/account/activity')).json().events as {
    action: string;
    status: number;
  }[];
  for (const action of ['insert', 'replace', 'delete'])
    assert.ok(
      activity.some((event) => event.action === action && event.status === 200),
      action,
    );
});

test('consultas salvas e conexões persistem após reiniciar a aplicação', async () => {
  const saved = await call(alice, 'POST', `/api/connections/${connectionId}/queries`, {
    name: 'Ativos',
    database: 'canopy_test',
    collection: 'records',
    query: { mode: 'find', text: '{"active":true}' },
  });
  assert.equal(saved.statusCode, 201, saved.body);
  await app.close();
  app = await createApp(config);
  await app.ready();
  const connections = await call(alice, 'GET', '/api/connections');
  assert.equal(connections.statusCode, 200, connections.body);
  assert.equal(connections.json().connections.length, 2);
  const queries = await call(alice, 'GET', `/api/connections/${connectionId}/queries`);
  assert.equal(queries.json().queries[0].query.text, '{"active":true}');
  assert.equal(
    (await call(bob, 'GET', `/api/connections/${connectionId}/queries`)).statusCode,
    404,
  );
});

test('logout revoga cookie já emitido e login cria uma sessão nova', async () => {
  assert.equal((await call(alice, 'POST', '/api/auth/logout')).statusCode, 200);
  assert.equal((await call(alice, 'GET', '/api/connections')).statusCode, 401);
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin },
    payload: { email: 'alice@example.test', password },
  });
  assert.equal(login.statusCode, 200, login.body);
  assert.notEqual((login.headers['set-cookie'] as string).split(';')[0], alice.cookie);
});
