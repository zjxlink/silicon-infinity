'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../game/circuit.js'),T=require('../game/terminal-v8.js'),A=require('../game/architecture-v5.js'),U=require('../game/custom-cpu-v8.js');
const clone=x=>JSON.parse(JSON.stringify(x)),tick=(r,n=1)=>r.advance(BigInt(n),{force:true}),h=(r,id)=>r.inspect().instances[id]?.hardware;
async function setup(core='fixed',options={}){const w=await T.build(core,{period:2000,...options}),r=new C.Runtime(w.project);return{w,r};}
function until(r,predicate,max=12000,step=10){for(let used=0;used<max;used+=step){if(predicate(T.inspect(r)))return T.inspect(r);tick(r,step);}assert.ok(predicate(T.inspect(r)),'condition not reached: '+JSON.stringify({time:r.time.toString(),count:T.inspect(r).count,cpu:T.inspect(r).cpu,errors:T.inspect(r).errors}));return T.inspect(r);}
function received(r,path='terminal'){return r.inspect().terminals[path].history.entries.filter(x=>x.kind==='byte');}

test('both source profiles compile and board exposes real modules and all public windows',async()=>{
 for(const core of['fixed','custom']){const w=await T.build(core);const a=core==='fixed'?A.assemble(w.source):U.assemble(U.DEFAULT_ISA,w.source);assert.equal(a.ok,true,a.error);assert.ok(a.labels.timer_isr>0);assert.ok(a.labels.uart_isr>a.labels.timer_isr);assert.match(w.source,/IRET/);assert.ok(w.project.circuit.instances.some(x=>x.id==='dma'));assert.equal(w.project.circuit.instances.find(x=>x.id==='cpu').parameters.source,w.source);assert.ok(w.sources[(core==='custom'?'customarch2:':'architecture:')+'cpu']);await C.importProject(w.project);assert.deepEqual(Object.values(T.ADDRESS),[0,256,272,288,304,320,336]);assert.equal(T.inspect(new C.Runtime(w.project)).initialized,false);}
 await assert.rejects(()=>T.build('bad'));await assert.rejects(()=>T.build('fixed',{period:999}));await assert.rejects(()=>T.build('fixed',{hidden:1}));
});
for(const core of['fixed','custom'])test(core+' performs actual I2C, SPI readback, RAM commit, DMA and UART with changing input',async()=>{
 const{r}=await setup(core);until(r,s=>s.count>=1);let s=T.inspect(r);assert.deepEqual(s.records,[25]);assert.deepEqual(s.copied,[25]);assert.equal(s.readback,25);assert.equal(s.display,25);assert.equal(s.peripherals.storage.memory[0],25);assert.equal(s.errors,0);assert.ok(s.interrupts.timer>=1);until(r,s=>s.interrupts.dma>=1&&BigInt(s.peripherals.uart.completed)>=1);assert.ok(received(r).some(e=>e.byte===25));T.setSense(r,65);until(r,s=>s.records.includes(65));s=T.inspect(r);assert.equal(s.cpu.fault,null);assert.deepEqual(s.copied,s.records);assert.equal(s.last,65);assert.equal(s.peripherals.storage.memory[s.count-1],65);assert.ok(BigInt(s.peripherals.sensor.transactions)>=2n);assert.ok(BigInt(s.peripherals.spi.completed)>=BigInt(s.count*2));
});
test('finite eight slots stop new I2C reads and never overwrite existing records',async()=>{
 const{r}=await setup('custom',{period:1000});until(r,s=>s.full,30000,100);until(r,s=>!s.peripherals.uart.active,3000);const before=T.inspect(r);T.setSense(r,99);tick(r,4000);const after=T.inspect(r);assert.equal(after.count,8);assert.deepEqual(after.records,before.records);assert.deepEqual(after.copied,before.copied);assert.equal(after.peripherals.i2c.completed,before.peripherals.i2c.completed);assert.ok(after.interrupts.timer>before.interrupts.timer);assert.equal(after.cpu.fault,null);
});
test('UART P/R/C travel through actual receiver, ISR ring and main consumer',async()=>{
 const{r}=await setup('custom');until(r,s=>s.count>=1);T.sendCommand(r,'P');until(r,s=>!s.running&&s.interrupts.uart>=1);const count=T.inspect(r).count;tick(r,4500);assert.equal(T.inspect(r).count,count);assert.equal(T.inspect(r).commandQueue.head,T.inspect(r).commandQueue.tail);T.sendCommand(r,'C');until(r,s=>s.count===0&&!s.ready);assert.deepEqual(T.inspect(r).records,[]);assert.equal(T.inspect(r).peripherals.storage.memory[0],25);T.setSense(r,66);T.sendCommand(r,'R');until(r,s=>s.count>=1&&s.running);assert.equal(T.inspect(r).records[0],66);assert.ok(T.inspect(r).interrupts.uart>=3);assert.equal(T.inspect(r).commandQueue.dropped,0);assert.equal(T.inspect(r).cpu.fault,null);
});
test('GPIO button edges cause real IRQ and press toggles run, release does not toggle',async()=>{
 const{r}=await setup();until(r,s=>s.initialized);T.setButton(r,1);until(r,s=>s.interrupts.gpio===1&&!s.running);T.setButton(r,0);until(r,s=>s.interrupts.gpio===2);assert.equal(T.inspect(r).running,false);T.setButton(r,1);until(r,s=>s.interrupts.gpio===3&&s.running);assert.equal(T.inspect(r).cpu.fault,null);
});
test('disconnect I2C in flight prevents commit; reconnection retries through the same firmware',async()=>{
 const{r}=await setup();until(r,s=>!!s.peripherals.i2c.active);const first=T.inspect(r).peripherals.i2c.active;r.setConnection('i2c_sensor',false);until(r,s=>s.errors>=1);assert.equal(T.inspect(r).count,0);assert.equal(T.inspect(r).peripherals.sensor.transactions,'0');r.setConnection('i2c_sensor',true);T.setSense(r,73);until(r,s=>s.count>=1);assert.equal(T.inspect(r).records[0],73);assert.ok(BigInt(T.inspect(r).peripherals.i2c.history.find(e=>e.kind==='complete'&&e.ok).time)>BigInt(first.done));assert.equal(T.inspect(r).cpu.fault,null);
});
test('disconnect SPI while writing never fabricates storage or RAM success; reconnect recovers',async()=>{
 const{r}=await setup('custom');until(r,s=>!!s.peripherals.spi.active);r.setConnection('spi_storage',false);until(r,s=>s.errors>=1);assert.equal(T.inspect(r).count,0);assert.equal(T.inspect(r).peripherals.storage.memory[0],0);r.setConnection('spi_storage',true);until(r,s=>s.count===1);assert.equal(T.inspect(r).records[0],25);assert.equal(T.inspect(r).cpu.fault,null);
});
test('actual device write-busy errors are retried before successful readback',async()=>{
 const{r}=await setup('custom',{writeBusyUs:1000});until(r,s=>s.count===1,12000);const s=T.inspect(r);assert.equal(s.errors,0);assert.equal(s.readback,25);assert.ok(s.peripherals.storage.history.some(e=>!e.ok&&e.error==='DEVICE_BUSY'));assert.equal(s.peripherals.storage.memory[0],25);assert.equal(s.cpu.fault,null);
});
test('busy retry exhaustion is bounded and counted, and zero values are not treated as absent',async()=>{
 const{r}=await setup('fixed',{writeBusyUs:20000,sense:0});until(r,s=>s.errors>=1,16000);assert.equal(T.inspect(r).count,0);assert.equal(T.inspect(r).cpu.fault,null);const zero=await setup('custom',{sense:0,writeBusyUs:0});until(zero.r,s=>s.count>=1);assert.equal(T.inspect(zero.r).records[0],0);assert.equal(T.inspect(zero.r).readback,0);
});
test('UART disconnection leaves committed RAM intact and reports an actual transmission failure',async()=>{
 const{r}=await setup();r.setConnection('uart_tx',false);until(r,s=>s.errors>=1);assert.ok(T.inspect(r).count>=1);assert.equal(received(r).length,0);r.setConnection('uart_tx',true);until(r,()=>received(r).length>0);assert.equal(T.inspect(r).cpu.fault,null);
});
test('missing sensor input and broken CPU bus fail visibly without forged record values',async()=>{
 const{r}=await setup();r.setConnection('sense_to_sensor',false);until(r,s=>s.errors>=1);assert.equal(T.inspect(r).count,0);assert.ok(T.inspect(r).peripherals.i2c.errors&256);const other=await setup('custom');other.r.setConnection('cpu_req_to_bus_m0_req',false);tick(other.r,700);assert.ok(T.inspect(other.r).cpu.fault);assert.equal(T.inspect(other.r).count,0);
});
test('busy transaction snapshot restores exactly and invalid state import leaves current runtime unchanged',async()=>{
 const{w,r}=await setup('custom');until(r,s=>!!s.peripherals.i2c.active);const snap=r.snapshot(),before=JSON.stringify(snap),copy=C.Runtime.fromSnapshot(w.project,snap);tick(r,3200);tick(copy,3200);assert.deepEqual(copy.snapshot(),r.snapshot());const bad=clone(snap);bad.instances.cpu.hardware.irqFrame={pc:99999};assert.throws(()=>C.Runtime.fromSnapshot(w.project,bad));assert.equal(JSON.stringify(snap),before);assert.equal(T.inspect(r).cpu.fault,null);
});
test('pause freezes all progress; warm reset hides old metadata until firmware publishes a new session',async()=>{
 const{r}=await setup();until(r,s=>s.count>=1);r.pause();const before=r.snapshot();r.advance(5000n);assert.deepEqual(r.snapshot(),before);r.reset('warm');tick(r);assert.equal(T.inspect(r).initialized,false);assert.deepEqual(T.inspect(r).records,[]);assert.equal(T.inspect(r).peripherals.storage.memory[0],25);until(r,s=>s.initialized);assert.equal(T.inspect(r).count,0);assert.equal(T.inspect(r).errors,0);assert.equal(T.inspect(r).commandQueue.head,0);until(r,s=>s.count===1);assert.equal(T.inspect(r).cpu.fault,null);
});
test('two packaged terminal instances have separate sensors, CPU frames, RAM, DMA, UART and NVM',async()=>{
 const w=await T.build('custom',{period:2000}),pkg=await C.packageModule(w.project,'双终端','user.terminal-v8'),p=await C.createProject('双终端隔离');const a=await C.placeModule(p,pkg,'left'),b=await C.placeModule(p,pkg,'right'),r=new C.Runtime(await C.importProject(p));T.setSense(r,31,a.boundaryMap.sense);T.setSense(r,62,b.boundaryMap.sense);tick(r,5200);const left=T.inspect(r,'left'),right=T.inspect(r,'right');assert.ok(left.count>=1);assert.ok(right.count>=1);assert.equal(left.records[0],31);assert.equal(right.records[0],62);assert.equal(left.peripherals.storage.memory[0],31);assert.equal(right.peripherals.storage.memory[0],62);T.sendCommand(r,'P','left/terminal');tick(r,3600);assert.equal(T.inspect(r,'left').running,false);assert.equal(T.inspect(r,'right').running,true);assert.equal(T.inspect(r,'left').cpu.fault,null);assert.equal(T.inspect(r,'right').cpu.fault,null);assert.deepEqual(C.Runtime.fromSnapshot(r.project,r.snapshot()).snapshot(),r.snapshot());
});
test('public inspection is read only, rejects unrelated boards and input helpers validate before enqueue',async()=>{
 const{r,w}=await setup();const before=r.snapshot();T.inspect(r);assert.deepEqual(r.snapshot(),before);assert.throws(()=>T.setSense(r,256));assert.throws(()=>T.setButton(r,3));assert.throws(()=>T.sendCommand(r,'Q'));assert.deepEqual(r.snapshot(),before);const empty=new C.Runtime(await C.createProject());assert.equal(T.inspect(empty).compatible,false);assert.equal(T.inspect(empty).initialized,false);
 const minimal=await C.createProject('只有CPU与RAM的其他板');C.createInstance(minimal,'std.cpu16/1','cpu').parameters.source='HALT';C.createInstance(minimal,'std.bus-ram16/1','ram').parameters.depth=256;assert.equal(T.inspect(new C.Runtime(await C.importProject(minimal))).compatible,false);
 const recorder=await require('../game/recorder-v7.js').build('reference');assert.equal(T.inspect(new C.Runtime(recorder.project)).compatible,false);
 const editable=clone(w.project);editable.circuit.instances.find(n=>n.id==='cpu').parameters.source='HALT';assert.equal(T.inspect(new C.Runtime(await C.importProject(editable))).compatible,true);
 const changedInput=clone(w.project);changedInput.circuit.inputs.find(p=>p.id==='sense').id='renamed_sense';changedInput.initialInputs.renamed_sense=changedInput.initialInputs.sense;delete changedInput.initialInputs.sense;for(const wire of changedInput.circuit.wires)for(const end of[wire.from,wire.to])if(end.kind==='boundary'&&end.port==='sense')end.port='renamed_sense';assert.equal(T.inspect(new C.Runtime(await C.importProject(changedInput))).compatible,false);
});
test('editing applied firmware changes actual storage, DMA and GPIO values rather than a predefined demonstration',async()=>{
 const w=await T.build('fixed',{period:2000}),p=clone(w.project),cpu=p.circuit.instances.find(n=>n.id==='cpu');cpu.parameters.source=cpu.parameters.source.replace('LOAD R2, 0x153','LDI R2, 33');assert.equal(A.assemble(cpu.parameters.source).ok,true);const r=new C.Runtime(await C.importProject(p));until(r,s=>s.count===1);const s=T.inspect(r);assert.deepEqual(s.records,[33]);assert.deepEqual(s.copied,[33]);assert.equal(s.display,33);assert.equal(s.peripherals.storage.memory[0],33);assert.deepEqual(s.peripherals.i2c.rx,[25]);assert.equal(s.cpu.fault,null);
});
test('warm reset during an actual I2C frame cancels its delivery and starts a new sample session',async()=>{
 const{r}=await setup('custom');until(r,s=>!!s.peripherals.i2c.active);r.reset('warm');tick(r);assert.equal(T.inspect(r).initialized,false);assert.equal(T.inspect(r).peripherals.i2c.active,null);assert.equal(T.inspect(r).peripherals.sensor.transactions,'0');T.setSense(r,77);until(r,s=>s.initialized);assert.equal(T.inspect(r).count,0);assert.equal(T.inspect(r).peripherals.sensor.transactions,'0');until(r,s=>s.count===1);assert.deepEqual(T.inspect(r).records,[77]);assert.equal(T.inspect(r).peripherals.sensor.transactions,'1');assert.equal(T.inspect(r).cpu.fault,null);
});
