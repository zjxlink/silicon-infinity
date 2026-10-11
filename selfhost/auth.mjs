import { randomBytes, randomUUID, scrypt as scryptCallback, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';

const scrypt = promisify(scryptCallback);
const COOKIE = 'silab_session';
const HASH_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const DUMMY_HASH = `scrypt-v1$${'00'.repeat(16)}$${'00'.repeat(32)}`;
const MAX_HASH_JOBS = 4;
let activeHashJobs = 0;

class AuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new AuthError(status, message); };
const digest = value => createHash('sha256').update(value).digest('hex');
const safeEqual = (a, b) => timingSafeEqual(Buffer.from(digest(a), 'hex'), Buffer.from(digest(b), 'hex'));
const publicUser = user => user ? { id: user.id, username: user.username, role: user.role } : null;
const nowSeconds = () => Math.floor(Date.now() / 1000);

/** For isolated in-memory tests only. Production migrations are owned by database.mjs. */
export function initializeAuthSchema(db) {
  db.exec(readFileSync(new URL('./auth-schema.sql', import.meta.url), 'utf8'));
}

export function normalizeUsername(value) {
  if (typeof value !== 'string') fail(400, '用户名需要 3–32 位英文字母、数字、点、下划线或短横线。');
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) fail(400, '用户名需要 3–32 位英文字母、数字、点、下划线或短横线。');
  return username;
}

export function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128 || Buffer.byteLength(value, 'utf8') > 512) {
    fail(400, '密码需要 10–128 个字符。');
  }
  return value;
}

async function derive(password, salt) {
  if (activeHashJobs >= MAX_HASH_JOBS) fail(503, '登录服务繁忙，请稍后重试。');
  activeHashJobs++;
  try { return await scrypt(password, salt, 32, HASH_OPTIONS); }
  finally { activeHashJobs--; }
}

export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt-v1$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 128 || Buffer.byteLength(password, 'utf8') > 512) return false;
  const parts = /^scrypt-v1\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(encoded || '');
  if (!parts) return false;
  return timingSafeEqual(await derive(password, Buffer.from(parts[1], 'hex')), Buffer.from(parts[2], 'hex'));
}

function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

function protectLastAdmin(db, user) {
  if (user.role === 'admin' && !user.disabled && db.prepare("SELECT count(*) AS n FROM auth_users WHERE role = 'admin' AND disabled = 0").get().n <= 1) {
    fail(409, '不能停用最后一位管理员。');
  }
}

export function setUserDisabled(db, username, disabled) {
  username = normalizeUsername(username);
  return transaction(db, () => {
    const user = db.prepare('SELECT * FROM auth_users WHERE username = ?').get(username);
    if (!user) fail(404, '账号不存在。');
    if (disabled) protectLastAdmin(db, user);
    db.prepare('UPDATE auth_users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, user.id);
    db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(user.id);
    return { ...publicUser(user), disabled: Boolean(disabled) };
  });
}

export async function resetUserPassword(db, username, password) {
  username = normalizeUsername(username);
  const hash = await hashPassword(password);
  return transaction(db, () => {
    const user = db.prepare('SELECT * FROM auth_users WHERE username = ?').get(username);
    if (!user) fail(404, '账号不存在。');
    db.prepare('UPDATE auth_users SET password_hash = ? WHERE id = ?').run(hash, user.id);
    db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(user.id);
    return publicUser(user);
  });
}

function createLimiter() {
  const attempts = new Map(), windowMs = 10 * 60 * 1000, maxEntries = 4096;
  return {
    take(key, limit) {
      const now = Date.now();
      for (const [k, value] of attempts) if (value.until <= now) attempts.delete(k);
      let entry = attempts.get(key);
      if (!entry) {
        if (attempts.size >= maxEntries) fail(429, '登录请求过多，请十分钟后再试。');
        entry = { count: 0, until: now + windowMs }; attempts.set(key, entry);
      }
      entry.count++;
      if (entry.count > limit) fail(429, '尝试次数过多，请十分钟后再试。');
    },
    close() { attempts.clear(); },
  };
}

function cookieToken(request) {
  const matches = (request.headers.get('cookie') || '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${COOKIE}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

async function readBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) fail(415, '请使用 JSON 请求。');
  if (Number(request.headers.get('content-length')) > 8192) fail(413, '请求内容过大。');
  if (!request.body) fail(400, '缺少请求内容。');
  const reader = request.body.getReader();
  let length = 0; const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 8192) { await reader.cancel(); fail(413, '请求内容过大。'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, '请求格式错误。');
    return data;
  } catch (error) { if (error instanceof AuthError) throw error; fail(400, '请求格式错误。'); }
}

