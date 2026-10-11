import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { dataDirectory, openDatabase, acquireDatabaseLock } from './database.mjs';
import { normalizeUsername, resetUserPassword, setUserDisabled } from './auth.mjs';

async function readPassword() {
  if (process.stdin.isTTY) throw new Error('为避免密码回显，请通过标准输入管道传入新密码；不要把密码写在命令参数里。');
  let length = 0; const chunks = [];
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 514) throw new Error('密码输入过长。');
    chunks.push(chunk);
  }
  const password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  if (/[\r\n]/.test(password)) throw new Error('只允许输入一行密码。');
  return password;
}

const [command, username, ...extra] = process.argv.slice(2);
let lock, adapter;
try {
  const directory = dataDirectory();
  if (command === 'setup-token' && username === undefined && extra.length === 0) {
    const tokenFile = path.join(directory, 'setup-token');
    if (!existsSync(tokenFile)) throw new Error('初始化令牌文件不存在；请先启动服务器，或检查已配置的初始化令牌。');
    const token = readFileSync(tokenFile, 'utf8').trim();
    if (token.length < 32 || token.length > 512) throw new Error('初始化令牌文件格式错误。');
    process.stdout.write(token + '\n');
  } else {
    const needsUsername = ['reset-password', 'disable', 'enable'].includes(command);
    if (extra.length || (command !== 'list' && !needsUsername) || (needsUsername && !username) || (command === 'list' && username !== undefined)) {
      throw new Error('用法：node selfhost/auth-cli.mjs setup-token | list | reset-password 用户名 | disable 用户名 | enable 用户名；新密码只能通过标准输入传入。');
    }
    if (needsUsername) normalizeUsername(username);
    const filename = path.join(directory, 'silicon.db');
    if (!existsSync(filename)) throw new Error('数据库不存在；请先启动服务器。');
    lock = acquireDatabaseLock(directory, { purpose: 'account-maintenance' });
    adapter = openDatabase(filename);
    let result;
    if (command === 'list') result = adapter.sqlite.prepare('SELECT id,username,role,disabled,created FROM auth_users ORDER BY username').all();
    else if (command === 'reset-password') result = await resetUserPassword(adapter.sqlite, username, await readPassword());
    else result = setUserDisabled(adapter.sqlite, username, command === 'disable');
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }
} catch (error) {
  console.error(`账号维护失败：${error.message}`); process.exitCode = 1;
} finally {
  try { adapter?.close(); } finally { lock?.release(); }
}
