'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../game/circuit.js');
const L = require('../game/lessons.js');
const Core8 = require('../game/core8.js');
const B=C.boundary,E=C.ep;
const clone=v=>JSON.parse(JSON.stringify(v));
function addDef(p,d){p.definitions.push(d);p.locks.push(C.identity(d));}
function composite(stableId,circuit,ports=[],stateful=false,dependencies=[]){
  const d={stableId,revision:1,name:stableId,ports,parameters:[],model:{kind:'composite',circuit},contract:{timing:stateful?'stateful':'combinational',dependencies,reset:stateful?{kind:'children'}:null,power:'implicit'}};
  d.contentHash=C.hashDefinition(d);return d;
}
const empty=()=>({inputs:[],outputs:[],inouts:[],instances:[],wires:[]});
const port=(id,direction)=>({id,name:id,direction,kind:'digital',width:1});

test('T09 expanded primitive nodes accept exactly1000 and reject1001 with small authored graph',async()=>{
  const p=await C.createProject(),inside=empty(),gate=p.definitions.find(d=>d.model.id==='std.not/1');
  for(let i=0;i<20;i++)inside.instances.push({id:'gate'+i,definition:C.identity(gate),parameters:{},bindings:{power:'main'}});
  const d=composite('release.twenty',inside);addDef(p,d);
  for(let i=0;i<50;i++)C.createInstance(p,d.stableId,'bank'+i);
  const imported=await C.importProject(JSON.stringify(p)),r=new C.Runtime(imported);
  assert.equal(r.compiled.nodes.size,1000);assert.equal(p.circuit.instances.length+inside.instances.length,70);
  const invalid=clone(p);C.createInstance(invalid,'std.not/1','extra');
  await assert.rejects(C.importProject(invalid),{code:'E_RESOURCE_LIMIT'});
  assert.equal(r.compiled.nodes.size,1000);assert.deepEqual(r.project,imported);
});

test('T02 AND encapsulation preserves all four output values at identical event times',async()=>{
  const p=await C.createProject();C.addInput(p,'a');C.addInput(p,'b');C.addOutput(p,'y');C.createInstance(p,'std.and/1','gate');
  C.addWire(p,'a',B('a'),E('gate','a'));C.addWire(p,'b',B('b'),E('gate','b'));C.addWire(p,'y',E('gate','out'),B('y'));
  const definition=await C.encapsulate(p,'AND package','release.and'),wrapped=await C.createProject();addDef(wrapped,definition);
  C.addInput(wrapped,'a');C.addInput(wrapped,'b');C.addOutput(wrapped,'y');C.createInstance(wrapped,definition.stableId,'chip');
  C.addWire(wrapped,'a',B('a'),E('chip','a'));C.addWire(wrapped,'b',B('b'),E('chip','b'));C.addWire(wrapped,'y',E('chip','y'),B('y'));
  const a=new C.Runtime(p),b=new C.Runtime(wrapped);
  for(let row=0;row<4;row++){for(const r of [a,b]){r.setInput('a',row>>1);r.setInput('b',row&1);r.advance(1n);}assert.equal(a.time,b.time);assert.equal(C.scalar(a.getPort('y')),row===3?1:0);assert.equal(C.scalar(a.getPort('y')),C.scalar(b.getPort('y')));}
  assert(b.inspect().instances['chip/gate']);
});

test('T09 expanded wires accept exactly4000 and reject4001 independently of authored budget',async()=>{
  const p=await C.createProject(),inside=empty();inside.inputs=[port('a','in')];inside.outputs=[port('y','out')];
  for(let i=0;i<100;i++)inside.wires.push({id:'parallel'+i,from:B('a'),to:B('y')});
  const d=composite('release.hundredWires',inside,[...inside.inputs,...inside.outputs],false,[{from:'a',to:'y'}]);addDef(p,d);
  for(let i=0;i<40;i++)C.createInstance(p,d.stableId,'bank'+i);
  const imported=await C.importProject(p),r=new C.Runtime(imported);assert.equal(r.compiled.wires.length,4000);
  const invalid=clone(p);C.addWire(invalid,'oneMore',E('bank0','y'),E('bank1','a'));
  assert.equal(invalid.circuit.wires.length+inside.wires.length,101);
  await assert.rejects(C.importProject(invalid),{code:'E_RESOURCE_LIMIT'});assert.equal(r.compiled.wires.length,4000);
});

