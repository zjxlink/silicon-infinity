'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Base=require('../game/core8.js');
const Plus=require('../game/core8plus.js');
const sample=id=>Plus.SAMPLES.find(s=>s.id===id).source;
function cpu(source,options={}){const a=typeof source==='string'?Plus.assemble(source):{ok:true,bytes:source};assert(a.ok,a.error);return new Plus.CPU(a.bytes,{powered:true,...options});}
function advance(c,target,io={}){target=BigInt(target);let next,events=0;while((next=c.nextTime())!==null&&next<=target){assert(++events<200000,'bounded event script');c.complete(next,io);c.commit(c.sample(next,[0,0,0,0,0,0,0,0]));c.flush(next,io);}c.complete(target,io);c.flush(target,io);}
function device(){
  const d={connected:true,version:0,mode:0,registers:new Uint8Array(16),cursor:null,temperature:25,scratch:0,starts:[],ends:[],uart:[]};
  d.io={startProtocol(protocol,request,t){d.starts.push({protocol,request,time:t});return {version:d.version,connected:d.connected};},completeProtocol(protocol,request,token,t){
    d.ends.push({protocol,request,time:t});if(!d.connected||!token.connected||token.version!==d.version)return {ok:false,error:protocol==='i2c-txn/1'?'NACK':'DISCONNECTED'};
    if(protocol==='spi-txn/1'){if(request.mode!==d.mode)return {ok:false,error:'MODE'};if(!d.cursor){if(request.byte&0x70)return {ok:false,error:'COMMAND'};d.cursor={read:!!(request.byte&128),reg:request.byte&15};return {ok:true,value:0};}const q=d.cursor;d.cursor=null;if(!q.read)d.registers[q.reg]=request.byte;return {ok:true,value:d.registers[q.reg]};}
    if(request.address!==0x48||request.register>2||!request.read&&request.register!==2)return {ok:false,error:'NACK'};
    if(!request.read)d.scratch=request.value;return {ok:true,value:[d.temperature,0xa1,d.scratch][request.register]};
  },completeTx(byte,token,t){d.uart.push({byte,time:t});return true;}};return d;
}

test('Core8/2 assembler adds only strict IRET while Core8/1 remains unchanged',()=>{
  const valid=Plus.assemble('start: IRET ; return');assert(valid.ok);assert.deepEqual([...valid.bytes],[18,0,0,0]);assert.equal(Base.assemble('IRET').ok,false);
  for(const source of ['IRET R0','IRET()','LDI R8,0','WAIT 65536','IRET\n'.repeat(1025),'x'.repeat(100001)])assert.equal(Plus.assemble(source).ok,false);
  const old=new Base.CPU(Uint8Array.from([18,0,0,0]),{powered:true});old.retire(1n,[0,0,0,0,0,0,0,0]);assert.equal(old.fault.code,'F_ENCODING');
  for(const s of Base.SAMPLES)assert.deepEqual([...Plus.assemble(s.source).bytes],[...Base.assemble(s.source).bytes]);
});

test('all four actual sample sources compile, use independent state and fit ROM',()=>{
  assert.equal(Plus.SAMPLES.length,4);for(const s of Plus.SAMPLES){const a=Plus.assemble(s.source);assert(a.ok,s.id+': '+a.error);assert(a.bytes.length<=4096);}
  const a=cpu('HALT'),b=cpu('HALT');a.plus.i2c.data=99;a.plus.irq.pending=3;assert.equal(b.plus.i2c.data,0);assert.equal(b.plus.irq.pending,0);
});

test('legacy programs retain exact Core8/1 output and1048us UART timing',()=>{
  const c=cpu(Base.SAMPLES[0].source),d=device();advance(c,16,d.io);assert.equal(c.out,2);advance(c,1048,d.io);assert.deepEqual(d.uart,[{byte:66,time:1048n}]);advance(c,60025,d.io);assert.equal(c.out,0);
});

test('timer register programming produces exact periodic expirations, flag and count',()=>{
  const c=cpu('LDI R0,10\nST R0,0x4201\nLDI R0,3\nST R0,0x4200\nWAIT 40\nHALT');
  advance(c,8);assert.equal(c._read(0x4204,[]).value,4);advance(c,13);assert.equal(c.plus.timer.fires,0n);advance(c,14);assert.equal(c.plus.timer.fires,1n);assert.equal(c.plus.timer.flag,1);assert.equal(c.plus.timer.next,24n);advance(c,34);assert.equal(c.plus.timer.fires,3n);
});

test('timer one-shot stops itself and flag clears only by writing1',()=>{
  const c=cpu('LDI R0,3\nST R0,0x4201\nLDI R0,1\nST R0,0x4200\nWAIT 5\nST R0,0x4203\nHALT');advance(c,10);assert.equal(c.plus.timer.fires,1n);assert.equal(c.plus.timer.flag,1);assert.equal(c.plus.timer.ctrl&1,0);advance(c,11);assert.equal(c.plus.timer.flag,0);assert.equal(c.plus.timer.next,null);
});

