import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createApplication } from '../../selfhost/app.mjs';
import { VERSION } from '../../selfhost/config.mjs';

const require = createRequire(import.meta.url);
const C = require('../../game/circuit.js'), V = require('../../game/v2-examples.js'), library = require('../../game/chip-library.js');
const password = 'http-integration-password', newPassword = 'new-http-integration-password';

async function fixture(t, options = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'silicon-http-'));
  let app, origin;
  const start = async () => {
    app = await createApplication({ dataDir: directory, host: '127.0.0.1', port: 0, publicOrigin: '', ...options });
    const address = await app.listen(); origin = `http://127.0.0.1:${address.port}`;
  };
  t.after(async () => { await app?.close(); rmSync(directory, { recursive: true, force: true }); });
  await start();
  async function request(route, { method = 'GET', body, cookie, headers = {}, origin: originOverride } = {}) {
    const requestHeaders = { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) };
    if (!['GET', 'HEAD'].includes(method) && originOverride !== null) requestHeaders.Origin = originOverride ?? (options.publicOrigin || origin);
    Object.assign(requestHeaders, headers);
    const response = await fetch(origin + route, { method, headers: requestHeaders, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }), redirect: 'manual' });
    const text = await response.text(); let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, body: data, headers: response.headers, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  return {
    directory, request,
    get origin() { return origin; },
    setup: (extra = {}) => request('/api/auth/setup', { method: 'POST', body: { setupToken: readFileSync(path.join(directory, 'setup-token'), 'utf8').trim(), username: 'admin', password }, ...extra }),
    login: (username = 'admin', value = password) => request('/api/auth/login', { method: 'POST', body: { username, password: value } }),
    async member(cookie, username = 'player') {
      const invitation = await request('/api/auth/invites', { method: 'POST', cookie, body: {} });
      assert.equal(invitation.status, 201, JSON.stringify(invitation.body));
      const registered = await request('/api/auth/register', { method: 'POST', body: { username, password, inviteToken: invitation.body.inviteToken } });
      assert.equal(registered.status, 201, JSON.stringify(registered.body)); return registered;
    },
    async restart() { await app.close(); app = undefined; await start(); },
  };
}

async function chipPackage() {
  const entry = await library.entry('counter2');
  return { format: 'silicon-lab.chip/2', ...entry, sources: {}, module: null };
}

async function publish(f, cookie, extra = {}) {
  const result = await f.request('/api/library', { method: 'POST', cookie, body: { requestId: 'http-publication', package: await chipPackage(), title: '私有计数器', ...extra } });
  assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body;
}

async function createRoom(f, cookie) {
  const built = await V.build('spi-register');
  const result = await f.request('/api/rooms', { method: 'POST', cookie, body: { workspace: { format: 'silicon-lab.workspace/1', project: built.project, view: built.view, sources: built.sources } } });
  assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body;
}

function rawGet(origin, rawPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(origin);
    const request = http.request({ hostname: url.hostname, port: url.port, method: 'GET', path: rawPath }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', data => body += data);
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.on('error', reject); request.end();
  });
}

