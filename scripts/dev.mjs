import { spawn } from 'node:child_process';
import { loadEnvFile } from 'node:process';

loadEnvFile('.env');
const children = [
  spawn(process.execPath, ['--import', 'tsx', '--watch', 'src/server/main.ts'], {
    stdio: 'inherit',
    env: { ...process.env, APP_ORIGIN: 'http://localhost:5174' },
  }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' }),
];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', (error) => {
    console.error(error);
    stop(1);
  });
  child.on('exit', (code) => stop(code ?? 1));
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