test('timer interrupt actually redirects PC, increments RAM/GPIO and IRET returns',()=>{
  const c=cpu(sample('timer-irq'));advance(c,1013);assert.equal(c.plus.irq.entries,0n);advance(c,1014);assert.equal(c.pc,128);assert.equal(c.plus.irq.active,1);assert.equal(c.plus.irq.frame.pc,60);advance(c,1018);assert.equal(c.ram[0],1);assert.equal(c.out,1);assert.equal(c.plus.irq.active,0);assert.equal(c.pc,60);
  advance(c,3500);assert.equal(c.plus.irq.entries,3n);assert.equal(c.ram[0],3);assert.equal(c.status,'WAITING');assert.equal(c.history.filter(e=>e.kind==='irq-return').length,3);
});

test('interrupt priority is deterministic, coalesces repeated events and never nests',()=>{
  const c=cpu('WAIT 100\nHALT\nIRET');advance(c,1);c.plus.irq.enabled=1;c.plus.irq.mask=7;c.plus.irq.vector=8;c.plus.irq.pending=7;c.flush(1n,{});
  assert.equal(c.plus.irq.cause,1);assert.equal(c.plus.irq.pending,6);c._raise(1);c._raise(1);c.flush(1n,{});assert.equal(c.plus.irq.entries,1n);assert.equal(c.plus.irq.pending,7);
  advance(c,2);assert.equal(c.plus.irq.cause,1);assert.equal(c.plus.irq.entries,2n);advance(c,3);assert.equal(c.plus.irq.cause,2);advance(c,4);assert.equal(c.plus.irq.cause,4);advance(c,5);assert.equal(c.plus.irq.active,0);assert.equal(c.pc,4);
});

test('IRET without active interrupt and reserved encoding fault atomically',()=>{
  for(const [bytes,error]of [[Uint8Array.from([18,0,0,0]),'F_ACCESS'],[Uint8Array.from([18,0,1,0]),'F_ENCODING']]){const c=cpu(bytes);c.regs[0]=165;advance(c,1);assert.equal(c.fault.code,error);assert.equal(c.regs[0],165);assert.equal(c.pc,0);assert.equal(c.retiredCount,0n);}
});

test('HALT and FAULT keep timer/PWM running but cannot be revived by IRQ',()=>{
  for(const ending of ['HALT','LD R0,0x5000']){const c=cpu('LDI R0,5\nST R0,0x4201\nST R0,0x4301\nLDI R0,2\nST R0,0x4303\nLDI R0,1\nST R0,0x4300\nST R0,0x4601\nST R0,0x4600\nLDI R0,7\nST R0,0x4200\n'+ending);advance(c,31);assert.equal(c.status,ending==='HALT'?'HALTED':'FAULT');assert.equal(c.plus.irq.entries,0n);assert.equal(c.plus.timer.fires,4n);assert.equal(c.plus.irq.pending,1);assert(c.plus.pwm.next>31n);}
});

test('PWM produces a real25percent waveform over ten1000us periods',()=>{
  const c=cpu('LDI R0,232\nST R0,0x4301\nLDI R0,3\nST R0,0x4302\nLDI R0,250\nST R0,0x4303\nLDI R0,1\nST R0,0x4300\nHALT');advance(c,8);assert.equal(c.pwmOutput(),1);
  for(let cycle=0;cycle<10;cycle++){const start=8+cycle*1000;advance(c,start);assert.equal(c.pwmOutput(),1);advance(c,start+249);assert.equal(c.pwmOutput(),1);advance(c,start+250);assert.equal(c.pwmOutput(),0);advance(c,start+999);assert.equal(c.pwmOutput(),0);}
});

test('PWM duty is cycle-latched; zero/full/clamped duty preserve valid edges',()=>{
  const c=cpu('LDI R0,10\nST R0,0x4301\nLDI R0,2\nST R0,0x4303\nLDI R0,1\nST R0,0x4300\nLDI R0,20\nST R0,0x4303\nHALT');advance(c,8);assert.equal(c.plus.pwm.duty,20);assert.equal(c.plus.pwm.activeDuty,2);assert.equal(c.pwmOutput(),0);advance(c,16);assert.equal(c.plus.pwm.activeDuty,10);assert.equal(c.pwmOutput(),1);advance(c,26);assert.equal(c.pwmOutput(),1);
  const zero=cpu('LDI R0,10\nST R0,0x4301\nLDI R0,1\nST R0,0x4300\nHALT');advance(zero,54);assert.equal(zero.pwmOutput(),0);assert.equal(zero.plus.pwm.next,64n);
});

