'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../game/circuit.js'),Core=require('../game/core8.js');
const reference=Core.SAMPLES.find(s=>s.id==='blinkButton').source;
async function board(source=reference){const p=await C.createProject('完整控制板');C.createInstance(p,'std.vcc/1','vcc');C.createInstance(p,'std.gnd/1','gnd');await C.addFirmware(p,'program',Core.assemble(source).bytes);C.createInstance(p,'core8/1','cpu',undefined,{firmware:'program'});C.createInstance(p,'io.terminal/1','term');C.addInput(p,'button','按钮','Z');C.addOutput(p,'led','灯');for(const[id,a,b]of [['vcc',C.ep('vcc','out'),C.ep('cpu','VCC')],['gnd',C.ep('gnd','out'),C.ep('cpu','GND')],['tx',C.ep('cpu','UART_TX'),C.ep('term','RX')],['rx',C.ep('term','TX'),C.ep('cpu','UART_RX')],['button',C.boundary('button'),C.ep('cpu','GPIO0')],['led',C.ep('cpu','GPIO1'),C.boundary('led')]])C.addWire(p,id,a,b);return p;}
const bytes=(r,path)=>r.inspect().terminals[path].history.entries.filter(x=>x.kind==='byte').map(x=>({byte:x.byte,time:x.time}));
const scalar=(r,end)=>C.scalar(r.getPort(end));
const Plus=require('../game/core8plus.js');
const sample=id=>Plus.SAMPLES.find(s=>s.id===id).source;
async function extensionBoard(source,peripheral){
  const p=await C.createProject('扩展MCU测试板');
  const assembled=Plus.assemble(source);assert.equal(assembled.ok,true,assembled.error);
  await C.addFirmware(p,'program',assembled.bytes,'core8/2');
  C.createInstance(p,'core8/2','cpu',undefined,{firmware:'program'});
  C.createInstance(p,'std.vcc/1','vcc');C.createInstance(p,'std.gnd/1','gnd');
  C.createInstance(p,'io.terminal/1','term');
  C.addWire(p,'vcc',C.ep('vcc','out'),C.ep('cpu','VCC'));
  C.addWire(p,'gnd',C.ep('gnd','out'),C.ep('cpu','GND'));
  C.addWire(p,'tx',C.ep('cpu','UART_TX'),C.ep('term','RX'));
  C.addOutput(p,'pwm');C.addWire(p,'pwm',C.ep('cpu','PWM_OUT'),C.boundary('pwm'));
  if(peripheral){
    p.powerDomains.push({id:'devicePower',initialPowered:true});
    C.createInstance(p,peripheral==='spi'?'std.spi-register/1':'std.i2c-temperature/1','device',undefined,{power:'devicePower'});
    C.addWire(p,'bus',C.ep('cpu',peripheral==='spi'?'SPI_OUT':'I2C_OUT'),C.ep('device','RX'));
  }
  return p;
}
const spiWrite='LDI R0,1\nST R0,0x4500\nST R0,0x4501\nWAIT 8\nLDI R0,90\nST R0,0x4501\nHALT';
const i2cWrite='LDI R0,1\nST R0,0x4400\nLDI R0,72\nST R0,0x4401\nLDI R0,2\nST R0,0x4402\nLDI R0,77\nST R0,0x4403\nLDI R0,2\nST R0,0x4404\nHALT';
const protocols=r=>r.inspect().history.filter(e=>e.kind==='protocol');

