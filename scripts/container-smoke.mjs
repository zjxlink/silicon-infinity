// This check always uses its own Compose project, random loopback port and
// disposable named volume. It never attaches to an existing deployment.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {mkdir, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../game/circuit.js');
const V = require('../game/v2-examples.js');
const library = require('../game/chip-library.js');
const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = 'silicon-smoke-' + randomBytes(6).toString('hex');
const args = process.argv.slice(2);
if (args.some(value => value !== '--build') || args.length > 1) throw Error('Usage: node scripts/container-smoke.mjs [--build]');
const started = new Date();
const report = {version: require('../package.json').version, started: started.toISOString(), checks: [], passed: false};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const port = await new Promise((resolve, reject) => {
  const socket = createServer();
  socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => { const value = socket.address().port; socket.close(error => error ? reject(error) : resolve(value)); });
});
const origin = `http://127.0.0.1:${port}`;
const env = {...process.env, HTTP_PORT: String(port), BIND_ADDRESS: '127.0.0.1', PUBLIC_ORIGIN: origin};
const prefix = ['compose', '--project-name', project, '--file', path.join(root, 'compose.yaml')];
let attemptedStart = false;

async function docker(argv, timeout = 60000) {
  try { return (await exec('docker', argv, {cwd: root, env, timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true})).stdout.trim(); }
  catch (error) {
    // Do not echo command output: setup-token and account tools can contain secrets.
    throw Error(`Docker command failed (${argv.slice(0, 2).join(' ')}): ${error.code || error.signal || 'error'}`);
  }
}
const compose = (argv, timeout) => docker([...prefix, ...argv], timeout);
const inside = argv => compose(['exec', '-T', 'app', 'node', ...argv]);
async function check(name, fn) {
  try { await fn(); } catch (error) { throw Error(`${name}: ${error.message}`); }
  report.checks.push({name, passed: true}); console.log('PASS ' + name);
}
async function ready() {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try { const r = await fetch(origin + '/healthz', {signal: AbortSignal.timeout(2000)}); if (r.ok && (await r.json()).status === 'ok') return; } catch {}
    await pause(500);
  }
  throw Error('Container did not become healthy within 60 seconds.');
}
async function api(route, {method = 'GET', body, cookie} = {}) {
  const headers = {...(cookie ? {cookie} : {})};
  if (body !== undefined) { headers['content-type'] = 'application/json'; headers.origin = origin; }
  const r = await fetch(origin + route, {method, headers, ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(15000), redirect: 'manual'});
  const raw = await r.text(); let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  return {status: r.status, body: data, cookie: r.headers.get('set-cookie')?.split(';')[0], headers: r.headers};
}
function status(result, expected) { assert.equal(result.status, expected, 'Unexpected HTTP status; response body omitted to protect account data.'); return result; }

