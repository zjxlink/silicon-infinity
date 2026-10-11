'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),C=require('../game/circuit.js'),B=require('../game/testbench-v5.js'),L=require('../game/lessons.js');
test('previous released challenge keeps its locked content hash and remains playable',async()=>{
 const raw=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/history/shared-v6.challenge.json'),'utf8'));
 assert.equal(raw.engineVersion,'0.6.0');const loaded=await B.importPackage(raw);assert.equal(loaded.contentHash,raw.contentHash);assert.deepEqual(loaded,raw);const r=await B.run(loaded.workspace,loaded.testbench);assert(r.ok,JSON.stringify(r.firstFailure));
});
test('v0.6 snapshot compatibility preserves queued input and subsequent state',async()=>{
 const w=await L.build('smart-lamp'),live=new C.Runtime(w.project);live.advance(25n,{force:true});const input=w.project.circuit.inputs.find(p=>p.kind==='digital');live.setInput(input.id,1,500n);const old=live.snapshot();old.engineVersion='0.6.0';const restored=C.Runtime.fromSnapshot(w.project,old);live.advance(1000n,{force:true});restored.advance(1000n,{force:true});assert.deepEqual(restored.snapshot(),live.snapshot());
 const future={...old,engineVersion:'99.0.0'};assert.throws(()=>C.Runtime.fromSnapshot(w.project,future),e=>e.code==='E_SNAPSHOT_INCOMPATIBLE');
});
