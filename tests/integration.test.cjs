'use strict';
// Independent end-to-end tests: all observations come from CircuitLab.Runtime.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core8 = require('../game/core8.js');
const C = require('../game/circuit.js');
const clone = value => JSON.parse(JSON.stringify(value));
const cases = [];
function test(name, coverage, fn) { cases.push({name,coverage,fn}); }
function code(source) { const a=Core8.assemble(source);assert.equal(a.ok,true,a.error);return a.bytes; }
const reference = Core8.SAMPLES.find(s=>s.id==='blinkButton').source;
async function board(source=reference, options={}) {
  const p=await C.createProject('独立集成夹具');
  p.powerDomains[0].initialPowered=options.powered!==false;
  C.createInstance(p,'std.vcc/1','vcc');C.createInstance(p,'std.gnd/1','gnd');
  const count=options.count||1;
  for(let i=0;i<count;i++){
    const name='mcu'+i,fw='fw'+i,src=Array.isArray(source)?source[i]:source;
    await C.addFirmware(p,fw,code(src));
    C.createInstance(p,'core8/1',name,undefined,{firmware:fw});
    C.addInput(p,'button'+i,'按钮', 'Z');C.addOutput(p,'led'+i,'LED');
    C.addWire(p,'button'+i,C.boundary('button'+i),C.ep(name,'GPIO0'));
    C.addWire(p,'led'+i,C.ep(name,'GPIO1'),C.boundary('led'+i));
    if(!options.missingVcc)C.addWire(p,'vcc'+i,C.ep('vcc','out'),C.ep(name,'VCC'));
    C.addWire(p,'gnd'+i,C.ep('gnd','out'),C.ep(name,'GND'));
    if(options.loopback)C.addWire(p,'loop'+i,C.ep(name,'UART_TX'),C.ep(name,'UART_RX'));
    else if(options.terminal!==false){
      C.createInstance(p,'io.terminal/1','term'+i);
      C.addWire(p,'tx'+i,C.ep(name,'UART_TX'),C.ep('term'+i,'RX'));
      C.addWire(p,'rx'+i,C.ep('term'+i,'TX'),C.ep(name,'UART_RX'));
    }
  }
  return p;
}
function at(runtime,target){assert(BigInt(target)>=runtime.time);runtime.advance(BigInt(target)-runtime.time);return runtime.inspect();}
function state(r,id='mcu0'){return r.inspect().instances[id];}
function pin(r,id){return C.scalar(r.getPort(id));}
function terminalBytes(r,id='term0'){return r.inspect().terminals[id].history.entries.filter(x=>x.kind==='byte').map(x=>({byte:x.byte,time:x.time}));}

