'use strict';
const assert = require('node:assert/strict');
const { CPU, assemble, SAMPLES, BYTE_TIME } = require('../game/core8.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }
function compile(source) { const a = assemble(source); assert.equal(a.ok, true, a.error); return a.bytes; }
function cpu(source, options = {}) { return new CPU(typeof source === 'string' ? compile(source) : source, { powered: true, ...options }); }
function pins(c, button = 0) {
  return c.gpioDrives().map((d, i) => i === 0 && button ? d === 'Z' ? 1 : 'X' : d === 'Z' ? c.pd & 1 << i ? 0 : 'Z' : d);
}
function advance(c, target, { io = {}, gpio = () => pins(c) } = {}) {
  target = BigInt(target);
  let guard = 0, next;
  while ((next = c.nextTime()) !== null && next <= target) {
    assert(++guard < 100000, 'event loop terminates');
    c.complete(next, io);
    c.commit(c.sample(next, gpio(next)));
    c.flush(next, io);
  }
  c.complete(target, io); c.flush(target, io);
}
function single(bytes, setup = () => {}) {
  const c = cpu(bytes); setup(c); c.retire(1n, pins(c)); return c;
}
test('assembler emits the exact 96-byte reference program and source map', () => {
  const a = assemble(SAMPLES.find(s => s.id === 'blinkButton').source);
  assert(a.ok); assert.equal(a.bytes.length, 96); assert.equal(a.sourceMap.length, 24);
  assert.deepEqual(Array.from(a.bytes.slice(0, 8)), [1,0,2,0,12,0,0,64]);
  assert.deepEqual(Array.from(a.bytes.slice(0x34, 0x38)), [14,2,0x50,0]);
  assert.deepEqual(Array.from(a.bytes.slice(0x58, 0x5c)), [16,0,0x60,0xea]);
});
test('assembler rejects unsafe syntax, immediate arithmetic, labels and limits', () => {
  for (const source of ['', 'LDI R8,1', 'LDI R0,256', 'ADD R0,1', 'SHL R0,8', 'WAIT 65536', 'NOP 1', 'UART "hey"', 'JMP 2', 'JMP 4096', 'JMP missing', 'JMP end\nend:', 'a:NOP\nA:HALT', 'globalThis.polluted=true', 'HALT\n'.repeat(1025)]) {
    assert.equal(assemble(source).ok, false, source.slice(0, 50));
  }
  assert.equal(globalThis.polluted, undefined);
  assert.equal(assemble('HALT\n'.repeat(1024)).bytes.length, 4096);
});
test('opcodes 00..0A execute arithmetic, aliases, bitwise and shifts', () => {
  const rows = [
    [[0,0,0,0], 0xa5, 0, 0xa5], [[1,0,255,0], 0, 0, 255], [[2,0,1,0],0,0xa5,0xa5],
    [[3,0,1,0],255,1,0], [[3,0,0,0],128,0,0], [[4,0,1,0],0,1,255],
    [[5,0,1,0],0xaa,0x0f,0x0a], [[6,0,1,0],0xa0,0x0f,0xaf], [[7,0,1,0],0xaa,255,0x55],
    [[8,0,0,0],0,0,255], [[9,0,0,0],0x81,0,0x81], [[9,0,7,0],1,0,0x80],
    [[10,0,0,0],0x81,0,0x81], [[10,0,7,0],0x80,0,1]
  ];
  for (const [raw, a, b, expected] of rows) {
    const c = single(raw, c => { c.regs[0] = a; c.regs[1] = b; });
    assert.equal(c.regs[0], expected); assert.equal(c.pc, 4); assert.equal(c.retiredCount, 1n);
  }
});
test('LD/ST cover RAM and ROM with byte addressing', () => {
  const c = cpu('LDI R0, 165\nST R0,0x2000\nLD R1,0x2000\nLD R2,0\nHALT');
  advance(c, 5);
  assert.equal(c.ram[0], 165); assert.equal(c.regs[1], 165); assert.equal(c.regs[2], 1); assert.equal(c.status, 'HALTED');
});
test('JMP JZ JNZ use register values and validate untaken targets', () => {
  assert.equal(single([13,0,8,0]).pc, 8);
  for (const op of [14, 15]) for (const value of [0, 1]) {
    const c = single([op,0,8,0], c => c.regs[0] = value);
    assert.equal(c.pc, (op === 14 ? value === 0 : value !== 0) ? 8 : 4);
    const bad = single([op,0,2,0], c => c.regs[0] = value);
    assert.equal(bad.fault.code, 'F_TARGET'); assert.equal(bad.pc, 0);
  }
});
test('strict opcode and reserved fields fault atomically', () => {
  for (const raw of [[255,0,0,0],[0,1,0,0],[1,8,0,0],[1,0,3,1],[2,0,8,0],[8,0,1,0],[9,0,8,0],[10,0,8,0],[13,1,4,0],[16,1,0,0],[17,0,0,1]]) {
    const c = single(raw, c => { c.regs[0] = 0xa5; c.ram[0] = 5; });
    assert.equal(c.fault.code, 'F_ENCODING'); assert.equal(c.pc, 0); assert.equal(c.regs[0], 0xa5); assert.equal(c.ram[0], 5); assert.equal(c.retiredCount, 0n);
  }
});
test('address permission failures leave PC, destination and peripheral state unchanged', () => {
  for (const source of ['ST R0,0', 'ST R0,0x4002', 'LD R0,0x4100', 'LD R0,0x4004', 'LD R0,0x4200', 'LD R0,0x4300', 'LD R0,0x4400', 'LD R0,0x4500', 'LD R0,0x4600', 'LD R0,0x2400', 'ST R0,0x4103']) {
    const c = cpu(source); c.regs[0] = 0xa5; advance(c, 1);
    assert.equal(c.fault.code, 'F_ACCESS', source); assert.equal(c.pc, 0); assert.equal(c.regs[0], 0xa5); assert.equal(c.uart.ctrl, 0);
  }
});
test('WAIT 0 and 65535 retire at exact integer times', () => {
  for (const n of [0, 65535]) {
    const c = cpu('WAIT ' + n + '\nLDI R0, 9\nHALT');
    advance(c, 1); assert.equal(c.pc, 4); assert.equal(c.retiredCount, 1n);
    advance(c, BigInt(n) + 1n); assert.equal(c.regs[0], 0);
    advance(c, BigInt(n) + 2n); assert.equal(c.regs[0], 9);
  }
});
test('time remains exact above Number.MAX_SAFE_INTEGER', () => {
  const t = 9007199254740993123456n;
  const c = cpu('WAIT 10\nHALT', { time: t });
  advance(c, t + 1n); assert.equal(c.startAt, t + 11n);
  advance(c, t + 12n); assert.equal(c.status, 'HALTED'); assert.equal(c.time, t + 12n);
});
test('operands are sampled at retirement, not fetch start', () => {
  const c = cpu('LD R0,0x4002');
  const intent = c.sample(1n, [1,0,0,0,0,0,0,0]);
  assert.equal(c.regs[0], 0); c.commit(intent); assert.equal(c.regs[0], 1);
});
test('GPIO unknown fails whole read without partial register write', () => {
  const c = cpu('LD R0,0x4002'); c.regs[0] = 165;
  c.retire(1n, ['Z',0,0,'X',0,0,0,0]);
  assert.equal(c.fault.code, 'F_UNKNOWN'); assert.equal(c.regs[0], 165); assert.equal(c.pc, 0);
  assert.deepEqual(c.fault.unknownPins,['GPIO0','GPIO3']);
});
test('GPIO direction, output and weak-pull registers have correct resets and writes', () => {
  const c = cpu('LDI R0,2\nST R0,0x4000\nST R0,0x4001\nLDI R0,254\nST R0,0x4003\nHALT');
  assert.equal(c.pd,255); assert.deepEqual(c.gpioDrives(), Array(8).fill('Z'));
  advance(c,6); assert.equal(c.dir,2); assert.equal(c.out,2); assert.equal(c.pd,254); assert.equal(c.gpioDrives()[1],1);
});
test('reference program produces B at 1048us and LED transitions at 16/60025us', () => {
  const c = cpu(SAMPLES[0].source), delivered = [];
  const io = { startTx: () => ({ wireVersion: '0' }), completeTx: (b,tok,t) => { delivered.push([b,t]); return true; } };
  advance(c, 15, {io}); assert.equal(c.out,0); advance(c,16,{io}); assert.equal(c.out,2);
  advance(c,1047,{io}); assert.equal(delivered.length,0); advance(c,1048,{io}); assert.deepEqual(delivered,[[66,1048n]]);
  advance(c,60024,{io}); assert.equal(c.out,2); advance(c,60025,{io}); assert.equal(c.out,0);
  const modified = cpu(SAMPLES[0].source.replace('WAIT 60000','WAIT 30000'));
  advance(modified,30025); assert.equal(modified.out,0);
});
test('reference program reads real button changes and sends P then R', () => {
  const c = cpu(SAMPLES[0].source), messages=[]; let button=0;
  const io={startTx:()=>({}),completeTx:(b)=>{messages.push(b);return true;}};
  const gpio=()=>pins(c,button);
  advance(c,2000,{io,gpio}); button=1; advance(c,202000,{io,gpio}); button=0; advance(c,402000,{io,gpio});
  assert.deepEqual(messages,[66,80,82]);
});
test('HALT and FAULT stop CPU while queued UART still completes', () => {
  for (const ending of ['HALT','LD R0,0x5000']) {
    const c=cpu('LDI R0,1\nST R0,0x4103\nLDI R0,65\nST R0,0x4100\n'+ending), got=[];
    const io={completeTx:(b)=>{got.push(b);return true;}};
    advance(c,5,{io}); assert.equal(c.status,ending==='HALT'?'HALTED':'FAULT');
    advance(c,1046,{io}); assert.deepEqual(got,[65]); assert.equal(c.pending,null);
  }
});
test('TX FIFO holds 16 including active, drops 17th with sticky error and drains every1042us', () => {
  const c=cpu('LDI R0,1\nST R0,0x4103\nLDI R0,65\n'+Array(17).fill('ST R0,0x4100').join('\n')+'\nHALT');
  const got=[], io={completeTx:(b,tok,t)=>{got.push(t);return true;}};
  advance(c,21,{io}); assert.equal(c.uart.tx.length,16); assert.equal(c.uart.err,1); assert.equal(c.status,'HALTED');
  advance(c,4n+16n*BYTE_TIME,{io}); assert.equal(got.length,16); assert.equal(c.uart.tx.length,0);
  for(let i=1;i<got.length;i++)assert.equal(got[i]-got[i-1],1042n);
});
test('RX overflow drops newest, reads pop once and status reads do not pop', () => {
  const c=cpu('LD R0,0x4102\nLD R1,0x4101\nHALT'); c.uart.ctrl=2;
  for(let i=0;i<17;i++)c.receive(i,0n);
  assert.equal(c.uart.rx.length,16); assert.equal(c.uart.err,2);
  advance(c,1); assert.equal(c.uart.rx.length,16); assert.equal(c.regs[0]&12,12);
  advance(c,2); assert.equal(c.regs[1],0); assert.equal(c.uart.rx.length,15);
  const empty=cpu('LD R0,0x4101');empty.uart.ctrl=2;advance(empty,1);assert.equal(empty.fault.code,'F_RX_EMPTY');
});
test('RW1C and disabling FIFO cancel in-flight tokens without clearing errors', () => {
  const c=cpu('LDI R0,1\nST R0,0x4104\nLDI R0,0\nST R0,0x4103\nHALT');
  c.uart.ctrl=3;c.uart.err=3;c.uart.tx=[70];c.receive(5,0n); const token=c.rxToken();c.flush(0n,{});
  advance(c,2);assert.equal(c.uart.err,2);advance(c,4);assert.equal(c.uart.ctrl,0);assert.equal(c.uart.tx.length,0);assert.equal(c.uart.rx.length,0);assert.equal(c.uart.active,null);assert.equal(c.uart.err,2);
  c.uart.ctrl=2;assert.equal(c.receive(8,4n,token),false);
});
test('same-time UART completion happens before program disables it', () => {
  const c=cpu('ST R0,0x4103\nHALT');c.uart.ctrl=1;c.uart.tx=[65];c.uart.active={byte:65,start:0n,done:1042n,token:null,generation:c.generation};
  c.pending.start=1041n;c.pending.retire=1042n; const got=[];
  advance(c,1042,{io:{completeTx:b=>{got.push(b);return true;}}});
  assert.deepEqual(got,[65]);assert.equal(c.uart.ctrl,0);
});
test('same-time warm reset cancels UART before completion and preserves RAM', () => {
  const c=cpu('HALT');c.ram[2]=88;c.regs[0]=99;c.uart.ctrl=1;c.uart.tx=[65];c.flush(0n,{});
  c.reset('warm',1042n);const got=[];c.complete(1042n,{completeTx:b=>got.push(b)});
  assert.deepEqual(got,[]);assert.equal(c.ram[2],88);assert.equal(c.regs[0],0);assert.equal(c.pc,0);assert.equal(c.nextTime(),1043n);assert(c.history.some(h=>h.kind==='warm-reset'));
  c.setPowered(false,1042n);assert.deepEqual(c.gpioDrives(),Array(8).fill('Z'));assert.equal(c.nextTime(),null);
  c.setPowered(true,2000n);assert.equal(c.ram[2],0);assert.equal(c.nextTime(),2001n);
});
test('loopback delivers once after one1042us interval', () => {
  const c=cpu('LDI R0,3\nST R0,0x4103\nLDI R0,66\nST R0,0x4100\nWAIT 1042\nLD R1,0x4101\nHALT');
  const io={startTx:()=>c.rxToken(),completeTx:(b,token,t)=>c.receive(b,t,token)};
  advance(c,1045,{io});assert.equal(c.uart.rx.length,0);advance(c,1046,{io});assert.deepEqual(c.uart.rx,[66]);advance(c,1048,{io});assert.equal(c.regs[1],66);
});
test('snapshots restore active transmission, waits, RAM and exact timelines without replay', () => {
  const source='LDI R0,1\nST R0,0x4103\nLDI R0,65\nST R0,0x4100\nWAIT 2000\nHALT';
  const a=cpu(source,{id:'a'}), gotA=[],gotB=[];
  const ioA={startTx:()=>({wire:'w',version:'4'}),completeTx:(b,tok,t)=>{gotA.push([b,t,tok]);return true;}};
  advance(a,504,{io:ioA});a.ram[15]=99;
  const snapshot=a.exportState();assert.doesNotThrow(()=>JSON.stringify(snapshot));
  const b=cpu(source,{id:'a'});b.importState(snapshot);
  advance(a,3000,{io:ioA});advance(b,3000,{io:{completeTx:(v,tok,t)=>{gotB.push([v,t,tok]);return true;}}});
  assert.deepEqual(gotB,gotA);assert.equal(b.ram[15],99);assert.deepEqual(b.exportState(),a.exportState());
  const before=b.exportState(),broken=JSON.parse(JSON.stringify(before));broken.ram.pop();assert.throws(()=>b.importState(broken));assert.deepEqual(b.exportState(),before);
});
test('two instances have independent RAM, queues and resets', () => {
  const a=cpu('HALT'),b=cpu('HALT');a.ram[0]=7;a.regs[2]=8;a.uart.rx.push(4);
  a.reset('warm',0n);assert.equal(a.ram[0],7);assert.equal(b.ram[0],0);assert.equal(b.regs[2],0);assert.equal(b.uart.rx.length,0);
});
test('last-ROM HALT retires, last-ROM NOP faults on next fetch', () => {
  for(const op of [0,17]){
    const bytes=new Uint8Array(4096);bytes[4092]=op;
    const c=cpu(bytes);c.pc=4092;c.pending=null;c.startAt=0n;c.flush(0n,{});advance(c,1);
    assert.equal(c.pc,4096);assert.equal(c.status,op===17?'HALTED':'FAULT');if(!op)assert.equal(c.fault.code,'F_FETCH');
  }
});
test('all CPUs sample common resolved GPIO before any commits', () => {
  const writer=cpu('ST R0,0x4001'),reader=cpu('LD R0,0x4002');writer.regs[0]=1;writer.dir=1;
  const previousWire=writer.gpioDrives()[0];
  const wa=writer.sample(1n,pins(writer)),rb=reader.sample(1n,[previousWire,0,0,0,0,0,0,0]);
  writer.commit(wa);reader.commit(rb);
  assert.equal(writer.out,1);assert.equal(reader.regs[0],0);
});
test('same-time full FIFO completion/read/write order matches shared scheduler', () => {
  const tx=cpu('ST R0,0x4100');tx.regs[0]=99;tx.uart.ctrl=1;tx.uart.tx=Array.from({length:16},(_,i)=>i);
  tx.uart.active={byte:0,start:0n,done:1042n,token:null,generation:tx.generation};tx.pending.start=1041n;tx.pending.retire=1042n;
  tx.complete(1042n,{});tx.retire(1042n,pins(tx));tx.flush(1042n,{});
  assert.equal(tx.uart.tx.length,16);assert.equal(tx.uart.tx[15],99);assert.equal(tx.uart.err,0);
  const rx=cpu('LD R0,0x4101');rx.uart.ctrl=2;rx.uart.rx=Array.from({length:16},(_,i)=>i);
  rx.receive(99,1n,rx.rxToken());rx.retire(1n,pins(rx));
  assert.equal(rx.regs[0],0);assert.equal(rx.uart.rx.length,15);assert.equal(rx.uart.err,2);
});
test('stale intents and receive tokens cannot modify reset instance', () => {
  const c=cpu('LDI R0,99');c.uart.ctrl=2;
  const token=c.rxToken(),intent=c.sample(1n,pins(c));
  c.reset('warm',1n);assert.equal(c.commit(intent),false);assert.equal(c.regs[0],0);
  c.uart.ctrl=2;assert.equal(c.receive(77,1n,token),false);assert.equal(c.uart.rx.length,0);
});
test('inconsistent snapshots fail atomically and bounded histories report truncation', () => {
  const c=cpu('again: NOP\nJMP again');advance(c,300);
  assert.equal(c.trace.length,256);assert.equal(c.traceDropped,44);
  const original=c.exportState();
  for(const edit of [s=>{s.pending=null;},s=>{s.id='someone-else';},s=>{s.powered=false;},s=>{s.uart.rx=[1];},s=>{s.traceDropped=-1;}]){
    const bad=JSON.parse(JSON.stringify(original));edit(bad);assert.throws(()=>c.importState(bad));assert.deepEqual(c.exportState(),original);
  }
});
console.log('\n'+passed+' Core8 tests passed.');
