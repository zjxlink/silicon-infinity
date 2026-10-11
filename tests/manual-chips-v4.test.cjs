'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../game/circuit.js'),H=require('../game/hardware-v3.js'),M=require('../game/manual-chips-v4.js'),L=require('../game/chip-library.js'),MCU=require('../game/mcu-v4.js');
const number=v=>H.known(v,C),read=(r,p)=>number(r.getPort(p));
const allX=v=>assert(C.bits(v).every(b=>b==='X'),JSON.stringify(v));
async function fixture(model,inputs={},parameters={}){
 const p=await C.createProject('手册语义验证'),n=C.createInstance(p,model,'chip');Object.assign(n.parameters,parameters);
 for(const port of C.catalog[model].ports){assert.equal(port.kind,'digital');if(port.direction==='in'){C.addInput(p,port.id,port.id,inputs[port.id]??0,port.width);C.addWire(p,'i_'+port.id,C.boundary(port.id),C.ep('chip',port.id));}else{C.addOutput(p,port.id,port.id,port.width);C.addWire(p,'o_'+port.id,C.ep('chip',port.id),C.boundary(port.id));}}
 await C.importProject(p);return {p,r:new C.Runtime(p)};
}
function drive(r,values){for(const[k,v]of Object.entries(values))r.setInput(k,v);r.advance(1n);}
test('chip manual CommonJS data is complete, unambiguous, and uses valid section/table shapes',()=>{
 assert.equal(M.aluOps.length,16);assert.deepEqual(M.aluOps.map(row=>Number(row[0].split(' / ')[0])),Array.from({length:16},(_,i)=>i));
 assert.equal(M.entries.filter(e=>e.id.startsWith('library-')).length,18);assert.equal(L.list.length,18);
 const ids=new Set();for(const e of M.entries){assert(!ids.has(e.id),e.id);ids.add(e.id);for(const key of['id','title','category','summary'])assert.equal(typeof e[key],'string');assert(e.summary.length>0);assert(Array.isArray(e.appliesTo));assert(e.sections.length>0);const sections=new Set();for(const s of e.sections){assert(!sections.has(s.id),e.id+':'+s.id);sections.add(s.id);assert.equal(typeof s.title,'string');assert(Array.isArray(s.paragraphs));assert(s.paragraphs.every(p=>typeof p==='string'));if(s.table){assert(s.table.headers.every(h=>typeof h==='string'));for(const row of s.table.rows){assert.equal(row.length,s.table.headers.length,e.id+':'+s.id);assert(row.every(v=>typeof v==='string'));}}}}
});
test('all 37 chip-manual model IDs and every port hint match the actual registered contracts',()=>{
 const covered=M.entries.flatMap(e=>e.appliesTo);assert.equal(covered.length,37);assert.equal(new Set(covered).size,37);
 for(const id of covered){assert(C.catalog[id],id);assert.deepEqual(Object.keys(M.portHints[id]).sort(),C.catalog[id].ports.map(p=>p.id).sort(),id);assert(Object.values(M.portHints[id]).every(s=>typeof s==='string'&&s.length>5));}
});
test('manuals jointly cover all 73 registered models with valid port hints',()=>{
 const mcu=require('../game/manual-mcu-v4.js'),architecture=require('../game/architecture-v5.js').manuals,systems=require('../game/systems-v5.js').manuals,custom=require('../game/custom-architecture-v6.js').manuals,all=[M,mcu,architecture,systems,custom,...['custom-cpu-v8','protocol-devices-v8','system-peripherals-v8'].map(file=>require('../game/'+file+'.js').manuals)],entries=all.flatMap(x=>x.entries),covered=entries.flatMap(e=>e.appliesTo||[]),models=Object.keys(C.catalog).sort();
 assert.equal(models.length,73);assert.equal(new Set(entries.map(e=>e.id)).size,entries.length,'global entry ids');assert.deepEqual([...new Set(covered)].sort(),models);for(const id of models){const hints=all.map(x=>x.portHints[id]).find(Boolean);assert(hints,id);assert.deepEqual(Object.keys(hints).sort(),C.catalog[id].ports.map(p=>p.id).sort(),id);}
});
for(const width of[8,16]){
 test(width+'-bit ALU OP0–15 use the documented unsigned results, zero, carry and invalid-op X',async()=>{
  const max=2**width-1,{r}=await fixture('std.alu'+width+'/1');
  // Expected values are independent examples, not a second copy of the switch implementation.
  const rows=[[0,91,13,13,0],[1,max,1,0,1],[1,12,30,42,0],[2,0,1,max,0],[2,9,9,0,1],[2,17,4,13,1],[3,0xaa,0x0f,10,0],[4,0xa0,0x0f,175,0],[5,0xaa,0xff,85,0],[6,max,7,0,0],[6,0,7,max,0],[7,2**(width-1),1,0,1],[8,3,1,1,0],[9,91,13,91,0],[10,max,2,max-1,1],[10,0,max,0,0],[11,7,7,1,0],[11,7,8,0,0],[12,0,max,1,0],[12,max,0,0,0],[13,max,0,1,0],[13,0,max,0,0]];
  for(const[op,a,b,out,carry]of rows){drive(r,{op,a,b});assert.equal(read(r,'out'),out,'OP '+op);assert.equal(read(r,'carry'),carry,'CARRY '+op);assert.equal(read(r,'zero'),Number(out===0),'ZERO '+op);}
  for(const op of[14,15]){drive(r,{op,a:0,b:0});for(const p of['out','zero','carry'])allX(r.getPort(p));}
 });
 test(width+'-bit shift count masks B to low bits and right shift never reports shifted-out carry',async()=>{
  const {r}=await fixture('std.alu'+width+'/1');for(const op of[7,8]){drive(r,{op,a:7,b:width});assert.equal(read(r,'out'),7);assert.equal(read(r,'carry'),0);drive(r,{op,a:7,b:width+1});assert.equal(read(r,'out'),op===7?14:3);assert.equal(read(r,'carry'),0);}drive(r,{op:7,a:3,b:2**width-1});assert.equal(read(r,'out'),2**(width-1));assert.equal(read(r,'carry'),1);drive(r,{op:8,a:3,b:2**width-1});assert.equal(read(r,'out'),0);assert.equal(read(r,'carry'),0);assert.equal(read(r,'zero'),1);
 });
 test(width+'-bit ALU requires every A/B/OP bit known, including mathematically unused operands',async()=>{
  const {r}=await fixture('std.alu'+width+'/1');for(const op of[0,6,9])for(const port of['a','b','op'])for(const unknown of['X','Z']){drive(r,{a:7,b:3,op,[port]:C.fromBits([unknown,...Array((port==='op'?4:width)-1).fill(0)])});for(const p of['out','zero','carry'])allX(r.getPort(p));}
 });
}
test('zero detector distinguishes a decisive known 1 from unresolved X/Z bits',async()=>{
 for(const width of[8,16]){const{r}=await fixture('std.iszero'+width+'/1');assert.equal(read(r,'zero'),1);drive(r,{in:C.fromBits([1,'X','Z',...Array(width-3).fill(0)])});assert.equal(read(r,'zero'),0);drive(r,{in:C.fromBits([0,'X','Z',...Array(width-3).fill(0)])});allX(r.getPort('zero'));}
});
test('wide registers restore initial on both reset forms and RESET outranks unknown EN',async()=>{
 for(const width of[8,16]){const{r}=await fixture('std.register'+width+'/1',{d:42,en:1},{initial:7});assert.equal(read(r,'q'),7);r.advance(1n);assert.equal(read(r,'q'),42);drive(r,{en:0,d:99});assert.equal(read(r,'q'),42);drive(r,{reset:1,en:'X'});assert.equal(read(r,'q'),7);drive(r,{reset:0,en:1,d:C.fromBits(['Z',1,...Array(width-2).fill(0)])});assert.equal(C.bits(r.getPort('q'))[0],'X');assert.equal(C.bits(r.getPort('q'))[1],1);drive(r,{en:0});r.reset('warm','chip');r.advance(1n);assert.equal(read(r,'q'),7);}
});
test('RAM writes commit next tick; failed writes preserve data and fault sticks until reset',async()=>{
 for(const width of[8,16]){const{r}=await fixture('std.ram'+width+'/1',{address:1,data:42,write:1},{contents:[7,9]});assert.equal(read(r,'out'),9);r.advance(1n);assert.equal(read(r,'out'),42);drive(r,{data:'Z'});assert.equal(read(r,'out'),42);assert.equal(read(r,'fault'),1);drive(r,{data:99});assert.equal(read(r,'out'),99);assert.equal(read(r,'fault'),1);drive(r,{write:0});r.reset('warm','chip');r.advance(1n);assert.equal(read(r,'out'),99);assert.equal(read(r,'fault'),0);r.reset('cold','chip');r.advance(1n);assert.equal(read(r,'out'),9);drive(r,{data:88,write:1});drive(r,{reset:1,write:'X'});assert.equal(read(r,'out'),9);assert.equal(read(r,'fault'),0);}
});
test('RAM unknown read address is X without write fault; unknown controls reject the write atomically',async()=>{
 const{r}=await fixture('std.ram8/1',{address:0,data:99},{contents:[7]});drive(r,{address:'X'});allX(r.getPort('out'));assert.equal(read(r,'fault'),0);drive(r,{address:0,write:'X'});assert.equal(read(r,'out'),7);assert.equal(read(r,'fault'),1);drive(r,{reset:1});drive(r,{reset:'X',write:1});assert.equal(read(r,'out'),7);assert.equal(read(r,'fault'),1);
});
test('ROM defaults unfilled valid addresses to zero, faults unknown/out-of-range, and ignores source text',async()=>{
 for(const width of[8,16]){const{r}=await fixture('std.rom'+width+'/1',{address:0},{contents:[10,20,30],source:'LDI 99\nOUT\nHALT'});assert.equal(read(r,'out'),10);drive(r,{address:1});assert.equal(read(r,'out'),20);drive(r,{address:255});assert.equal(read(r,'out'),0);assert.equal(read(r,'fault'),0);for(const address of['X','Z',...(width===16?[256,65535]:[])]){drive(r,{address});allX(r.getPort('out'));assert.equal(read(r,'fault'),1);}drive(r,{address:2});assert.equal(read(r,'out'),30);assert.equal(read(r,'fault'),0);r.reset('warm','chip');r.advance(1n);assert.equal(read(r,'out'),30);}
});
test('full FIFO simultaneous POP/PUSH first removes old head, then appends without overflow',async()=>{
 for(const width of[8,16]){const{r}=await fixture('std.fifo'+width+'/1',{data:10,push:1},{capacity:2});r.advance(1n);drive(r,{data:20});assert.equal(read(r,'full'),1);drive(r,{data:30,pop:1});assert.equal(read(r,'out'),20);assert.equal(read(r,'count'),2);assert.equal(read(r,'fault'),0);drive(r,{push:0});assert.equal(read(r,'out'),30);assert.equal(read(r,'count'),1);}
});
test('empty FIFO simultaneous POP/PUSH latches underflow but still accepts new data',async()=>{
 for(const width of[8,16]){const{r}=await fixture('std.fifo'+width+'/1',{data:77,push:1,pop:1});allX(r.getPort('out'));r.advance(1n);assert.equal(read(r,'out'),77);assert.equal(read(r,'count'),1);assert.equal(read(r,'fault'),1);drive(r,{push:0,pop:0});assert.equal(read(r,'fault'),1);drive(r,{reset:1,push:'X',pop:'Z'});assert.equal(read(r,'count'),0);assert.equal(read(r,'fault'),0);allX(r.getPort('out'));}
});
test('FIFO unknown controls reject both actions; unknown pushed data does not undo an already valid POP',async()=>{
 const{r}=await fixture('std.fifo8/1',{data:65,push:1});r.advance(1n);drive(r,{data:66});drive(r,{pop:1,push:'X'});assert.equal(read(r,'count'),2);assert.equal(read(r,'out'),65);drive(r,{pop:1,push:1,data:'X'});assert.equal(read(r,'count'),1);assert.equal(read(r,'out'),66);assert.equal(read(r,'fault'),1);r.reset('warm','chip');r.advance(1n);assert.equal(read(r,'count'),0);assert.equal(read(r,'fault'),0);
});
test('capacity 256 FIFO exposes a real 9-bit count and rejects the 257th push',async()=>{
 const{r}=await fixture('std.fifo8/1',{data:5,push:1},{capacity:256});r.advance(256n);assert.equal(read(r,'count'),256);assert.equal(r.getPort('count').width,9);assert.equal(read(r,'full'),1);r.advance(1n);assert.equal(read(r,'count'),256);assert.equal(read(r,'fault'),1);
});
test('PC explicit reset outranks stopped state, while an already stopped PC ignores unknown controls',async()=>{
 const{r}=await fixture('std.pc16/1',{halt:1},{initial:7});r.advance(1n);assert.equal(read(r,'halted'),1);drive(r,{reset:'X',halt:'X',en:'X'});assert.equal(read(r,'out'),7);drive(r,{reset:1});assert.equal(read(r,'out'),7);assert.equal(read(r,'halted'),0);drive(r,{reset:0,halt:1,en:'X'});allX(r.getPort('out'));assert.equal(read(r,'halted'),1);
});
const delay=Array(55).fill('NOP').join('\n');
async function board(source){const b=await MCU.build(source);return new C.Runtime(b.project);}
function spi(byte){return 'LDI '+byte+'\nSTORE 0xE9\nLDI 1\nSTORE 0xEB\n'+Array(8).fill('NOP').join('\n');}
test('SPI device real transactions implement 16 registers, two-byte write/read framing and target reset',async()=>{
 const r=await board('LDI 1\nSTORE 0xE8\n'+[15,90,143,0].map(spi).join('\n')+'\nLOAD 0xE9\nOUT\nHALT');r.advance(150n);assert.equal(MCU.inspect(r).output,90);assert.equal(r.inspect().instances.spi_device.device.registers[15],90);assert.equal(r.inspect().instances.spi_device.device.selected,null);assert.deepEqual(r.history.filter(e=>e.kind==='protocol'&&e.ok).map(e=>e.value),[0,90,0,90]);r.reset('warm','spi_device');r.advance(1n);assert(r.inspect().instances.spi_device.device.registers.every(v=>v===0));
});
test('SPI unsupported mode and forbidden first-byte bits fail without changing device registers',async()=>{
 for(const[mode,byte,error]of[[1,0,'MODE'],[0,0x70,'FRAME']]){const r=await board('LDI 1\nSTORE 0xE8\nLDI '+mode+'\nSTORE 0xEA\n'+spi(byte)+'\nHALT');r.advance(50n);assert(r.history.some(e=>e.kind==='protocol'&&!e.ok&&e.error===error));assert(r.inspect().instances.spi_device.device.registers.every(v=>v===0));assert.equal(r.inspect().instances.spi_device.device.selected,null);}
});
test('I2C sensor real transactions expose ID, writable scratch, reset defaults, and read-only NACK',async()=>{
 const write='LDI 1\nSTORE 0xF0\nLDI 72\nSTORE 0xF1\nLDI 2\nSTORE 0xF2\nLDI 77\nSTORE 0xF3\nLDI 2\nSTORE 0xF4\n'+delay+'\nLDI 1\nSTORE 0xF4\n'+delay+'\nLOAD 0xF3\nOUT\nHALT';const r=await board(write);r.advance(320n);assert.equal(MCU.inspect(r).output,77);assert.equal(r.inspect().instances.sensor.device.scratch,77);r.setSensorTemperature('sensor',65);r.advance(1n);r.reset('warm','sensor');r.advance(1n);assert.equal(r.inspect().instances.sensor.device.temperature,25);assert.equal(r.inspect().instances.sensor.device.scratch,0);
 for(const[address,register,command,ok,value]of[[72,1,1,true,161],[144,0,1,false,null],[72,3,1,false,null],[72,0,2,false,null]]){const s=await board('LDI 1\nSTORE 0xF0\nLDI '+address+'\nSTORE 0xF1\nLDI '+register+'\nSTORE 0xF2\nLDI '+command+'\nSTORE 0xF4\n'+delay+'\nLOAD 0xF3\nOUT\nHALT');s.advance(160n);const event=s.history.find(e=>e.kind==='protocol');assert.equal(event.ok,ok);if(ok)assert.equal(MCU.inspect(s).output,value);else assert.equal(event.error,'NACK');assert.equal(s.inspect().instances.sensor.device.temperature,25);}
});
