const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Core8 = require('../game/core8.js');
const Lab = require('../game/circuit.js');
const Lessons = require('../game/lessons.js');

test('all ten templates use valid canonical projects and return independent data', async () => {
  assert.equal(Lessons.list.length, 10);
  for (const lesson of Lessons.list) {
    const built=await Lessons.build(lesson.templateId);
    const result=await Lab.validate(built.project);
    assert.equal(result.ok,true,lesson.id+': '+JSON.stringify(result.errors));
    assert.equal(built.project.schema,'chip-game.project/0.1.0');
    assert.ok(built.view.positions);
    assert.equal(typeof built.source,'string');
  }
  const a=await Lessons.build('half-adder'),b=await Lessons.build('half-adder');
  a.project.name='changed';
  assert.notEqual(a.project.name,b.project.name);
});

test('first wire starts incomplete and succeeds only after the missing functional connection', async () => {
  const {project}=await Lessons.build('first-wire');
  assert.equal((await Lessons.verify('first-wire',project)).ok,false);
  Lab.addWire(project,'player_added',Lab.ep('rule','out'),Lab.boundary('y'));
  assert.equal((await Lessons.verify('first-wire',project)).ok,true);
});

test('OR goal accepts an alternative De Morgan implementation and arbitrary internal names', async () => {
  const {project}=await Lessons.build('or-alarm');
  project.circuit.instances=[];project.circuit.wires=[];
  Lab.createInstance(project,'std.not/1','leftInvert');
  Lab.createInstance(project,'std.not/1','rightInvert');
  Lab.createInstance(project,'std.nand/1','differentSolution');
  Lab.addWire(project,'a',Lab.boundary('a'),Lab.ep('leftInvert','in'));
  Lab.addWire(project,'b',Lab.boundary('b'),Lab.ep('rightInvert','in'));
  Lab.addWire(project,'c',Lab.ep('leftInvert','out'),Lab.ep('differentSolution','a'));
  Lab.addWire(project,'d',Lab.ep('rightInvert','out'),Lab.ep('differentSolution','b'));
  Lab.addWire(project,'e',Lab.ep('differentSolution','out'),Lab.boundary('y'));
  const result=await Lessons.verify('or-alarm',project);
  assert.equal(result.ok,true,JSON.stringify(result.checks));
});

test('adder truth tables and independent memory scenarios pass without modifying the project', async () => {
  for(const id of ['half-adder','full-adder','memory','dual-memory']) {
    const {project}=await Lessons.build(id),original=JSON.stringify(project);
    const result=await Lessons.verify(id,project);
    assert.equal(result.ok,true,id+': '+JSON.stringify(result.checks));
    assert.equal(JSON.stringify(project),original,'verification must be isolated');
  }
});

test('an unused chip definition cannot satisfy the explicit reuse goal', async () => {
  const {project}=await Lessons.build('chip-package');
  const chip=await Lab.encapsulate(project,'Half adder','user.half');
  project.definitions.push(chip);project.locks.push(Lab.identity(chip));
  Lab.createInstance(project,'user.half','unused_chip');
  const result=await Lessons.verify('chip-package',project);
  assert.equal(result.ok,false);
  assert.equal(result.checks.filter(c=>!c.ok).length,1);
});

test('a real encapsulated half adder preserves all outputs and satisfies reuse', async () => {
  const {project}=await Lessons.build('chip-package');
  const chip=await Lab.encapsulate(project,'Half adder','user.half');
  project.definitions.push(chip);project.locks.push(Lab.identity(chip));
  project.circuit.instances=[];project.circuit.wires=[];
  Lab.createInstance(project,'user.half','my_chip');
  for(const port of ['a','b'])Lab.addWire(project,'in_'+port,Lab.boundary(port),Lab.ep('my_chip',port));
  for(const port of ['sum','carry'])Lab.addWire(project,'out_'+port,Lab.ep('my_chip',port),Lab.boundary(port));
  const result=await Lessons.verify('chip-package',project);
  assert.equal(result.ok,true,JSON.stringify(result.checks));
});

test('smart lamp retains the delivered 96-byte firmware and behavior', async () => {
  const {project}=await Lessons.build('smart-lamp');
  const program=project.firmware.find(f=>f.id==='program');
  assert.equal(program.data.length,192);
  assert.equal(crypto.createHash('sha256').update(Buffer.from(program.data,'hex')).digest('hex'),'0ff1ad4eb1c06c098d5ecfe86308822030316193ecd8a198e3fac3c8e501cb43');
  const result=await Lessons.verify('smart-lamp',project);
  assert.equal(result.ok,true,JSON.stringify(result.checks));
});

test('faster lamp requires actual firmware modification and application', async () => {
  const {project}=await Lessons.build('faster-lamp');
  assert.equal((await Lessons.verify('faster-lamp',project)).ok,false);
  const assembled=Core8.assemble(Lessons.SMART_LAMP_SOURCE.replace('WAIT 60000','WAIT 30000'));
  assert.equal(assembled.ok,true);
  const hex=Array.from(assembled.bytes,b=>b.toString(16).padStart(2,'0')).join('');
  project.firmware=[];
  await Lab.addFirmware(project,'program',hex);
  const result=await Lessons.verify('faster-lamp',project);
  assert.equal(result.ok,true,JSON.stringify(result.checks));
});

test('UART success depends on receiving the actual byte through a valid connection', async () => {
  const {project}=await Lessons.build('uart-loopback');
  const result=await Lessons.verify('uart-loopback',project);
  assert.equal(result.ok,true,JSON.stringify(result.checks));
  project.circuit.wires=project.circuit.wires.filter(w=>w.id!=='uart_loopback');
  assert.equal((await Lessons.verify('uart-loopback',project)).ok,false);
});