test('T29 full board package preserves exact GPIO, CPU and UART timeline including button events',async()=>{const source=await board(),pkg=await C.packageModule(source,'智能灯板','user.lamp',{sourceMap:{program:reference}}),host=await C.createProject('host'),placed=await C.placeModule(host,pkg,'lamp');assert.ok(pkg.firmware.length);assert.ok(!pkg.definitions.some(d=>d.stableId===pkg.definition.stableId));assert.equal(placed.sourceMap[placed.firmwareMap.program],reference);const a=new C.Runtime(source),b=new C.Runtime(host);a.setInput('button',1,10n);b.setInput(placed.boundaryMap.button,1,10n);a.setInput('button','Z',200010n);b.setInput(placed.boundaryMap.button,'Z',200010n);for(const t of [16n,1048n,60025n,200011n,400100n]){a.advance(t-a.time);b.advance(t-b.time);assert.equal(scalar(a,'led'),scalar(b,placed.boundaryMap.led));assert.deepEqual(a.inspect().instances.cpu.regs,b.inspect().instances['lamp/cpu'].regs);assert.equal(a.inspect().instances.cpu.pc,b.inspect().instances['lamp/cpu'].pc);assert.deepEqual(bytes(a,'term'),bytes(b,'lamp/term'));}assert.deepEqual(bytes(b,'lamp/term').map(x=>x.byte),[66,80,82]);});
test('placing a board twice isolates power domains, input, reset, RAM and terminal state',async()=>{const pkg=await C.packageModule(await board(),'智能灯板','user.lamp'),p=await C.createProject();const a=await C.placeModule(p,pkg,'a'),b=await C.placeModule(p,pkg,'b');assert.notEqual(a.domainMap.main,b.domainMap.main);assert.notEqual(a.firmwareMap.program,b.firmwareMap.program);const r=new C.Runtime(p);r.setInput(a.boundaryMap.button,1,10n);r.advance(3000n);assert.deepEqual(bytes(r,'a/term').map(x=>x.byte),[66,80]);assert.deepEqual(bytes(r,'b/term').map(x=>x.byte),[66]);const before=r.inspect().instances['b/cpu'].pc;r.setPower(a.domainMap.main,false);r.advance(1n);assert.equal(r.inspect().instances['a/cpu'].status,'OFF');assert.equal(r.inspect().instances['b/cpu'].pc,before);r.reset('warm','b');r.advance(1n);assert.equal(r.inspect().instances['a/cpu'].status,'OFF');assert.equal(r.inspect().instances['b/cpu'].pc,0);});
test('multi-domain package keeps an off domain from gating an independently powered board',async()=>{const source=await board();source.powerDomains.unshift({id:'unusedOff',initialPowered:false});const pkg=await C.packageModule(source,'双供电','user.domains'),p=await C.createProject();const placed=await C.placeModule(p,pkg,'m');const r=new C.Runtime(p);r.advance(1048n);assert.deepEqual(bytes(r,'m/term'),[{byte:66,time:'1048'}]);assert.equal(r.domains[placed.domainMap.unusedOff].isPowered,false);});
test('a module package can be nested again and persisted as canonical project',async()=>{const pkg=await C.packageModule(await board(),'板','user.board'),first=await C.createProject();const a=await C.placeModule(first,pkg,'inside');const outer=await C.packageModule(first,'嵌套板','user.nested'),p=await C.createProject();const b=await C.placeModule(p,outer,'outside');const imported=await C.importProject(JSON.stringify(p)),r=new C.Runtime(imported);r.setInput(b.boundaryMap[a.boundaryMap.button],1,10n);r.advance(3000n);assert.deepEqual(bytes(r,'outside/inside/term').map(x=>x.byte),[66,80]);assert.equal(r.inspect().instances['outside/inside/cpu'].modelId,'core8/1');});
test('nested UART in-flight snapshot resumes once with connection version history intact',async()=>{const pkg=await C.packageModule(await board(),'板','user.board'),p=await C.createProject();await C.placeModule(p,pkg,'board');const r=new C.Runtime(p);r.advance(500n);r.pause();const restored=C.Runtime.fromSnapshot(p,r.snapshot());r.advance(548n,{force:true});restored.advance(548n,{force:true});assert.deepEqual(restored.snapshot(),r.snapshot());assert.deepEqual(bytes(restored,'board/term'),[{byte:66,time:'1048'}]);restored.setConnection('board/tx',false);restored.stepTick();assert.equal(restored.connections['board/tx'].version,'1');});
test('new packaged firmware revision cannot mutate an already placed board',async()=>{const p=await C.createProject(),v1=await C.packageModule(await board(),'板','user.lamp',{revision:1}),v2=await C.packageModule(await board(reference.replace('WAIT 60000','WAIT 30000')),'板','user.lamp',{revision:2});const a=await C.placeModule(p,v1,'old'),identity=JSON.stringify(a.definition),b=await C.placeModule(p,v2,'new');assert.equal(JSON.stringify(p.definitions.find(d=>d.stableId===a.definition.stableId)),identity);const r=new C.Runtime(p);r.advance(30025n);assert.equal(scalar(r,a.boundaryMap.led),1);assert.equal(scalar(r,b.boundaryMap.led),0);});
test('package import and placement reject tampering atomically',async()=>{const pkg=await C.packageModule(await board(),'板','user.board'),p=await C.createProject(),before=JSON.stringify(p),bad=structuredClone(pkg);bad.firmware[0].data='00000000';await assert.rejects(C.placeModule(p,bad,'board'),{code:'E_HASH_MISMATCH'});assert.equal(JSON.stringify(p),before);bad.contentHash=C.hashPackage(bad);await assert.rejects(C.importModulePackage(bad),{code:'E_HASH_MISMATCH'});const edited=structuredClone(pkg);edited.definition.revision=2;edited.definition.contentHash=C.hashDefinition(edited.definition);edited.contentHash=C.hashPackage(edited);assert.equal((await C.importModulePackage(edited)).definition.revision,2);});
test('pure digital encapsulate remains compatible and packaging optionally suppresses exposed controls',async()=>{const p=await C.createProject();C.addInput(p,'a');C.addOutput(p,'y');C.createInstance(p,'std.not/1','inv');C.addWire(p,'i',C.boundary('a'),C.ep('inv','in'));C.addWire(p,'o',C.ep('inv','out'),C.boundary('y'));assert.equal((await C.encapsulate(p,'非门芯片','user.not')).model.kind,'composite');const pkg=await C.packageModule(p,'非门包','user.not'),q=await C.createProject(),result=await C.placeModule(q,pkg,'n',undefined,{exposePorts:false});assert.deepEqual(result.boundaryMap,{});assert.equal(q.circuit.inputs.length,0);C.addInput(q,'x','x',1);C.addWire(q,'input',C.boundary('x'),C.ep('n','a'));assert.equal(scalar(new C.Runtime(q),C.ep('n','y')),0);});

