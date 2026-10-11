import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {openDatabase, migrateDatabase, loadMigrations, acquireDatabaseLock, backupDatabase, restoreDatabase, inspectDatabase} from '../../selfhost/database.mjs';

const migrations = [{id:'test/0001',sql:'CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT NOT NULL UNIQUE);'}];
function fixture(t) { const dir = mkdtempSync(path.join(tmpdir(), 'silicon-storage-')); t.after(() => rmSync(dir, {recursive:true,force:true})); return {dir, file:path.join(dir,'silicon.db')}; }

test('migration applies once, remains journalled after reopen, and sets durability constraints', t => {
  const {file}=fixture(t); let db=openDatabase(file,{migrations});
  db.prepare('INSERT INTO items(value) VALUES (?)').bind('first').run();
  assert.equal(db.sqlite.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
  assert.equal(db.sqlite.prepare('PRAGMA journal_mode').get().journal_mode,'wal');
  assert.equal(db.sqlite.prepare('PRAGMA synchronous').get().synchronous,2);
  const journal=db.sqlite.prepare('SELECT * FROM silicon_schema_migrations').all(); db.close();
  db=openDatabase(file,{migrations});
  assert.equal(db.prepare('SELECT value FROM items').first('value'),'first');
  assert.deepEqual(db.sqlite.prepare('SELECT * FROM silicon_schema_migrations').all(),journal); db.close();
});

test('changed or missing historical migration rejects without touching data', t => {
  const {file}=fixture(t); const db=openDatabase(file,{migrations});
  db.prepare('INSERT INTO items(value) VALUES (?)').bind('retained').run(); db.close();
  assert.throws(()=>openDatabase(file,{migrations:[{...migrations[0],sql:migrations[0].sql+' -- changed'}]}),/Applied migration changed/);
  assert.throws(()=>openDatabase(file,{migrations:[]}),/unknown/);
  const check=openDatabase(file,{migrations,readOnly:true}); assert.equal(check.prepare('SELECT value FROM items').first('value'),'retained');check.close();
});

test('all pending migrations rollback together on error, including schema and journal', () => {
  const db=new DatabaseSync(':memory:');
  assert.throws(()=>migrateDatabase(db,[...migrations,{id:'test/0002',sql:'INSERT INTO missing_table VALUES (1);'}]),/missing_table/);
  assert.equal(db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name IN ('items','silicon_schema_migrations')").get().n,0);db.close();
});

test('legacy drizzle database is adopted without rerunning CREATE or losing existing records', t => {
  const {file}=fixture(t); const legacy=loadMigrations({authSchema:null}); const raw=new DatabaseSync(file);
  for(const m of legacy)raw.exec(m.sql);
  raw.prepare('INSERT INTO silicon_rooms(id,owner,title,revision,body,updated) VALUES(?,?,?,?,?,?)').run('room','owner','preserved',3,'{}',123);raw.close();
  const db=openDatabase(file,{migrations:legacy});
  assert.equal(db.prepare('SELECT title FROM silicon_rooms').first('title'),'preserved');
  assert.equal(db.prepare('SELECT count(*) n FROM silicon_schema_migrations').first('n'),legacy.length);db.close();
});

test('partial or incompatible legacy schema rejects instead of falsely marking it applied', t => {
  const {file}=fixture(t); const raw=new DatabaseSync(file);raw.exec('CREATE TABLE silicon_rooms(id TEXT PRIMARY KEY, title TEXT)');raw.close();
  assert.throws(()=>openDatabase(file,{migrations:loadMigrations({authSchema:null})}),/Legacy schema does not match/);
  const check=new DatabaseSync(file); assert.equal(check.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='silicon_schema_migrations'").get().n,0);check.close();
});

test('D1 adapter supports binding, missing rows, column reads and mutation metadata', t => {
  let db;t.after(()=>db?.close());const {file}=fixture(t);db=openDatabase(file,{migrations});
  const insert=db.prepare('INSERT INTO items(value) VALUES(?)');
  assert.equal(insert.bind('a').run().meta.changes,1); assert.equal(insert.bind('b').run().meta.last_row_id,2);
  assert.deepEqual(db.prepare('SELECT * FROM items WHERE id=?').bind(1).first(),{id:1,value:'a'});
  assert.equal(db.prepare('SELECT * FROM items WHERE id=?').bind(9).first(),null);
  assert.deepEqual(db.prepare('SELECT value FROM items ORDER BY id').all().results,[{value:'a'},{value:'b'}]);
  assert.equal(db.prepare('UPDATE items SET value=? WHERE id=?').bind('z',9).run().meta.changes,0);
});

test('failed batch rolls back every mutation and only accepts owned statements',t=>{
  let db;t.after(()=>db?.close());const {file}=fixture(t);db=openDatabase(file,{migrations});
  assert.throws(()=>db.batch([db.prepare('INSERT INTO items(value) VALUES(?)').bind('same'),db.prepare('INSERT INTO items(value) VALUES(?)').bind('same')]),/UNIQUE/);
  assert.equal(db.prepare('SELECT count(*) n FROM items').first('n'),0);
  assert.throws(()=>db.batch([{run(){throw new Error('must not run');}}]),/prepared by this database/);
});

test('concurrent asynchronous callers observe complete atomic batches without transaction interleaving',async t=>{
  let db;t.after(()=>db?.close());const {file}=fixture(t);db=openDatabase(file,{migrations});
  const seen=[];
  await Promise.all(Array.from({length:40},(_,i)=>Promise.resolve().then(async()=>{
    const result=db.batch([db.prepare('INSERT INTO items(value) VALUES(?)').bind(`${i}-a`),db.prepare('INSERT INTO items(value) VALUES(?)').bind(`${i}-b`)]);
    assert.ok(Array.isArray(result),'batch must finish synchronously before returning');
    seen.push(db.prepare('SELECT count(*) n FROM items').first('n'));await Promise.resolve();
  })));
  assert.deepEqual(seen,Array.from({length:40},(_,i)=>(i+1)*2));
});

test('exclusive SQLite server/maintenance mutex rejects overlap and persists safely after release',t=>{
  const {dir}=fixture(t);const lock=acquireDatabaseLock(dir);assert.throws(()=>acquireDatabaseLock(dir),/locked/);
  assert.equal(path.basename(lock.path),'server-lock.sqlite');
  lock.release();lock.release();assert.ok(existsSync(lock.path));
  const next=acquireDatabaseLock(dir,{purpose:'maintenance'});next.release();
});

test('online backup includes committed WAL data and is standalone; existing backup cannot be overwritten',async t=>{
  let db;t.after(()=>db?.close());const {dir,file}=fixture(t);db=openDatabase(file,{migrations});
  db.prepare('INSERT INTO items(value) VALUES(?)').bind('wal-committed').run();assert.ok(existsSync(file+'-wal'));
  const destination=path.join(dir,'backups','one.sqlite');const result=await backupDatabase(file,destination,{migrations});
  assert.equal(result.integrity,'ok');assert.ok(!existsSync(destination+'-wal'));
  const snap=openDatabase(destination,{migrations,readOnly:true});assert.equal(snap.prepare('SELECT value FROM items').first('value'),'wal-committed');snap.close();
  db.prepare('INSERT INTO items(value) VALUES(?)').bind('newer').run();
  await assert.rejects(()=>backupDatabase(file,destination,{migrations}),/already exists/);
  assert.equal(inspectDatabase(destination,{migrations}).integrity,'ok');
});

test('restore requires explicit confirmation and refuses while server is running',async t=>{
  const {dir,file}=fixture(t);const db=openDatabase(file,{migrations});db.close();
  const source=path.join(dir,'source.sqlite');await backupDatabase(file,source,{migrations});
  await assert.rejects(()=>restoreDatabase(source,dir,{migrations}),/--confirm/);
  const lock=acquireDatabaseLock(dir);try{await assert.rejects(()=>restoreDatabase(source,dir,{migrations,confirm:true}),/locked/);}finally{lock.release();}
});

test('offline restore preserves pre-restore data and makes restored state immediately reopenable',async t=>{
  const {dir,file}=fixture(t);let db=openDatabase(file,{migrations});db.prepare('INSERT INTO items(value) VALUES(?)').bind('old').run();db.close();
  const source=path.join(dir,'source.sqlite');await backupDatabase(file,source,{migrations});
  db=openDatabase(file,{migrations});db.prepare('INSERT INTO items(value) VALUES(?)').bind('new').run();db.close();
  const report=await restoreDatabase(source,dir,{migrations,confirm:true});assert.ok(report.previousBackup);
  db=openDatabase(file,{migrations});assert.deepEqual(db.prepare('SELECT value FROM items').all().results,[{value:'old'}]);db.close();
  const before=openDatabase(report.previousBackup,{migrations,readOnly:true});assert.equal(before.prepare('SELECT count(*) n FROM items').first('n'),2);before.close();
  const released=acquireDatabaseLock(dir);released.release();
});

test('corrupt or mismatched restore source leaves newer database untouched and removes temporary state',async t=>{
  const {dir,file}=fixture(t);let db=openDatabase(file,{migrations});db.prepare('INSERT INTO items(value) VALUES(?)').bind('must survive').run();db.close();
  const bad=path.join(dir,'corrupt.sqlite');writeFileSync(bad,'not a sqlite database');
  await assert.rejects(()=>restoreDatabase(bad,dir,{migrations,confirm:true}),/not a database/);
  const other=path.join(dir,'other.sqlite');const different=openDatabase(other,{migrations:[{id:'other/1',sql:'CREATE TABLE other(id INTEGER)'}]});different.close();
  await assert.rejects(()=>restoreDatabase(other,dir,{migrations,confirm:true}),/migration mismatch/);
  db=openDatabase(file,{migrations});assert.equal(db.prepare('SELECT value FROM items').first('value'),'must survive');db.close();
  assert.deepEqual(readdirSync(dir).filter(name=>name.includes('.restore-')||name.endsWith('.lock')),[]);
});

test('batch returns query results and rollback preserves previous rows when a later statement fails',t=>{
  const {file}=fixture(t);const db=openDatabase(file,{migrations});
  const result=db.batch([db.prepare('INSERT INTO items(value) VALUES(?)').bind('a'),db.prepare('SELECT value FROM items')]);
  assert.deepEqual(result[1].results,[{value:'a'}]);
  assert.throws(()=>db.batch([db.prepare('UPDATE items SET value=?').bind('changed'),db.prepare('INSERT INTO items(value) VALUES(?)').bind('changed')]),/UNIQUE/);
  assert.equal(db.prepare('SELECT value FROM items').first('value'),'a');db.close();
});

test('default schema backup/restore includes authenticated users, active sessions and legacy content',async t=>{
  const {dir,file}=fixture(t);let db=openDatabase(file);
  assert.equal(db.prepare('SELECT count(*) n FROM silicon_schema_migrations').first('n'),3);
  db.sqlite.prepare('INSERT INTO auth_users(id,username,password_hash,role,disabled,created) VALUES(?,?,?,?,?,?)').run('user','admin','password-hash','admin',0,1);
  db.sqlite.prepare('INSERT INTO auth_sessions(token_hash,user_id,created,expires) VALUES(?,?,?,?)').run('session-token-hash','user',1,9999999999999);
  db.sqlite.prepare('INSERT INTO silicon_rooms(id,owner,title,revision,body,updated) VALUES(?,?,?,?,?,?)').run('room','user','room title',2,'{}',1);
  const source=path.join(dir,'snapshot.sqlite');await backupDatabase(file,source);db.close();
  db=openDatabase(file);db.sqlite.prepare('DELETE FROM auth_sessions').run();db.close();
  await restoreDatabase(source,dir,{confirm:true});db=openDatabase(file);
  assert.equal(db.prepare('SELECT token_hash FROM auth_sessions').first('token_hash'),'session-token-hash');
  assert.equal(db.prepare('SELECT password_hash FROM auth_users').first('password_hash'),'password-hash');
  assert.equal(db.prepare('SELECT title FROM silicon_rooms').first('title'),'room title');db.close();
});

test('CLI creates inspectable backup, rejects traversal/overwrite and guards restore confirmation',t=>{
  const {dir,file}=fixture(t);const db=openDatabase(file);db.close();
  const cli=fileURLToPath(new URL('../../selfhost/storage-cli.mjs',import.meta.url));
  const run=(...args)=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8',env:{...process.env,SILICON_DATA_DIR:dir}});
  const saved=run('backup','cli-check');assert.equal(saved.status,0,saved.stderr);assert.equal(JSON.parse(saved.stdout).integrity,'ok');
  const filePath=JSON.parse(saved.stdout).file;
  assert.equal(run('inspect',filePath).status,0);
  assert.equal(run('backup','../outside').status,1);
  assert.equal(run('backup','cli-check').status,1);
  assert.equal(run('restore',filePath).status,1);
  assert.equal(run('restore',filePath,'--confirm').status,0);
});

test('readonly open never creates a missing database and competing backups cannot overwrite one another',async t=>{
  const {dir,file}=fixture(t);assert.throws(()=>openDatabase(file,{migrations,readOnly:true}),/does not exist/);assert.equal(existsSync(file),false);
  const db=openDatabase(file,{migrations});db.close();const destination=path.join(dir,'competing.sqlite');
  const result=await Promise.allSettled([backupDatabase(file,destination,{migrations}),backupDatabase(file,destination,{migrations})]);
  assert.equal(result.filter(x=>x.status==='fulfilled').length,1);assert.equal(result.filter(x=>x.status==='rejected').length,1);
  assert.equal(inspectDatabase(destination,{migrations}).integrity,'ok');
});

test('migration checksum survives Windows/Linux newline conversion while still checking content',t=>{
  const {file}=fixture(t);const sql='CREATE TABLE portable (id INTEGER);\r\n-- Portable migration\r\n';
  let db=openDatabase(file,{migrations:[{id:'portable/1',sql}]});db.close();
  db=openDatabase(file,{migrations:[{id:'portable/1',sql:sql.replace(/\r\n/g,'\n')}]});db.close();
  assert.throws(()=>openDatabase(file,{migrations:[{id:'portable/1',sql:sql.replace('Portable','Changed')}]}),/Applied migration changed/);
});

test('separate processes cannot share the mutex, and force-killing its owner permits immediate recovery',async t=>{
  let child;t.after(async()=>{if(child&&child.exitCode===null&&child.signalCode===null){const exit=once(child,'exit');child.kill('SIGKILL');await exit;}});
  const {dir}=fixture(t),moduleURL=new URL('../../selfhost/database.mjs',import.meta.url).href;
  const hold=`import {acquireDatabaseLock} from ${JSON.stringify(moduleURL)}; const lock=acquireDatabaseLock(process.env.SILICON_DATA_DIR); process.send('locked'); setInterval(()=>{},10000);`;
  child=spawn(process.execPath,['--input-type=module','-e',hold],{env:{...process.env,SILICON_DATA_DIR:dir},stdio:['ignore','pipe','pipe','ipc']});
  const [message]=await once(child,'message');assert.equal(message,'locked');
  assert.throws(()=>acquireDatabaseLock(dir),/locked/);
  const contender=spawnSync(process.execPath,['--input-type=module','-e',`import {acquireDatabaseLock} from ${JSON.stringify(moduleURL)};acquireDatabaseLock(process.env.SILICON_DATA_DIR);`],{encoding:'utf8',env:{...process.env,SILICON_DATA_DIR:dir}});
  assert.notEqual(contender.status,0);assert.match(contender.stderr,/Database is locked/);
  const exit=once(child,'exit');child.kill('SIGKILL');await exit;
  const recovered=acquireDatabaseLock(dir);recovered.release();
  const again=acquireDatabaseLock(dir);again.release();
});
