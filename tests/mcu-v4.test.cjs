'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../game/circuit.js'),M=require('../game/mcu-v4.js'),B=require('../game/builder-mcu.js');
const clone=x=>JSON.parse(JSON.stringify(x));
async function setup(source){const built=await M.build(source);return{...built,r:new C.Runtime(built.project)};}
const h=(r,id)=>r.inspect().instances[id].hardware;
const byteHistory=(r)=>r.inspect().terminals.terminal.history.entries.filter(e=>e.kind==='byte');
test('Build8/2 consists of separately wired hardware and all12 new models can instantiate independently',async()=>{
  const{project,r}=await setup('mcu4-i2c');assert.equal(project.circuit.instances.length,26);assert.equal(M.list.length,12);assert(![...r.states.values()].some(s=>s.cpu));assert.equal(project.firmware.length,0);assert.equal(project.circuit.instances.find(n=>n.id==='program_rom').parameters.source,M.SAMPLES.find(s=>s.id==='mcu4-i2c').source);const p=await C.createProject();for(const[id,i]of M.list.map((x,i)=>[x.id,i]))C.createInstance(p,id,'module'+i);await C.importProject(p);
});
test('new assembler has19 strict instruction encodings, old v1 ISA stays16 and EI is rejected there',()=>{
  assert.equal(M.assemble('LDI handler\nEI\nDI\nhandler: IRET').words.join(','),'259,4096,4352,4608');assert.equal(B.assemble('EI').ok,false);for(const s of['IRET 1','EI 1','DI 1','SHL 8','LDI missing','JMP end\nend:','LDI 256','NOP\n'.repeat(257),'globalThis.x=1'])assert(!M.assemble(s).ok,s);assert.equal(M.assemble('NOP\n'.repeat(256)).words.length,256);
});
test('fetch/execute observes actual ROM, old arithmetic and RAM path work on /2 without interpreter',async()=>{
  const{r}=await setup('LDI 7\nADDI 5\nSTORE 3\nLDI 0\nLOAD 3\nOUT\nHALT');r.advance(1n);assert.equal(M.inspect(r).instruction,0x107);assert.equal(M.inspect(r).accumulator,0);r.advance(13n);assert.equal(M.inspect(r).output,12);assert.equal(M.inspect(r).ram[3],12);assert.equal(M.inspect(r).halted,true);assert.deepEqual(r.issues,[]);
});
test('GPIO resolves actual button and output wires; UART arrives only1042us after enqueue',async()=>{
  const{r}=await setup('mcu4-gpio-uart');r.advance(12n);assert.equal(h(r,'uart').active.done,'1054');assert.equal(byteHistory(r).length,0);r.setInput('button',1,13n);r.advance(12n);assert.equal(C.scalar(r.getPort('led')),1);r.setInput('button',0);r.advance(12n);assert.equal(C.scalar(r.getPort('led')),0);r.advance(1017n);assert.equal(r.time,1053n);assert.equal(byteHistory(r).length,0);r.advance(1n);assert.equal(byteHistory(r)[0].byte,66);
});
test('address decoder routes MMIO instead of aliasing data RAM',async()=>{
  const{r}=await setup('LDI 2\nSTORE 0xC0\nLDI 90\nSTORE 0xC1\nLOAD 0xC1\nOUT\nHALT');r.advance(14n);assert.equal(h(r,'gpio').dir,2);assert.equal(h(r,'gpio').out,90);assert.equal(M.inspect(r).output,90);assert.equal(M.inspect(r).ram[0xc1],0);
});
test('disconnecting address, write-enable, readback, ROM or arithmetic wires breaks actual work',async()=>{
  for(const[id,source,check]of[
    ['bus_write_gpio','LDI 2\nSTORE 0xC0\nHALT',r=>h(r,'gpio').dir===0],
    ['address_to_decoder','LDI 2\nSTORE 0xC0\nHALT',r=>h(r,'gpio').dir===0],
    ['mmio_to_writeback','LDI 5\nSTORE 1\nLOAD 1\nOUT\nHALT',r=>M.inspect(r).output===null],
    ['rom_to_ir','LDI 90\nOUT\nHALT',r=>M.inspect(r).output!==90],
    ['alu_writeback','LDI 90\nOUT\nHALT',r=>M.inspect(r).output!==90]
  ]){const{r}=await setup(source);r.setConnection(id,false);r.advance(20n);assert(check(r),id);if(['bus_write_gpio','address_to_decoder','rom_to_ir'].includes(id))assert(r.issues.length,id);}
});
test('GPIO unknown/conflict is reported and is never converted into valid CPU input',async()=>{
  const{r}=await setup('LDI 0\nSTORE 0xC3\nLOAD 0xC2\nOUT\nHALT');r.advance(10n);assert.equal(M.inspect(r).output,null);assert(r.issues.some(x=>x.code==='E_UNKNOWN_GPIO'));const b=await setup('LDI 1\nSTORE 0xC0\nHALT');b.r.advance(6n);assert(b.r.issues.some(x=>x.code==='E_DRIVE_CONFLICT'));
});
test('GPIO debounce and double-edge interrupt latch depend on stable input samples',async()=>{
  const{r}=await setup('LDI 4\nSTORE 0xC6\nLDI 1\nSTORE 0xC4\nloop: JMP loop');r.advance(10n);r.setInput('button',1,11n);r.setInput('button',0,13n);r.advance(5n);assert.equal(h(r,'gpio').flags,0);r.setInput('button',1,16n);r.advance(4n);assert.equal(h(r,'gpio').flags,1);assert.equal(h(r,'gpio').filtered&1,1);
});
test('timer interrupt saves actual PC/A, enters visible handler and IRET returns; DI suppresses entry',async()=>{
  const{r}=await setup('mcu4-timer-irq');r.advance(215n);assert.equal(h(r,'irq').entries,'0');r.advance(2n);assert.equal(h(r,'irq').active,1);assert.deepEqual(h(r,'irq').frame,{pc:9,acc:7});r.advance(20n);assert.equal(h(r,'irq').active,0);assert.equal(M.inspect(r).accumulator,7);assert.equal(M.inspect(r).pc,9);assert.equal(M.inspect(r).output,1);r.advance(763n);assert.equal(h(r,'irq').entries,'4');assert.equal(M.inspect(r).ram[0],4);const d=await setup(M.SAMPLES.find(s=>s.id==='mcu4-timer-irq').source.replace('EI','DI'));d.r.advance(500n);assert.equal(h(d.r,'irq').entries,'0');assert.equal(h(d.r,'timer').flag,1);
});
test('illegal IRET does not silently alter PC; disconnecting IRQ request prevents handler',async()=>{
  const a=await setup('IRET');a.r.advance(2n);assert.equal(M.inspect(a.r).pc,0);assert.equal(M.inspect(a.r).halted,true);assert(a.r.issues.some(i=>i.code==='E_BUILD8_ENCODING'));const b=await setup('mcu4-timer-irq');b.r.setConnection('irq_request_timer',false);b.r.advance(500n);assert.equal(h(b.r,'irq').entries,'0');assert(b.r.issues.some(i=>i.code==='E_UNKNOWN_IRQ'));
});
test('PWM runs after CPU HALT and produces exact duty samples, pause freezes it',async()=>{
  const{r}=await setup('LDI 8\nSTORE 0xD9\nLDI 3\nSTORE 0xDA\nLDI 1\nSTORE 0xD8\nHALT');r.advance(14n);let highs=0;for(let i=0;i<8;i++){r.advance(1n);highs+=C.scalar(r.getPort('pwm_led'));}assert.equal(highs,3);assert(M.inspect(r).halted);const before=r.snapshot();r.pause();const paused=r.snapshot();r.advance(100n);assert.deepEqual(r.snapshot(),paused);assert.equal(before.time,paused.time);
});
test('SPI sends real four byte requests and reads back device register90; mode error has no write',async()=>{
  const{r}=await setup('mcu4-spi');r.advance(120n);assert.equal(M.inspect(r).output,90);assert.equal(r.inspect().instances.spi_device.device.registers[1],90);assert.equal(r.history.filter(e=>e.kind==='protocol'&&e.ok).length,4);const bad=await setup('LDI 1\nSTORE 0xE8\nSTORE 0xEA\nSTORE 0xEB\nHALT');bad.r.advance(40n);assert.equal(h(bad.r,'spi').status,6);assert.equal(bad.r.inspect().instances.spi_device.device.selected,null);
});
test('I2C samples real external temperature at completion and repeats after environmental change',async()=>{
  const{r}=await setup('mcu4-i2c');r.advance(115n);assert.equal(M.inspect(r).output,0);r.advance(20n);assert.equal(M.inspect(r).output,25);r.setSensorTemperature('sensor',65);r.advance(150n);assert.equal(M.inspect(r).output,65);assert.equal(M.inspect(r).ram[2],65);assert(r.history.some(e=>e.kind==='protocol'&&e.value===65));
});
test('I2C NACK and SPI/I2C disconnection/reconnection never commit an in-flight transaction',async()=>{
  const bad=await setup('LDI 1\nSTORE 0xF0\nLDI 73\nSTORE 0xF1\nLDI 1\nSTORE 0xF4\nHALT');bad.r.advance(130n);assert.equal(h(bad.r,'i2c').status,6);assert.equal(bad.r.inspect().instances.sensor.device.transactions,'0');for(const[id,line,until]of[['mcu4-i2c','i2c_line',120n],['mcu4-spi','spi_line',20n]]){const{r}=await setup(id);r.setConnection(line,false,17n);r.setConnection(line,true,18n);r.advance(until);assert(r.history.some(e=>e.kind==='protocol'&&!e.ok));}
});
test('UART input is actual delayed terminal transfer and RX pop only occurs on LOAD',async()=>{
  const{r}=await setup('LDI 3\nSTORE 0xE0\nloop: LOAD 0xE3\nANDI 1\nJZ loop\nLOAD 0xE2\nOUT\nSTORE 0xE1\nHALT');r.advance(6n);r.injectTerminal('terminal',90);r.advance(1041n);assert.equal(h(r,'uart').received,'0');r.advance(15n);assert.equal(M.inspect(r).output,90);assert.equal(h(r,'uart').received,'1');assert.equal(h(r,'uart').rx.length,0);r.advance(1042n);assert.equal(byteHistory(r).at(-1).byte,90);
});
test('UART full FIFO drops new byte with sticky error and disabled TX cancels queued/inflight',async()=>{
  const fill='LDI 1\nSTORE 0xE0\nLDI 65\n'+Array(17).fill('STORE 0xE1').join('\n')+'\nHALT';const{r}=await setup(fill);r.advance(42n);assert.equal(h(r,'uart').tx.length,16);assert.equal(h(r,'uart').error,1);const cancel=await setup('LDI 1\nSTORE 0xE0\nLDI 65\nSTORE 0xE1\nLDI 0\nSTORE 0xE0\nHALT');cancel.r.advance(1100n);assert.equal(byteHistory(cancel.r).length,0);assert.equal(h(cancel.r,'uart').tx.length,0);
});
test('warm reset at UART completion wins and disconnect/reconnect loses old transmit token',async()=>{
  for(const mode of['reset','disconnect']){const{r}=await setup('mcu4-gpio-uart');r.advance(12n);if(mode==='reset')r.reset('warm','uart',1054n);else{r.setConnection('uart_tx_line',false,1053n);r.setConnection('uart_tx_line',true,1054n);}r.advance(1042n);assert.equal(byteHistory(r).length,0,mode);}
});
test('UART synchronous reset invalidates receiving epoch even if RX re-enables before completion',async()=>{
  const{r}=await setup('LDI 2\nSTORE 0xE0\nloop: JMP loop');r.advance(6n);r.injectTerminal('terminal',88);r.advance(1n);r.setInput('reset',1,8n);r.setInput('reset',0,9n);r.advance(1100n);assert.equal(h(r,'uart').rx.length,0);assert.equal(h(r,'uart').received,'0');
});
test('warm reset keeps RAM while peripheral state clears; power loss cancels requests and cold clears RAM',async()=>{
  const{r}=await setup('mcu4-i2c');r.advance(135n);assert.equal(M.inspect(r).ram[2],25);r.reset('warm');r.advance(1n);assert.equal(M.inspect(r).ram[2],25);assert.equal(h(r,'i2c').active,null);assert.equal(h(r,'gpio').dir,0);r.setPower('main',false);r.advance(1n);const transactions=r.inspect().instances.sensor.device.transactions;r.advance(200n);assert.equal(r.inspect().instances.sensor.device.transactions,transactions);r.setPower('main',true);r.advance(1n);assert.equal(M.inspect(r).ram[2],0);
});
test('active UART/SPI/I2C and interrupt frame snapshots restore exact continuation',async()=>{
  for(const[id,time]of[['mcu4-gpio-uart',12],['mcu4-spi',14],['mcu4-i2c',20],['mcu4-timer-irq',218]]){const{project,r}=await setup(id);r.advance(BigInt(time));const b=C.Runtime.fromSnapshot(project,r.snapshot());r.advance(1100n);b.advance(1100n);assert.deepEqual(b.snapshot(),r.snapshot(),id);}
});
test('malformed protocol/IRQ snapshot import is atomic and v0.3 runtime snapshots remain accepted',async()=>{
  const{r}=await setup('mcu4-i2c');r.advance(20n);const before=r.snapshot(),bad=clone(before);bad.instances.i2c.hardware.active.done='119';assert.throws(()=>C.Runtime.fromSnapshot(r.project,bad));assert.deepEqual(r.snapshot(),before);const frame=clone(before);frame.instances.irq.hardware.active=1;assert.throws(()=>C.Runtime.fromSnapshot(r.project,frame));assert.deepEqual(r.snapshot(),before);const v1=await B.build(),legacy=new C.Runtime(v1.project),snapshot=legacy.snapshot();snapshot.engineVersion='0.3.0';C.Runtime.fromSnapshot(v1.project,snapshot);assert.equal(legacy.time,0n);
});
test('source edits update actual ROM, preserve original on rejection and change behavior',async()=>{
  const b=await M.build('LDI 1\nOUT\nHALT'),before=clone(b.project),p=await M.applyProgram(b.project,'LDI 65\nOUT\nHALT'),r=new C.Runtime(p);r.advance(6n);assert.equal(M.inspect(r).output,65);assert.deepEqual(b.project,before);await assert.rejects(M.applyProgram(b.project,'EI 1'));assert.deepEqual(b.project,before);
});
test('complete packaged MCU instances retain source, peripherals, protocol devices and independent memory/reset',async()=>{
  const b=await M.build('mcu4-i2c'),pkg=await C.packageModule(b.project,'模块 MCU','user.mcu4'),p=await C.createProject();await C.placeModule(p,pkg,'a');await C.placeModule(p,pkg,'b');const r=new C.Runtime(p);r.setSensorTemperature('a/sensor',65);r.advance(150n);assert.equal(M.inspect(r,'a').output,65);assert.equal(M.inspect(r,'b').output,25);assert(![...r.states.values()].some(s=>s.cpu));r.reset('warm','a');r.advance(1n);assert.equal(M.inspect(r,'a').pc,0);assert.notEqual(M.inspect(r,'b').pc,0);assert.equal(M.inspect(r,'a').ram[2],65);assert.equal(M.inspect(r,'b').ram[2],25);const restored=C.Runtime.fromSnapshot(p,r.snapshot());r.advance(150n);restored.advance(150n);assert.deepEqual(r.snapshot(),restored.snapshot());assert(pkg.definition.model.circuit.instances.some(n=>n.id==='program_rom'&&n.parameters.source===b.source));
});