test('independent packaged MCU RAM is changed by each board input and targeted cold reset',async()=>{
  const source='LD R0,0x4002\nST R0,0x2000\nHALT';
  const pkg=await C.packageModule(await board(source),'采样板','user.sample'),p=await C.createProject();
  const a=await C.placeModule(p,pkg,'a'),b=await C.placeModule(p,pkg,'b');
  const r=new C.Runtime(p);r.setInput(a.boundaryMap.button,1,1n);r.advance(3n);
  assert.equal(r.inspect().instances['a/cpu'].ram[0],1);assert.equal(r.inspect().instances['b/cpu'].ram[0],0);
  r.reset('cold','a',4n);r.advance(1n);assert.equal(r.inspect().instances['a/cpu'].ram[0],0);
  assert.equal(r.inspect().instances['b/cpu'].status,'HALTED');
});

test('Core8/2 SPI reaches a real chip after exactly8us per byte and returns the stored byte',async()=>{
  const p=await extensionBoard(sample('spi-register'),'spi'),r=new C.Runtime(p);
  r.advance(7n);assert.equal(r.inspect().instances.cpu.plus.spi.active.done,'15');
  r.advance(7n);assert.equal(r.inspect().instances.device.device.transactions,'0');
  r.advance(1n);assert.deepEqual(r.inspect().instances.device.device.selected,{register:1,read:false});
  r.advance(33n);assert.deepEqual(protocols(r).map(e=>[e.time,e.value]),[['15',0],['26',90],['37',0],['48',90]]);
  r.advance(2000n);const state=r.inspect();assert.equal(state.instances.cpu.ram[0],90);
  assert.equal(state.instances.device.device.registers[1],90);assert.equal(state.instances.device.device.transactions,'4');
  assert.deepEqual(bytes(r,'term').map(e=>e.byte),[90]);
});

test('SPI runtime disconnect/reconnect, slave reset and loss of power invalidate in-flight writes',async()=>{
  const p=await extensionBoard(spiWrite,'spi');
  for(const action of ['disconnect','reset','power']){
    const r=new C.Runtime(p);r.advance(15n);assert.equal(r.inspect().instances.cpu.plus.spi.active.done,'22');
    if(action==='disconnect'){r.setConnection('bus',false,16n);r.setConnection('bus',true,17n);}
    if(action==='reset')r.reset('warm','device',22n);
    if(action==='power'){r.setPower('devicePower',false,16n);r.setPower('devicePower',true,17n);}
    r.advance(20n);assert.equal(r.inspect().instances.device.device.registers[1],0,action);
    assert.equal(r.inspect().instances.cpu.plus.spi.status,6,action);
    assert.equal(protocols(r).at(-1).error,'DISCONNECTED',action);
  }
});

