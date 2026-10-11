import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile, realpath, stat} from 'node:fs/promises';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {randomBytes, createHash} from 'node:crypto';
import {openDatabase, acquireDatabaseLock} from './database.mjs';
import {createAuth} from './auth.mjs';
import {createCloudDispatcher} from './cloud-dispatcher.mjs';
import {configuration, VERSION} from './config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon'};
const json = (status, error) => new Response(JSON.stringify({error}), {status, headers: {'content-type': 'application/json; charset=utf-8'}});
const security = {
  'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY', 'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
};

function requestOrigin(req, configured) {
  const host = req.headers.host;
  if (!host || !/^(?:\[[a-f\d:]+\]|[a-z\d.-]+)(?::\d{1,5})?$/i.test(host)) throw Object.assign(new Error('Invalid Host header.'), {status: 400});
  return configured || new URL(`http://${host}`).origin;
}
async function readBody(req, limit) {
  if (Number(req.headers['content-length']) > limit) throw Object.assign(new Error('请求内容过大。'), {status: 413});
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('请求内容过大。'), {status: 413});
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function staticFile(base, relative, method) {
  const resolvedBase = await realpath(base);
  const candidate = path.resolve(base, relative);
  if (!candidate.startsWith(path.resolve(base) + path.sep) || relative.split(/[\\/]/).some(s => s.startsWith('.'))) return json(404, '文件不存在。');
  const mime = types[path.extname(candidate)];
  if (!mime) return json(404, '文件不存在。');
  try {
    const filename = await realpath(candidate);
    if (!filename.startsWith(resolvedBase + path.sep) || !(await stat(filename)).isFile()) return json(404, '文件不存在。');
    const data = await readFile(filename);
    const headers = {'content-type': mime, 'content-length': String(data.length), 'cache-control': 'no-cache'};
    if (relative === 'CHIP-USER-MANUAL.html') {
      // Keep the generated manual usable both offline and with our strict CSP.
      const hashes = [...data.toString('utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => `'sha256-${createHash('sha256').update(match[1].replace(/\r\n?/g, '\n')).digest('base64')}'`);
      headers['content-security-policy'] = security['content-security-policy'].replace("script-src 'self'", "script-src 'self' " + hashes.join(' '));
    }
    return new Response(method === 'HEAD' ? null : data, {headers});
  } catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return json(404, '文件不存在。'); throw error; }
}

export async function createApplication(options = {}) {
  const config = {...configuration(), ...options};
  const lock = acquireDatabaseLock(config.dataDir);
  let db, auth, cloud;
  try {
    const filename = path.join(config.dataDir, 'silicon.db');
    db = openDatabase(filename);
    const tokenPath = path.join(config.dataDir, 'setup-token');
    if (!existsSync(tokenPath)) writeFileSync(tokenPath, randomBytes(32).toString('base64url') + '\n', {flag: 'wx', mode: 0o600});
    auth = createAuth({db: db.sqlite, setupToken: readFileSync(tokenPath, 'utf8').trim(), secureCookies: config.publicOrigin.startsWith('https://')});
    cloud = await createCloudDispatcher(filename);
  } catch (error) { auth?.close(); db?.close(); lock.release(); throw error; }

  let closing = false;
  async function route(req) {
    if (!req.url?.startsWith('/') || req.url.startsWith('//') || req.url.includes('\\') || req.url.length > 4096) return json(400, '无效的请求地址。');
    const origin = requestOrigin(req, config.publicOrigin);
    const url = new URL(req.url, origin), pathname = decodeURIComponent(url.pathname);
    if (pathname.includes('\0') || pathname.includes('\\')) return json(400, '无效的请求地址。');
    const method = req.method || 'GET', safe = method === 'GET' || method === 'HEAD';
    if (pathname === '/healthz' && safe) return new Response(JSON.stringify({status: cloud.ready && !closing ? 'ok' : 'recovering', version: VERSION}), {status: cloud.ready && !closing ? 200 : 503, headers: {'content-type': 'application/json'}});
    if (pathname.startsWith('/api/')) {
      if (!safe && (req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site')) return json(403, '操作来源校验失败，请从本站页面重试。');
      if (!safe && !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return json(415, '请使用 JSON 请求内容。');
      const body = safe ? undefined : await readBody(req, pathname.startsWith('/api/auth/') ? 16384 : 1048576);
      const headers = new Headers();
      if (req.headers.cookie) headers.set('cookie', req.headers.cookie);
      if (req.headers['content-type']) headers.set('content-type', req.headers['content-type']);
      if (req.headers.origin) headers.set('origin', req.headers.origin);
      // No inbound identity or proxy header crosses the authentication boundary.
      const request = new Request(url, {method, headers, body});
      if (pathname.startsWith('/api/auth/')) return await auth.handle(request, {remoteAddress: req.socket.remoteAddress}) || json(404, '接口不存在。');
      const user = auth.authenticate(request);
      if (!user) return json(401, '请先登录本站账号。');
      headers.delete('cookie'); headers.set('oai-authenticated-user-id', user.id);
      return cloud.handle(new Request(url, {method, headers, body}));
    }
    if (!safe) return json(405, '此地址仅支持读取。');
    if (pathname === '/favicon.ico') return new Response(null, {status: 204});
    if (pathname === '/' || pathname === '/game') return new Response(null, {status: 302, headers: {location: '/game/'}});
    if (pathname === '/signin-with-chatgpt') return new Response(null, {status: 302, headers: {location: '/login?return_to=/game/'}});
    if (pathname === '/login' || pathname === '/account') return staticFile(path.join(root, 'selfhost/web'), 'index.html', method);
    if (pathname.startsWith('/account/')) return staticFile(path.join(root, 'selfhost/web'), pathname.slice('/account/'.length), method);
    if (pathname.startsWith('/game/')) return staticFile(path.join(root, 'game'), pathname.slice('/game/'.length) || 'index.html', method);
    if (pathname === '/docs/CHIP-USER-MANUAL.html') return staticFile(path.join(root, 'docs'), 'CHIP-USER-MANUAL.html', method);
    return json(404, '页面不存在。');
  }
  const server = http.createServer({maxHeaderSize: 16384, requestTimeout: 15000, headersTimeout: 10000, keepAliveTimeout: 5000}, async (req, res) => {
    try {
      const response = await route(req);
      for (const [key, value] of Object.entries(security)) res.setHeader(key, value);
      res.setHeader('cache-control', 'no-store');
      for (const [key, value] of response.headers) res.setHeader(key, value);
      res.statusCode = response.status;
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      const status = error.status || (error instanceof URIError ? 400 : 500);
      if (!res.headersSent) res.writeHead(status, {...security, 'content-type': 'application/json', 'cache-control': 'no-store'});
      res.end(JSON.stringify({error: status === 500 ? '服务暂时无法处理请求。' : error.message}));
    }
  });
  server.maxRequestsPerSocket = 1000;
  server.maxConnections = 128;
  server.on('clientError', (_error, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
  let closed;
  return {
    server, config,
    async listen() { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, () => { server.off('error', reject); resolve(); }); }); return server.address(); },
    close() {
      if (closed) return closed;
      closing = true;
      closed = (async () => {
        const httpClosed = new Promise(resolve => server.listening ? server.close(resolve) : resolve());
        await cloud.close(); server.closeAllConnections(); await httpClosed;
        auth.close(); db.close(); lock.release();
      })();
      return closed;
    },
  };
}
