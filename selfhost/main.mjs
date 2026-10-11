import {createApplication} from './app.mjs';
import {VERSION} from './config.mjs';

let app;
try {
  app = await createApplication();
  const address = await app.listen();
  console.log(`Silicon Infinity ${VERSION} listening on ${address.address}:${address.port}`);
  console.log('Open /game/ to play or /account to manage local accounts. First-time setup: see README.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
} catch (error) {
  console.error(`Startup failed: ${error.message}`);
  await app?.close(); process.exitCode = 1;
}