test('SPI wrong mode is an actual transaction error and disabled or reset masters never commit writes',async()=>{
  const wrong='LDI R0,1\nST R0,0x4503\nST R0,0x4500\nST R0,0x4501\nHALT';
  const r=new C.Runtime(await extensionBoard(wrong,'spi'));r.advance(20n);
  assert.equal(protocols(r)[0].error,'MODE');assert.equal(r.inspect().instances.device.device.transactions,'0');
  const disabled=spiWrite.replace('HALT','LDI R0,0\nST R0,0x4500\nHALT');
  const s=new C.Runtime(await extensionBoard(disabled,'spi'));s.advance(50n);
  assert.equal(s.inspect().instances.device.device.registers[1],0);assert.equal(protocols(s).length,1);
  const q=new C.Runtime(await extensionBoard(spiWrite,'spi'));q.reset('warm','cpu',22n);q.advance(22n);
  assert.equal(q.inspect().instances.device.device.registers[1],0);assert.equal(protocols(q).length,1);
});

test('I2C transaction samples real sensor at100us completion and follows scheduled environmental input',async()=>{
  const p=await extensionBoard(sample('i2c-temperature'),'i2c'),r=new C.Runtime(p);
  r.setSensorTemperature('device',41,111n);r.advance(110n);
  assert.equal(r.inspect().instances.device.device.transactions,'0');assert.equal(r.inspect().instances.cpu.plus.i2c.active.done,'111');
  r.advance(1n);assert.equal(protocols(r)[0].value,41);assert.equal(protocols(r)[0].time,'111');
  r.advance(2000n);assert.equal(r.inspect().instances.cpu.ram[0],41);
  r.setSensorTemperature('device',7,3000n);r.advance(10000n);
  assert.equal(r.inspect().instances.cpu.ram[0],7);assert.deepEqual(bytes(r,'term').map(e=>e.byte),[41,7]);
});

test('I2C scratch register mutates only after completion; address and readonly writes NACK',async()=>{
  const p=await extensionBoard(i2cWrite,'i2c'),r=new C.Runtime(p);r.advance(109n);
  assert.equal(r.inspect().instances.device.device.scratch,0);r.advance(1n);
  assert.equal(r.inspect().instances.device.device.scratch,77);assert.equal(r.inspect().instances.cpu.plus.i2c.status,2);
  for(const source of [i2cWrite.replace('R0,72','R0,73'),i2cWrite.replace('LDI R0,2\nST R0,0x4402','LDI R0,0\nST R0,0x4402')]){
    const q=new C.Runtime(await extensionBoard(source,'i2c'));q.advance(200n);
    assert.equal(q.inspect().instances.device.device.scratch,0);assert.equal(q.inspect().instances.cpu.plus.i2c.status,6);
    assert.equal(protocols(q)[0].error,'NACK');
  }
});

test('I2C exact-completion disconnect, slave reset, loss of supply and master disable prevent writes',async()=>{
  const p=await extensionBoard(i2cWrite,'i2c');
  for(const action of ['disconnect','reset','power']){
    const r=new C.Runtime(p);
    if(action==='disconnect')r.setConnection('bus',false,110n);
    if(action==='reset')r.reset('warm','device',110n);
    if(action==='power')r.setPower('devicePower',false,110n);
    r.advance(200n);assert.equal(r.inspect().instances.device.device.scratch,0,action);
    assert.equal(r.inspect().instances.cpu.plus.i2c.status,6,action);
  }
  const source=i2cWrite.replace('HALT','LDI R0,0\nST R0,0x4400\nHALT');
  const r=new C.Runtime(await extensionBoard(source,'i2c'));r.advance(200n);
  assert.equal(r.inspect().instances.device.device.scratch,0);assert.deepEqual(protocols(r),[]);
});

