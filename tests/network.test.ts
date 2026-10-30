import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  connectionPlan,
  isPublicAddress,
  parseDocument,
  parseFilter,
  parsePipeline,
} from '../src/server/mongo.js';
import { readConfig } from '../src/server/config.js';
import { decrypt, encrypt } from '../src/server/security.js';
import { randomBytes } from 'node:crypto';

test('a fronteira de conexão bloqueia rede privada, opções inseguras e descoberta arbitrária', async () => {
  const config = { localHosts: [] };
  for (const uri of [
    'mongodb://127.0.0.1/',
    'mongodb://10.0.0.1/',
    'mongodb://169.254.169.254/',
    'mongodb://[::1]/',
    'mongodb://[::ffff:127.0.0.1]/',
    'mongodb://192.168.1.2/',
    'mongodb://127.0.0.1:80/',
    'mongodb://public.example/?tls=false',
    'mongodb://public.example/?tlsAllowInvalidCertificates=true',
    'mongodb://public.example/?tlsCAFile=/etc/passwd',
    'mongodb://public.example/?proxyHost=localhost',
    'mongodb://public.example/?w=0',
    'mongodb://one.example,two.example/',
    'mongodb+srv://arbitrary.example/',
    'mongodb://%2Ftmp%2Fmongodb.sock/',
  ])
    await assert.rejects(() => connectionPlan(uri, config), { name: 'Error' }, uri);
  for (const address of [
    '0.0.0.0',
    '127.1.2.3',
    '100.64.0.1',
    '198.18.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:10.0.0.1',
  ])
    assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  const atlas = await connectionPlan(
    'mongodb+srv://user:secret@cluster.example.mongodb.net/?replicaSet=rs0',
    config,
  );
  assert.equal(atlas.options.tls, true);
  assert.equal(atlas.options.srvMaxHosts, undefined);
  assert.equal(atlas.options.writeConcern?.w, 'majority');
  const direct = await connectionPlan('mongodb://127.0.0.1:27017/', { localHosts: ['127.0.0.1'] });
  assert.equal(direct.options.directConnection, true);
});

test('pipelines de leitura rejeitam escrita aninhada e JavaScript no servidor', () => {
  for (const text of [
    '[{"$out":"stolen"}]',
    '[{"$merge":"other"}]',
    '[{"$lookup":{"from":"items","pipeline":[{"$out":"other"}],"as":"joined"}}]',
    '[{"$facet":{"unsafe":[{"$merge":"other"}]}}]',
    '[{"$project":{"value":{"$function":{"body":"function(){return 1}","args":[],"lang":"js"}}}}]',
  ])
    assert.throws(() => parsePipeline(text));
  assert.throws(() => parseFilter('{"$where":"sleep(10000)"}'));
  assert.throws(() => parseDocument('{"$date":"2026-10-29T00:00:00Z"}'));
  assert.throws(() => parseDocument('{"$oid":"507f1f77bcf86cd799439011"}'));
  assert.equal(parsePipeline('[{"$match":{"active":true}}]').length, 1);
});

test('criptografia associa a credencial ao dono e falha em troca de chave ou adulteração', () => {
  const key = randomBytes(32);
  const encrypted = encrypt('mongodb://user:secret@example/', key, 'owner:connection');
  assert.equal(encrypted.includes('secret'), false);
  assert.equal(decrypt(encrypted, key, 'owner:connection'), 'mongodb://user:secret@example/');
  assert.throws(() => decrypt(encrypted, key, 'another-owner:connection'));
  assert.throws(() => decrypt(encrypted, randomBytes(32), 'owner:connection'));
});

test('produção falha sem HTTPS, chave ou com exceções para rede interna', () => {
  const base = {
    APP_ORIGIN: 'https://canopy.example',
    ENCRYPTION_KEY: 'a'.repeat(64),
    NODE_ENV: 'production',
    MAIL_MODE: 'smtp',
    SMTP_HOST: 'smtp.example.test',
  };
  assert.throws(() => readConfig({ ...base, APP_ORIGIN: 'http://canopy.example' }));
  assert.throws(() => readConfig({ ...base, ENCRYPTION_KEY: '' }));
  assert.throws(() => readConfig({ ...base, MONGO_ALLOWED_LOCAL_HOSTS: 'localhost' }));
  assert.throws(() => readConfig({ ...base, MAIL_MODE: 'file' }));
  assert.throws(() => readConfig({ ...base, SMTP_HOST: undefined }));
  assert.throws(() => readConfig({ ...base, SMTP_USER: 'user' }));
  assert.equal(readConfig(base).production, true);
  assert.equal(
    readConfig({ ...base, MAIL_MODE: 'disabled', SMTP_HOST: undefined }).production,
    true,
  );
});