export function createAuth({ db, setupToken, secureCookies = false, sessionTtlSeconds = 604800 }) {
  if (!db?.prepare || !db?.exec) throw new TypeError('Auth requires DatabaseSync.');
  if (setupToken != null && (typeof setupToken !== 'string' || setupToken.length < 32 || setupToken.length > 512)) throw new TypeError('Setup token must contain 32–512 characters.');
  if (!Number.isSafeInteger(sessionTtlSeconds) || sessionTtlSeconds < 300 || sessionTtlSeconds > 2592000) throw new TypeError('Session TTL must be 300–2592000 seconds.');
  const limiter = createLimiter();
  const response = (status, body, cookie) => {
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (cookie) headers['Set-Cookie'] = cookie;
    if (status === 429) headers['Retry-After'] = '600';
    return new Response(JSON.stringify(body), { status, headers });
  };
  const setCookie = (token, age) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secureCookies ? '; Secure' : ''}`;
  const clearCookie = () => setCookie('', 0);
  const needsSetup = () => db.prepare('SELECT 1 FROM auth_users LIMIT 1').get() === undefined;
  const getUser = id => db.prepare('SELECT * FROM auth_users WHERE id = ? AND disabled = 0').get(id);
  const authenticate = request => {
    const token = cookieToken(request);
    if (!token) return null;
    const user = db.prepare('SELECT u.id,u.username,u.role FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ? AND u.disabled = 0').get(digest(token), nowSeconds());
    return publicUser(user);
  };
  const requireUser = request => authenticate(request) || fail(401, '请先登录。');
  const requireAdmin = request => {
    const user = requireUser(request);
    if (user.role !== 'admin') fail(403, '此操作需要管理员权限。');
    return user;
  };
  const session = user => {
    const token = randomBytes(32).toString('base64url'), now = nowSeconds();
    db.prepare('DELETE FROM auth_sessions WHERE expires <= ?').run(now);
    // A bounded number of concurrent sessions per account. Login order breaks second ties.
    db.prepare('DELETE FROM auth_sessions WHERE user_id = ? AND token_hash NOT IN (SELECT token_hash FROM auth_sessions WHERE user_id = ? ORDER BY created DESC,rowid DESC LIMIT 9)').run(user.id, user.id);
    db.prepare('INSERT INTO auth_sessions(token_hash,user_id,created,expires) VALUES(?,?,?,?)').run(digest(token), user.id, now, now + sessionTtlSeconds);
    return setCookie(token, sessionTtlSeconds);
  };

  const handle = async (request, { remoteAddress = 'unknown' } = {}) => {
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/api/auth/')) return null;
    try {
      if (path === '/api/auth/status' && request.method === 'GET') return response(200, { needsSetup: needsSetup(), user: authenticate(request) });
      if (path === '/api/auth/users' && request.method === 'GET') {
        requireAdmin(request);
        const users = db.prepare('SELECT id,username,role,disabled,created FROM auth_users ORDER BY created,username LIMIT 1000').all().map(user => ({ ...user, disabled: Boolean(user.disabled) }));
        return response(200, { users });
      }
      if (request.method === 'PATCH' && /^\/api\/auth\/users\/[^/]+$/.test(path)) {
        requireAdmin(request); const body = await readBody(request);
        requireAdmin(request);
        if (typeof body.disabled !== 'boolean') fail(400, '请指定账号是否停用。');
        const target = db.prepare('SELECT username FROM auth_users WHERE id = ?').get(path.slice('/api/auth/users/'.length));
        if (!target) fail(404, '账号不存在。');
        return response(200, { user: setUserDisabled(db, target.username, body.disabled) });
      }
      if (request.method !== 'POST') return response(405, { error: '不支持此请求方式。' });
      if (path === '/api/auth/logout') {
        const token = cookieToken(request);
        if (token) db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(digest(token));
        return response(200, { ok: true }, clearCookie());
      }
      if (!['/api/auth/setup', '/api/auth/login', '/api/auth/register', '/api/auth/password', '/api/auth/invites'].includes(path)) return response(404, { error: '接口不存在。' });
      const body = await readBody(request);
      // remoteAddress is supplied by the HTTP socket; forwarding/client headers are never trusted.
      const address = String(remoteAddress).slice(0, 128);
      if (['/api/auth/setup', '/api/auth/login', '/api/auth/register'].includes(path)) limiter.take(`ip:${address}`, 40);
      if (path === '/api/auth/setup') {
        if (!needsSetup()) fail(409, '管理员已创建，请登录。');
        if (!setupToken) fail(503, '管理员初始化尚未配置，请检查服务器初始化令牌。');
        if (typeof body.setupToken !== 'string' || body.setupToken.length > 512 || !safeEqual(body.setupToken, setupToken)) fail(403, '初始化令牌错误。');
        const username = normalizeUsername(body.username), passwordHash = await hashPassword(body.password);
        const user = transaction(db, () => {
          if (!needsSetup()) fail(409, '管理员已创建，请登录。');
          const user = { id: randomUUID(), username, role: 'admin' };
          db.prepare('INSERT INTO auth_users(id,username,password_hash,role,created) VALUES(?,?,?,?,?)').run(user.id, username, passwordHash, 'admin', nowSeconds());
          return user;
        });
        return response(201, { user: publicUser(user) }, session(user));
      }
      if (path === '/api/auth/login') {
        const username = normalizeUsername(body.username);
        limiter.take(`account:${username}`, 12);
        const user = db.prepare('SELECT * FROM auth_users WHERE username = ?').get(username);
        const valid = await verifyPassword(body.password, user?.password_hash || DUMMY_HASH);
        // Re-read after scrypt: an administrator may revoke/disable this account in the meantime.
        const current = user && getUser(user.id);
        if (!valid || !current || current.password_hash !== user.password_hash) fail(401, '用户名或密码错误，或账号已停用。');
        return response(200, { user: publicUser(current) }, session(current));
      }
      if (path === '/api/auth/password') {
        const user = requireUser(request); limiter.take(`password:${user.id}`, 10);
        const current = getUser(user.id);
        if (!await verifyPassword(body.currentPassword, current?.password_hash)) fail(403, '当前密码错误。');
        const passwordHash = await hashPassword(body.newPassword);
        transaction(db, () => {
          const latest = getUser(user.id);
          if (!latest || latest.password_hash !== current.password_hash || !authenticate(request)) fail(401, '登录状态已失效，请重新登录。');
          db.prepare('UPDATE auth_users SET password_hash = ? WHERE id = ?').run(passwordHash, user.id);
          db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(user.id);
        });
        return response(200, { ok: true, loginRequired: true }, clearCookie());
      }
      if (path === '/api/auth/invites') {
        const admin = requireAdmin(request); limiter.take(`invites:${admin.id}`, 20);
        const expiresHours = body.expiresHours ?? 24;
        if (!Number.isInteger(expiresHours) || expiresHours < 1 || expiresHours > 168) fail(400, '邀请有效期需要为 1–168 小时。');
        const token = randomBytes(32).toString('base64url'), now = nowSeconds(), expires = now + expiresHours * 3600;
        db.prepare('DELETE FROM auth_invites WHERE expires <= ?').run(now);
        if (db.prepare('SELECT count(*) AS n FROM auth_invites WHERE used_at IS NULL').get().n >= 1000) fail(409, '未使用的邀请码过多，请等待旧邀请过期。');
        db.prepare('INSERT INTO auth_invites(token_hash,created_by,created,expires) VALUES(?,?,?,?)').run(digest(token), admin.id, now, expires);
        return response(201, { inviteToken: token, expires });
      }
      if (path === '/api/auth/register') {
        const token = body.inviteToken;
        if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail(403, '邀请码无效、已使用或已过期。');
        const tokenHash = digest(token);
        const validInvite = () => db.prepare('SELECT i.token_hash FROM auth_invites i JOIN auth_users u ON u.id = i.created_by WHERE i.token_hash = ? AND i.expires > ? AND i.used_at IS NULL AND u.disabled = 0 AND u.role = ?').get(tokenHash, nowSeconds(), 'admin');
        if (!validInvite()) fail(403, '邀请码无效、已使用或已过期。');
        const username = normalizeUsername(body.username), passwordHash = await hashPassword(body.password);
        const user = transaction(db, () => {
          if (!validInvite()) fail(403, '邀请码无效、已使用或已过期。');
          if (db.prepare('SELECT 1 FROM auth_users WHERE username = ?').get(username)) fail(409, '用户名已被使用。');
          if (db.prepare('SELECT count(*) AS n FROM auth_users').get().n >= 1000) fail(409, '当前实例最多支持 1000 个账号。');
          const user = { id: randomUUID(), username, role: 'member' }, now = nowSeconds();
          db.prepare('INSERT INTO auth_users(id,username,password_hash,role,created) VALUES(?,?,?,?,?)').run(user.id, username, passwordHash, 'member', now);
          db.prepare('UPDATE auth_invites SET used_at = ?,used_by = ? WHERE token_hash = ?').run(now, user.id, tokenHash);
          return user;
        });
        return response(201, { user: publicUser(user) }, session(user));
      }
    } catch (error) {
      if (error instanceof AuthError) return response(error.status, { error: error.message });
      // Never leak database details, token material or password hashes to clients.
      return response(500, { error: '账号服务暂时不可用，请稍后再试。' });
    }
  };
  return { handle, authenticate, close: () => limiter.close() };
}