test('PWM_OUT is a wired waveform after HALT, with freeze/resume and disconnect semantics',async()=>{
  const source='LDI R0,100\nST R0,0x4301\nLDI R0,25\nST R0,0x4303\nLDI R0,1\nST R0,0x4300\nHALT';
  const p=await extensionBoard(source),r=new C.Runtime(p);r.advance(7n);assert.equal(r.inspect().instances.cpu.status,'HALTED');
  assert.equal(scalar(r,'pwm'),1);r.advance(23n);assert.equal(scalar(r,'pwm'),1);
  r.advance(1n);assert.equal(scalar(r,'pwm'),0);r.advance(75n);assert.equal(scalar(r,'pwm'),1);
  r.pause();const frozen=r.snapshot();r.advance(100000n);assert.deepEqual(r.snapshot(),frozen);
  r.resume();r.setConnection('pwm',false);r.advance(1n);assert.equal(scalar(r,'pwm'),'Z');assert.equal(scalar(r,C.ep('cpu','PWM_OUT')),1);
  r.setConnection('pwm',true);r.advance(1n);assert.equal(scalar(r,'pwm'),1);
});

test('timer IRQ advances real program, RAM and GPIO even during WAIT under the shared scheduler',async()=>{
  const p=await extensionBoard(sample('timer-irq')),r=new C.Runtime(p);r.advance(3500n);
  const cpu=r.inspect().instances.cpu;assert.equal(cpu.ram[0],3);assert.equal(cpu.plus.irq.entries,'3');
  assert.equal(cpu.plus.timer.fires,'3');assert.equal(cpu.plus.irq.active,0);
  assert.equal(scalar(r,C.ep('cpu','GPIO0')),1);assert.equal(scalar(r,C.ep('cpu','GPIO1')),1);
});

test('Core8/2 in-flight SPI/I2C and active PWM snapshot continuation exactly matches uninterrupted execution',async()=>{
  const vectors=[{source:sample('spi-register'),device:'spi',at:20n,to:2000n},{source:i2cWrite,device:'i2c',at:50n,to:200n},{source:sample('pwm-breath'),at:15000n,to:31000n},{source:sample('timer-irq'),at:1016n,to:3500n}];
  for(const v of vectors){const p=await extensionBoard(v.source,v.device),a=new C.Runtime(p);a.advance(v.at);if(v.device==='i2c')a.setSensorTemperature('device',51,75n);const b=C.Runtime.fromSnapshot(p,JSON.stringify(a.snapshot()));a.advance(v.to-v.at);b.advance(v.to-v.at);assert.deepEqual(b.snapshot(),a.snapshot());}
});

test('extension board dependencies, source and device state survive repeated nested packaging independently',async()=>{
  const source=await extensionBoard(sample('i2c-temperature'),'i2c');
  const pkg=await C.packageModule(source,'测温板','user.temperature',{sourceMap:{program:sample('i2c-temperature')}});
  const middle=await C.createProject(),inner=await C.placeModule(middle,pkg,'inner');
  const nested=await C.packageModule(middle,'嵌套测温','user.nested-temperature',{sourceMap:inner.sourceMap});
  const host=await C.createProject();await C.placeModule(host,nested,'a');await C.placeModule(host,nested,'b');
  const imported=await C.importProject(JSON.stringify(host)),r=new C.Runtime(imported);
  r.setSensorTemperature('a/inner/device',64,1n);r.advance(1200n);
  assert.equal(r.inspect().instances['a/inner/cpu'].ram[0],64);assert.equal(r.inspect().instances['b/inner/cpu'].ram[0],25);
  assert.deepEqual(bytes(r,'a/inner/term').map(e=>e.byte),[64]);assert.deepEqual(bytes(r,'b/inner/term').map(e=>e.byte),[25]);
  const copy=C.Runtime.fromSnapshot(imported,r.snapshot());r.advance(10100n);copy.advance(10100n);assert.deepEqual(copy.snapshot(),r.snapshot());
});

test('protocols and firmware signatures reject incompatible wires/targets before runtime',async()=>{
  const p=await extensionBoard(sample('spi-register'),'spi');C.createInstance(p,'std.i2c-temperature/1','temperature');
  C.addWire(p,'wrong',C.ep('cpu','SPI_OUT'),C.ep('temperature','RX'));
  assert.equal((await C.validate(p)).errors[0].code,'E_PORT_KIND');
  const q=await extensionBoard('HALT');q.firmware[0].targetModel='core8/1';
  assert.equal((await C.validate(q)).errors[0].code,'E_SCHEMA');
  const old=await board('LDI R0,1\nST R0,0x4300\nHALT'),r=new C.Runtime(old);r.advance(5n);
  assert.equal(r.inspect().instances.cpu.fault.code,'F_ACCESS');assert.equal(old.definitions.length,13);
});