test('T09 authored budget counts unused definitions, not just active circuit',async()=>{
  const p=await C.createProject(),inside=empty(),gate=p.definitions.find(d=>d.model.id==='std.not/1');
  for(let i=0;i<999;i++)inside.instances.push({id:'g'+i,definition:C.identity(gate),parameters:{},bindings:{power:'main'}});
  addDef(p,composite('release.unused',inside));C.createInstance(p,'std.not/1','visible');
  assert.equal((await C.validate(p)).ok,true);
  C.createInstance(p,'std.not/1','oneTooMany');await assert.rejects(C.importProject(p),{code:'E_RESOURCE_LIMIT'});
});

async function invertDefinition(times,revision){
  const p=await C.createProject();C.addInput(p,'a');C.addOutput(p,'y');
  for(let i=0;i<times;i++){C.createInstance(p,'std.not/1','n'+i);C.addWire(p,'w'+i,i?E('n'+(i-1),'out'):B('a'),E('n'+i,'in'));}
  C.addWire(p,'out',E('n'+(times-1),'out'),B('y'));
  const d=clone(await C.encapsulate(p,'Reusable inverter','release.versioned'));d.revision=revision;d.contentHash=C.hashDefinition(d);return d;
}
test('T07 old locked version stays unchanged after publishing v2; explicit compatible upgrade changes behavior',async()=>{
  const p=await C.createProject(),v1=await invertDefinition(1,1),v2=await invertDefinition(2,2);addDef(p,v1);
  C.addInput(p,'a');C.addOutput(p,'y');C.createInstance(p,v1.stableId,'chip');C.addWire(p,'in',B('a'),E('chip','a'));C.addWire(p,'out',E('chip','y'),B('y'));
  const original=new C.Runtime(p);assert.equal(C.scalar(original.getPort('y')),1);addDef(p,v2);
  const old=await C.importProject(JSON.stringify(p)),stillOld=new C.Runtime(old);assert.equal(C.scalar(stillOld.getPort('y')),1);
  const upgraded=clone(old);upgraded.circuit.instances[0].definition=C.identity(v2);
  const current=new C.Runtime(await C.importProject(upgraded));assert.equal(C.scalar(current.getPort('y')),0);
  for(const runtime of [original,stillOld,current]){runtime.setInput('a',1);runtime.advance(1n);}
  assert.equal(C.scalar(original.getPort('y')),0);assert.equal(C.scalar(stillOld.getPort('y')),0);assert.equal(C.scalar(current.getPort('y')),1);
});

test('T07 incompatible port upgrade rejects entire candidate and preserves previous live version',async()=>{
  const p=await C.createProject(),v1=await invertDefinition(1,1);addDef(p,v1);C.addInput(p,'a');C.addOutput(p,'y');C.createInstance(p,v1.stableId,'chip');C.addWire(p,'in',B('a'),E('chip','a'));C.addWire(p,'out',E('chip','y'),B('y'));
  const r=new C.Runtime(p),before=r.snapshot(),candidate=clone(p),v3=clone(v1);v3.revision=3;
  v3.ports.find(x=>x.id==='y').id='z';v3.model.circuit.outputs[0].id='z';v3.model.circuit.wires.find(w=>w.id==='out').to.port='z';v3.contract.dependencies[0].to='z';v3.contentHash=C.hashDefinition(v3);addDef(candidate,v3);
  candidate.circuit.instances[0].definition=C.identity(v3);
  await assert.rejects(C.importProject(candidate),{code:'E_DANGLING_REF'});assert.deepEqual(r.snapshot(),before);assert.equal(C.scalar(r.getPort('y')),1);
});

