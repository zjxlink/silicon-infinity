import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createAuth, initializeAuthSchema, resetUserPassword, setUserDisabled } from '../../selfhost/auth.mjs';
import { openDatabase, acquireDatabaseLock } from '../../selfhost/database.mjs';

const setupToken = 'T'.repeat(43), password = 'correct-horse-battery', changedPassword = 'different-horse-battery';
function fixture(t, options = {}) {
  const db = new DatabaseSync(':memory:'); initializeAuthSchema(db);
  const auth = createAuth({ db, setupToken, ...options });
  t.after(() => { auth.close(); db.close(); });
  return { db, auth };
}
async function call(auth, route, body, { cookie, method, headers = {}, remoteAddress = '127.0.0.1' } = {}) {
  const request = new Request(`http://localhost/api/auth/${route}`, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const response = await auth.handle(request, { remoteAddress });
  return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers };
}
const setup = auth => call(auth, 'setup', { setupToken, username: 'Admin', password });
const login = (auth, username = 'admin', pw = password) => call(auth, 'login', { username, password: pw });
const requestWithCookie = cookie => new Request('http://localhost/api/silicon/me', { headers: { Cookie: cookie } });
async function addMember(auth, cookie, username = 'player') {
  const invitation = await call(auth, 'invites', {}, { cookie });
  assert.equal(invitation.status, 201);
  return { ...await call(auth, 'register', { inviteToken: invitation.body.inviteToken, username, password }), token: invitation.body.inviteToken };
}