test('device snapshot state is validated before adoption, including byte, selection and temperature limits',async()=>{
  for(const [source,kind,mutate]of [[spiWrite,'spi',s=>s.registers[1]=256],[spiWrite,'spi',s=>s.selected={register:16,read:false}],[i2cWrite,'i2c',s=>s.temperature=-1],[i2cWrite,'i2c',s=>s.transactions='01']]){
    const p=await extensionBoard(source,kind),r=new C.Runtime(p);r.advance(12n);const before=r.snapshot(),bad=structuredClone(before);mutate(bad.instances.device.device);
    assert.throws(()=>C.Runtime.fromSnapshot(p,bad),{code:'E_SNAPSHOT_INCOMPATIBLE'});assert.deepEqual(r.snapshot(),before);
  }
});

test('SPI and UART transactions cross independently packaged public protocol ports and nested wire versions',async()=>{
  const controller=await extensionBoard(sample('spi-register'));
  controller.circuit.instances=controller.circuit.instances.filter(n=>n.id!=='term');
  controller.circuit.wires=controller.circuit.wires.filter(w=>w.id!=='tx');
  for(const[id,port,protocol]of [['serial','UART_TX','uart-txn/1'],['spi','SPI_OUT','spi-txn/1']]){
    controller.circuit.outputs.push({id,name:id,direction:'out',kind:'protocol_transaction',protocol});
    C.addWire(controller,id,C.ep('cpu',port),C.boundary(id));
  }
  const peripheral=await C.createProject();C.createInstance(peripheral,'std.spi-register/1','registers');
  peripheral.circuit.inputs.push({id:'bus',name:'bus',direction:'in',kind:'protocol_transaction',protocol:'spi-txn/1'});
  C.addWire(peripheral,'bus',C.boundary('bus'),C.ep('registers','RX'));
  const host=await C.createProject();
  await C.placeModule(host,await C.packageModule(controller,'主控','user.controller'),'controller');
  await C.placeModule(host,await C.packageModule(peripheral,'存储','user.storage'),'storage');
  C.createInstance(host,'io.terminal/1','console');
  C.addWire(host,'spi',C.ep('controller','spi'),C.ep('storage','bus'));
  C.addWire(host,'serial',C.ep('controller','serial'),C.ep('console','RX'));
  const r=new C.Runtime(host);r.advance(2000n);
  assert.equal(r.inspect().instances['storage/registers'].device.registers[1],90);
  assert.equal(r.inspect().instances['controller/cpu'].ram[0],90);assert.deepEqual(bytes(r,'console').map(e=>e.byte),[90]);
  const broken=new C.Runtime(host);broken.setConnection('storage/bus',false,20n);broken.setConnection('storage/bus',true,21n);broken.advance(26n);
  assert.equal(broken.inspect().instances['storage/registers'].device.registers[1],0);
  assert.equal(broken.inspect().instances['controller/cpu'].plus.spi.status,6);
});

test('snapshot rejects forged delivery routes but preserves legitimately invalidated in-flight tokens',async()=>{
  const p=await extensionBoard(spiWrite,'spi'),r=new C.Runtime(p);r.advance(15n);const original=r.snapshot();
  for(const mutate of [t=>t.source='device',t=>t.receiverPort='missing',t=>t.wires=[],t=>t.wires[0].version='1',t=>t.receiverToken.generation='999',t=>t.sequence='01']){
    const bad=structuredClone(original);mutate(bad.instances.cpu.cpu.plus.spi.active.token);
    assert.throws(()=>C.Runtime.fromSnapshot(p,bad),{code:'E_SNAPSHOT_INCOMPATIBLE'});
  }
  r.setConnection('bus',false,16n);r.setConnection('bus',true,17n);r.advance(3n);
  const restored=C.Runtime.fromSnapshot(p,r.snapshot());r.advance(10n);restored.advance(10n);
  assert.deepEqual(restored.snapshot(),r.snapshot());assert.equal(restored.inspect().instances.device.device.registers[1],0);
});
