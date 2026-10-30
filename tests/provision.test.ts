import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { Store } from '../src/server/store.js';
import { hashPassword, digest, decrypt } from '../src/server/security.js';

test('importação inicial preserva hash e estado, gera confirmação de uso único e recusa sobrescrever contas', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'canopy-initial-'));
  const user = {
    id: randomUUID(),
    email: 'owner@example.test',
    name: 'Owner',
    password: await hashPassword('initial-owner-password-2026'),
    created_at: Date.now(),
    email_verified_at: null,
  };
  const env = {
    ...process.env,
    APP_ORIGIN: 'https://canopy.example',
    NODE_ENV: 'production',
    MAIL_MODE: 'disabled',
    DATA_DIR: directory,
    ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  };
  try {
    const result = JSON.parse(
      execFileSync(process.execPath, ['deploy/import-initial-accounts.mjs'], {
        input: JSON.stringify({ users: [user] }),
        encoding: 'utf8',
        env,
      }),
    );
    assert.equal(result.passwordHashesPreserved, true);
    assert.equal(result.imported.length, 1);
    const link = new URL(result.initialLinks[0].url);
    assert.equal(link.origin, env.APP_ORIGIN);
    const token = new URLSearchParams(link.hash.slice(1)).get('verify-email')!;
    assert.match(token, /^[a-f\d]{64}$/);
    const store = new Store(directory);
    try {
      assert.equal(store.user(user.id)!.password, user.password);
      assert.equal(store.user(user.id)!.email_verified_at, null);
      const row = store.db
        .prepare('SELECT hash, purpose FROM account_tokens WHERE user_id=?')
        .get(user.id)!;
      assert.equal(row.hash, digest(token));
      assert.equal(row.purpose, 'verify');
      const durable = store.db
        .prepare('SELECT id, payload, status FROM account_mail WHERE user_id=?')
        .get(user.id)!;
      assert.equal(durable.status, 'operator');
      assert.equal(String(durable.payload).includes(token), false);
      const recovered = JSON.parse(
        decrypt(
          String(durable.payload),
          Buffer.from(env.ENCRYPTION_KEY, 'hex'),
          `mail:${user.id}:${durable.id}`,
        ),
      );
      assert.equal(recovered.text, result.initialLinks[0].url);
      assert.throws(() =>
        execFileSync(process.execPath, ['deploy/import-initial-accounts.mjs'], {
          input: JSON.stringify({ users: [{ ...user, name: 'Overwrite' }] }),
          encoding: 'utf8',
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        }),
      );
      assert.equal(store.user(user.id)!.name, 'Owner');
      assert.equal(store.user(user.id)!.password, user.password);
      assert.equal(store.db.prepare('SELECT count(*) AS n FROM users').get()!.n, 1);
    } finally {
      store.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