test('HTTP health and atomic first-admin setup expose no setup secret or password hash', async t => {
  const f = await fixture(t);
  const health = await f.request('/healthz');
  assert.equal(health.status, 200); assert.deepEqual(health.body, { status: 'ok', version: VERSION });
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(health.headers.get('x-frame-options'), 'DENY');
  assert.match(health.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const status = await f.request('/api/auth/status');
  assert.deepEqual(status.body, { needsSetup: true, user: null });
  const results = await Promise.all([f.setup(), f.setup()]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  const admin = results.find(r => r.status === 201);
  assert.equal(admin.body.user.role, 'admin'); assert.ok(admin.cookie);
  assert.match(admin.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  assert.equal(admin.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(JSON.stringify(admin.body), /password_hash|setupToken|scrypt/);
  const session = await f.request('/api/session', { cookie: admin.cookie });
  assert.equal(session.status, 200); assert.equal(session.body.user, admin.body.user.id);
});

test('HTTP identity boundary rejects platform-header spoof and ignores spoofed owner with valid member cookie', async t => {
  const f = await fixture(t), admin = await f.setup(), member = await f.member(admin.cookie);
  const spoof = { 'oai-authenticated-user-id': admin.body.user.id, 'x-openai-user-id': admin.body.user.id, 'x-forwarded-user': admin.body.user.id, Authorization: 'Bearer fake-session' };
  assert.equal((await f.request('/api/session', { headers: spoof })).status, 401);
  assert.equal((await f.request('/api/library', { headers: spoof })).status, 401);
  const current = await f.request('/api/session', { cookie: member.cookie, headers: spoof });
  assert.equal(current.status, 200); assert.equal(current.body.user, member.body.user.id);
  assert.equal((await f.request('/api/auth/users', { cookie: member.cookie, headers: spoof })).status, 403);
});

test('HTTP mutations require exact Origin and JSON; forwarded headers cannot bypass origin checks', async t => {
  const f = await fixture(t);
  assert.equal((await f.setup({ origin: null })).status, 403);
  assert.equal((await f.setup({ origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.setup({ origin: 'null' })).status, 403);
  assert.equal((await f.setup({ headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await f.setup({ origin: 'https://evil.example', headers: { 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'https' } })).status, 403);
  assert.equal((await f.setup({ headers: { 'Content-Type': 'text/plain' } })).status, 415);
  const admin = await f.setup(); assert.equal(admin.status, 201);
  assert.equal((await f.request('/api/rooms', { method: 'POST', cookie: admin.cookie, origin: null, body: {} })).status, 403);
  assert.equal((await f.request('/api/rooms', { method: 'POST', cookie: admin.cookie, origin: 'https://evil.example', body: {} })).status, 403);
  assert.equal((await f.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'x'.repeat(20000) } })).status, 413);
});

test('real accounts isolate private chip library and explicit chip invitation grants/revokes access', async t => {
  const f = await fixture(t), admin = await f.setup(), member = await f.member(admin.cookie), published = await publish(f, admin.cookie);
  assert.equal((await f.request(`/api/library/${published.chipId}`)).status, 401);
  assert.equal((await f.request('/api/library', { cookie: member.cookie })).body.items.length, 0);
  assert.equal((await f.request(`/api/library/${published.chipId}`, { cookie: member.cookie })).status, 404);
  const own = await f.request(`/api/library/${published.chipId}`, { cookie: admin.cookie });
  assert.equal(own.status, 200); assert.equal(own.body.release.package.definition.name, (await chipPackage()).definition.name);
  const invitation = await f.request('/api/invites', { method: 'POST', cookie: admin.cookie, body: { kind: 'chip', resource: published.chipId } });
  assert.equal(invitation.status, 201);
  assert.equal((await f.request('/api/invites/join', { method: 'POST', cookie: member.cookie, body: { token: invitation.body.token } })).status, 200);
  assert.equal((await f.request(`/api/library/${published.chipId}`, { cookie: member.cookie })).status, 200);
  assert.equal((await f.request(`/api/invites/${invitation.body.id}`, { method: 'DELETE', cookie: admin.cookie, body: {} })).status, 200);
  assert.equal((await f.request(`/api/library/${published.chipId}`, { cookie: member.cookie })).status, 404);
});

test('real room executes SPI, preserves retry receipts and enforces second-account viewer role', async t => {
  const f = await fixture(t), admin = await f.setup(), member = await f.member(admin.cookie), room = await createRoom(f, admin.cookie);
  assert.equal((await f.request(`/api/rooms/${room.id}`, { cookie: member.cookie })).status, 403);
  const invite = await f.request('/api/invites', { method: 'POST', cookie: admin.cookie, body: { kind: 'room', resource: room.id, role: 'viewer' } });
  assert.equal(invite.status, 201);
  assert.equal((await f.request('/api/invites/join', { method: 'POST', cookie: member.cookie, body: { token: invite.body.token } })).status, 200);
  const operation = { clientId: 'http-controller', sequence: 1, epoch: room.epoch, operation: { kind: 'advance', single: true, microseconds: 1000 } };
  const advanced = await f.request(`/api/rooms/${room.id}/operations`, { method: 'POST', cookie: admin.cookie, body: operation });
  assert.equal(advanced.status, 200, JSON.stringify(advanced.body));
  const runtime = C.Runtime.fromSnapshot(advanced.body.workspace.project, advanced.body.snapshot);
  assert.equal(runtime.inspect().instances.mcu.ram[0], 90);
  const again = await f.request(`/api/rooms/${room.id}/operations`, { method: 'POST', cookie: admin.cookie, body: operation });
  assert.deepEqual(again.body.snapshot, advanced.body.snapshot);
  const viewer = await f.request(`/api/rooms/${room.id}`, { cookie: member.cookie });
  assert.deepEqual(viewer.body.snapshot, advanced.body.snapshot);
  assert.equal((await f.request(`/api/rooms/${room.id}/operations`, { method: 'POST', cookie: member.cookie, body: { ...operation, clientId: 'viewer' } })).status, 403);
});

test('server restart keeps accounts, opaque sessions, private chips and complete room state', async t => {
  const f = await fixture(t), admin = await f.setup(), published = await publish(f, admin.cookie), room = await createRoom(f, admin.cookie);
  const body = { clientId: 'restart-controller', sequence: 1, epoch: room.epoch, operation: { kind: 'advance', single: true, microseconds: 1000 } };
  const advanced = await f.request(`/api/rooms/${room.id}/operations`, { method: 'POST', cookie: admin.cookie, body });
  assert.equal(advanced.status, 200);
  await f.restart();
  assert.equal((await f.request('/api/auth/status', { cookie: admin.cookie })).body.user.id, admin.body.user.id);
  assert.equal((await f.setup()).status, 409);
  assert.equal((await f.login()).status, 200);
  assert.equal((await f.request(`/api/library/${published.chipId}`, { cookie: admin.cookie })).status, 200);
  assert.deepEqual((await f.request(`/api/rooms/${room.id}`, { cookie: admin.cookie })).body.snapshot, advanced.body.snapshot);
  assert.deepEqual((await f.request(`/api/rooms/${room.id}/operations`, { method: 'POST', cookie: admin.cookie, body })).body.snapshot, advanced.body.snapshot);
});

test('HTTP password change revokes all sessions and disabling member blocks cloud endpoints immediately', async t => {
  const f = await fixture(t), admin = await f.setup(), second = await f.login(), member = await f.member(admin.cookie);
  const change = await f.request('/api/auth/password', { method: 'POST', cookie: admin.cookie, body: { currentPassword: password, newPassword } });
  assert.equal(change.status, 200); assert.match(change.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await f.request('/api/session', { cookie: admin.cookie })).status, 401);
  assert.equal((await f.request('/api/session', { cookie: second.cookie })).status, 401);
  assert.equal((await f.login()).status, 401);
  const replacement = await f.login('admin', newPassword); assert.equal(replacement.status, 200);
  assert.equal((await f.request(`/api/auth/users/${member.body.user.id}`, { method: 'PATCH', cookie: replacement.cookie, body: { disabled: true } })).status, 200);
  assert.equal((await f.request('/api/library', { cookie: member.cookie })).status, 401);
  assert.equal((await f.login('player')).status, 401);
});

test('static routes serve game/manual with security headers and never expose DB, source or traversal paths', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/')).headers.get('location'), '/game/');
  assert.equal((await f.request('/signin-with-chatgpt')).headers.get('location'), '/login?return_to=/game/');
  const game = await f.request('/game/'); assert.equal(game.status, 200); assert.match(game.body, /<html/);
  assert.equal(game.headers.get('x-frame-options'), 'DENY');
  const head = await f.request('/game/circuit.js', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(head.body, ''); assert.ok(Number(head.headers.get('content-length')) > 1000);
  assert.equal((await f.request('/docs/CHIP-USER-MANUAL.html')).status, 200);
  for (const route of ['/data/setup-token', '/data/silicon.db', '/selfhost/auth.mjs', '/server/cloud.mjs', '/.env', '/game/.env', '/game/%2e%2e%2fselfhost/auth.mjs', '/game/%2e%2e/%2e%2e/data/setup-token', '/game/%252e%252e/selfhost/auth.mjs']) {
    const response = await rawGet(f.origin, route); assert.equal(response.status, 404, route);
    assert.doesNotMatch(response.body, /scrypt-v1|SQLite format/);
  }
  assert.equal((await rawGet(f.origin, '/game/%00')).status, 400);
  assert.equal((await rawGet(f.origin, '/game/%ZZ')).status, 400);
  assert.equal((await rawGet(f.origin, '/game/%5c..%5cselfhost/auth.mjs')).status, 400);
});

test('configured HTTPS canonical origin drives Secure cookies and cannot be overridden by client proxy headers', async t => {
  const canonical = 'https://silicon.example';
  const f = await fixture(t, { publicOrigin: canonical });
  assert.equal((await f.setup({ origin: f.origin, headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'silicon.example' } })).status, 403);
  const admin = await f.setup(); assert.equal(admin.status, 201);
  assert.match(admin.headers.get('set-cookie'), /; Secure$/);
  assert.equal((await f.request('/api/auth/logout', { method: 'POST', cookie: admin.cookie, body: {}, origin: 'https://evil.example', headers: { 'X-Forwarded-Host': 'evil.example' } })).status, 403);
  assert.equal((await f.request('/api/session', { cookie: admin.cookie })).status, 200);
});