test('T03/T10 nested DFF instances preserve state and targeted recursive reset boundary',async()=>{
  const base=await L.build('memory'),inner=await C.encapsulate(base.project,'inner','release.inner');
  const middle=await C.createProject();addDef(middle,inner);
  for(const p of base.project.circuit.inputs)C.addInput(middle,p.id,p.name,p.id==='enable'?1:0);C.addOutput(middle,'q');C.createInstance(middle,inner.stableId,'inside');
  for(const id of ['data','enable','reset'])C.addWire(middle,id,B(id),E('inside',id));C.addWire(middle,'out',E('inside','q'),B('q'));
  const outer=await C.encapsulate(middle,'outer','release.outer'),project=await C.createProject();addDef(project,inner);addDef(project,outer);
  C.addInput(project,'one','one',1);C.addInput(project,'zero');
  for(const id of ['a','b']){C.createInstance(project,outer.stableId,id);for(const [port,input]of [['data','one'],['enable',id==='a'?'one':'zero'],['reset','zero']])C.addWire(project,id+port,B(input),E(id,port));}
  const r=new C.Runtime(project);r.advance(1n);assert.equal(C.scalar(r.getPort(E('a','q'))),1);assert.equal(C.scalar(r.getPort(E('b','q'))),0);
  assert(r.inspect().instances['a/inside/memory']);assert(r.inspect().instances['b/inside/memory']);
  r.reset('warm','a');r.advance(1n);assert.equal(C.scalar(r.getPort(E('a','q'))),0);assert.equal(C.scalar(r.getPort(E('b','q'))),0);
  r.advance(1n);assert.equal(C.scalar(r.getPort(E('a','q'))),1);assert.equal(C.scalar(r.getPort(E('b','q'))),0);
});

test('T05 the same net becomes Z, weak0, strong1 then Z through recorded wire events',async()=>{
  const p=await C.createProject();C.addInput(p,'a','a','Z');C.addOutput(p,'y');C.addWire(p,'drive',B('a'),B('y'));C.addWire(p,'weak',B('a'),B('y'),'pull_down');
  const r=new C.Runtime(p);r.setConnection('weak',false,1n);r.advance(1n);assert.equal(C.scalar(r.getPort('y')),'Z');
  r.setConnection('weak',true,2n);r.advance(1n);assert.equal(C.scalar(r.getPort('y')),0);
  r.setInput('a',1,3n);r.advance(1n);assert.equal(C.scalar(r.getPort('y')),1);
  r.setInput('a','Z',4n);r.setConnection('weak',false,4n);r.advance(1n);assert.equal(C.scalar(r.getPort('y')),'Z');
});

test('T10 self and mutual-reference candidates are rejected before activation',async()=>{
  const p=await C.createProject(),self=composite('release.self',empty());
  self.model.circuit.instances.push({id:'selfChild',definition:C.identity(self),parameters:{},bindings:{power:'main'}});self.contentHash=C.hashDefinition(self);addDef(p,self);
  await assert.rejects(C.importProject(p),e=>['E_DEPENDENCY_VERSION','E_MODULE_CYCLE'].includes(e.code)&&e.message.includes('selfChild'));
  const q=await C.createProject(),a=composite('release.cycleA',empty()),b=composite('release.cycleB',empty());
  a.model.circuit.instances.push({id:'toB',definition:C.identity(b),parameters:{},bindings:{power:'main'}});
  b.model.circuit.instances.push({id:'toA',definition:C.identity(a),parameters:{},bindings:{power:'main'}});
  a.contentHash=C.hashDefinition(a);b.contentHash=C.hashDefinition(b);addDef(q,a);addDef(q,b);
  await assert.rejects(C.importProject(q),e=>['E_DEPENDENCY_VERSION','E_MODULE_CYCLE'].includes(e.code)&&/toA|toB/.test(e.message));
});

test('T06 UART cannot be wired as digital and T08 missing dependency import is rejected',async()=>{
  const {project}=await L.build('smart-lamp'),wrong=clone(project);C.addWire(wrong,'wrongKind',E('mcu','UART_TX'),E('mcu','GPIO2'));
  await assert.rejects(C.importProject(wrong),{code:'E_PORT_KIND'});
  const missing=clone(project);missing.definitions=missing.definitions.filter(d=>d.model.id!=='core8/1');
  await assert.rejects(C.importProject(missing));assert.equal((await C.validate(project)).ok,true);
});

