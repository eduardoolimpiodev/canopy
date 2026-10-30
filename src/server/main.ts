import { createApp } from './app.js';
import { readConfig } from './config.js';

const config = readConfig(process.env);
const app = await createApp(config, { logger: true });
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
}
process.once('SIGINT', () => {
  close().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
});
process.once('SIGTERM', () => {
  close().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
});
try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  await app.close();
  throw error;
}
