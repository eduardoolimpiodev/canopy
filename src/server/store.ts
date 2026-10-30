import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password: string;
  avatar: string | null;
  email_verified_at: number | null;
}
export interface SessionRow {
  user_id: string;
  csrf: string;
  expires_at: number;
  email: string;
  name: string;
  email_verified_at: number | null;
}
export type AccountPurpose = 'verify' | 'reset';
export type AuditAction = 'find' | 'aggregate' | 'insert' | 'replace' | 'delete';
export interface AccountMailRow {
  id: string;
  user_id: string;
  kind: AccountPurpose | 'password-changed';
  payload: string;
  attempts: number;
}
export interface ConnectionRow {
  id: string;
  user_id: string;
  name: string;
  host: string;
  uri: string;
  read_only: number;
  created_at: number;
}
export interface QueryRow {
  id: string;
  name: string;
  payload: string;
  created_at: number;
}

export class Store {
  readonly db: DatabaseSync;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(directory, 'canopy.sqlite'));
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, host TEXT NOT NULL, uri TEXT NOT NULL, read_only INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS connection_owner ON connections(user_id);
      CREATE TABLE IF NOT EXISTS queries (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE, name TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS query_owner ON queries(user_id, connection_id);
      CREATE TABLE IF NOT EXISTS account_tokens (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, purpose TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, UNIQUE(user_id, purpose));
      CREATE TABLE IF NOT EXISTS account_mail (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, created_at INTEGER NOT NULL, last_error TEXT);
      CREATE INDEX IF NOT EXISTS mail_due ON account_mail(status, next_at);
      CREATE TABLE IF NOT EXISTS audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, method TEXT NOT NULL, route TEXT NOT NULL, connection_id TEXT, database_name TEXT, collection_name TEXT, action TEXT, status INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS audit_owner ON audit_events(user_id, id DESC);
    `);
    const columns = this.db.prepare('PRAGMA table_info(users)').all();
    if (!columns.some((column) => column.name === 'avatar'))
      this.db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
    if (!columns.some((column) => column.name === 'email_verified_at'))
      this.db.exec('ALTER TABLE users ADD COLUMN email_verified_at INTEGER');
    if (
      !this.db
        .prepare('PRAGMA table_info(audit_events)')
        .all()
        .some((column) => column.name === 'action')
    )
      this.db.exec('ALTER TABLE audit_events ADD COLUMN action TEXT');
    if (
      !this.db
        .prepare('PRAGMA table_info(account_mail)')
        .all()
        .some((column) => column.name === 'last_error')
    )
      this.db.exec('ALTER TABLE account_mail ADD COLUMN last_error TEXT');
    this.db
      .prepare(
        "UPDATE account_mail SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END WHERE status = 'sending'",
      )
      .run();
  }
  userByEmail(email: string) {
    return this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as unknown as
      UserRow | undefined;
  }
  session(hash: string) {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    return this.db
      .prepare(
        'SELECT sessions.*, users.email, users.name, users.email_verified_at FROM sessions JOIN users ON users.id = sessions.user_id WHERE hash = ? AND expires_at > ?',
      )
      .get(hash, Date.now()) as unknown as SessionRow | undefined;
  }
  connections(userId: string) {
    return this.db
      .prepare('SELECT * FROM connections WHERE user_id = ? ORDER BY created_at DESC')
      .all(userId) as unknown as ConnectionRow[];
  }
  connection(userId: string, id: string) {
    return this.db
      .prepare('SELECT * FROM connections WHERE id = ? AND user_id = ?')
      .get(id, userId) as unknown as ConnectionRow | undefined;
  }
  user(id: string) {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as
      UserRow | undefined;
  }
  transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  addMail(id: string, userId: string, kind: AccountMailRow['kind'], payload: string) {
    this.db
      .prepare(
        'INSERT INTO account_mail(id, user_id, kind, payload, status, next_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, userId, kind, payload, 'pending', Date.now(), Date.now());
  }
  nextMail() {
    return this.db
      .prepare(
        "SELECT * FROM account_mail WHERE status = 'pending' AND next_at <= ? ORDER BY created_at, id LIMIT 1",
      )
      .get(Date.now()) as unknown as AccountMailRow | undefined;
  }
  mailStatus(userId: string) {
    return (
      this.db
        .prepare(
          "SELECT status, attempts, created_at AS createdAt FROM account_mail WHERE user_id = ? AND kind = 'verify' ORDER BY created_at DESC LIMIT 1",
        )
        .get(userId) ?? null
    );
  }
  audit(
    userId: string,
    event: {
      method: string;
      route: string;
      connectionId?: string;
      database?: string;
      collection?: string;
      action?: AuditAction | null;
      status: number;
    },
  ) {
    this.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO audit_events(user_id, method, route, connection_id, database_name, collection_name, action, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          userId,
          event.method,
          event.route,
          event.connectionId ?? null,
          event.database ?? null,
          event.collection ?? null,
          event.action ?? null,
          event.status,
          Date.now(),
        );
      this.db
        .prepare(
          'DELETE FROM audit_events WHERE user_id = ? AND (created_at < ? OR id NOT IN (SELECT id FROM audit_events WHERE user_id = ? ORDER BY id DESC LIMIT 1000))',
        )
        .run(userId, Date.now() - 30 * 86400000, userId);
    });
  }
  close() {
    this.db.close();
  }
}
