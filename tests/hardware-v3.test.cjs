'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../game/circuit.js'),H=require('../game/hardware-v3.js');
const clone=x=>JSON.parse(JSON.stringify(x)),num=v=>H.known(v,C);
test('null or false register/memory/FIFO snapshot payloads reject without changing live state',async()=>{
  for(const[id,key]of[['std.register8/1','q'],['std.pc16/1','q'],['std.ram8/1','memory'],['std.fifo8/1','queue']]){const {r}=await fixture(id),before=r.snapshot();for(const value of [null,false,0]){const bad=clone(before);bad.instances.chip.hardware[key]=value;assert.throws(()=>r.restore(bad));assert.deepEqual(r.snapshot(),before);}}
});
async function fixture(id,values={},params={}){const p=await C.createProject(id),n=C.createInstance(p,id,'chip');Object.assign(n.parameters,params);for(const port of H.models[id].ports){if(port.direction==='in'){C.addInput(p,port.id,port.id,values[port.id]??0,port.width);C.addWire(p,'input_'+port.id,C.boundary(port.id),C.ep('chip',port.id));}else{C.addOutput(p,port.id,port.id,port.width);C.addWire(p,'output_'+port.id,C.ep('chip',port.id),C.boundary(port.id));}}return {p,r:new C.Runtime(p)};}

