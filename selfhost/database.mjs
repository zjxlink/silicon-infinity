import {DatabaseSync, backup as sqliteBackup} from 'node:sqlite';
import {createHash, randomUUID} from 'node:crypto';
import {mkdirSync, readdirSync, readFileSync, existsSync, openSync, closeSync, unlinkSync, renameSync, statSync, chmodSync, fsyncSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JOURNAL = 'silicon_schema_migrations';
// Git checkouts may use CRLF on Windows and LF inside Linux containers.
// Normalize only newlines; all other edits invalidate migration history.
const sha256 = text => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
export const dataDirectory = () => path.resolve(process.env.SILICON_DATA_DIR || './data');

export function loadMigrations({migrationDir = path.join(projectRoot, 'drizzle'), authSchema = path.join(projectRoot, 'selfhost/auth-schema.sql')} = {}) {
  const list = readdirSync(migrationDir).filter(name => /^\d+.*\.sql$/.test(name)).sort().map(name => ({id: `drizzle/${name}`, sql: readFileSync(path.join(migrationDir, name), 'utf8')}));
  if (authSchema) list.push({id: 'selfhost/0001-auth', sql: readFileSync(authSchema, 'utf8')});
  return list.map(m => ({...m, hash: sha256(m.sql)}));
}

const normalizeSQL = sql => sql.replace(/\s+/g, ' ').replace(/\bIF NOT EXISTS\s+/gi, '').trim().replace(/;$/, '');
function adoptableLegacy(sqlite, migration) {
  // Existing D1 exports can be adopted only when every CREATE object matches.
  // Partial schemas and non-CREATE migrations are never inferred as applied.
  if (!migration.id.startsWith('drizzle/')) return false;
  const clean = migration.sql.replace(/--[^\n]*(?:\n|$)/g, '\n');
  const statements = clean.split(';').map(s => s.trim()).filter(Boolean);
  if (!statements.length || statements.some(s => !/^CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\b/i.test(s))) return false;
  const probe = new DatabaseSync(':memory:');
  try {
    probe.exec(migration.sql);
    const objects = probe.prepare("SELECT name,type,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").all();
    const found = objects.map(o => ({expected:o, actual:sqlite.prepare('SELECT type,sql FROM sqlite_schema WHERE name=?').get(o.name)}));
    if (found.every(x => !x.actual)) return false;
    if (found.some(x => !x.actual || x.actual.type !== x.expected.type || normalizeSQL(x.actual.sql) !== normalizeSQL(x.expected.sql))) throw new Error(`Legacy schema does not match migration ${migration.id}; no data was changed.`);
    return true;
  } finally { probe.close(); }
}

export function migrateDatabase(sqlite, migrations = loadMigrations()) {
  const normalized = migrations.map(m => ({...m, hash: sha256(m.sql)}));
  if (new Set(normalized.map(m => m.id)).size !== normalized.length) throw new Error('Duplicate migration identifier.');
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS ${JOURNAL} (id TEXT PRIMARY KEY NOT NULL, sha256 TEXT NOT NULL, applied_at INTEGER NOT NULL)`);
    const applied = sqlite.prepare(`SELECT id,sha256 FROM ${JOURNAL}`).all();
    for (const row of applied) {
      const expected = normalized.find(m => m.id === row.id);
      if (!expected) throw new Error(`Database migration ${row.id} is newer than or unknown to this application; use the matching release.`);
      if (expected.hash !== row.sha256) throw new Error(`Applied migration changed: ${row.id}. Restore the original migration file; do not rewrite migration history.`);
    }
    const existing = new Set(applied.map(m => m.id));
    for (const migration of normalized) {
      if (existing.has(migration.id)) continue;
      if (!adoptableLegacy(sqlite, migration)) sqlite.exec(migration.sql);
      sqlite.prepare(`INSERT INTO ${JOURNAL} (id,sha256,applied_at) VALUES (?,?,?)`).run(migration.id, migration.hash, Date.now());
    }
    sqlite.exec('COMMIT');
    return normalized.map(({id, hash}) => ({id, sha256: hash}));
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}

function verifyJournal(sqlite, migrations) {
  const applied = sqlite.prepare(`SELECT id,sha256,applied_at FROM ${JOURNAL} ORDER BY id`).all();
  if (applied.length !== migrations.length) throw new Error('Database schema version does not match this release; start the matching server to migrate it before backup/restore.');
  for (const row of applied) {
    const expected = migrations.find(m => m.id === row.id);
    if (!expected || row.sha256 !== sha256(expected.sql)) throw new Error(`Database migration mismatch: ${row.id}`);
  }
  return applied.map(row => ({...row}));
}

export function openDatabase(filename, options = {}) {
  const {readOnly = false, busyTimeout = 5000} = options;
  if (!Number.isSafeInteger(busyTimeout) || busyTimeout < 0 || busyTimeout > 60000) throw new Error('Invalid SQLite busy timeout.');
  const migrations = options.migrations ?? loadMigrations(options);
  if (filename !== ':memory:') {
    if (readOnly && !existsSync(filename)) throw new Error(`Database does not exist: ${filename}`);
    if (!readOnly) mkdirSync(path.dirname(path.resolve(filename)), {recursive: true, mode: 0o700});
  }
  const sqlite = new DatabaseSync(filename, {readOnly, enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false});
  try {
    sqlite.exec(`PRAGMA busy_timeout=${busyTimeout}; PRAGMA foreign_keys=ON;`);
    if (readOnly) verifyJournal(sqlite, migrations);
    else {
      sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      migrateDatabase(sqlite, migrations);
      if (filename !== ':memory:') chmodSync(filename, 0o600);
    }
  } catch (error) { sqlite.close(); throw error; }
  let closed = false;
  const owned = new WeakMap();
  function prepare(sql) {
    if (closed) throw new Error('Database is closed.');
    const statement = sqlite.prepare(sql);
    function wrapper(values = []) {
      const all = () => ({success: true, results: statement.all(...values).map(row => ({...row})), meta: {changes: 0}});
      const run = () => { const info = statement.run(...values); return {success: true, results: [], meta: {changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid)}}; };
      const result = {
        bind(...args) { return wrapper(args); },
        first(column) { const row = statement.get(...values); if (!row) return null; return column === undefined ? {...row} : row[column]; },
        all, run
      };
      owned.set(result, () => statement.columns().length ? all() : run());
      return result;
    }
    return wrapper();
  }
  return {
    sqlite, filename, prepare,
    batch(statements) {
      if (closed) throw new Error('Database is closed.');
      if (!Array.isArray(statements) || statements.some(s => !owned.has(s))) throw new Error('Batch requires statements prepared by this database.');
      // Deliberately synchronous: BEGIN, every statement, COMMIT/ROLLBACK run
      // in one event-loop turn, so Promise.all callers cannot interleave them.
      sqlite.exec('BEGIN IMMEDIATE');
      try { const results = statements.map(s => owned.get(s)()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
    close() { if (!closed) { sqlite.close(); closed = true; } }
  };
}

export function acquireDatabaseLock(directory, {purpose = 'server'} = {}) {
  directory = path.resolve(directory);
  mkdirSync(directory, {recursive: true, mode: 0o700});
  const lockPath = path.join(directory, 'server-lock.sqlite');
  let mutex;
  try {
    mutex = new DatabaseSync(lockPath);
    mutex.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS mutex (id INTEGER PRIMARY KEY CHECK(id=1), purpose TEXT NOT NULL); BEGIN EXCLUSIVE;');
    chmodSync(lockPath, 0o600);
  } catch (error) {
    mutex?.close();
    if (/locked|busy/i.test(error.message)) throw new Error(`Database is locked (${lockPath}). Stop the server before maintenance.`, {cause:error});
    throw error;
  }
  // This dedicated SQLite connection holds an OS file lock, not a PID lease.
  // A crash or power loss releases it automatically even across container PID
  // namespaces. Never delete the file: all contenders must lock the same inode.
  let released = false;
  return {path: lockPath, purpose, release() {
    if (released) return;
    try { mutex.exec('ROLLBACK'); } finally { mutex.close(); released = true; }
  }};
}

export function inspectDatabase(filename, options = {}) {
  const db = openDatabase(filename, {...options, readOnly: true});
  try {
    const integrity = db.sqlite.prepare('PRAGMA integrity_check').all().map(row => Object.values(row)[0]);
    if (integrity.length !== 1 || integrity[0] !== 'ok') throw new Error(`SQLite integrity check failed: ${integrity.join('; ')}`);
    const foreignKeys = db.sqlite.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeys.length) throw new Error(`SQLite foreign key check failed (${foreignKeys.length} violations).`);
    return {file: path.resolve(filename), bytes: statSync(filename).size, integrity: 'ok', migrations: verifyJournal(db.sqlite, options.migrations ?? loadMigrations(options)), tables: db.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name)};
  } finally { db.close(); }
}

function syncFile(filename) { const fd = openSync(filename, 'r+'); try { fsyncSync(fd); } finally { closeSync(fd); } }
function syncDirectory(directory) { if (process.platform === 'win32') return; const fd = openSync(directory, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
function cleanupTemporary(filename) { for (const suffix of ['', '-wal', '-shm']) { const file = filename + suffix; if (existsSync(file)) unlinkSync(file); } }

export async function backupDatabase(filename, destination, options = {}) {
  if (path.resolve(filename) === path.resolve(destination)) throw new Error('Backup destination cannot be the live database.');
  if (existsSync(destination)) throw new Error(`Backup already exists: ${destination}`);
  mkdirSync(path.dirname(path.resolve(destination)), {recursive: true, mode: 0o700});
  const reservation = destination + '.lock';
  const reserve = openSync(reservation, 'wx', 0o600); closeSync(reserve);
  const temporary = destination + `.tmp-${randomUUID()}`;
  let source;
  try {
    if (existsSync(destination)) throw new Error(`Backup already exists: ${destination}`);
    source = openDatabase(filename, {...options, readOnly: true});
    await sqliteBackup(source.sqlite, temporary);
    source.close(); source = null;
    chmodSync(temporary, 0o600);
    // A standalone backup must contain all committed pages without sidecars.
    const target = new DatabaseSync(temporary);
    try { target.exec('PRAGMA journal_mode=DELETE;'); } finally { target.close(); }
    const report = inspectDatabase(temporary, options);
    syncFile(temporary);
    if (existsSync(destination)) throw new Error(`Backup already exists: ${destination}`);
    renameSync(temporary, destination); syncDirectory(path.dirname(path.resolve(destination)));
    return {...report, file: path.resolve(destination)};
  } finally { source?.close(); cleanupTemporary(temporary); unlinkSync(reservation); }
}

export async function restoreDatabase(source, directory, {confirm = false, ...options} = {}) {
  if (!confirm) throw new Error('Restore replaces the current database. Pass --confirm after stopping the server.');
  directory = path.resolve(directory);
  const filename = path.join(directory, 'silicon.db');
  if (path.resolve(source) === filename) throw new Error('Restore source cannot be the live database.');
  const lock = acquireDatabaseLock(directory, {purpose: 'restore'});
  const temporary = path.join(directory, `.restore-${randomUUID()}.sqlite`);
  let previousBackup = null;
  try {
    await backupDatabase(source, temporary, options);
    if (existsSync(filename)) {
      previousBackup = path.join(directory, 'backups', `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0,8)}.sqlite`);
      await backupDatabase(filename, previousBackup, options);
      const old = openDatabase(filename, options);
      try {
        const status = old.sqlite.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
        if (Number(status.busy) !== 0) throw new Error('Database is still in use; restore cancelled.');
        old.sqlite.exec('PRAGMA journal_mode=DELETE;');
      } finally { old.close(); }
      for (const suffix of ['-wal', '-shm']) if (existsSync(filename + suffix)) throw new Error('Database sidecars are still active; restore cancelled.');
    }
    // Same-directory rename atomically replaces the closed main database. On
    // failure the existing database stays intact, with its backup preserved.
    renameSync(temporary, filename); syncDirectory(directory);
    return {restored: filename, previousBackup, ...inspectDatabase(filename, options)};
  } finally { cleanupTemporary(temporary); lock.release(); }
}