test('breathing sample changes actual duty in both directions',()=>{
  const c=cpu(sample('pwm-breath'));advance(c,2500);assert.equal(c.plus.pwm.duty,0);advance(c,260000);const descending=c.plus.pwm.duty;assert(descending<250&&descending>200);advance(c,510000);assert(c.plus.pwm.duty<20);assert(c.history.length<=256);
});

test('SPI sample writes and reads a real register then sends its result',()=>{
  const c=cpu(sample('spi-register')),d=device();advance(c,2000,d.io);assert.equal(d.registers[1],90);assert.equal(c.regs[1],90);assert.equal(c.ram[0],90);assert.equal(c.out,90);assert.equal(c.plus.spi.status,2);assert.deepEqual(d.uart.map(e=>e.byte),[90]);assert.equal(d.starts.length,4);assert.equal(d.ends.length,4);for(let n=0;n<4;n++)assert.equal(d.ends[n].time-d.starts[n].time,8n);
});

test('SPI disconnected and wrong-mode transactions report errors and do not write',()=>{
  for(const mode of [0,1]){const d=device();if(mode===0)d.connected=false;const src='LDI R0,1\nST R0,0x4500\nLDI R0,'+mode+'\nST R0,0x4503\nLDI R0,1\nST R0,0x4501\nWAIT 8\nHALT';const c=cpu(src);advance(c,30,d.io);assert.equal(c.plus.spi.status,6);assert.deepEqual([...d.registers],Array(16).fill(0));assert.equal(d.cursor,null);}
});

test('SPI busy write faults without replacing the original request; completion still occurs',()=>{
  const c=cpu('LDI R0,1\nST R0,0x4500\nST R0,0x4501\nST R0,0x4501'),d=device();advance(c,4,d.io);assert.equal(c.fault.code,'F_ACCESS');assert.equal(c.pc,12);assert.equal(c.plus.spi.active.request.byte,1);advance(c,11,d.io);assert.equal(d.ends.length,1);assert.equal(c.plus.spi.status,2);assert.equal(c.status,'FAULT');
});

test('I2C temperature reads are delayed real transactions and follow changing device values',()=>{
  const c=cpu(sample('i2c-temperature')),d=device();advance(c,110,d.io);assert.equal(c.plus.i2c.data,0);advance(c,111,d.io);assert.equal(c.plus.i2c.data,25);advance(c,1200,d.io);assert.equal(c.ram[0],25);assert.equal(c.out,25);assert.deepEqual(d.uart.map(e=>e.byte),[25]);d.temperature=37;advance(c,12000,d.io);assert.equal(c.ram[0],37);assert.equal(c.out,37);assert.deepEqual(d.uart.map(e=>e.byte),[25,37]);for(let n=0;n<d.ends.length;n++)assert.equal(d.ends[n].time-d.starts[n].time,100n);
});

test('I2C scratch write/read and NACK preserve actual device state',()=>{
  const d=device(),c=cpu('LDI R0,1\nST R0,0x4400\nLDI R0,72\nST R0,0x4401\nLDI R0,2\nST R0,0x4402\nLDI R0,77\nST R0,0x4403\nLDI R0,2\nST R0,0x4404\nWAIT 100\nLDI R0,1\nST R0,0x4404\nWAIT 100\nLD R1,0x4403\nHALT');advance(c,500,d.io);assert.equal(d.scratch,77);assert.equal(c.regs[1],77);
  const wrong=cpu(sample('i2c-temperature').replace('LDI R0,72','LDI R0,73'));advance(wrong,1200,d.io);assert.equal(wrong.plus.i2c.status,6);assert.equal(wrong.ram[0],0);assert.equal(d.scratch,77);
});

test('protocol disconnect/reconnect invalidates in-flight token and cannot mutate device',()=>{
  const c=cpu('LDI R0,1\nST R0,0x4400\nLDI R0,72\nST R0,0x4401\nLDI R0,2\nST R0,0x4402\nLDI R0,88\nST R0,0x4403\nLDI R0,2\nST R0,0x4404\nHALT'),d=device();advance(c,50,d.io);d.connected=false;d.version++;d.connected=true;d.version++;advance(c,110,d.io);assert.equal(d.scratch,0);assert.equal(c.plus.i2c.status,6);
});

test('program disabling SPI/I2C cancels pending completion and preserves status errors',()=>{
  for(const [ctrl,data]of [[0x4500,0x4501],[0x4400,0x4404]]){const c=cpu('LDI R0,1\nST R0,'+ctrl+'\nST R0,'+data+'\nLDI R0,0\nST R0,'+ctrl+'\nHALT'),d=device();advance(c,500,d.io);assert.equal(d.starts.length,1);assert.equal(d.ends.length,0);assert.equal(c.plus[ctrl===0x4500?'spi':'i2c'].active,null);}
});