test('T11 identical fixed input and reset scripts replay all states and observations deterministically',async()=>{
  const {project}=await L.build('smart-lamp'),a=new C.Runtime(project),b=new C.Runtime(project);
  const seed=20261010;assert.equal(seed,20261010);
  for(const r of [a,b]){r.setInput('button',1,10n);r.setInput('button','Z',80000n);r.setConnection('uart_tx',false,90000n);r.setConnection('uart_tx',true,90001n);r.reset('warm','mcu',120000n);}
  for(const at of [10n,1048n,60025n,90001n,120000n,180000n]){a.advance(at-a.time);const delta=at-b.time;b.advance(delta/3n);b.advance(at-b.time);assert.deepEqual(a.snapshot(),b.snapshot());}
});

test('T31 oversized raw4097byte ROM is rejected with its correct hash',async()=>{
  const {project}=await L.build('smart-lamp'),oversized=new Uint8Array(4097);project.firmware[0].data=Buffer.from(oversized).toString('hex');project.firmware[0].contentHash=C.hashBytes(oversized);
  await assert.rejects(C.importProject(project),{code:'E_SCHEMA'});
});

test('T44 mismatched snapshot lock fails without changing current runtime',async()=>{
  const {project}=await L.build('smart-lamp'),r=new C.Runtime(project);r.advance(500n);const before=r.snapshot(),bad=clone(before);bad.locks[0].contentHash='sha256:'+'0'.repeat(64);
  assert.throws(()=>C.Runtime.fromSnapshot(project,bad),{code:'E_SNAPSHOT_INCOMPATIBLE'});assert.deepEqual(r.snapshot(),before);
});

test('T32 global reset at UART completion leaves a reset marker and no cancelled byte',async()=>{
  const {project}=await L.build('smart-lamp'),r=new C.Runtime(project);r.reset('warm','all',1048n);r.advance(1048n);
  const history=r.inspect().terminals.terminal.history.entries;assert(history.some(e=>e.kind==='marker'&&e.reason==='warm-reset'));assert.equal(history.filter(e=>e.kind==='byte').length,0);
});

test('T34 HALT/FAULT disable instruction-step but paused UART resumes to exact completion',async()=>{
  for(const ending of ['HALT','LD R0,0x5000']){
    const {project}=await L.build('smart-lamp'),a=Core8.assemble('LDI R0,1\nST R0,0x4103\nLDI R0,65\nST R0,0x4100\n'+ending);assert(a.ok);
    project.firmware=[];await C.addFirmware(project,'program',a.bytes);const r=new C.Runtime(project);r.advance(5n);r.pause();const before=r.snapshot();
    assert.throws(()=>r.stepInstruction('mcu'),{code:'E_SCHEMA'});r.advance(2000000n);assert.deepEqual(r.snapshot(),before);
    r.resume();r.advance(1041n);const terminal=r.inspect().terminals.terminal.history.entries.filter(e=>e.kind==='byte');assert.equal(terminal.length,1);assert.equal(terminal[0].time,'1046');assert.equal(terminal[0].byte,65);
    assert.equal(r.inspect().instances.mcu.status,ending==='HALT'?'HALTED':'FAULT');
  }
});

async function lampWithSource(source){
  const {project}=await L.build('smart-lamp'),a=Core8.assemble(source);assert(a.ok,a.error);
  project.firmware=[];await C.addFirmware(project,'program',a.bytes);return project;
}

test('T20 live GPIO weak-pull connection transitions through0,1,Z and atomic read fault',async()=>{
  const project=await lampWithSource('LDI R0,254\nST R0,0x4003\nread: LD R1,0x4002\nJMP read');
  C.addWire(project,'external_pull',B('button'),E('mcu','GPIO0'),'pull_down');
  const r=new C.Runtime(project);r.setConnection('external_pull',false,1n);r.advance(1n);assert.equal(r.inspect().connections.external_pull.enabled,false);
  r.setConnection('external_pull',true,3n);r.advance(2n);
  assert.equal(C.scalar(r.getPort(E('mcu','GPIO0'))),0);assert.equal(r.inspect().instances.mcu.regs[1],0);
  r.setInput('button',1,5n);r.advance(2n);assert.equal(C.scalar(r.getPort(E('mcu','GPIO0'))),1);assert.equal(r.inspect().instances.mcu.regs[1],1);
  r.setConnection('external_pull',false,7n);r.setInput('button','Z',7n);r.advance(2n);
  const cpu=r.inspect().instances.mcu;assert.equal(C.scalar(r.getPort(E('mcu','GPIO0'))),'Z');assert.equal(cpu.fault.code,'F_UNKNOWN');assert.deepEqual(cpu.fault.unknownPins,['GPIO0']);assert.equal(cpu.regs[1],1);
});

