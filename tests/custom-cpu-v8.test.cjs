'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),A=require('../game/custom-cpu-v8.js'),V6=require('../game/custom-architecture-v6.js'),C=require('../game/circuit.js');
const cp=x=>JSON.parse(JSON.stringify(x)),state=(r,id='custom_cpu')=>r.inspect().instances[id].hardware,tick=(r,n=1)=>r.advance(BigInt(n),{force:true}),num=v=>C.bits(v).every(x=>x===0||x===1)?Number(BigInt(v.value)):null;
async function setup(source,edit){const w=await A.build();if(source)w.project.circuit.instances.find(n=>n.id==='custom_cpu').parameters.source=source;if(edit)edit(w.project);w.project=await C.importProject(w.project);return{...w,r:new C.Runtime(w.project)};}
function until(r,predicate,max=1000){for(let i=0;i<max;i++){if(predicate(state(r),r))return;tick(r);}assert.fail('CPU condition not reached: '+JSON.stringify(state(r)));}
function raise(r,vector){if(vector!==undefined)r.setInput('vector',vector);r.setInput('irq',1);}

test('new model and schema are distinct while old ISA/model/parameters remain unchanged',()=>{
 assert.equal(A.CPU,'std.custom-cpu16/2');assert.equal(A.ISA_SCHEMA,'silicon-lab.isa/2');assert.equal(V6.CPU,'std.custom-cpu16/1');assert.equal(JSON.parse(V6.DEFAULT_ISA).schema,'silicon-lab.isa/1');assert.equal(JSON.parse(V6.DEFAULT_ISA).instructions.length,16);assert.equal(JSON.parse(A.DEFAULT_ISA).instructions.length,34);assert.throws(()=>A.validateISA(V6.DEFAULT_ISA));assert.throws(()=>V6.validateISA(A.DEFAULT_ISA));assert.deepEqual(A.models[A.CPU].parameters.map(p=>p.id),['isa','source','busTimeout']);assert(A.models[A.CPU].ports.some(p=>p.id==='vector'&&p.width===16));
});
test('ISA2 assembles and disassembles renamed interrupt opcodes with actual source maps',()=>{
 for(const item of A.SAMPLES){const image=A.assemble(item.isa,item.source);assert(image.ok,image.error);assert.equal(image.labels.handler,3);assert.deepEqual(image.sourceMap,[1,2,3,4,5,6,7]);const back=A.disassemble(item.isa,image.words);assert(back.ok);assert.deepEqual(A.assemble(item.isa,back.source).words,image.words);}
 assert.equal(A.assemble(A.SAMPLES[0].isa,A.SAMPLES[0].source).words[1]>>>24,64);assert.equal(A.assemble(A.SAMPLES[1].isa,A.SAMPLES[1].source).words[1]>>>24,112);assert.equal(A.assemble(A.SAMPLES[1].isa,'EI\nSTOP').ok,false);for(const word of[0x42000001,0x42100000,0x99000000])assert.equal(A.disassemble(A.DEFAULT_ISA,[word]).ok,false);
});
test('new microoperations are bounded data; iret ordering, unknown fields and old limits remain strict',()=>{
 for(const edit of[i=>i.instructions[0].steps=[{op:'iret'},{op:'nop'}],i=>i.instructions[0].steps=[{op:'irq_enable',script:'eval(1)'}],i=>i.instructions[0].steps=[{op:'irq_disable',mask:1}],i=>i.instructions[0].steps=[{op:'script'}],i=>i.instructions[0].steps=Array(9).fill({op:'irq_enable'}),i=>i.instructions[0].steps=[{op:'halt'},{op:'iret'}],i=>i.registerCount=17,i=>i.instructions=Array(65).fill(i.instructions[0]),i=>i.instructions[0].opcode=64]){const isa=A.defaultProfile();edit(isa);assert.throws(()=>A.validateISA(isa));}
 const isa=A.defaultProfile();isa.registerCount=16;assert(A.assemble(isa,'LIT R15,65535\nEI\nDI\nSTOP').ok);isa.registerCount=1;assert.equal(A.assemble(isa,'LIT R1,1').ok,false);assert.equal(A.assemble(A.DEFAULT_ISA,'NOP\n'.repeat(1025)).ok,false);
});
test('default extended arithmetic and direct/indirect memory operations execute on real external RAM',async()=>{
 const source='LDI R0,65535\nADDI R0,1\nSUBI R0,1\nLDI R1,15\nAND R0,R1\nLDI R1,16\nOR R0,R1\nSHL R0,1\nSHR R0,2\nLDI R1,2\nMUL R0,R1\nSUB R0,R1\nSTR R0,7\nLDR R2,7\nLDI R3,8\nSTORE R2,R3\nLOAD R4,R3\nSTOP';const{r}=await setup(source);tick(r,100);assert.equal(state(r).fault,null);assert.equal(state(r).phase,'halted');assert.equal(state(r).regs[4],28);assert.equal(state(r,'ram').memory[7],28);assert.equal(state(r,'ram').memory[8],28);
});
test('IRQ really enters, acknowledges one tick, writes RAM and restores all main registers',async()=>{
 const{r}=await setup();tick(r,8);const registers=state(r).regs.slice();raise(r);until(r,s=>s.irqAck===1);assert.equal(num(r.getPort('irq_ack')),1);assert.equal(state(r).ie,false);assert.equal(state(r).irqFrame.pc,2);assert.equal(state(r).pc,3);tick(r);assert.equal(num(r.getPort('irq_ack')),0);until(r,s=>!s.irqFrame);assert.equal(state(r,'ram').memory[0],42);assert.deepEqual(state(r).regs,registers);assert.equal(state(r).ie,true);assert.equal(state(r).irqCount,'1');
});
test('held-high IRQ cannot retrigger and a known low tick rearms the next request',async()=>{
 const{r}=await setup();tick(r,8);raise(r);tick(r,120);assert.equal(state(r).irqCount,'1');assert.equal(state(r).irqFrame,null);r.setInput('irq',0);tick(r);raise(r);tick(r,120);assert.equal(state(r).irqCount,'2');assert.equal(state(r).fault,null);
});
test('masked unknown inputs are harmless; enabled unknown IRQ/vector and out-of-range vector fault without ack',async()=>{
 const masked=await setup('DI\nloop: JUMP loop');masked.r.setInput('irq','X');masked.r.setInput('vector','X');tick(masked.r,20);assert.equal(state(masked.r).fault,null);
 for(const[irq,vector,code]of[['X',3,'F_IRQ_UNKNOWN'],[1,'X','F_IRQ_VECTOR_UNKNOWN'],[1,65535,'F_IRQ_VECTOR']]){const{r}=await setup();tick(r,8);r.setInput('irq',irq);r.setInput('vector',vector);tick(r,3);assert.equal(state(r).fault,code);assert.equal(state(r).irqCount,'0');assert.equal(state(r).irqFrame,null);assert.equal(num(r.getPort('irq_ack')),0);assert.equal(state(r).regs[0],1);}
});
test('unconnected vector is never read when no request is active',async()=>{
 const{r}=await setup();r.setConnection('input_vector',false);tick(r,20);assert.equal(state(r).fault,null);raise(r);tick(r,4);assert.equal(state(r).fault,'F_IRQ_VECTOR_UNKNOWN');
});
test('multi-micro instruction finishes before entry and snapshots preserve its true intermediate values',async()=>{
 const source='LIT R0,5\nLIT R1,7\nEI\nMIX R0,R1\nmain: JUMP main\nhandler: STR R0,0\nIRET';const{r,project}=await setup(source);r.setInput('vector',5);until(r,s=>s.pc===3&&s.phase==='micro'&&s.micro===0);raise(r);tick(r);assert.equal(state(r).tmp,35);assert.equal(state(r).regs[0],5);assert.equal(state(r).irqCount,'0');const snapshot=r.snapshot();tick(r);assert.equal(state(r).regs[0],36);assert.equal(state(r).irqCount,'0');tick(r);assert.equal(state(r).irqAck,1);assert.equal(state(r).irqFrame.regs[0],36);assert.equal(state(r).irqFrame.tmp,35);assert.equal(state(r).irqFrame.pc,4);tick(r,70);assert.equal(state(r,'ram').memory[0],36);const restored=C.Runtime.fromSnapshot(project,snapshot);tick(restored,72);assert.deepEqual(restored.snapshot(),r.snapshot());
});
test('pending bus response and low-request gap finish before interrupt entry',async()=>{
 const source='LIT R0,19\nEI\nSTR R0,0\nmain: JUMP main\nhandler: LDR R1,0\nSTR R1,1\nIRET';const{r}=await setup(source,p=>p.circuit.instances.find(n=>n.id==='ram').parameters.latency=12);r.setInput('vector',4);until(r,s=>s.phase==='bus');raise(r);tick(r,5);assert.equal(state(r).irqCount,'0');assert.equal(state(r).phase,'bus');until(r,s=>s.phase==='gap');assert.equal(state(r).irqCount,'0');assert.equal(state(r,'ram').memory[0],19);tick(r);assert.equal(state(r).phase,'fetch');assert.equal(state(r).irqCount,'0');tick(r);assert.equal(state(r).irqAck,1);tick(r,90);assert.equal(state(r,'ram').memory[1],19);
});
test('bus failure wins before the retirement boundary and never claims interrupt acceptance',async()=>{
 const{r}=await setup('EI\nLDR R0,4000\nloop: JUMP loop\nhandler: IRET');r.setInput('vector',3);until(r,s=>s.phase==='bus');raise(r);tick(r,20);assert.equal(state(r).fault,'F_BUS_ERROR');assert.equal(state(r).irqCount,'0');assert.equal(state(r).irqAck,0);assert.equal(state(r).regs[0],0);
});
test('EI within an eight-step instruction does not enable partial-instruction preemption',async()=>{
 const{r}=await setup('ARM R0\nloop: JUMP loop\nhandler: STR R0,0\nIRET',p=>{const n=p.circuit.instances.find(n=>n.id==='custom_cpu'),isa=A.defaultProfile();isa.instructions.push({mnemonic:'ARM',opcode:100,form:'r',steps:[{op:'irq_enable'},...Array.from({length:7},(_,i)=>({op:'set',dst:'rd',src:i+1}))]});n.parameters.isa=JSON.stringify(isa);});r.setInput('vector',2);raise(r);tick(r,8);assert.equal(state(r).irqCount,'0');assert.equal(state(r).regs[0],6);tick(r);assert.equal(state(r).regs[0],7);tick(r);assert.equal(state(r).irqFrame.regs[0],7);tick(r,50);assert.equal(state(r,'ram').memory[0],7);
});
test('ISR cannot nest even after EI; queued held request is serviced only after IRET',async()=>{
 const source='EI\nloop: JUMP loop\nhandler: EI\nNOP\nNOP\nSTR R0,0\nIRET';const{r}=await setup(source);r.setInput('vector',2);tick(r,4);raise(r);until(r,s=>s.irqAck===1);r.setInput('irq',0);tick(r);raise(r);for(let i=0;i<3;i++){tick(r);assert.equal(state(r).irqCount,'1');assert.ok(state(r).irqFrame);}until(r,s=>s.irqFrame===null);assert.equal(state(r).irqCount,'1');tick(r);assert.equal(state(r).irqCount,'2');assert.equal(state(r).irqAck,1);
});
test('main stack can be full while ISR gets a separate empty stack and restores the exact original stack',async()=>{
 const source='LIT R0,9\n'+Array(64).fill('PUSH R0').join('\n')+'\nEI\nloop: JUMP loop\nhandler: PUSH R0\nLIT R0,77\nPOP R1\nSTR R1,0\nIRET';const{r}=await setup(source);const vector=A.assemble(A.DEFAULT_ISA,source).labels.handler;r.setInput('vector',vector);until(r,s=>s.ie&&s.phase==='fetch');assert.equal(state(r).stack.length,64);raise(r);until(r,s=>s.irqAck===1);assert.deepEqual(state(r).stack,[]);assert.equal(state(r).irqFrame.stack.length,64);tick(r,80);assert.deepEqual(state(r).stack,Array(64).fill(9));assert.equal(state(r).regs[0],9);assert.equal(state(r).regs[1],0);assert.equal(state(r,'ram').memory[0],9);
});
test('ISR stack overflow remains precise and IRET without a frame is a distinct fault',async()=>{
 const noframe=await setup('IRET');tick(noframe.r,2);assert.equal(state(noframe.r).fault,'F_IRET');assert.deepEqual(state(noframe.r).faultAt,{pc:0,micro:0});const source='EI\nloop: JUMP loop\nhandler: PUSH R0\nJUMP handler';const{r}=await setup(source);r.setInput('vector',2);tick(r,4);raise(r);tick(r,300);assert.equal(state(r).fault,'F_STACK_OVERFLOW');assert.ok(state(r).irqFrame);assert.equal(state(r).irqCount,'1');
});
test('HALT remains stopped with no IRQ wake and DI defers a persistent IRQ until later EI',async()=>{
 const stopped=await setup('EI\nSTOP\nIRET');tick(stopped.r,6);raise(stopped.r,2);tick(stopped.r,20);assert.equal(state(stopped.r).phase,'halted');assert.equal(state(stopped.r).irqCount,'0');const{r}=await setup('DI\nLIT R0,7\nEI\nmain: JUMP main\nhandler: STR R0,0\nIRET');raise(r,4);tick(r,5);assert.equal(state(r).irqCount,'0');tick(r,50);assert.equal(state(r,'ram').memory[0],7);assert.equal(state(r).regs[0],7);
});
test('reset wins over pending IRQ, clears the single frame, and cancels an uncommitted ISR write',async()=>{
 const{r}=await setup(undefined,p=>p.circuit.instances.find(n=>n.id==='ram').parameters.latency=12);tick(r,8);raise(r);r.setInput('reset',1);tick(r);assert.equal(state(r).irqCount,'0');assert.equal(state(r).ie,false);assert.equal(state(r).irqAck,0);r.setInput('irq',0);r.setInput('reset',0);tick(r,8);raise(r);until(r,s=>s.phase==='bus'&&s.irqFrame);r.setInput('reset',1);tick(r,20);assert.equal(state(r,'ram').memory[0],0);assert.equal(state(r).irqFrame,null);assert.equal(state(r).pending,null);assert.equal(num(r.getPort('irq_ack')),0);
});
test('unknown reset suppresses request/ack and faults, while warm reset preserves only committed external RAM',async()=>{
 const{r}=await setup();tick(r,8);raise(r);tick(r,60);assert.equal(state(r,'ram').memory[0],42);r.reset('warm');tick(r);assert.equal(state(r,'ram').memory[0],42);assert.equal(state(r).irqFrame,null);assert.equal(state(r).ie,false);r.setInput('reset','X');tick(r);assert.equal(state(r).fault,'F_RESET_UNKNOWN');assert.equal(num(r.getPort('irq_ack')),0);assert.equal(num(r.getPort(C.ep('custom_cpu','req'))),0);
});
test('entry, in-ISR bus, returned and faulted snapshots are strict and resume identically',async()=>{
 const{r,project}=await setup();tick(r,8);raise(r);until(r,s=>s.irqAck===1);const entry=r.snapshot();until(r,s=>s.phase==='bus'&&s.irqFrame);const bus=r.snapshot();tick(r,60);const returned=r.snapshot();for(const snap of[entry,bus,returned]){const one=C.Runtime.fromSnapshot(project,snap),two=C.Runtime.fromSnapshot(project,snap);tick(one,80);tick(two,80);assert.deepEqual(one.snapshot(),two.snapshot());}
 for(const edit of[s=>s.irqFrame.pc=9999,s=>s.irqFrame.stack=Array(65).fill(0),s=>s.irqFrame.regs.push(0),s=>s.irqFrame.ie=false,s=>s.irqFrame.ir=0xffffffff,s=>s.irqCount='0',s=>s.ie=true,s=>s.irqFrame.extra=true]){const bad=cp(entry);edit(bad.instances.custom_cpu.hardware);assert.throws(()=>C.Runtime.fromSnapshot(project,bad));}
 const bad=cp(bus);bad.instances.custom_cpu.hardware.pending.address=55;assert.throws(()=>C.Runtime.fromSnapshot(project,bad));assert.deepEqual(r.snapshot(),returned);const fault=await setup('IRET');tick(fault.r,3);assert.deepEqual(C.Runtime.fromSnapshot(fault.project,fault.r.snapshot()).snapshot(),fault.r.snapshot());
});
test('malformed return state faults at the IRET without mutating architectural registers',()=>{
 const p=A.defaultParameters();p.source='EI\nloop: JUMP loop\nhandler: IRET';const read=name=>C.signal(({reset:0,irq:0,vector:2,ready:0,error:0,rdata:0})[name]??0,name==='vector'||name==='rdata'?16:1);let s=A.fresh(A.CPU,p);for(let i=0;i<2;i++)s=A.sample(A.CPU,p,s,read,C);const raised=name=>name==='irq'?C.signal(1):read(name);s=A.sample(A.CPU,p,s,raised,C);s=A.sample(A.CPU,p,s,raised,C);assert.equal(s.pc,2);const before=s.regs.slice();s.irqFrame.pc=9999;s=A.sample(A.CPU,p,s,raised,C);assert.equal(s.fault,'F_IRQ_RETURN');assert.deepEqual(s.regs,before);assert.equal(s.irqAck,0);
});
test('two packaged copies keep separate ISA/source/frames and only the selected instance services IRQ',async()=>{
 const w=await A.build('custom-irq-renamed'),pkg=await C.packageModule(w.project,'两份中断核心','user.irq-core8'),p=await C.createProject(),left=await C.placeModule(p,pkg,'left'),right=await C.placeModule(p,pkg,'right'),r=new C.Runtime(await C.importProject(p));tick(r,8);r.setInput(left.boundaryMap.irq,1);tick(r,80);assert.equal(state(r,'left/custom_cpu').irqCount,'1');assert.equal(state(r,'right/custom_cpu').irqCount,'0');assert.equal(state(r,'left/ram').memory[0],42);assert.equal(state(r,'right/ram').memory[0],0);assert.equal(num(r.getPort(right.boundaryMap.irq_ack)),0);assert.equal(pkg.definition.model.circuit.instances.find(n=>n.id==='custom_cpu').parameters.isa,A.SAMPLES[1].isa);assert.deepEqual(C.Runtime.fromSnapshot(r.project,r.snapshot()).snapshot(),r.snapshot());
});
test('snapshot restore and pause cannot invent extra IRQ edges or advance interrupt execution',async()=>{
 const{r,project}=await setup();tick(r,8);raise(r);until(r,s=>s.irqAck===1);r.pause();const before=r.snapshot();r.advance(50n);assert.deepEqual(r.snapshot(),before);const restored=C.Runtime.fromSnapshot(project,before);tick(r,100);tick(restored,100);assert.equal(state(r).irqCount,'1');assert.deepEqual(r.snapshot(),restored.snapshot());
});
test('old v1 and new v2 non-interrupt execution are state-equivalent under real RAM traffic',async()=>{
 const old=await V6.build('custom-math'),current=await A.build(),cpu=current.project.circuit.instances.find(n=>n.id==='custom_cpu');cpu.parameters.source=old.project.circuit.instances.find(n=>n.id==='custom_cpu').parameters.source;const a=new C.Runtime(old.project),b=new C.Runtime(current.project);for(let i=0;i<60;i++){tick(a);tick(b);const newer=cp(state(b));for(const k of['ie','irqFrame','irqBlocked','irqAck','irqCount'])delete newer[k];assert.deepEqual(newer,state(a));assert.deepEqual(state(a,'ram'),state(b,'ram'));}
});
test('cached and original circuit solvers agree for a real interrupt, return and later rearm',async()=>{
 const w=await A.build(),a=new C.Runtime(w.project),b=new C.Runtime(w.project,{referenceSolver:true});for(const r of[a,b]){tick(r,8);raise(r);tick(r,70);r.setInput('irq',0);tick(r,2);raise(r);tick(r,70);}assert.deepEqual(a.snapshot(),b.snapshot());
});
test('manual contains every model port and generated default instruction; code really compiles',()=>{
 assert.equal(A.manuals.entries.length,1);assert.deepEqual(Object.keys(A.manuals.portHints[A.CPU]).sort(),A.models[A.CPU].ports.map(p=>p.id).sort());const entry=A.manuals.entries[0];assert(entry.sections.some(s=>s.paragraphs.join('').includes('不嵌套')));assert.equal(entry.sections.find(s=>s.id==='default').table.rows.length,34);for(const s of entry.sections)if(s.code)assert.equal(A.assemble(A.DEFAULT_ISA,s.code).ok,true);assert.equal(C.catalog[A.CPU].modelId,A.CPU);
});
