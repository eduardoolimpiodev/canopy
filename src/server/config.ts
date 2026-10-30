import { resolve } from 'node:path';
import { z } from 'zod';
import ipaddr from 'ipaddr.js';

const envSchema = z.object({
  APP_ORIGIN: z.url(),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4310),
  DATA_DIR: z.string().min(1).default('.data'),
  ENCRYPTION_KEY: z
    .string()
    .regex(
      /^[a-f\d]{64}$/i,
      'Execute npm run setup ou forneça ENCRYPTION_KEY com 32 bytes em hexadecimal.',
    ),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MONGO_ALLOWED_LOCAL_HOSTS: z.string().default(''),
  TRUSTED_PROXY_CIDRS: z.string().default(''),
  MAIL_MODE: z.enum(['file', 'smtp', 'disabled']).default('file'),
  MAIL_FROM: z.email().default('canopy@localhost.test'),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_TLS: z.enum(['starttls', 'tls']).default('starttls'),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
});

export function readConfig(env: NodeJS.ProcessEnv) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success)
    throw new Error(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'),
    );
  const settings = parsed.data;
  const origin = new URL(settings.APP_ORIGIN);
  if (origin.origin !== settings.APP_ORIGIN)
    throw new Error('APP_ORIGIN deve conter apenas protocolo, host e porta, sem caminho.');
  if (!['http:', 'https:'].includes(origin.protocol))
    throw new Error('APP_ORIGIN deve usar HTTP ou HTTPS.');
  if (settings.NODE_ENV === 'production' && origin.protocol !== 'https:')
    throw new Error('Produção exige APP_ORIGIN com HTTPS.');
  const localHosts = settings.MONGO_ALLOWED_LOCAL_HOSTS.split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  const trustedProxies = settings.TRUSTED_PROXY_CIDRS.split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  if (trustedProxies.some((host) => !ipaddr.isValid(host) && !ipaddr.isValidCIDR(host)))
    throw new Error(
      'TRUSTED_PROXY_CIDRS aceita apenas IPs ou CIDRs dos proxies controlados pelo operador.',
    );
  if (settings.NODE_ENV === 'production' && localHosts.length)
    throw new Error('Exceções de rede local não são permitidas em produção.');
  if (settings.NODE_ENV === 'production' && settings.MAIL_MODE === 'file')
    throw new Error(
      'Produção não permite MAIL_MODE=file. Configure smtp ou disabled para suspender os fluxos de e-mail.',
    );
  if (settings.MAIL_MODE === 'smtp' && !settings.SMTP_HOST)
    throw new Error('MAIL_MODE=smtp exige SMTP_HOST.');
  if (!!settings.SMTP_USER !== !!settings.SMTP_PASSWORD)
    throw new Error('SMTP_USER e SMTP_PASSWORD devem ser fornecidos juntos.');
  return {
    origin: origin.origin,
    host: settings.HOST,
    port: settings.PORT,
    dataDir: resolve(settings.DATA_DIR),
    encryptionKey: Buffer.from(settings.ENCRYPTION_KEY, 'hex'),
    production: settings.NODE_ENV === 'production',
    localHosts,
    trustedProxies,
    mail: {
      mode: settings.MAIL_MODE,
      from: settings.MAIL_FROM,
      host: settings.SMTP_HOST,
      port: settings.SMTP_PORT,
      secure: settings.SMTP_TLS === 'tls',
      auth: settings.SMTP_USER
        ? { user: settings.SMTP_USER, pass: settings.SMTP_PASSWORD! }
        : undefined,
    },
  };
}
export type Config = ReturnType<typeof readConfig>;
