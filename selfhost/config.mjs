import path from 'node:path';
export const VERSION = '0.9.0-selfhost.1';
export function configuration(env = process.env) {
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 0 to 65535.');
  let publicOrigin = '';
  if (env.PUBLIC_ORIGIN) {
    const url = new URL(env.PUBLIC_ORIGIN);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('PUBLIC_ORIGIN must be an HTTP(S) origin without a path, credentials, query or fragment.');
    publicOrigin = url.origin;
  }
  return {port, host: env.HOST || '0.0.0.0', dataDir: path.resolve(env.SILICON_DATA_DIR || './data'), publicOrigin};
}