test('reference template uses actual power, firmware, GPIO and1042us UART','T12',async()=>{
  const p=await board();const r=new C.Runtime(p);
  assert.equal(pin(r,'mcu0.GPIO1'),0);at(r,15);assert.equal(pin(r,'led0'),0);
  at(r,16);assert.equal(pin(r,'led0'),1);assert.equal(state(r).out,2);
  at(r,1047);assert.deepEqual(terminalBytes(r),[]);at(r,1048);assert.deepEqual(terminalBytes(r),[{byte:66,time:'1048'}]);
  at(r,60024);assert.equal(pin(r,'led0'),1);at(r,60025);assert.equal(pin(r,'led0'),0);
});
test('button events travel through wiring and program before P/R messages','T13,T33',async()=>{
  const r=new C.Runtime(await board());r.setInput('button0',1,10n);r.setInput('button0','Z',200010n);
  at(r,10);assert.equal(state(r).regs[1]&1,1);assert.equal(pin(r,'mcu0.GPIO0'),1);
  at(r,400100);assert.deepEqual(terminalBytes(r).map(x=>x.byte),[66,80,82]);assert.equal(pin(r,'mcu0.GPIO0'),0);
});
test('changing firmware WAIT changes real edge time','T14',async()=>{
  const r=new C.Runtime(await board(reference.replace('WAIT 60000','WAIT 30000')));
  at(r,16);assert.equal(pin(r,'led0'),1);at(r,30024);assert.equal(pin(r,'led0'),1);at(r,30025);assert.equal(pin(r,'led0'),0);
});
test('disconnect LED produces Z while CPU output remains high','T15',async()=>{
  const r=new C.Runtime(await board());at(r,16);r.setConnection('led0',false,17n);at(r,18);
  assert.equal(pin(r,'led0'),'Z');assert.equal(pin(r,'mcu0.GPIO1'),1);assert.equal(state(r).status,'WAITING');
  r.setConnection('led0',true,19n);at(r,19);assert.equal(pin(r,'led0'),1);
});
test('UART disconnect and reconnect invalidates old delivery but drains TX','T16',async()=>{
  const r=new C.Runtime(await board());r.setConnection('tx0',false,506n);r.setConnection('tx0',true,507n);at(r,1048);
  assert.deepEqual(terminalBytes(r),[]);assert.equal(state(r).uart.tx.length,0);assert.equal(r.inspect().connections.tx0.version,'2');
  r.setInput('button0',1,2000n);at(r,70000);assert.deepEqual(terminalBytes(r).map(x=>x.byte),[80]);
});
test('power-off and missing VCC never execute a MCU','T17',async()=>{
  const r=new C.Runtime(await board(reference,{powered:false}));at(r,10000);
  assert.equal(state(r).retiredCount,'0');assert.equal(state(r).status,'OFF');assert.equal(pin(r,'mcu0.GPIO1'),'Z');assert.deepEqual(terminalBytes(r),[]);
  r.setPower('main',true,10001n);at(r,11049);assert.deepEqual(terminalBytes(r),[{byte:66,time:'11049'}]);
  const missing=new C.Runtime(await board(reference,{missingVcc:true}));at(missing,10000);assert.equal(state(missing).status,'OFF');assert.equal(state(missing).retiredCount,'0');
});
test('wrong power roles and cross-domain supply reject before activation','T17',async()=>{
  const p=await board(),wrong=clone(p),crossed=clone(p);
  wrong.circuit.wires.find(w=>w.id==='gnd0').from=C.ep('vcc','out');
  await assert.rejects(()=>C.importProject(wrong),e=>e.code==='E_POWER_ROLE');
  crossed.powerDomains.push({id:'other',initialPowered:true});crossed.circuit.instances.find(x=>x.id==='gnd').bindings.power='other';
  await assert.rejects(()=>C.importProject(crossed),e=>e.code==='E_POWER_DOMAIN');
});
test('turning off an actual VCC wire stops execution and reconnect cold starts','T17,T25',async()=>{
  const r=new C.Runtime(await board());at(r,16);r.setConnection('vcc0',false,17n);at(r,18);
  assert.equal(state(r).status,'OFF');assert.equal(pin(r,'mcu0.GPIO1'),'Z');r.setConnection('vcc0',true,20n);at(r,36);
  assert.equal(pin(r,'led0'),1);assert.equal(state(r).pc,0x58);
});
test('floating GPIO faults; explicit weak pulldown restores known input','T18,T20',async()=>{
  const src='LDI R0,254\nST R0,0x4003\nLDI R1,165\nLD R1,0x4002\nHALT';
  const p=await board(src);const floating=new C.Runtime(p);at(floating,4);
  assert.equal(state(floating).fault.code,'F_UNKNOWN');assert.equal(state(floating).regs[1],165);assert.equal(pin(floating,'mcu0.GPIO0'),'Z');
  assert.deepEqual(state(floating).fault.unknownPins,['GPIO0']);const issue=floating.inspect().issues.find(x=>x.code==='F_UNKNOWN');assert(issue.message.includes('GPIO0'));assert.deepEqual(issue.ports,['mcu0.GPIO0']);
  const pulled=clone(p);pulled.circuit.wires.find(w=>w.id==='button0').pull='pull_down';const known=new C.Runtime(pulled);at(known,5);
  assert.equal(state(known).status,'HALTED');assert.equal(state(known).regs[1],0);assert.equal(pin(known,'mcu0.GPIO0'),0);
});
test('GPIO strong-driver conflict is unknown even when both drive1','T19,T04',async()=>{
  for(const value of [0,1]){
    const r=new C.Runtime(await board('LDI R0,'+value+'\nST R0,0x4001\nLDI R0,1\nST R0,0x4000\nLD R1,0x4002\nHALT'));
    r.setInput('button0',1,1n);at(r,5);assert.equal(pin(r,'mcu0.GPIO0'),'X');assert.equal(state(r).fault.code,'F_UNKNOWN');assert(r.inspect().issues.some(x=>x.code==='E_DRIVE_CONFLICT'));
  }
});
test('two real MCU instances have independent RAM, reset and UART','T28',async()=>{
  const src='LDI R0,99\nST R0,0x2000\nLDI R0,3\nST R0,0x4103\nLDI R0,65\nST R0,0x4100\nHALT';
  const r=new C.Runtime(await board(src,{count:2}));at(r,7);r.reset('warm','mcu0',100n);at(r,100);
  assert.equal(state(r,'mcu0').ram[0],99);assert.equal(state(r,'mcu0').pc,0);assert.equal(state(r,'mcu1').status,'HALTED');assert.equal(state(r,'mcu1').pc,28);
  at(r,1048);assert.deepEqual(terminalBytes(r,'term0'),[]);assert.deepEqual(terminalBytes(r,'term1'),[{byte:65,time:'1048'}]);
  at(r,1148);assert.deepEqual(terminalBytes(r,'term0'),[{byte:65,time:'1148'}]);
});
test('terminal bytes arrive after1042us then program echoes via UART','PER-007/008',async()=>{
  const r=new C.Runtime(await board(Core8.SAMPLES.find(s=>s.id==='echo').source));
  r.injectTerminal('term0',90,10n);at(r,1051);assert.deepEqual(terminalBytes(r),[]);assert.equal(state(r).uart.rx.length,0);
  at(r,2105);assert.deepEqual(terminalBytes(r).map(x=>x.byte),[90]);assert(BigInt(terminalBytes(r)[0].time)>=2094n);
});
test('MCU self-loopback travels via real link once, disconnect prevents success','PER-008/009',async()=>{
  const src='LDI R0,3\nST R0,0x4103\nLDI R0,66\nST R0,0x4100\nWAIT 1042\nLD R1,0x4101\nHALT';
  const p=await board(src,{loopback:true});const r=new C.Runtime(p);at(r,1048);assert.equal(state(r).regs[1],66);assert.equal(state(r).uart.rx.length,0);
  const broken=new C.Runtime(p);broken.setConnection('loop0',false,10n);at(broken,1048);assert.equal(state(broken).fault.code,'F_RX_EMPTY');assert.equal(state(broken).regs[1],0);
});
test('pause is frozen and snapshot restores remaining UART delay once','T23,T27',async()=>{
  const p=await board(),r=new C.Runtime(p);r.setConnection('led0',false,100n);r.setConnection('led0',true,101n);at(r,506);r.pause();const before=r.snapshot();assert.equal(before.connections.led0.version,'2');r.advance(2000000n);assert.deepEqual(r.snapshot(),before);
  const restored=C.Runtime.fromSnapshot(p,JSON.stringify(before));assert.deepEqual(restored.snapshot(),before);
  r.resume();restored.resume();r.advance(542n);restored.advance(542n);assert.deepEqual(terminalBytes(restored),[{byte:66,time:'1048'}]);assert.deepEqual(restored.snapshot(),r.snapshot());
});
test('same-time warm reset or disconnect wins over UART delivery','T24,T32',async()=>{
  const p=await board(),reset=new C.Runtime(p),disconnected=new C.Runtime(p);
  reset.reset('warm','mcu0',1048n);at(reset,1048);assert.deepEqual(terminalBytes(reset),[]);assert.equal(state(reset).pc,0);
  disconnected.setConnection('tx0',false,1048n);at(disconnected,1048);assert.deepEqual(terminalBytes(disconnected),[]);assert.equal(state(disconnected).uart.tx.length,0);
});
test('saved design restarts rather than silently restoring RAM','T25,T26',async()=>{
  const p=await board('LDI R0,123\nST R0,0x2000\nHALT'),r=new C.Runtime(p);at(r,3);assert.equal(state(r).ram[0],123);
  const restoredProject=await C.importProject(JSON.stringify(p)),fresh=new C.Runtime(restoredProject);assert.equal(state(fresh).ram[0],0);assert.equal(state(fresh).pc,0);
  r.setPower('main',false,4n);r.setPower('main',true,5n);at(r,5);assert.equal(state(r).ram[0],0);assert.equal(state(r).pc,0);
});
test('bad candidate imports never mutate caller design or running state','T08(partial),T43(partial)',async()=>{
  const p=await board(),r=new C.Runtime(p);at(r,506);const projectBefore=JSON.stringify(p),runtimeBefore=JSON.stringify(r.snapshot());
  const changed=clone(p);changed.firmware[0].data='ff'+changed.firmware[0].data.slice(2);
  await assert.rejects(()=>C.importProject(changed),e=>e.code==='E_HASH_MISMATCH');
  const wrong=clone(p);wrong.circuit.instances[0].extraScript='globalThis.hacked=true';await assert.rejects(()=>C.importProject(wrong));
  await assert.rejects(()=>C.importProject('{"__proto__":{},"schema":"x"}'));
  assert.equal(JSON.stringify(p),projectBefore);assert.equal(JSON.stringify(r.snapshot()),runtimeBefore);assert.equal(globalThis.hacked,undefined);
});
test('incompatible or tampered snapshot is rejected without current state changes','T44',async()=>{
  const p=await board(),r=new C.Runtime(p);at(r,506);const before=r.snapshot();
  for(const mutate of [s=>s.engineVersion='999',s=>s.projectHash='sha256:'+'0'.repeat(64),s=>s.instances.mcu0.cpu.ram.pop()]){
    const bad=clone(before);mutate(bad);assert.throws(()=>C.Runtime.fromSnapshot(p,bad),e=>e.code==='E_SNAPSHOT_INCOMPATIBLE');assert.deepEqual(r.snapshot(),before);
  }
});

