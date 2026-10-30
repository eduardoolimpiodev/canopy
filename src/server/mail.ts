import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createTransport } from 'nodemailer';
import { z } from 'zod';
import type { Config } from './config.js';
import { decrypt, encrypt } from './security.js';
import { Store, type AccountMailRow } from './store.js';

const mailInput = z
  .object({ to: z.email(), subject: z.string().max(200), text: z.string().max(4000) })
  .strict();
export type AccountMail = z.infer<typeof mailInput>;
export class MailDeliveryError extends Error {
  readonly details: { deliveryId: string; code: string; smtpCode?: number; command?: string };
  constructor(deliveryId: string, cause: unknown) {
    super('Falha na entrega de e-mail; tentativa registrada e limitada a três envios.', { cause });
    this.name = 'MailDeliveryError';
    const source = cause as { code?: unknown; responseCode?: unknown; command?: unknown } | null;
    const code =
      typeof source?.code === 'string' && /^[A-Z_\d]{1,40}$/.test(source.code)
        ? source.code
        : 'UNCLASSIFIED';
    const smtpCode =
      typeof source?.responseCode === 'number' &&
      Number.isInteger(source.responseCode) &&
      source.responseCode >= 100 &&
      source.responseCode <= 599
        ? source.responseCode
        : undefined;
    const commands = [
      'CONN',
      'EHLO',
      'HELO',
      'STARTTLS',
      'AUTH PLAIN',
      'AUTH LOGIN',
      'AUTH XOAUTH2',
      'MAIL FROM',
      'RCPT TO',
      'DATA',
    ];
    const command =
      typeof source?.command === 'string' && commands.includes(source.command)
        ? source.command
        : undefined;
    this.details = { deliveryId, code, smtpCode, command };
  }
}

export class MailDelivery {
  private running: Promise<void> | undefined;
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;
  private transport;
  readonly directory: string;
  constructor(
    private store: Store,
    private config: Config,
  ) {
    this.directory = join(config.dataDir, 'mail');
    this.transport =
      config.mail.mode === 'smtp'
        ? createTransport({
            host: config.mail.host,
            port: config.mail.port,
            secure: config.mail.secure,
            requireTLS: true,
            auth: config.mail.auth,
            connectionTimeout: 5000,
            greetingTimeout: 5000,
            socketTimeout: 5000,
            dnsTimeout: 1500,
            disableFileAccess: true,
            disableUrlAccess: true,
            logger: false,
            debug: false,
          })
        : undefined;
  }
  payload(id: string, userId: string, mail: AccountMail) {
    return encrypt(
      JSON.stringify(mailInput.parse(mail)),
      this.config.encryptionKey,
      `mail:${userId}:${id}`,
    );
  }
  start(onFailure: (error: unknown) => void) {
    this.timer = setInterval(() => {
      this.flush().catch(onFailure);
    }, 1000);
    this.timer.unref();
  }
  flush() {
    if (!this.running && !this.stopped) {
      this.running = this.process().finally(() => {
        this.running = undefined;
      });
    }
    return this.running ?? Promise.resolve();
  }
  private async send(row: AccountMailRow) {
    if (this.config.mail.mode === 'disabled')
      throw Object.assign(new Error('Entrega de e-mail desativada na configuração.'), {
        code: 'MAIL_DISABLED',
      });
    const mail = mailInput.parse(
      JSON.parse(decrypt(row.payload, this.config.encryptionKey, `mail:${row.user_id}:${row.id}`)),
    );
    if (this.transport) {
      const result = await this.transport.sendMail({ from: this.config.mail.from, ...mail });
      if (!result.accepted?.length || result.rejected?.length) throw new Error('MailRejected');
    } else {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await writeFile(join(this.directory, `${row.id}.json`), JSON.stringify(mail), {
        mode: 0o600,
      });
    }
  }
  private async process() {
    const expired = this.store.db
      .prepare('SELECT id FROM account_mail WHERE created_at < ? LIMIT 100')
      .all(Date.now() - 86400000);
    for (const row of expired) {
      if (!this.transport) await this.removeFile(String(row.id));
      this.store.db.prepare('DELETE FROM account_mail WHERE id = ?').run(row.id);
    }
    this.store.db.prepare('DELETE FROM account_tokens WHERE expires_at <= ?').run(Date.now());
    this.store.db
      .prepare('DELETE FROM audit_events WHERE created_at < ?')
      .run(Date.now() - 30 * 86400000);
    for (let count = 0; count < 5 && !this.stopped; count++) {
      const row = this.store.nextMail();
      if (!row) break;
      this.store.db
        .prepare("UPDATE account_mail SET status = 'sending', attempts = attempts + 1 WHERE id = ?")
        .run(row.id);
      try {
        await this.send(row);
      } catch (error) {
        const failure = new MailDeliveryError(row.id, error);
        this.store.db
          .prepare('UPDATE account_mail SET status = ?, next_at = ?, last_error = ? WHERE id = ?')
          .run(
            this.config.mail.mode === 'disabled' || row.attempts + 1 >= 3 ? 'failed' : 'pending',
            Date.now() + 60000 * (row.attempts + 1),
            JSON.stringify(failure.details),
            row.id,
          );
        throw failure;
      }
      if (!this.store.user(row.user_id)) {
        if (!this.transport) await this.removeFile(row.id);
      } else {
        this.store.db
          .prepare("UPDATE account_mail SET status = 'sent', payload = '' WHERE id = ?")
          .run(row.id);
      }
    }
  }
  async removeFile(id: string) {
    try {
      await unlink(join(this.directory, `${id}.json`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  async close() {
    this.stopped = true;
    clearInterval(this.timer);
    try {
      await this.running;
    } finally {
      this.transport?.close();
    }
  }
}
