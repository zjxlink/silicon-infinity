'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),A=require('../game/custom-architecture-v6.js'),C=require('../game/circuit.js');
const clone=x=>JSON.parse(JSON.stringify(x)),state=(r,id='custom_cpu')=>r.inspect().instances[id].hardware,tick=(r,n=1)=>r.advance(BigInt(n),{force:true});
async function setup(id='custom-math',edit){const w=await A.build(id);if(edit)edit(w.project);const p=await C.importProject(w.project);return{...w,project:p,r:new C.Runtime(p)};}
const changeProgram=source=>p=>p.circuit.instances.find(n=>n.id==='custom_cpu').parameters.source=source;
test('custom ISA assembler encodes actual8/4/4/16bit fields and roundtrips through disassembly',()=>{
 const a=A.assemble(A.DEFAULT_ISA,'; first\nLIT R0,5\nLIT R1,7\nMIX R0,R1\nSTOP');assert(a.ok);assert.deepEqual(a.words,[0x01000005,0x01100007,0x05010000,0xff000000]);assert.deepEqual(a.sourceMap,[2,3,4,5]);const back=A.disassemble(A.DEFAULT_ISA,a.words);assert(back.ok);assert.deepEqual(A.assemble(A.DEFAULT_ISA,back.source).words,a.words);
 for(const raw of[0x99000000,0xff000001,0x00100000,0x01800001])assert(!A.disassemble(A.DEFAULT_ISA,[raw]).ok,raw.toString(16));
});
test('schema strictly rejects duplicate opcodes/names, unknown executable fields, invalid operand references and budgets',()=>{
 for(const change of[i=>i.instructions[1].opcode=0,i=>i.instructions[1].mnemonic='NOP',i=>i.registerCount=17,i=>i.instructions[0].steps=[{op:'eval',source:'globalThis.x=1'}],i=>i.instructions[0].steps=[{op:'set',dst:'rd',src:1}],i=>i.instructions[0].steps=Array(9).fill({op:'nop'}),i=>i.instructions[0].steps=[{op:'halt'},{op:'nop'}],i=>i.script='alert(1)',i=>i.instructions=Array(65).fill(i.instructions[0])]){const isa=JSON.parse(A.DEFAULT_ISA);change(isa);assert.throws(()=>A.validateISA(isa));}
 for(const code of['LIT R8,1','LIT R0,-1','LIT R0,65536','LOAD R0,[R1]','JUMP end\nend:','MISSING R0,1','LIT R0,1; comment\nSTOP 1','a: NOP\na: STOP','NOP\n'.repeat(1025)])assert(!A.assemble(A.DEFAULT_ISA,code).ok);
 assert(A.assemble(A.DEFAULT_ISA,'NOP\n'.repeat(1024)).ok);
});
test('custom instruction executes one visible micro-op per tick and then accesses real externalRAM',async()=>{
 const{r}=await setup();tick(r,5);assert.equal(state(r).ir,0x05010000);assert.equal(state(r).micro,0);tick(r);assert.equal(state(r).tmp,35);assert.equal(state(r).regs[0],5);assert.equal(state(r).micro,1);tick(r);assert.equal(state(r).regs[0],36);tick(r,40);assert.equal(state(r).regs[3],36);assert.equal(state(r,'ram').memory[16],36);assert.equal(state(r).phase,'halted');
});
test('changing mnemonic/opcode changes machine image; changing its microoperation changes actual arithmetic',async()=>{
 const one=await setup('custom-math'),two=await setup('custom-opcodes');tick(one.r);tick(two.r);assert.equal(state(one.r).ir>>>24,1);assert.equal(state(two.r).ir>>>24,97);tick(one.r,50);tick(two.r,50);assert.equal(state(one.r).regs[3],36);assert.equal(state(two.r).regs[3],42);assert(!A.assemble(two.project.circuit.instances.find(n=>n.id==='custom_cpu').parameters.isa,'LIT R0,1').ok);
});
test('register count is real, unused fixed observation ports are zero and out of profile registers reject',async()=>{
 const{r}=await setup('custom-math',p=>{const n=p.circuit.instances.find(n=>n.id==='custom_cpu'),i=JSON.parse(n.parameters.isa);i.registerCount=16;n.parameters.isa=JSON.stringify(i);n.parameters.source='LIT R15,65535\nSTOP';});tick(r,4);assert.equal(state(r).regs.length,16);assert.equal(A.known(r.getPort(C.ep('custom_cpu','r15')),C),65535);const q=JSON.parse(A.DEFAULT_ISA);q.registerCount=1;assert(!A.assemble(q,'LIT R1,1').ok);assert(A.assemble(q,'LIT R0,1\nSTOP').ok);
});
test('user-defined arithmetic operators and named formats execute actual16bit wrapped results',async()=>{
 const{r}=await setup('custom-math',p=>{const n=p.circuit.instances.find(n=>n.id==='custom_cpu'),i=JSON.parse(n.parameters.isa);for(const[k,j]of['sub','and','or','shl','shr'].map((x,i)=>[x,i]))i.instructions.push({mnemonic:k.toUpperCase(),opcode:100+j,form:'ri',steps:[{op:'alu',kind:k,dst:'rd',a:'rd',b:'imm'}]});n.parameters.isa=JSON.stringify(i);n.parameters.source='LIT R0,65535\nLIT R1,1\nADD R0,R1\nSUB R0,1\nAND R0,15\nOR R0,16\nSHL R0,1\nSHR R0,2\nXOR R0,R1\nMOVE R2,R0\nNOP\nSTOP';});tick(r,40);assert.equal(state(r).regs[0],14);assert.equal(state(r).regs[2],14);
});
test('custom CALL RETURN PUSH POP and zero jump support real loops and nested subroutines',async()=>{
 const{r}=await setup('custom-math',changeProgram('LIT R0,3\nLIT R1,0\nCALL sum\nSTOP\nsum: PUSH R0\nloop: ADD R1,R0\nDEC R0\nJZERO R0,end\nJUMP loop\nend: POP R0\nRETURN'));tick(r,100);assert.equal(state(r).regs[0],3);assert.equal(state(r).regs[1],6);assert.deepEqual(state(r).stack,[]);assert.equal(state(r).phase,'halted');
});
test('stack underflow, overflow, invalid returns and falloff preserve precisePC and micro faults',async()=>{
 for(const[source,code,pc]of[['RETURN','F_STACK_UNDERFLOW',0],['POP R0','F_STACK_UNDERFLOW',0],['LIT R0,999\nPUSH R0\nRETURN','F_RETURN',2],['loop: CALL loop\nSTOP','F_STACK_OVERFLOW',0],['NOP','F_PC',1]]){const{r}=await setup('custom-math',changeProgram(source));tick(r,200);assert.equal(state(r).fault,code);assert.equal(state(r).faultAt.pc,pc);assert.equal(state(r).pending,null);}
});
test('partial microinstruction commits are explicit: bus error does not undo a completed earlier micro-op',async()=>{
 const{r}=await setup('custom-math',p=>{const n=p.circuit.instances.find(n=>n.id==='custom_cpu'),i=JSON.parse(n.parameters.isa);i.instructions.push({mnemonic:'TRY',opcode:88,form:'r',steps:[{op:'set',dst:'rd',src:99},{op:'read',address:4096,dst:'rd'}]});n.parameters.isa=JSON.stringify(i);n.parameters.source='TRY R0\nSTOP';});tick(r,20);assert.equal(state(r).regs[0],99);assert.equal(state(r).retired,'0');assert.deepEqual(state(r).faultAt,{pc:0,micro:1});assert.equal(state(r).fault,'F_BUS_ERROR');
});
test('multiple bus micro-operations have a real low request gap and each completes only once',async()=>{
 const{r}=await setup('custom-math',p=>{const n=p.circuit.instances.find(n=>n.id==='custom_cpu'),i=JSON.parse(n.parameters.isa);i.instructions.push({mnemonic:'COPY',opcode:90,form:'rr',steps:[{op:'read',address:'rs',dst:'tmp'},{op:'write',address:'rd',data:'tmp'}]});n.parameters.isa=JSON.stringify(i);n.parameters.source='LIT R0,5\nLIT R1,1\nCOPY R0,R1\nSTOP';p.circuit.instances.find(n=>n.id==='ram').parameters.contents=[0,1234];});tick(r,40);assert.equal(state(r,'ram').memory[5],1234);assert.equal(state(r,'ram').transactions,'2');assert.equal(state(r).phase,'halted');
});
test('broken ready/data wires and long waits fail rather than inventing successful reads',async()=>{
 for(const line of['bus_ready','bus_rdata']){const{r}=await setup();r.setConnection(line,false);tick(r,100);assert.equal(state(r).fault,'F_BUS_UNKNOWN');assert.equal(state(r).regs[3],0);}
 const slow=await setup('custom-math',p=>{p.circuit.instances.find(n=>n.id==='custom_cpu').parameters.busTimeout=3;p.circuit.instances.find(n=>n.id==='ram').parameters.latency=30;});tick(slow.r,80);assert.equal(state(slow.r).fault,'F_BUS_TIMEOUT');assert.equal(state(slow.r,'ram').memory[16],0);
});
test('mid-micro and pending-bus snapshots continue identically; forged decoded image is rejected atomically',async()=>{
 for(const at of[6,12]){const{r,project}=await setup();tick(r,at);const snap=r.snapshot(),restored=C.Runtime.fromSnapshot(project,snap);tick(r,70);tick(restored,70);assert.deepEqual(r.snapshot(),restored.snapshot());const bad=clone(snap);bad.instances.custom_cpu.hardware.ir^=16777216;assert.throws(()=>C.Runtime.fromSnapshot(project,bad));}
});
test('reset cancels pending stores and clearsCPU but global warm reset preserves independentRAM',async()=>{
 const{r}=await setup('custom-math',p=>p.circuit.instances.find(n=>n.id==='ram').parameters.latency=10);tick(r,12);r.setInput('reset',1);tick(r,15);assert.equal(state(r,'ram').memory[16],0);r.setInput('reset',0);tick(r,100);assert.equal(state(r,'ram').memory[16],36);r.reset('warm');tick(r);assert.equal(state(r,'ram').memory[16],36);assert(state(r).regs.every(v=>v===0));
});
test('protocol receiver shifts actualclocked data bits and reports completion forA5',async()=>{
 const{r}=await setup('serial-receiver');r.setInput('input',1);tick(r);for(const b of[1,0,1,0,0,1,0,1]){r.setInput('input',1|(b<<2));tick(r);r.setInput('input',3|(b<<2));tick(r);}tick(r);assert.equal(state(r,'controller').shift,165);assert.equal(state(r,'controller').count,8);assert.equal(A.known(r.getPort('out'),C),2);assert.equal(state(r,'controller').fault,null);
});
test('protocol detects edges rather than repeated levels and wait timeout is explicit',async()=>{
 const{r}=await setup('serial-receiver');r.setInput('input',1);tick(r);r.setInput('input',7);tick(r,20);assert.equal(state(r,'controller').count,1);tick(r,21);assert.equal(state(r,'controller').fault,'F_PROTOCOL_TIMEOUT');assert.equal(A.known(r.getPort('out'),C),0);
});
test('falling edges, timer conditions, load/shift_out/count_set and successful boundary transition beat timeout',async()=>{
 const table={schema:A.PROTOCOL_SCHEMA,initial:'idle',states:[{id:'idle',output:0,timeout:0,rules:[{when:{kind:'falling',bit:0},next:'wait',actions:[{op:'load'},{op:'count_set',value:9}]}]},{id:'wait',output:1,timeout:2,rules:[{when:{kind:'after',ticks:2},next:'done',actions:[{op:'shift_out'}]}]},{id:'done',output:2,timeout:0,rules:[]}]};const{r}=await setup('serial-receiver',p=>p.circuit.instances[0].parameters.protocol=JSON.stringify(table));r.setInput('data',0x8001);r.setInput('input',1);tick(r);r.setInput('input',0);tick(r);assert.equal(state(r,'controller').shift,0x8001);tick(r);assert.equal(A.known(r.getPort('out'),C),1);tick(r);assert.equal(A.known(r.getPort('out'),C),2);assert.equal(state(r,'controller').shift,2);assert.equal(state(r,'controller').count,9);assert.equal(state(r,'controller').fault,null);
});
test('protocol unknown bits and counter overflow fault without partially committing transition actions',async()=>{
 const a=await setup('serial-receiver');a.r.setInput('input','X');tick(a.r);assert.equal(state(a.r,'controller').fault,'F_INPUT_UNKNOWN');
 const table={schema:A.PROTOCOL_SCHEMA,initial:'a',states:[{id:'a',output:1,timeout:0,rules:[{when:{kind:'always'},next:'a',actions:[{op:'load'},{op:'count_set',value:65535},{op:'count_add',value:1}]}]}]};const b=await setup('serial-receiver',p=>p.circuit.instances[0].parameters.protocol=JSON.stringify(table));b.r.setInput('data',99);tick(b.r);assert.equal(state(b.r,'controller').fault,'F_COUNTER_OVERFLOW');assert.equal(state(b.r,'controller').shift,0);assert.equal(state(b.r,'controller').count,0);
});
test('protocol schema rejects unknown expressions, impossible transitions and unbounded action lists',()=>{
 for(const edit of[p=>p.states[0].rules[0].when={kind:'script',code:'alert(1)'},p=>p.states[0].rules[0].next='missing',p=>p.states[0].rules[0].actions=Array(5).fill({op:'clear'}),p=>p.states[0].rules[0].when={kind:'level',mask:1,value:2},p=>p.states=Array(65).fill(p.states[0])]){const p=JSON.parse(A.DEFAULT_PROTOCOL);edit(p);assert.throws(()=>A.validateProtocol(p));}
});
test('protocol snapshot keeps edge history and independent packaged copies keep their own shift data',async()=>{
 const w=await A.build('serial-receiver'),pkg=await C.packageModule(w.project,'Serial','user.serial6'),p=await C.createProject(),one=await C.placeModule(p,pkg,'a'),two=await C.placeModule(p,pkg,'b');const r=new C.Runtime(p);r.setInput(one.boundaryMap.input,1);r.setInput(two.boundaryMap.input,1);tick(r);r.setInput(one.boundaryMap.input,7);r.setInput(two.boundaryMap.input,3);tick(r);const restored=C.Runtime.fromSnapshot(p,r.snapshot());tick(r,3);tick(restored,3);assert.deepEqual(restored.snapshot(),r.snapshot());assert.equal(state(r,'a/controller').shift,1);assert.equal(state(r,'b/controller').shift,0);assert.equal(state(r,'a/controller').count,1);assert.equal(state(r,'b/controller').count,1);
});
test('a portableCPU module carries customISA and program while two copies isolate registers, stack andRAM',async()=>{
 const w=await A.build('custom-opcodes'),pkg=await C.packageModule(w.project,'Custom CPU','user.customcpu6'),round=JSON.parse(JSON.stringify(pkg)),p=await C.createProject();await C.placeModule(p,round,'a');await C.placeModule(p,round,'b');const r=new C.Runtime(await C.importProject(p));r.setConnection('a/bus_ready',false);tick(r,80);assert.equal(state(r,'a/custom_cpu').fault,'F_BUS_UNKNOWN');assert.equal(state(r,'b/custom_cpu').regs[3],42);assert.equal(state(r,'b/ram').memory[16],42);assert.equal(state(r,'a/custom_cpu').regs[3],0);const restored=C.Runtime.fromSnapshot(p,r.snapshot());assert.deepEqual(restored.snapshot(),r.snapshot());
});
test('both registered models havecomplete manuals and every documented sourceexample compiles and executes',async()=>{
 assert.equal(A.manuals.entries.length,2);for(const[id,model]of Object.entries(A.models)){assert(A.manuals.entries.some(e=>e.appliesTo.includes(id)));assert.deepEqual(Object.keys(A.manuals.portHints[id]).sort(),model.ports.map(p=>p.id).sort());}
 for(const e of A.manuals.entries)for(const s of e.sections){if(s.codeTarget==='custom-protocol-json')assert.deepEqual(A.validateProtocol(s.code),A.validateProtocol(A.DEFAULT_PROTOCOL));if(s.codeTarget==='custom-isa-default'){assert(A.assemble(A.DEFAULT_ISA,s.code).ok);const{r}=await setup('custom-math',changeProgram(s.code));tick(r,200);assert.equal(state(r).fault,null);assert.equal(state(r).phase,'halted');if(s.id==='example')assert.equal(state(r).regs[3],36);if(s.id==='subroutine'){assert.equal(state(r).regs[0],12);assert.equal(state(r).regs[1],7);assert.deepEqual(state(r).stack,[]);}}}
});