test('cold/warm reset and power-off cancel all new events; warm alone preserves RAM',()=>{
  const c=cpu(sample('timer-irq'));advance(c,1016);c.ram[5]=99;c.reset('warm',1016n);assert.equal(c.ram[5],99);assert.deepEqual(c.exportState().plus,cpu('HALT').exportState().plus);c.setPowered(false,1016n);assert.equal(c.nextTime(),null);assert.equal(c.pwmOutput(),'Z');c.setPowered(true,2000n);assert.equal(c.ram[5],0);assert.equal(c.nextTime(),2001n);
  const d=device(),tx=cpu('LDI R0,1\nST R0,0x4500\nST R0,0x4501\nHALT');advance(tx,3,d.io);tx.reset('warm',11n);tx.complete(11n,d.io);assert.equal(d.ends.length,0);
});

test('same-time protocol completion precedes program disable, external reset precedes completion',()=>{
  const d=device(),source='LDI R0,1\nST R0,0x4500\nST R0,0x4501\nLDI R0,0\nWAIT 5\nST R0,0x4500\nHALT';const c=cpu(source);advance(c,11,d.io);assert.equal(d.ends.length,1);assert.equal(c.plus.spi.ctrl,0);assert.equal(c.plus.spi.status,2);
  const cancelled=cpu(source),d2=device();advance(cancelled,10,d2.io);cancelled.reset('warm',11n);cancelled.complete(11n,d2.io);assert.equal(d2.ends.length,0);
});

test('new register permissions reject invalid configurations atomically',()=>{
  for(const source of ['LDI R0,1\nST R0,0x4200','LDI R0,1\nST R0,0x4300','LD R0,0x4404','LDI R0,128\nST R0,0x4401','LDI R0,4\nST R0,0x4503','LD R0,0x4607','LDI R0,2\nST R0,0x4603\nLDI R0,1\nST R0,0x4600']){const c=cpu(source);advance(c,100);assert.equal(c.fault.code,'F_ACCESS',source);assert(c.pc<Plus.assemble(source).bytes.length);}
});

test('SPI and I2C completion can raise distinct interrupt pending bits',()=>{
  const c=cpu('LDI R0,3\nST R0,0x4500\nST R0,0x4400\nLDI R0,1\nST R0,0x4501\nST R0,0x4404\nHALT'),d=device();advance(c,106,d.io);assert.equal(c.plus.irq.pending,6);assert.equal(c.plus.irq.entries,0n);assert.equal(c.status,'HALTED');
});

test('snapshots preserve active IRQ, PWM phase and protocol remaining time without replay',()=>{
  for(const [source,at,end]of [[sample('timer-irq'),1016,3500],[sample('pwm-breath'),5200,11000],[sample('spi-register'),10,2000],[sample('i2c-temperature'),50,1500]]){
    const a=cpu(source,{id:'same'}),da=device();advance(a,at,da.io);const state=a.exportState(),b=cpu(source,{id:'same'}),db=device();db.cursor=da.cursor?{...da.cursor}:null;db.registers.set(da.registers);db.scratch=da.scratch;b.importState(JSON.parse(JSON.stringify(state)));
    const priorEnds=da.ends.length,priorUart=da.uart.length;advance(a,end,da.io);advance(b,end,db.io);assert.deepEqual(b.exportState(),a.exportState());assert.deepEqual(db.ends,da.ends.slice(priorEnds));assert.deepEqual(db.uart,da.uart.slice(priorUart));
  }
});

test('corrupt extension snapshots fail atomically and core versions cannot cross-restore',()=>{
  const c=cpu(sample('pwm-breath'));advance(c,5200);const good=c.exportState();for(const edit of [s=>s.schema='core8.snapshot/1',s=>s.plus.pwm.next=s.time,s=>s.plus.pwm.level=3,s=>s.plus.irq.mask=8,s=>s.plus.timer.next=s.time,s=>s.plus.i2c.extra=1,s=>s.plus.irq.frame={pc:2}]){const bad=JSON.parse(JSON.stringify(good));edit(bad);assert.throws(()=>c.importState(bad));assert.deepEqual(c.exportState(),good);}
  const old=new Base.CPU(Plus.assemble(sample('pwm-breath')).bytes,{powered:true});assert.throws(()=>old.importState(good));
});

test('BigInt peripheral times remain exact beyond machine integer range',()=>{
  const start=9007199254740993123456n,c=cpu('LDI R0,10\nST R0,0x4201\nLDI R0,3\nST R0,0x4200\nHALT',{time:start});advance(c,start+14n);assert.equal(c.plus.timer.fires,1n);assert.equal(c.plus.timer.next,start+24n);assert.equal(c.exportState().plus.timer.next,String(start+24n));
});
