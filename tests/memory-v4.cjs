'use strict';
// Isolates the application's real request handler and SQLite adapter from HTTP,
// Vinext, Workers, Miniflare and browser tooling. Run with node --expose-gc.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {SqliteD1}=require('./sqlite-d1.cjs'),C=require('../game/circuit.js'),V=require('../game/v2-examples.js');
const root=path.resolve(__dirname,'..'),output=path.join(root,'qa/v0.4/memory-core.json');
const targetCycles=Number(process.env.MEMORY_CYCLES||2000),checkpoints=[],started=performance.now();
const users=Array.from({length:8},(_,i)=>'memory-v4-'+i);
let state,roomId,db,handler,cycles=0,requests=0,reads=0,setupRequests=0,error=null;
if(typeof global.gc!=='function')throw Error('Run Node with --expose-gc.');
assert(Number.isSafeInteger(targetCycles)&&targetCycles>=200&&targetCycles<=20000);
async function call(user,route,method='GET',body){
 const response=await handler(new Request('https://lab.test/api/'+route,{method,headers:{origin:'https://lab.test','content-type':'application/json','oai-authenticated-user-id':user},...(body===undefined?{}:{body:JSON.stringify(body)})}),{db});
 requests++;const data=await response.json();assert(response.status>=200&&response.status<300,JSON.stringify({status:response.status,data}));return data;
}
function checkpoint(){
 const snapshotBytes=Buffer.byteLength(JSON.stringify(state.snapshot)),roomBytes=Buffer.byteLength(db.sqlite.prepare('SELECT body FROM silicon_rooms WHERE id=?').get(roomId).body);
 const cpu=state.snapshot.instances.mcu.cpu,terminal=state.snapshot.instances.terminal.history;
 global.gc();const memory=process.memoryUsage();
 const point={cycles,requests,elapsedMilliseconds:Math.round(performance.now()-started),heapUsed:memory.heapUsed,heapTotal:memory.heapTotal,rss:memory.rss,external:memory.external,arrayBuffers:memory.arrayBuffers,snapshotBytes,roomBytes,virtualTime:state.snapshot.time,cpuTrace:cpu.trace.length,cpuHistory:cpu.history.length,runtimeHistory:state.snapshot.history.length,terminalHistory:terminal.entries.length,roomLog:state.log.length,pendingEvents:state.snapshot.events.length,clientRecords:Object.keys(state.clients||{}).length};
 // clients is intentionally not exposed in room views; query only the count.
 point.clientRecords=JSON.parse(db.sqlite.prepare('SELECT body FROM silicon_rooms WHERE id=?').get(roomId).body).clients;
 point.clientRecords=Object.keys(point.clientRecords).length;
 checkpoints.push(point);console.log(JSON.stringify(point));
}
function write(complete){
 const result={complete,node:process.version,platform:process.platform,startedAt:new Date(Date.now()-(performance.now()-started)).toISOString(),endedAt:new Date().toISOString(),environment:'Node --expose-gc, real handleRequest and SqliteD1 backed by node:sqlite in-memory database. No HTTP server, Vinext, Workers, Miniflare, browser, or real external accounts.',workload:'One Core8/2 I2C authoritative advance of 1000 us followed by seven concurrent observer GET requests per cycle; every observer snapshot and revision compared exactly.',requestedCycles:targetCycles,cycles,workloadRequests:requests-setupRequests,setupRequests,totalRequests:requests,observerReads:reads,elapsedMilliseconds:Math.round(performance.now()-started),virtualTime:state?.snapshot.time,finalSnapshotHash:state?crypto.createHash('sha256').update(JSON.stringify(state.snapshot)).digest('hex'):null,checkpoints,error};
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2));return result;
}
(async()=>{
 handler=(await import('../server/cloud.mjs')).handleRequest;db=new SqliteD1();
 const board=await V.build('i2c-temperature');
 state=await call(users[0],'rooms','POST',{workspace:{project:board.project,view:board.view,sources:board.sources},title:'Accelerated request memory isolation'});roomId=state.id;
 const invitation=await call(users[0],'invites','POST',{kind:'room',resource:roomId,role:'viewer'});
 for(const user of users.slice(1))await call(user,'invites/join','POST',{token:invitation.token});
 setupRequests=requests;checkpoint();
 async function cycle(){
  state=await call(users[0],'rooms/'+roomId+'/operations','POST',{clientId:'memory-controller',sequence:cycles+1,epoch:state.epoch,operation:{kind:'advance',single:true,microseconds:1000}});
  const views=await Promise.all(users.slice(1).map(user=>call(user,'rooms/'+roomId)));
  for(const view of views){assert.deepEqual(view.snapshot,state.snapshot);assert.equal(view.revision,state.revision);reads++;}
  cycles++;assert.equal(state.snapshot.time,String(cycles*1000));assert(state.log.length<=100);assert(state.snapshot.events.length<=256);
 }
 while(cycles<targetCycles){await cycle();if(cycles%200===0||cycles===targetCycles){await new Promise(setImmediate);checkpoint();write(false);}else if(cycles%20===0)await new Promise(setImmediate);}
 const runtime=C.Runtime.fromSnapshot(state.workspace.project,state.snapshot);assert.equal(runtime.inspect().instances.mcu.ram[0],25);assert.equal(reads,targetCycles*7);assert.equal(requests-setupRequests,targetCycles*8);
 const result=write(true);console.log(JSON.stringify({complete:true,cycles,workloadRequests:result.workloadRequests,output,heapFirst:checkpoints[0].heapUsed,heapLast:checkpoints.at(-1).heapUsed}));
})().catch(e=>{error=e.stack||String(e);write(false);console.error(error);process.exitCode=1;}).finally(()=>db?.close());
