import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const container = `canopy-test-${randomUUID().slice(0, 8)}`;
const mongoPassword = randomUUID();
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 60000 });
  if (result.error || result.status !== 0)
    throw new Error(`Docker ${args[0]} falhou: ${result.error?.message ?? result.stderr}`);
  return result.stdout.trim();
}
let created = false;
try {
  const compiled = spawnSync(
    process.execPath,
    ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.server.json'],
    { stdio: 'inherit', timeout: 60000 },
  );
  if (compiled.error || compiled.status !== 0)
    throw new Error('A compilação do servidor para os testes falhou.', { cause: compiled.error });
  docker([
    'run',
    '--detach',
    '--rm',
    '--name',
    container,
    '--publish',
    '127.0.0.1::27017',
    '--env',
    'MONGO_INITDB_ROOT_USERNAME=canopy_root',
    '--env',
    `MONGO_INITDB_ROOT_PASSWORD=${mongoPassword}`,
    'mongo:8.0.5',
  ]);
  created = true;
  const port = docker([
    'inspect',
    '--format',
    '{{(index (index .NetworkSettings.Ports "27017/tcp") 0).HostPort}}',
    container,
  ]);
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--test',
      'tests/integration.test.ts',
      'tests/network.test.ts',
      'tests/accounts.test.ts',
      'tests/mail.test.ts',
      'tests/provision.test.ts',
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        TEST_MONGO_URI: `mongodb://canopy_root:${mongoPassword}@127.0.0.1:${port}/?authSource=admin`,
      },
      timeout: 120000,
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  if (created) docker(['stop', '--time', '5', container]);
}