test('bootstrap requires token; two simultaneous setup requests create exactly one admin', async t => {
  const { auth, db } = fixture(t);
  assert.equal((await call(auth, 'status')).body.needsSetup, true);
  assert.equal((await call(auth, 'setup', { setupToken: 'wrong', username: 'admin', password })).status, 403);
  const results = await Promise.all([setup(auth), setup(auth)]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.equal(db.prepare('SELECT count(*) AS n FROM auth_users').get().n, 1);
  const created = results.find(r => r.status === 201);
  assert.equal(created.body.user.username, 'admin');
  assert.equal(created.body.user.role, 'admin');
  assert.match(created.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  assert.equal((await setup(auth)).status, 409);
  assert.equal((await call(auth, 'status', undefined, { cookie: created.cookie })).body.needsSetup, false);
});

test('authentication trusts only opaque session cookie, stores only digest, expiry persists across auth instances', async t => {
  const { auth, db } = fixture(t, { secureCookies: true });
  const admin = await setup(auth);
  assert.match(admin.headers.get('set-cookie'), /; Secure$/);
  const token = admin.cookie.split('=')[1];
  const stored = db.prepare('SELECT token_hash FROM auth_sessions').get().token_hash;
  assert.notEqual(stored, token); assert.equal(stored, createHash('sha256').update(token).digest('hex'));
  assert.equal(auth.authenticate(new Request('http://localhost/', { headers: { 'x-openai-user-id': admin.body.user.id, 'x-silicon-user-id': admin.body.user.id, Authorization: `Bearer ${token}` } })), null);
  assert.equal(auth.authenticate(requestWithCookie(`${admin.cookie}; ${admin.cookie}`)), null);
  const restarted = createAuth({ db, setupToken });
  assert.equal(restarted.authenticate(requestWithCookie(admin.cookie)).id, admin.body.user.id);
  db.prepare('UPDATE auth_sessions SET expires = 0').run();
  assert.equal(restarted.authenticate(requestWithCookie(admin.cookie)), null); restarted.close();
});

test('login is case insensitive and rejects wrong or disabled credentials; logout revokes token', async t => {
  const { auth, db } = fixture(t); const admin = await setup(auth);
  assert.equal((await login(auth, 'ADMIN')).status, 200);
  assert.equal((await login(auth, 'admin', 'wrong-password')).status, 401);
  assert.equal((await login(auth, 'missing', password)).status, 401);
  const member = await addMember(auth, admin.cookie);
  setUserDisabled(db, 'player', true);
  assert.equal(auth.authenticate(requestWithCookie(member.cookie)), null);
  assert.equal((await login(auth, 'player')).status, 401);
  setUserDisabled(db, 'player', false);
  const enabled = await login(auth, 'player'); assert.equal(enabled.status, 200);
  const logout = await call(auth, 'logout', {}, { cookie: enabled.cookie });
  assert.equal(logout.status, 200); assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(auth.authenticate(requestWithCookie(enabled.cookie)), null);
});

test('password change requires current password and revokes every session including caller', async t => {
  const { auth } = fixture(t); const admin = await setup(auth), second = await login(auth);
  assert.equal((await call(auth, 'password', { currentPassword: 'wrong-password', newPassword: changedPassword }, { cookie: admin.cookie })).status, 403);
  assert.ok(auth.authenticate(requestWithCookie(second.cookie)));
  const result = await call(auth, 'password', { currentPassword: password, newPassword: changedPassword }, { cookie: admin.cookie });
  assert.equal(result.status, 200); assert.equal(result.body.loginRequired, true);
  assert.equal(auth.authenticate(requestWithCookie(admin.cookie)), null);
  assert.equal(auth.authenticate(requestWithCookie(second.cookie)), null);
  assert.equal((await login(auth)).status, 401);
  assert.equal((await login(auth, 'admin', changedPassword)).status, 200);
});

test('admin-only invites and account management; one-time invitation remains atomic during register race', async t => {
  const { auth, db } = fixture(t); const admin = await setup(auth);
  assert.equal((await call(auth, 'invites', {})).status, 401);
  const invitation = await call(auth, 'invites', { expiresHours: 1 }, { cookie: admin.cookie });
  const registrations = await Promise.all(['player-a', 'player-b'].map(username => call(auth, 'register', { inviteToken: invitation.body.inviteToken, username, password })));
  assert.deepEqual(registrations.map(r => r.status).sort(), [201, 403]);
  const member = registrations.find(r => r.status === 201);
  assert.equal(member.body.user.role, 'member');
  assert.equal((await call(auth, 'invites', {}, { cookie: member.cookie })).status, 403);
  assert.equal((await call(auth, 'users', undefined, { cookie: member.cookie })).status, 403);
  assert.equal((await call(auth, `users/${admin.body.user.id}`, { disabled: true }, { method: 'PATCH', cookie: member.cookie })).status, 403);
  assert.equal((await call(auth, `users/${admin.body.user.id}`, { disabled: true }, { method: 'PATCH', cookie: admin.cookie })).status, 409);
  assert.equal((await call(auth, `users/${member.body.user.id}`, { disabled: true }, { method: 'PATCH', cookie: admin.cookie })).status, 200);
  assert.equal(auth.authenticate(requestWithCookie(member.cookie)), null);
  assert.equal(db.prepare('SELECT count(*) AS n FROM auth_users').get().n, 2);
  const users = await call(auth, 'users', undefined, { cookie: admin.cookie });
  assert.equal(users.body.users.length, 2); assert.ok(users.body.users.every(u => !('password_hash' in u)));
});

test('expired invites, invalid registration, password bounds and payload bounds reject without creating users', async t => {
  const { auth, db } = fixture(t); const admin = await setup(auth);
  const invitation = await call(auth, 'invites', {}, { cookie: admin.cookie });
  db.prepare('UPDATE auth_invites SET expires = 0').run();
  assert.equal((await call(auth, 'register', { inviteToken: invitation.body.inviteToken, username: 'player', password })).status, 403);
  assert.equal((await call(auth, 'register', { username: 'player', password })).status, 403);
  const another = await call(auth, 'invites', {}, { cookie: admin.cookie });
  assert.equal((await call(auth, 'register', { inviteToken: another.body.inviteToken, username: 'player', password: 'short' })).status, 400);
  assert.equal((await call(auth, 'login', { username: 'admin', password: 'x'.repeat(9000) })).status, 413);
  const raw = new Request('http://localhost/api/auth/login', { method: 'POST', body: '{broken', headers: { 'Content-Type': 'application/json' } });
  assert.equal((await auth.handle(raw)).status, 400);
  assert.equal(db.prepare('SELECT count(*) AS n FROM auth_users').get().n, 1);
});

test('per-account throttling spans IP addresses and does not accept spoofed forwarding headers', async t => {
  const { auth } = fixture(t); await setup(auth);
  for (let i = 0; i < 12; i++) assert.equal((await call(auth, 'login', { username: 'admin', password: 'bad-password' }, { remoteAddress: `ip-${i}` })).status, 401);
  const blocked = await call(auth, 'login', { username: 'admin', password }, { remoteAddress: 'different', headers: { 'X-Forwarded-For': 'fresh-address' } });
  assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('retry-after'), '600');
  const ipBlocked = fixture(t).auth;
  for (let i = 0; i < 40; i++) assert.equal((await call(ipBlocked, 'login', { username: '$invalid', password }, { headers: { 'X-Forwarded-For': `fresh-${i}` } })).status, 400);
  assert.equal((await call(ipBlocked, 'login', { username: '$invalid', password })).status, 429);
});

test('session count is bounded and CLI reset primitive revokes all existing sessions', async t => {
  const { auth, db } = fixture(t); await setup(auth);
  for (let i = 0; i < 11; i++) assert.equal((await login(auth)).status, 200);
  assert.equal(db.prepare('SELECT count(*) AS n FROM auth_sessions').get().n, 10);
  await resetUserPassword(db, 'admin', changedPassword);
  assert.equal(db.prepare('SELECT count(*) AS n FROM auth_sessions').get().n, 0);
  assert.equal((await login(auth, 'admin', changedPassword)).status, 200);
  assert.throws(() => setUserDisabled(db, 'admin', true), /最后一位管理员/);
});

test('password hashing has a fixed concurrency budget and recovers after overload', async t => {
  const { auth } = fixture(t); await setup(auth);
  const attempts = await Promise.all(Array.from({ length: 5 }, (_, i) => call(auth, 'login', { username: 'admin', password }, { remoteAddress: `concurrency-${i}` })));
  assert.deepEqual(attempts.map(result => result.status).sort(), [200, 200, 200, 200, 503]);
  assert.equal((await login(auth)).status, 200);
});

test('rate-limiter storage stops accepting new attacker keys at its bounded capacity', async t => {
  const { auth } = fixture(t);
  for (let i = 0; i < 2048; i++) {
    const result = await call(auth, 'login', { username: `unknown-${i}`, password: null }, { remoteAddress: `source-${i}` });
    assert.equal(result.status, 401);
  }
  const blocked = await call(auth, 'login', { username: 'new-user', password: null }, { remoteAddress: 'new-source' });
  assert.equal(blocked.status, 429);
});

test('offline CLI uses migrated database and lock, rejects password argv, resets from stdin', async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'silicon-auth-cli-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const adapter = openDatabase(path.join(directory, 'silicon.db'));
  const auth = createAuth({ db: adapter.sqlite, setupToken }); await setup(auth); auth.close(); adapter.close();
  const options = { encoding: 'utf8', env: { ...process.env, SILICON_DATA_DIR: directory } };
  const cli = path.resolve('selfhost/auth-cli.mjs');
  const extra = spawnSync(process.execPath, [cli, 'reset-password', 'admin', 'do-not-accept-password-argv'], options);
  assert.equal(extra.status, 1); assert.doesNotMatch(extra.stderr, /do-not-accept-password-argv/);
  const lock = acquireDatabaseLock(directory);
  const blocked = spawnSync(process.execPath, [cli, 'reset-password', 'admin'], { ...options, input: changedPassword });
  assert.equal(blocked.status, 1); lock.release();
  const reset = spawnSync(process.execPath, [cli, 'reset-password', 'admin'], { ...options, input: changedPassword + '\n' });
  assert.equal(reset.status, 0, reset.stderr); assert.doesNotMatch(reset.stdout + reset.stderr, /different-horse/);
  const reopened = openDatabase(path.join(directory, 'silicon.db'));
  const restarted = createAuth({ db: reopened.sqlite, setupToken });
  assert.equal((await login(restarted, 'admin', changedPassword)).status, 200); restarted.close(); reopened.close();
  writeFileSync(path.join(directory, 'setup-token'), setupToken);
  const shown = spawnSync(process.execPath, [cli, 'setup-token'], options); assert.equal(shown.status, 0); assert.equal(shown.stdout.trim(), setupToken);
});
