'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),A=require('../game/architecture-v5.js');
const C=require('../game/circuit.js'),clone=x=>JSON.parse(JSON.stringify(x));
const cpu=(r,path='cpu')=>r.inspect().instances[path].hardware,hw=(r,path)=>r.inspect().instances[path].hardware;
async function setup(source='array-stack',modify){const b=await A.build(source);if(modify)modify(b.project);const p=await C.importProject(b.project);return{...b,project:p,r:new C.Runtime(p)};}
const tick=(r,n=1)=>r.advance(BigInt(n),{force:true});
test('CPU16 strict assembler has26 instructions, labels and exact original source lines',()=>{
 const a=A.assemble('; comment\nLDI R0,0xffff\n\nloop: ADDI R0,1\nJZ R0,loop\nHALT');assert(a.ok);assert.deepEqual(a.sourceMap,[2,4,5,6]);assert.equal(a.labels.loop,1);assert.equal(a.instructions[2].target,1);assert.equal(A.NAMES.length,26);
 for(const src of['globalThis.x=1','LDI R8,1','LDI R0,-1','LDI R0,65536','LOAD R0,[R9]','SHL R0,16','MOV R0,1','JMP tail\ntail:','HALT 1','a: NOP\na: HALT','NOP\n'.repeat(1025)])assert.equal(A.assemble(src).ok,false,src.slice(0,40));assert(A.assemble('NOP\n'.repeat(1024)).ok);
});
test('array sample fills actual externalRAM using indirect addresses, nested call stack restores registers',async()=>{
 const{r,project}=await setup();assert.equal(project.circuit.instances.length,2);assert.equal(project.firmware.length,0);tick(r,400);assert.equal(cpu(r).phase,'halted');assert.deepEqual(hw(r,'ram').memory.slice(0,8),[1,2,3,4,5,6,7,8]);assert.equal(hw(r,'ram').memory[16],36);assert.equal(cpu(r).regs[3],36);assert.equal(cpu(r).regs[0],8);assert.equal(cpu(r).regs[1],9);assert.deepEqual(cpu(r).stack,[]);assert.equal(cpu(r).fault,null);
});
test('arithmetic is actual16bit wrap; register ALU, immediate ops, shifts and both branch directions execute',async()=>{
 const{r}=await setup('LDI R0,65535\nADDI R0,1\nJNZ R0,bad\nLDI R1,3\nMOV R2,R1\nADD R2,R1\nSUBI R2,1\nLDI R3,1\nSUB R2,R3\nOR R2,R1\nAND R2,R1\nXOR R2,R3\nSHL R2,3\nSHR R2,1\nNOT R3\nJZ R2,bad\nJMP done\nbad: LDI R2,99\ndone: NOP\nHALT');tick(r,80);assert.deepEqual(cpu(r).regs.slice(0,4),[0,3,8,65534]);assert.equal(cpu(r).phase,'halted');
});
test('CALL RET and PUSH POP share visible bounded stack; underflow/overflow/invalid return fault precisely',async()=>{
 const good=await setup('LDI R0,7\nCALL a\nHALT\na: PUSH R0\nCALL b\nPOP R0\nRET\nb: LDI R0,90\nRET');tick(good.r,40);assert.equal(cpu(good.r).regs[0],7);assert.equal(cpu(good.r).phase,'halted');
 for(const[src,code,pc]of[['RET','F_STACK_UNDERFLOW',0],['POP R0','F_STACK_UNDERFLOW',0],['LDI R0,900\nPUSH R0\nRET','F_RETURN',2],['loop: CALL loop\nHALT','F_STACK_OVERFLOW',0],['IRET','F_IRET',0]]){const{r}=await setup(src);tick(r,200);assert.equal(cpu(r).fault,code);assert.equal(cpu(r).pc,pc);if(code==='F_RETURN')assert.deepEqual(cpu(r).stack,[900]);}
});
test('bus requests hold stable through latency; retirement and RAM read follow real ready handshake',async()=>{
 const{r}=await setup('LDI R0,123\nSTORE R0,3\nLOAD R1,3\nHALT',p=>p.circuit.instances.find(n=>n.id==='ram').parameters.latency=4);tick(r,4);assert.equal(cpu(r).phase,'bus');assert.equal(cpu(r).retired,'1');for(let i=0;i<4;i++){tick(r);assert.equal(C.scalar(r.getPort(C.ep('cpu','req'))),1);assert.equal(hw(r,'ram').memory[3],0);}tick(r);assert.equal(hw(r,'ram').memory[3],123);assert.equal(cpu(r).retired,'1');tick(r);assert.equal(cpu(r).retired,'2');tick(r,20);assert.equal(cpu(r).regs[1],123);assert.equal(hw(r,'ram').transactions,'2');
});
test('missing handshake/readback, invalid RAM address and deadline cannot silently succeed',async()=>{
 for(const line of ['bus_ready','bus_rdata']){const{r}=await setup('LDI R0,42\nSTORE R0,1\nLOAD R1,1\nHALT');r.setConnection(line,false);tick(r,40);assert.equal(cpu(r).fault,'F_BUS_UNKNOWN',line);assert.equal(cpu(r).regs[1],0);}
 const invalid=await setup('LDI R0,42\nSTORE R0,256\nHALT');tick(invalid.r,20);assert.equal(cpu(invalid.r).fault,'F_BUS_ERROR');assert(hw(invalid.r,'ram').memory.every(x=>x===0));
 const slow=await setup('LDI R0,42\nSTORE R0,1\nHALT',p=>{p.circuit.instances.find(n=>n.id==='cpu').parameters.busTimeout=3;p.circuit.instances.find(n=>n.id==='ram').parameters.latency=20;});tick(slow.r,30);assert.equal(cpu(slow.r).fault,'F_BUS_TIMEOUT');assert.equal(hw(slow.r,'ram').memory[1],0);
});
test('synchronous reset cancels in-flight writes, warm reset preserves externalRAM, power cycle clears it',async()=>{
 const{r}=await setup('LDI R0,42\nSTORE R0,1\nHALT',p=>p.circuit.instances.find(n=>n.id==='ram').parameters.latency=8);tick(r,6);r.setInput('reset',1);tick(r,12);assert.equal(hw(r,'ram').memory[1],0);r.setInput('reset',0);tick(r,20);assert.equal(hw(r,'ram').memory[1],42);r.reset('warm');tick(r);assert.equal(hw(r,'ram').memory[1],42);assert.deepEqual(cpu(r).regs,Array(8).fill(0));r.setPower('main',false);tick(r);r.setPower('main',true);tick(r);assert.equal(hw(r,'ram').memory[1],0);
});
test('in-flight CPU and RAM snapshots resume identically; malformed pending state import is atomic',async()=>{
 const{r,project}=await setup('LDI R0,99\nSTORE R0,4\nLOAD R1,4\nHALT',p=>p.circuit.instances.find(n=>n.id==='ram').parameters.latency=8);tick(r,7);const snapshot=r.snapshot(),restored=C.Runtime.fromSnapshot(project,snapshot);tick(r,40);tick(restored,40);assert.deepEqual(restored.snapshot(),r.snapshot());const before=r.snapshot(),bad=clone(snapshot);bad.instances.cpu.hardware.pending.address=999;assert.throws(()=>C.Runtime.fromSnapshot(project,bad));assert.deepEqual(r.snapshot(),before);
});
test('FSM control table changes actual visible outputs, accepts masked conditions and rejects arbitrary code',async()=>{
 const{r,project}=await setup('state-machine');tick(r,1);assert.equal(C.scalar(r.getPort('output')),0);r.setInput('input',1);tick(r);assert.equal(C.scalar(r.getPort('output')),1);assert.equal(hw(r,'fsm').index,1);r.setInput('input',0);tick(r);assert.equal(C.scalar(r.getPort('output')),0);
 const changed=clone(project),n=changed.circuit.instances[0],table=JSON.parse(n.parameters.table);table.states[1].output=42;n.parameters.table=JSON.stringify(table);const rr=new C.Runtime(await C.importProject(changed));rr.setInput('input',1);tick(rr);assert.equal(A.known(rr.getPort('output'),C),42);n.parameters.table='({run:()=>42})';await assert.rejects(C.importProject(changed));
});
test('custom register device implements RW/RO/W1C/read-clear and external input independently',async()=>{
 const{r}=await setup('register-device');tick(r,100);assert.equal(cpu(r).phase,'halted');assert.deepEqual(cpu(r).regs.slice(1,5),[65,10,7,0]);assert.deepEqual(hw(r,'device').values,[90,0,10,0]);assert.equal(A.known(r.getPort('device_out'),C),90);
 const bad=await setup('register-device',p=>p.circuit.instances.find(n=>n.id==='cpu').parameters.source='LDI R0,99\nSTORE R0,1\nHALT');tick(bad.r,30);assert.equal(cpu(bad.r).fault,'F_BUS_ERROR');assert.equal(hw(bad.r,'device').values[1],0);
});
test('user register map is strict, unique, finite, portable; protocol side effects happen once per req',async()=>{
 const p=A.defaultParameters(A.DEV);for(const table of [{registers:[{address:0,name:'x',access:'exec',reset:0}]},{registers:[{address:0,name:'x',access:'rw',reset:0},{address:0,name:'y',access:'rw',reset:1}]}]){p.registers=JSON.stringify(table);assert.throws(()=>A.validateParameters(A.DEV,p));}
 const{r}=await setup('register-device',p=>p.circuit.instances.find(n=>n.id==='cpu').parameters.source='LOAD R0,3\nHALT');tick(r,30);assert.equal(cpu(r).regs[0],7);assert.equal(hw(r,'device').transactions,'1');
});
test('source line breakpoints stop before execution; read/write watchpoints stop before request side effects',async()=>{
 const{r}=await setup('LDI R0,55\nSTORE R0,1\nHALT');const d=new A.DebugSession(r);d.addBreakpoint(1);let result=d.advance(20);assert.equal(result.advanced,1);assert.equal(cpu(r).regs[0],0);assert.equal(result.hit.line,1);d.stepInstruction();assert.equal(cpu(r).regs[0],55);d.addWatch(1);result=d.advance(20);assert.equal(result.hit.kind,'watch');assert.equal(hw(r,'ram').memory[1],0);assert.equal(cpu(r).phase,'execute');d.continueOnce();d.advance(20);assert.equal(hw(r,'ram').memory[1],55);assert.equal(cpu(r).phase,'halted');assert.throws(()=>d.addBreakpoint(900));
});
test('EI, DI and IRET take a real external request, save state, restore it and acknowledge correct source',async()=>{
 const{r}=await setup('LDI R0,7\nEI\nloop: JMP loop\nhandler: LDI R0,99\nSTORE R0,1\nIRET',p=>p.circuit.instances.find(n=>n.id==='cpu').parameters.vector1=3);tick(r,4);r.setInput('irq_id',1);r.setInput('irq',1);tick(r);assert.equal(cpu(r).frames.length,1);assert.equal(cpu(r).pc,3);assert.equal(C.scalar(r.getPort(C.ep('cpu','irq_ack'))),1);assert.equal(C.scalar(r.getPort(C.ep('cpu','irq_ack_id'))),1);r.setInput('irq',0);tick(r,20);assert.equal(hw(r,'ram').memory[1],99);assert.equal(cpu(r).regs[0],7);assert.equal(cpu(r).frames.length,0);assert.equal(cpu(r).ie,true);
 const di=await setup('DI\nloop: JMP loop');di.r.setInput('irq',1);tick(di.r,20);assert.equal(cpu(di.r).frames.length,0);
});
test('nested IRQ only accepts higher priority and nested snapshots preserve full frames',async()=>{
 const source='EI\nmain: JMP main\nlow: EI\nwait: JMP wait\nhigh: LDI R0,77\nSTORE R0,2\nIRET';
 const{r,project}=await setup(source,p=>Object.assign(p.circuit.instances.find(n=>n.id==='cpu').parameters,{vector2:2,vector0:4}));tick(r,2);r.setInput('irq_id',2);r.setInput('irq',1);tick(r);assert.equal(cpu(r).frames.length,1);r.setInput('irq',0);tick(r,2);r.setInput('irq_id',3);r.setInput('irq',1);tick(r,5);assert.equal(cpu(r).frames.length,1);r.setInput('irq',0);tick(r);r.setInput('irq_id',0);r.setInput('irq',1);for(let i=0;i<3&&cpu(r).frames.length<2;i++)tick(r);assert.equal(cpu(r).frames.length,2);const restored=C.Runtime.fromSnapshot(project,r.snapshot());r.setInput('irq',0);restored.setInput('irq',0);tick(r,20);tick(restored,20);assert.deepEqual(r.snapshot(),restored.snapshot());assert.equal(hw(r,'ram').memory[2],77);assert.equal(cpu(r).frames.length,1);assert.equal(cpu(r).regs[0],0);
});
test('two packaged CPU+RAM copies have independent firmware, state and external memories',async()=>{
 const b=await A.build('array-stack'),pkg=await C.packageModule(b.project,'CPU16 board','user.cpu16');const p=await C.createProject('two');await C.placeModule(p,pkg,'first');await C.placeModule(p,pkg,'second');const r=new C.Runtime(await C.importProject(p));tick(r,400);assert.equal(cpu(r,'first/cpu').regs[3],36);assert.equal(cpu(r,'second/cpu').regs[3],36);r.reset('cold','first');tick(r);assert.equal(hw(r,'first/ram').memory[16],0);assert.equal(hw(r,'second/ram').memory[16],36);
});
test('receiver-only reset with a still-high request cannot replay old writes or read-clear side effects',()=>{
 const p=A.defaultParameters(A.DEV),values={req:0,we:0,address:3,wdata:0,input:0,reset:0},read=id=>C.signal(values[id],['address','wdata','input'].includes(id)?16:1);let s=A.fresh(A.DEV,p);s=A.sample(A.DEV,p,s,read,C);values.req=1;s=A.sample(A.DEV,p,s,read,C);s=A.sample(A.DEV,p,s,read,C);assert.equal(s.response.data,7);assert.equal(s.values[3],0);s=A.reset(A.DEV,p,s,'warm',C);for(let i=0;i<10;i++)s=A.sample(A.DEV,p,s,read,C);assert.equal(s.values[3],7);assert.equal(s.transactions,'0');assert.equal(s.response,null);values.req=0;s=A.sample(A.DEV,p,s,read,C);values.req=1;s=A.sample(A.DEV,p,s,read,C);s=A.sample(A.DEV,p,s,read,C);assert.equal(s.response.data,7);assert.equal(s.values[3],0);
});
test('invalid nullable fields and impossible program counters reject snapshots without touching original runtime',async()=>{
 const{r,project}=await setup('HALT');const before=r.snapshot();for(const[path,key,value]of[['cpu','pending',false],['cpu','lastAccess',false],['cpu','pc',999],['cpu','frames',null],['ram','active',false],['ram','response',false],['ram','armed',1],['ram','memory',null]]){const bad=clone(before);bad.instances[path].hardware[key]=value;assert.throws(()=>C.Runtime.fromSnapshot(project,bad),path+'.'+key);assert.deepEqual(r.snapshot(),before);}
});
test('unknown masked FSM inputs and enabled IRQ input produce explicit faults, reset recovers',async()=>{
 const f=await setup('state-machine');f.r.setInput('input','X');tick(f.r);assert.equal(hw(f.r,'fsm').fault,'F_INPUT_UNKNOWN');f.r.setInput('reset',1);tick(f.r);assert.equal(hw(f.r,'fsm').fault,null);const c=await setup('EI\nloop: JMP loop');c.r.setConnection('irq',false);tick(c.r,4);assert.equal(cpu(c.r).fault,'F_IRQ_UNKNOWN');assert.equal(cpu(c.r).pc,1);
});
test('all new models have complete port manuals and every included code example validates with its real parser',()=>{
 assert.equal(A.manuals.entries.length,4);for(const[id,model]of Object.entries(A.models)){assert(A.manuals.entries.some(e=>e.appliesTo.includes(id)));for(const p of model.ports)assert(A.manuals.portHints[id][p.id],id+'.'+p.id);}for(const e of A.manuals.entries)for(const s of e.sections.filter(s=>s.code)){if(s.codeTarget==='architecture16')assert(A.assemble(s.code).ok,s.codeTitle);else if(s.codeTarget==='json-fsm'){const p=A.defaultParameters(A.FSM);p.table=s.code;A.validateParameters(A.FSM,p);}else if(s.codeTarget==='json-registers'){const p=A.defaultParameters(A.DEV);p.registers=s.code;A.validateParameters(A.DEV,p);}else assert.fail('missing code target');}
});