test('24 registered chips carry strict signed parameter contracts and independent default data',async()=>{
  assert.equal(H.list.length,24);for(const m of H.list){const {p}=await fixture(m.id);assert.equal((await C.validate(p)).ok,true,m.id);const a=C.createInstance(p,m.id,'other');assert.deepEqual(a.parameters,H.defaultParameters(m.id));if(a.parameters.contents){a.parameters.contents.push(7);assert.deepEqual(p.circuit.instances[0].parameters.contents,[]);}}
});
test('8/16bit ALU implements all14 operations, wrapping and exact unsigned carry',async()=>{
  for(const width of [8,16]){const max=2**width-1,{r}=await fixture('std.alu'+width+'/1');const rows=[[0,7,5,5,0],[1,max,1,0,1],[2,0,1,max,0],[2,7,5,2,1],[3,0xaa,0x0f,10,0],[4,0xa0,15,0xaf,0],[5,0xaa,255,0x55,0],[6,0,0,max,0],[7,1,width-1,2**(width-1),0],[8,2**(width-1),width-1,1,0],[9,42,0,42,0],[10,max,2,max-1,1],[11,7,7,1,0],[12,1,2,1,0],[13,2,1,1,0]];for(const [op,a,b,out,carry]of rows){r.setInput('op',op);r.setInput('a',a);r.setInput('b',b);r.advance(1n);assert.equal(num(r.getPort('out')),out);assert.equal(num(r.getPort('carry')),carry);assert.equal(num(r.getPort('zero')),out===0?1:0);}r.setInput('a','X');r.advance(1n);assert.equal(num(r.getPort('out')),null);}
});
test('wide register chains sample the common precommit state and hold on disable',async()=>{
  const {p}=await fixture('std.register16/1',{d:65535,en:1});C.createInstance(p,'std.register16/1','second');C.addWire(p,'between',C.ep('chip','q'),C.ep('second','d'));C.addWire(p,'en2',C.boundary('en'),C.ep('second','en'));C.addWire(p,'reset2',C.boundary('reset'),C.ep('second','reset'));const r=new C.Runtime(p);r.advance(1n);assert.equal(num(r.getPort('q')),65535);assert.equal(num(r.getPort(C.ep('second','q'))),0);r.advance(1n);assert.equal(num(r.getPort(C.ep('second','q'))),65535);r.setInput('en',0);r.setInput('d',123);r.advance(1n);assert.equal(num(r.getPort('q')),65535);r.setInput('reset',1);r.advance(1n);assert.equal(num(r.getPort('q')),0);
});
test('RAM8/16 has asynchronous read and atomic synchronous write, with warm memory retention',async()=>{
  for(const width of [8,16]){const {r}=await fixture('std.ram'+width+'/1',{address:7,data:2**width-1,write:1});assert.equal(num(r.getPort('out')),0);r.advance(1n);assert.equal(num(r.getPort('out')),2**width-1);r.setInput('write',0);r.reset('warm','chip');r.advance(1n);assert.equal(num(r.getPort('out')),2**width-1);r.setInput('write',1);r.setInput('data','X');r.advance(1n);assert.equal(num(r.getPort('out')),2**width-1);assert.equal(num(r.getPort('fault')),1);r.setInput('write',0);r.reset('cold','chip');r.advance(1n);assert.equal(num(r.getPort('out')),0);}
});
test('editable ROM words are real data and out of range/unknown addresses produce X',async()=>{
  for(const width of [8,16]){const {p,r}=await fixture('std.rom'+width+'/1',{address:1},{contents:[1,2**width-1]});assert.equal(num(r.getPort('out')),2**width-1);const changed=clone(p);changed.circuit.instances[0].parameters.contents[1]=42;const s=new C.Runtime(await C.importProject(changed));assert.equal(num(s.getPort('out')),42);r.setInput('address','X');r.advance(1n);assert.equal(num(r.getPort('fault')),1);assert.equal(num(r.getPort('out')),null);if(width===16){s.setInput('address',256);s.advance(1n);assert.equal(num(s.getPort('out')),null);}}
});
test('FIFO full simultaneous pop/push keeps ordering, underflow is explicit',async()=>{
  const {r}=await fixture('std.fifo8/1',{data:10,push:1},{capacity:2});r.advance(1n);r.setInput('data',20);r.advance(1n);assert.equal(num(r.getPort('full')),1);r.setInput('pop',1);r.setInput('data',30);r.advance(1n);assert.equal(num(r.getPort('out')),20);assert.equal(num(r.getPort('count')),2);r.setInput('push',0);r.advance(1n);assert.equal(num(r.getPort('out')),30);r.advance(1n);assert.equal(num(r.getPort('empty')),1);assert.equal(num(r.getPort('out')),null);r.advance(1n);assert.equal(num(r.getPort('fault')),1);assert(r.inspect().issues.some(i=>i.code==='E_FIFO_EMPTY'));
});
test('split/merge preserve partially unknown and high bits rather than coercing to boolean',async()=>{
  const {p}=await fixture('std.split16/1');C.createInstance(p,'std.merge16/1','merge');C.addWire(p,'low',C.ep('chip','lo'),C.ep('merge','lo'));C.addWire(p,'high',C.ep('chip','hi'),C.ep('merge','hi'));const r=new C.Runtime(p),value=C.fromBits([1,0,'X','Z',...Array(11).fill(0),1]);r.setInput('in',value);r.advance(1n);assert.deepEqual(r.getPort(C.ep('merge','out')),value);
  const split=await fixture('std.split8/1',{in:129});assert.equal(num(split.r.getPort('b0')),1);assert.equal(num(split.r.getPort('b7')),1);const merged=await fixture('std.merge8/1',{b0:1,b7:1});assert.equal(num(merged.r.getPort('out')),129);
});
test('mux unknown selection only resolves bit positions common to all inputs',async()=>{
  const {r}=await fixture('std.mux8/1',{a:7,b:7,c:7,d:7,sel:'X'});assert.equal(num(r.getPort('out')),7);r.setInput('d',3);r.advance(1n);assert.equal(C.bits(r.getPort('out'))[2],'X');assert.equal(C.bits(r.getPort('out'))[0],1);
});
test('PC load/halt/reset and sequencer fetch/execute controls operate on real clocks',async()=>{
  const {r}=await fixture('std.pc16/1',{en:1});r.advance(2n);assert.equal(num(r.getPort('out')),2);r.setInput('load',1);r.setInput('target',500);r.advance(1n);assert.equal(num(r.getPort('out')),500);r.setInput('halt',1);r.advance(1n);assert.equal(num(r.getPort('halted')),1);r.advance(2n);assert.equal(num(r.getPort('out')),500);r.reset('warm','chip');r.advance(1n);assert.equal(num(r.getPort('out')),0);
  const s=(await fixture('std.fetch-execute/1')).r;assert.equal(num(s.getPort('fetch')),1);s.advance(1n);assert.equal(num(s.getPort('execute')),1);s.advance(1n);assert.equal(num(s.getPort('fetch')),1);
});
test('strict parameters reject excessive content, scripts and forged registry signatures atomically',async()=>{
  const {p,r}=await fixture('std.rom16/1'),before=r.snapshot();for(const contents of [Array(257).fill(0),[65536],[-1],['eval(1)']]){const bad=clone(p);bad.circuit.instances[0].parameters.contents=contents;await assert.rejects(C.importProject(bad));assert.deepEqual(r.snapshot(),before);}const forged=clone(p),def=forged.definitions.find(d=>d.model.id==='std.rom16/1');def.parameters[0].maxLength=999;def.contentHash=C.hashDefinition(def);forged.locks.find(l=>l.stableId===def.stableId).contentHash=def.contentHash;forged.circuit.instances[0].definition=C.identity(def);await assert.rejects(C.importProject(forged));
});
test('hardware snapshots restore memories and queued input events; invalid state never partially imports',async()=>{
  const {p,r}=await fixture('std.fifo16/1',{data:500,push:1});r.advance(2n);r.setInput('data',700,4n);const saved=r.snapshot(),s=C.Runtime.fromSnapshot(p,saved);r.advance(3n);s.advance(3n);assert.deepEqual(s.snapshot(),r.snapshot());const bad=clone(saved);bad.instances.chip.hardware.queue=[65536];assert.throws(()=>C.Runtime.fromSnapshot(p,bad));assert.deepEqual(saved.instances.chip.hardware.queue,[500,500]);
});
test('all four hardware boards execute through canonical runtime and encapsulate unchanged',async()=>{
  for(const board of H.boards){const {project}=await H.buildBoard(board.id),r=new C.Runtime(project);r.advance(1n);if(board.id==='calculator8')assert.equal(num(r.getPort('result')),12);if(board.id==='keyboard-display')assert.equal(num(r.getPort('character')),65);if(board.id==='memory-lab'){r.setInput('write',1);r.advance(1n);assert.equal(num(r.getPort('read')),42);}const packaged=await C.packageModule(project,board.name,'hw.'+board.id),p=await C.createProject();await C.placeModule(p,packaged,'module');const loaded=await C.importProject(JSON.stringify(p));assert(new C.Runtime(loaded).inspect().instances['module/'+project.circuit.instances[0].id]);}
});