try {
  attemptedStart = true;
  await compose(['up', '-d', args.includes('--build') ? '--build' : '--no-build', 'app'], 240000);
  await ready();
  await check('hardened container, fresh private volume and actual game assets', async () => {
    const id = await compose(['ps', '-q', 'app']);
    const [container] = JSON.parse(await docker(['inspect', id]));
    assert.equal(container.Config.User, '1000:1000');
    assert.equal(container.HostConfig.ReadonlyRootfs, true);
    assert.ok(container.HostConfig.CapDrop.includes('ALL'));
    assert.ok(container.HostConfig.SecurityOpt.some(value => value.startsWith('no-new-privileges')));
    const data = container.Mounts.find(mount => mount.Destination === '/data');
    assert.equal(data.Type, 'volume'); assert.ok(data.Name.startsWith(project + '_'));
    assert.equal(await inside(['-p', 'String(process.getuid())']), '1000');
    assert.match(status(await api('/game/'), 200).body, /<html/);
    assert.match(status(await api('/account'), 200).body, /<html/);
    assert.equal(status(await api('/api/auth/status'), 200).body.needsSetup, true);
  });

  const password = randomBytes(24).toString('base64url');
  let admin, member, publication, room, advanced, operation;
  await check('first admin, invitation registration and member isolation', async () => {
    const token = await inside(['selfhost/auth-cli.mjs', 'setup-token']);
    admin = status(await api('/api/auth/setup', {method: 'POST', body: {setupToken: token, username: 'container_admin', password}}), 201);
    assert.equal(admin.body.user.role, 'admin'); assert.ok(admin.cookie);
    assert.match(admin.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
    const invitation = status(await api('/api/auth/invites', {method: 'POST', cookie: admin.cookie, body: {expiresHours: 1}}), 201);
    member = status(await api('/api/auth/register', {method: 'POST', body: {username: 'container_member', password, inviteToken: invitation.body.inviteToken}}), 201);
    assert.equal(member.body.user.role, 'member'); assert.ok(member.cookie);
    status(await api('/api/auth/users', {cookie: member.cookie}), 403);
    status(await api('/api/library'), 401);
  });

  await check('private chip and running SPI MCU state stored through real HTTP API', async () => {
    const entry = await library.entry('counter2');
    const chip = {format: 'silicon-lab.chip/2', ...entry, sources: {}, module: null};
    publication = status(await api('/api/library', {method: 'POST', cookie: admin.cookie, body: {requestId: 'container-chip', package: chip, title: 'Container persistence counter'}}), 201).body;
    status(await api(`/api/library/${publication.chipId}`, {cookie: member.cookie}), 404);
    const built = await V.build('spi-register');
    room = status(await api('/api/rooms', {method: 'POST', cookie: admin.cookie, body: {workspace: {format: 'silicon-lab.workspace/1', project: built.project, view: built.view, sources: built.sources}}}), 201).body;
    operation = {clientId: 'container-controller', sequence: 1, epoch: room.epoch, operation: {kind: 'advance', single: true, microseconds: 1000}};
    advanced = status(await api(`/api/rooms/${room.id}/operations`, {method: 'POST', cookie: admin.cookie, body: operation}), 200).body;
    assert.equal(C.Runtime.fromSnapshot(advanced.workspace.project, advanced.snapshot).inspect().instances.mcu.ram[0], 90);
  });

  async function persistentState() {
    const current = status(await api('/api/auth/status', {cookie: admin.cookie}), 200).body;
    assert.equal(current.needsSetup, false); assert.equal(current.user.id, admin.body.user.id);
    const login = status(await api('/api/auth/login', {method: 'POST', body: {username: 'container_admin', password}}), 200);
    assert.equal(login.body.user.id, admin.body.user.id);
    assert.equal(status(await api(`/api/library/${publication.chipId}`, {cookie: admin.cookie}), 200).body.release.package.definition.name, (await library.entry('counter2')).definition.name);
    status(await api(`/api/library/${publication.chipId}`, {cookie: member.cookie}), 404);
    assert.deepEqual(status(await api(`/api/rooms/${room.id}`, {cookie: admin.cookie}), 200).body.snapshot, advanced.snapshot);
    assert.deepEqual(status(await api(`/api/rooms/${room.id}/operations`, {method: 'POST', cookie: admin.cookie, body: operation}), 200).body.snapshot, advanced.snapshot);
  }
  await check('graceful container restart preserves accounts, sessions, private chip and idempotent room state', async () => {
    await compose(['restart', 'app']); await ready(); await persistentState();
  });
  await check('SIGKILL recovery releases the SQLite mutex and preserves committed simulation data', async () => {
    const inode = await inside(['-p', "String(require('node:fs').statSync('/data/server-lock.sqlite').ino)"]);
    await compose(['kill', '--signal', 'SIGKILL', 'app']);
    await compose(['up', '-d', '--no-build', 'app']); await ready();
    assert.equal(await inside(['-p', "String(require('node:fs').statSync('/data/server-lock.sqlite').ino)"]), inode);
    await persistentState();
  });
  await check('online SQLite backup and offline restore recover complete application state', async () => {
    const backup = JSON.parse(await inside(['selfhost/storage-cli.mjs', 'backup', 'container-smoke']));
    assert.equal(backup.integrity, 'ok');
    const inspected = JSON.parse(await inside(['selfhost/storage-cli.mjs', 'inspect', '/data/backups/container-smoke.sqlite']));
    assert.equal(inspected.integrity, 'ok');
    // Maintenance and container restarts can outlive the five-second control
    // lease. Exercise that case explicitly, then reacquire as the real UI does.
    // Use a separate client so the original operation remains a valid replay
    // both before and after restoring the backup.
    await pause(5500);
    const released = status(await api(`/api/rooms/${room.id}`, {cookie: admin.cookie}), 200).body;
    assert.equal(released.controller, null);
    const acquired = status(await api(`/api/rooms/${room.id}/operations`, {method: 'POST', cookie: admin.cookie, body: {clientId: 'container-maintenance', sequence: 1, epoch: released.epoch, operation: {kind: 'acquire'}}}), 200).body;
    const changed = status(await api(`/api/rooms/${room.id}/operations`, {method: 'POST', cookie: admin.cookie, body: {clientId: 'container-maintenance', sequence: 2, epoch: acquired.epoch, operation: {kind: 'advance', single: true, microseconds: 300}}}), 200);
    assert.notDeepEqual(changed.body.snapshot, advanced.snapshot);
    status(await api(`/api/auth/users/${member.body.user.id}`, {method: 'PATCH', cookie: admin.cookie, body: {disabled: true}}), 200);
    status(await api('/api/session', {cookie: member.cookie}), 401);
    await compose(['stop', 'app']);
    const restored = JSON.parse(await compose(['run', '--rm', '--no-deps', '-T', 'app', 'node', 'selfhost/storage-cli.mjs', 'restore', '/data/backups/container-smoke.sqlite', '--confirm']));
    assert.equal(restored.integrity, 'ok'); assert.ok(restored.previousBackup);
    await compose(['up', '-d', '--no-build', 'app']); await ready(); await persistentState();
    assert.equal(status(await api('/api/auth/status', {cookie: member.cookie}), 200).body.user.id, member.body.user.id);
  });
  report.passed = true;
} catch (error) {
  report.error = error.message; console.error('Container check failed: ' + error.message); process.exitCode = 1;
} finally {
  if (attemptedStart) {
    try { await compose(['down', '--volumes', '--remove-orphans']); }
    catch (error) { report.cleanupError = error.message; report.passed = false; process.exitCode = 1; }
  }
  report.finished = new Date().toISOString(); report.elapsedMs = Date.now() - started.getTime();
  await mkdir(path.join(root, 'qa/selfhost'), {recursive: true});
  await writeFile(path.join(root, 'qa/selfhost/container-smoke.json'), JSON.stringify(report, null, 2) + '\n');
}