test('T40 RX completion precedes same-timestamp program disable and is then cleared',async()=>{
  const project=await lampWithSource('LDI R0,2\nST R0,0x4103\nLDI R0,0\nWAIT 1048\nST R0,0x4103\nHALT');
  const r=new C.Runtime(project);r.injectTerminal('terminal',90,11n);r.advance(1052n);
  assert.equal(r.inspect().instances.mcu.uart.rx.length,0);r.advance(1n);
  const cpu=r.inspect().instances.mcu;assert(cpu.history.some(e=>e.kind==='rx'&&e.byte===90&&e.time==='1053'));
  assert.equal(cpu.uart.ctrl,0);assert.deepEqual(cpu.uart.rx,[]);assert.equal(cpu.pc,20);assert.equal(cpu.fault,null);
});

test('T40 TX completion reaches terminal before program disable cancels the next queued byte',async()=>{
  const project=await lampWithSource('LDI R0,1\nST R0,0x4103\nLDI R0,65\nST R0,0x4100\nLDI R0,66\nST R0,0x4100\nLDI R0,0\nWAIT 1037\nST R0,0x4103\nHALT');
  const r=new C.Runtime(project);r.advance(1045n);assert.deepEqual(r.inspect().instances.mcu.uart.tx,[65,66]);r.advance(1n);
  const cpu=r.inspect().instances.mcu;assert.equal(cpu.uart.ctrl,0);assert.deepEqual(cpu.uart.tx,[]);assert.equal(cpu.uart.active,null);
  const received=()=>r.inspect().terminals.terminal.history.entries.filter(e=>e.kind==='byte').map(e=>({byte:e.byte,time:e.time}));
  assert.deepEqual(received(),[{byte:65,time:'1046'}]);r.advance(1042n);assert.deepEqual(received(),[{byte:65,time:'1046'}]);
});

test('T23/T34/T38 actual two-second wall-clock pause freezes UART and maximum WAIT',async()=>{
  const reference=new C.Runtime((await L.build('smart-lamp')).project);reference.advance(506n);
  const stopped=[];for(const ending of ['HALT','LD R0,0x5000']){
    const r=new C.Runtime(await lampWithSource('LDI R0,1\nST R0,0x4103\nLDI R0,65\nST R0,0x4100\n'+ending));r.advance(5n);stopped.push(r);
  }
  const waiting=new C.Runtime(await lampWithSource('WAIT 65535\nLDI R0,9\nHALT'));waiting.advance(1n);
  const runtimes=[reference,...stopped,waiting];for(const r of runtimes)r.pause();const snapshots=runtimes.map(r=>r.snapshot());
  await new Promise(resolve=>setTimeout(resolve,2000));
  for(let i=0;i<runtimes.length;i++){runtimes[i].advance(2000000n);assert.deepEqual(runtimes[i].snapshot(),snapshots[i]);runtimes[i].resume();}
  reference.advance(542n);assert.deepEqual(reference.inspect().terminals.terminal.history.entries.filter(e=>e.kind==='byte').map(e=>({byte:e.byte,time:e.time})),[{byte:66,time:'1048'}]);
  for(const r of stopped){r.advance(1041n);assert.equal(r.inspect().terminals.terminal.history.entries.filter(e=>e.kind==='byte').length,1);assert(['HALTED','FAULT'].includes(r.inspect().instances.mcu.status));}
  waiting.advance(65535n);assert.equal(waiting.inspect().instances.mcu.regs[0],0);waiting.advance(1n);assert.equal(waiting.inspect().instances.mcu.regs[0],9);assert.equal(waiting.time,65537n);
});
