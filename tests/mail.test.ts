import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as tlsServer, getCACertificates, setDefaultCACertificates } from 'node:tls';
import { createServer as tcpServer } from 'node:net';
import { once } from 'node:events';
import { readFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { Store } from '../src/server/store.js';
import { MailDelivery } from '../src/server/mail.js';
import { readConfig } from '../src/server/config.js';

test('e-mail desativado falha explicitamente sem gravar mensagem local nem repetir envio', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'canopy-mail-disabled-'));
  const config = readConfig({
    APP_ORIGIN: 'https://canopy.example',
    DATA_DIR: directory,
    ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    NODE_ENV: 'production',
    MAIL_MODE: 'disabled',
  });
  const store = new Store(directory);
  const delivery = new MailDelivery(store, config);
  try {
    store.db
      .prepare('INSERT INTO users(id,email,name,password,created_at) VALUES (?,?,?,?,?)')
      .run('owner', 'owner@example.test', 'Owner', 'unused-fixture', Date.now());
    const id = randomUUID();
    store.addMail(
      id,
      'owner',
      'verify',
      delivery.payload(id, 'owner', {
        to: 'owner@example.test',
        subject: 'Disabled',
        text: 'must-not-be-delivered',
      }),
    );
    await assert.rejects(() => delivery.flush(), /Falha na entrega/);
    const row = store.db
      .prepare('SELECT status,attempts,last_error FROM account_mail WHERE id=?')
      .get(id)!;
    assert.equal(row.status, 'failed');
    assert.equal(row.attempts, 1);
    assert.equal(JSON.parse(String(row.last_error)).code, 'MAIL_DISABLED');
    await assert.rejects(() => stat(delivery.directory), { code: 'ENOENT' });
    await delivery.flush();
    assert.equal(
      store.db.prepare('SELECT attempts FROM account_mail WHERE id=?').get(id)!.attempts,
      1,
    );
  } finally {
    await delivery.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('SMTP real com TLS recebe o e-mail e a fila limpa o conteúdo após aceite do servidor', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'canopy-smtp-'));
  const cert = await readFile(new URL('./fixtures/smtp-cert.pem', import.meta.url), 'utf8');
  const key = await readFile(new URL('./fixtures/smtp-key.pem', import.meta.url), 'utf8');
  const originalCAs = getCACertificates('default');
  setDefaultCACertificates([...originalCAs, cert]);
  const received: string[] = [];
  const server = tlsServer({ key, cert }, (socket) => {
    socket.write('220 localhost ESMTP\r\n');
    let buffer = '';
    let data = false;
    let body = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let end: number;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data) {
          if (line === '.') {
            received.push(body);
            data = false;
            socket.write('250 accepted\r\n');
          } else body += `${line}\n`;
        } else if (/^EHLO/.test(line)) socket.write('250-localhost\r\n250 SIZE 100000\r\n');
        else if (/^(MAIL FROM|RCPT TO)/.test(line)) socket.write('250 ok\r\n');
        else if (line === 'DATA') {
          data = true;
          socket.write('354 enter message\r\n');
        } else if (line === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('500 unsupported\r\n');
      }
    });
  });
  let store: Store | undefined;
  let delivery: MailDelivery | undefined;
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as { port: number }).port;
    const config = readConfig({
      APP_ORIGIN: 'http://localhost:4310',
      DATA_DIR: directory,
      ENCRYPTION_KEY: randomBytes(32).toString('hex'),
      MAIL_MODE: 'smtp',
      SMTP_HOST: 'localhost',
      SMTP_PORT: String(port),
      SMTP_TLS: 'tls',
      NODE_ENV: 'test',
    });
    store = new Store(directory);
    store.db
      .prepare('INSERT INTO users(id,email,name,password,created_at) VALUES (?,?,?,?,?)')
      .run('owner', 'owner@example.test', 'Owner', 'unused-fixture', Date.now());
    delivery = new MailDelivery(store, config);
    const id = randomUUID();
    store.addMail(
      id,
      'owner',
      'verify',
      delivery.payload(id, 'owner', {
        to: 'owner@example.test',
        subject: 'SMTP acceptance',
        text: 'safe-body',
      }),
    );
    await delivery.close();
    store.close();
    store = new Store(directory);
    delivery = new MailDelivery(store, config);
    await delivery.flush();
    assert.equal(received.length, 1);
    assert.match(received[0], /Subject: SMTP acceptance/);
    assert.match(received[0], /safe-body/);
    const row = store.db
      .prepare('SELECT status, attempts, payload FROM account_mail WHERE id = ?')
      .get(id)!;
    assert.deepEqual({ ...row }, { status: 'sent', attempts: 1, payload: '' });
  } finally {
    await delivery?.close();
    store?.close();
    server.close();
    await once(server, 'close');
    setDefaultCACertificates(originalCAs);
    await rm(directory, { recursive: true, force: true });
  }
});