test('every shipped lesson is canonical; incomplete challenges remain incomplete','T30(partial),LAMP-005',async()=>{
  const L=require('../game/lessons.js');
  const expectedIncomplete=new Set(['first-wire','chip-package','faster-lamp']);
  for(const lesson of L.list){
    const built=await L.build(lesson.id),valid=await C.validate(built.project);assert.equal(valid.ok,true,lesson.id+': '+JSON.stringify(valid.errors));
    const verified=await L.verify(lesson.id,built.project);assert.equal(verified.ok,!expectedIncomplete.has(lesson.id),lesson.id+': '+JSON.stringify(verified.checks));
  }
});
test('shipped smart-lamp uses the exact assembler bytes and real output paths','T12,T15,LAMP-001/002',async()=>{
  const L=require('../game/lessons.js'),built=await L.build('smart-lamp');
  assert.equal(built.project.firmware[0].data,Buffer.from(code(built.source)).toString('hex'));
  const r=new C.Runtime(built.project);at(r,16);assert.equal(pin(r,'led'),1);at(r,1048);assert.deepEqual(terminalBytes(r,'terminal'),[{byte:66,time:'1048'}]);
  const broken=clone(built.project);broken.circuit.wires=broken.circuit.wires.filter(w=>w.id!=='led_wire');
  assert.equal((await L.verify('smart-lamp',broken)).ok,false);
  const halted=clone(built.project),bytes=code('HALT');halted.firmware[0].data=Buffer.from(bytes).toString('hex');halted.firmware[0].contentHash=C.hashBytes(bytes);
  assert.equal((await L.verify('smart-lamp',halted)).ok,false);
});
test('loopback lesson cannot pass with unconditional programmed LED output','PER-008/009,LAMP-002',async()=>{
  const L=require('../game/lessons.js'),built=await L.build('uart-loopback');
  assert.equal((await L.verify('uart-loopback',built.project)).ok,true);
  const bytes=code('LDI R0,2\nST R0,0x4000\nWAIT 1100\nST R0,0x4001\nHALT');
  built.project.firmware[0].data=Buffer.from(bytes).toString('hex');built.project.firmware[0].contentHash=C.hashBytes(bytes);
  const result=await L.verify('uart-loopback',built.project);assert.equal(result.ok,false);assert(result.checks.some(c=>c.label.includes('断开')&&!c.ok));
});
test('first-wire pass requires a wire and faster-lamp pass requires changed firmware','T01(partial),T14,LAMP-002',async()=>{
  const L=require('../game/lessons.js'),first=await L.build('first-wire');
  assert.equal((await L.verify('first-wire',first.project)).ok,false);
  C.addWire(first.project,'complete',C.ep('rule','out'),C.boundary('y'));assert.equal((await L.verify('first-wire',first.project)).ok,true);
  const faster=await L.build('faster-lamp');assert.equal((await L.verify('faster-lamp',faster.project)).ok,false);
  const bytes=code(faster.source.replace('WAIT 60000','WAIT 30000'));faster.project.firmware[0].data=Buffer.from(bytes).toString('hex');faster.project.firmware[0].contentHash=C.hashBytes(bytes);
  assert.equal((await L.verify('faster-lamp',faster.project)).ok,true);
});

async function main(){
  let passed=0,failed=0;
  for(const t of cases){try{await t.fn();passed++;console.log('PASS ['+t.coverage+'] '+t.name);}catch(e){failed++;console.error('FAIL ['+t.coverage+'] '+t.name+'\n'+e.stack);}}
  const lessonFile=path.join(__dirname,'../game/lessons.js');
  console.log(fs.existsSync(lessonFile)?'NOTE direct lesson template checks executed above; no browser/UI checks are included.':'NOTE lessons.js missing.');
  console.log('\n'+passed+' integration cases passed; '+failed+' failed.');if(failed)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
