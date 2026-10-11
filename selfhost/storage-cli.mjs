import path from 'node:path';
import {backupDatabase, restoreDatabase, inspectDatabase, dataDirectory} from './database.mjs';

const [command, argument, ...flags] = process.argv.slice(2);
try {
  const directory = dataDirectory();
  let result;
  if (command === 'backup' && flags.length === 0) {
    const name = argument || `silicon-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(name) || name.includes('..')) throw new Error('Backup name must be a simple filename (letters, digits, dots, dashes and underscores).');
    result = await backupDatabase(path.join(directory, 'silicon.db'), path.join(directory, 'backups', name.endsWith('.sqlite') ? name : name + '.sqlite'));
  } else if (command === 'inspect' && argument && flags.length === 0) result = inspectDatabase(path.resolve(argument));
  else if (command === 'restore' && argument && flags.length === 1 && flags[0] === '--confirm') result = await restoreDatabase(path.resolve(argument), directory, {confirm: true});
  else throw new Error('Usage: node selfhost/storage-cli.mjs backup [name] | inspect <file> | restore <file> --confirm');
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(`Storage operation failed: ${error.message}`); process.exitCode = 1; }