test('SMTP sem STARTTLS é recusado; falha persiste e termina após três tentativas, inclusive após reinício', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'canopy-mail-failure-'));
  const commands: string[] = [];
  const server = tcpServer((socket) => {
    socket.write('220 local test\r\n');
    socket.on('data', (chunk) => {
      const line = chunk.toString();
      commands.push(line);
      if (line.startsWith('EHLO')) socket.write('250 localhost\r\n');
      else socket.write('500 TLS unavailable\r\n');
    });
  });
  let store: Store | undefined;
  let delivery: MailDelivery | undefined;
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as { port: number }).port;
    const config = readConfig({
      APP_ORIGIN: 'http://localhost:4310',
      DATA_DIR: directory,
      ENCRYPTION_KEY: randomBytes(32).toString('hex'),
      MAIL_MODE: 'smtp',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(port),
      NODE_ENV: 'test',
    });
    store = new Store(directory);
    store.db
      .prepare('INSERT INTO users(id,email,name,password,created_at) VALUES (?,?,?,?,?)')
      .run('owner', 'owner@example.test', 'Owner', 'unused-fixture', Date.now());
    const id = randomUUID();
    delivery = new MailDelivery(store, config);
    store.addMail(
      id,
      'owner',
      'reset',
      delivery.payload(id, 'owner', {
        to: 'owner@example.test',
        subject: 'private-subject',
        text: 'private-link-token',
      }),
    );
    for (let attempt = 1; attempt <= 3; attempt++) {
      store.db.prepare('UPDATE account_mail SET next_at = 0 WHERE id = ?').run(id);
      await assert.rejects(() => delivery!.flush(), /Falha na entrega/);
      const row: Record<string, SQLOutputValue> = store.db
        .prepare('SELECT status, attempts, payload, last_error FROM account_mail WHERE id = ?')
        .get(id)!;
      assert.equal(row.attempts, attempt);
      assert.equal(row.status, attempt === 3 ? 'failed' : 'pending');
      assert.equal(String(row.payload).includes('private-link-token'), false);
      const details = JSON.parse(String(row.last_error));
      assert.equal(details.deliveryId, id);
      assert.notEqual(details.code, 'UNCLASSIFIED');
      assert.equal(String(row.last_error).includes('private-link-token'), false);
      assert.equal(String(row.last_error).includes('owner@example.test'), false);
      if (attempt === 1) {
        await delivery.close();
        store.close();
        store = new Store(directory);
        delivery = new MailDelivery(store, config);
      }
    }
    const count = commands.length;
    await delivery.flush();
    assert.equal(commands.length, count);
    assert.equal(
      commands.some((command) => command.startsWith('DATA')),
      false,
    );
  } finally {
    await delivery?.close();
    store?.close();
    server.close();
    await once(server, 'close');
    await rm(directory, { recursive: true, force: true });
  }
});

test('migração de metadados preserva usuário anterior e exige confirmação sem marcar e-mail como verificado', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'canopy-migration-'));
  try {
    const legacy = new DatabaseSync(join(directory, 'canopy.sqlite'));
    legacy.exec(
      'CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password TEXT NOT NULL, created_at INTEGER NOT NULL)',
    );
    legacy
      .prepare('INSERT INTO users VALUES (?,?,?,?,?)')
      .run('existing', 'old@example.test', 'Existing', 'unchanged-password-hash', 1);
    legacy.close();
    const store = new Store(directory);
    try {
      assert.equal(store.user('existing')!.password, 'unchanged-password-hash');
      assert.equal(store.user('existing')!.email_verified_at, null);
      assert.equal(store.user('existing')!.name, 'Existing');
    } finally {
      store.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
