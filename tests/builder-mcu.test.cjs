'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../game/circuit.js'),B=require('../game/builder-mcu.js'),H=require('../game/hardware-v3.js');
const clone=x=>JSON.parse(JSON.stringify(x));

test('Build8 consists entirely of separately wired hardware modules, no hidden Core8 model',async()=>{
  const {project}=await B.build();assert.equal(project.circuit.instances.length,13);assert.equal(project.firmware.length,0);assert(!project.definitions.some(d=>d.model.id==='core8/2'));assert(project.circuit.instances.every(n=>H.supported(project.definitions.find(d=>d.stableId===n.definition.stableId&&d.revision===n.definition.revision).model.id)));const r=new C.Runtime(project);assert([...r.states.values()].every(s=>!s.cpu));
});
test('instruction register fetch precedes execution and all modules use common edge snapshot',async()=>{
  const {project}=await B.build(),r=new C.Runtime(project);r.advance(1n);let s=B.inspect(r);assert.equal(s.pc,0);assert.equal(s.instruction,0x107);assert.equal(s.accumulator,0);assert.equal(s.phase,1);r.advance(1n);s=B.inspect(r);assert.equal(s.accumulator,7);assert.equal(s.pc,1);assert.equal(s.instruction,0x107);r.advance(2n);assert.equal(B.inspect(r).accumulator,12);r.advance(2n);assert.equal(B.inspect(r).ram[3],12);r.advance(2n);assert.equal(B.inspect(r).output,12);r.advance(2n);assert.equal(B.inspect(r).halted,true);
});
test('assembler validates labels, immediate limits, reserved operands and256word image limit',()=>{
  for(const source of ['', 'ADD R0,1','LDI 256','OUT 1','JMP missing','x:NOP\nX:HALT','JMP end\nend:','SHL 8','NOP\n'.repeat(257),'globalThis.bad=true'])assert.equal(B.assemble(source).ok,false,source.slice(0,30));const a=B.assemble('LDI 2\nloop: SUBI 1\nJZ done\nJMP loop\ndone: OUT\nHALT');assert(a.ok);assert.equal(a.words[2],0x0a04);assert.equal(a.words[3],0x0901);assert.equal(B.assemble('NOP\n'.repeat(256)).words.length,256);
});
test('every arithmetic opcode is driven through actual ALU and register wires',async()=>{
  const rows=[['ADDI',250,10,4],['SUBI',0,1,255],['ANDI',170,15,10],['ORI',160,15,175],['XORI',170,255,85],['SHL',129,1,2],['SHR',128,7,1]];for(const[op,a,b,expected]of rows){const r=new C.Runtime((await B.build('LDI '+a+'\n'+op+' '+b+'\nOUT\nHALT')).project);r.advance(8n);assert.equal(B.inspect(r).output,expected);}
});
test('LOAD/STORE and zero branch follow actual RAM and accumulator feedback',async()=>{
  const r=new C.Runtime((await B.build('LDI 77\nSTORE 5\nLDI 0\nLOAD 5\nOUT\nHALT')).project);r.advance(12n);assert.equal(B.inspect(r).ram[5],77);assert.equal(B.inspect(r).output,77);const branch=new C.Runtime((await B.build('build8-branch')).project);branch.advance(40n);assert.equal(B.inspect(branch).output,99);assert.equal(B.inspect(branch).halted,true);
});
test('IN samples the true boundary bus and program output changes only on OUT',async()=>{
  const r=new C.Runtime((await B.build('build8-keyboard')).project);r.setInput('key',90,2n);r.advance(2n);assert.equal(B.inspect(r).accumulator,90);assert.equal(B.inspect(r).output,0);r.advance(4n);assert.equal(B.inspect(r).output,90);r.setInput('key',33);r.advance(8n);assert.equal(B.inspect(r).output,33);
});
test('program edits produce new ROM contents and behavior while invalid edits preserve original object',async()=>{
  const {project}=await B.build(),before=clone(project);const changed=await B.applyProgram(project,'LDI 42\nOUT\nHALT');assert.deepEqual(project,before);const r=new C.Runtime(changed);r.advance(6n);assert.equal(B.inspect(r).output,42);await assert.rejects(B.applyProgram(project,'LDI 999'));assert.deepEqual(project,before);
});
test('disconnecting the ALU writeback wire breaks the result instead of scripted success',async()=>{
  const {project}=await B.build(),r=new C.Runtime(project);r.setConnection('alu_writeback',false,1n);r.advance(10n);assert.equal(B.inspect(r).output,null);assert.equal(B.inspect(r).accumulator,null);assert(r.inspect().issues.some(i=>i.code==='E_UNKNOWN_WRITE'));
});
test('invalid ROM opcode stops control with visible fault, rather than executing as NOP',async()=>{
  const {project}=await B.build();project.circuit.instances.find(n=>n.id==='program_rom').parameters.contents=[0xff00];const r=new C.Runtime(project);r.advance(2n);assert.equal(B.inspect(r).halted,true);assert(r.inspect().issues.some(i=>i.code==='E_BUILD8_ENCODING'));assert.equal(B.inspect(r).pc,0);
});
test('pause/snapshot at fetch and execute boundaries restores exact component state and continuation',async()=>{
  const {project}=await B.build('build8-counter'),a=new C.Runtime(project);a.advance(7n);a.pause();const snapshot=a.snapshot();a.advance(100n);assert.deepEqual(a.snapshot(),snapshot);const b=C.Runtime.fromSnapshot(project,JSON.stringify(snapshot));a.resume();b.resume();a.advance(25n);b.advance(25n);assert.deepEqual(a.snapshot(),b.snapshot());
});
test('warm reset keeps data RAM but restarts PC, IR and output; cold power cycle clears memory',async()=>{
  const {project}=await B.build(),r=new C.Runtime(project);r.advance(10n);r.reset('warm');r.advance(1n);assert.equal(B.inspect(r).pc,0);assert.equal(B.inspect(r).ram[3],12);assert.equal(B.inspect(r).output,0);r.setPower('main',false);r.advance(1n);assert.equal(C.scalar(r.getPort('fetch')),'Z');r.setPower('main',true);r.advance(1n);assert.equal(B.inspect(r).ram[3],0);
});
test('packaged two Build8 instances have independent PC/registers/RAM and source-bearing board package',async()=>{
  const built=await B.build('build8-keyboard'),pkg=await C.packageModule(built.project,'Build8','user.build8'),p=await C.createProject();const placed=await C.placeModule(p,pkg,'a');await C.placeModule(p,pkg,'b');assert.equal(pkg.definition.model.circuit.instances.find(n=>n.id==='program_rom').parameters.source,built.source);const r=new C.Runtime(p);const input=placed.boundaryMap.key;assert(input);r.setInput(input,90);r.advance(6n);assert.equal(B.inspect(r,'a').output,90);assert.equal(B.inspect(r,'b').output,65);r.reset('warm','a');r.advance(1n);assert.equal(B.inspect(r,'a').pc,0);assert.equal(B.inspect(r,'b').pc,3);assert.equal(B.inspect(r,'a').ram[1],90);assert.equal(B.inspect(r,'b').ram[1],65);
});

test('verification requires observable expectations and rejects a broken datapath independently',async()=>{
  const b=await B.build();assert.equal((await B.verify(b.project,b.source)).ok,false);assert.equal((await B.verify(b.project,b.source,{output:12,halted:true,ram:{3:12}},10)).ok,true);const broken=JSON.parse(JSON.stringify(b.project));broken.circuit.wires=broken.circuit.wires.filter(w=>w.id!=='alu_writeback');assert.equal((await B.verify(broken,b.source,{output:12,ram:{3:12}},10)).ok,false);assert.equal((await B.verify(b.project,'LDI 0\nHALT',{output:12})).ok,false);
});
