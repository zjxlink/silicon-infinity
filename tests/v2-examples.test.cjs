'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),C=require('../game/circuit.js'),E=require('../game/v2-examples.js');
for(const example of E.list)test('v2 board '+example.id+' uses actual wired execution',async()=>{const b=await E.build(example.id);const result=await E.verify(example.id,b.project);assert.equal(result.ok,true,JSON.stringify(result.checks));});
test('SPI board disconnect prevents programmed register result',async()=>{const {project}=await E.build('spi-register'),r=new C.Runtime(project);r.setConnection('spi_bus',false,1n);r.advance(20000n);assert.notEqual(r.inspect().instances.mcu.ram[0],90);});
test('I2C board exact ROM and dependency closure roundtrip',async()=>{const a=await E.build('i2c-temperature'),p=await C.importProject(JSON.stringify(a.project));assert.deepEqual(p,a.project);const r=new C.Runtime(p);r.advance(2000n);assert.equal(r.inspect().instances.mcu.ram[0],25);});
