'use strict';
const {DatabaseSync}=require('node:sqlite'),fs=require('node:fs'),path=require('node:path');
class SqliteD1{
 constructor(filename=':memory:'){this.sqlite=new DatabaseSync(filename);const dir=path.resolve(__dirname,'../drizzle');for(const name of fs.readdirSync(dir).filter(x=>x.endsWith('.sql')).sort())this.sqlite.exec(fs.readFileSync(path.join(dir,name),'utf8'));}
 prepare(sql){const db=this;return {args:[],bind(...args){this.args=args;return this;},async first(){return db.sqlite.prepare(sql).get(...this.args)||null;},async all(){return {results:db.sqlite.prepare(sql).all(...this.args)};},async run(){const r=db.sqlite.prepare(sql).run(...this.args);return {success:true,meta:{changes:Number(r.changes)}};}};}
 async batch(statements){this.sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());this.sqlite.exec('COMMIT');return results;}catch(e){this.sqlite.exec('ROLLBACK');throw e;}}
 close(){this.sqlite.close();}
}
module.exports={SqliteD1};
