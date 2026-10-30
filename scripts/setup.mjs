import { randomBytes } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';

if (existsSync('.env')) {
  console.log('.env já existe; configuração preservada.');
} else {
  writeFileSync(
    '.env',
    `APP_ORIGIN=http://localhost:4310\nHOST=127.0.0.1\nPORT=4310\nDATA_DIR=.data\nENCRYPTION_KEY=${randomBytes(32).toString('hex')}\nMONGO_ALLOWED_LOCAL_HOSTS=\nTRUSTED_PROXY_CIDRS=\nMAIL_MODE=file\nMAIL_FROM=canopy@localhost.test\n`,
    { mode: 0o600, flag: 'wx' },
  );
  console.log('Configuração local criada em .env. Preserve a chave junto ao backup dos dados.');
}
