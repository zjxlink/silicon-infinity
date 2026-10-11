const test = require('node:test');
const assert = require('node:assert/strict');
const Lab = require('../game/circuit.js');
const Library = require('../game/chip-library.js');
const copy = value => JSON.parse(JSON.stringify(value));

async function packaged(entry) {
  const project=copy(entry.project);
  project.definitions=[...copy(entry.dependencies),copy(entry.definition)];
  project.locks=project.definitions.map(Lab.identity);
  project.circuit.instances=[];project.circuit.wires=[];
  Lab.createInstance(project,entry.definition.stableId,'packaged','可复用芯片');
  for(const port of entry.definition.ports){
    const external=Lab.boundary(port.id),internal=Lab.ep('packaged',port.id);
    Lab.addWire(project,'port_'+port.id,port.direction==='in'?external:internal,port.direction==='in'?internal:external);
  }
  return project;
}

test('catalog contains eighteen actual editable circuits and six application boards',()=>{
  assert.equal(Library.list.length,18);
  assert.equal(new Set(Library.list.map(x=>x.id)).size,18);
  assert.equal(Library.boards.length,6);
  for(const item of Library.list){
    assert.equal(item.editable,true);
    assert.match(item.stableId,/^lib\./);
    assert.equal(item.revision,1);
    assert.ok(item.description&&item.usage&&item.ports.length);
    assert.ok(item.ports.every(p=>p.width===1&&['in','out'].includes(p.direction)));
  }
});

for(const meta of Library.list){
  test(meta.id+': full truth table or temporal contract, before and after encapsulation',async()=>{
    const built=await Library.build(meta.id),original=JSON.stringify(built.project);
    const structural=await Lab.validate(built.project);
    assert.equal(structural.ok,true,JSON.stringify(structural.errors));
    assert.ok(built.project.circuit.instances.length>0);
    assert.ok(built.project.circuit.instances.length<=1000);
    assert.ok(built.project.circuit.wires.length<=4000);
    assert.ok(built.project.definitions.every(d=>d.model.kind==='primitive'));
    assert.deepEqual(built.project.circuit.inputs.map(p=>p.id),meta.ports.filter(p=>p.direction==='in').map(p=>p.id));
    for(const p of Object.values(built.view.positions)){assert.ok(p.x>=0&&p.x<=2130&&p.y>=0&&p.y<=1250);}
    const result=await Library.verify(meta.id,built.project);
    assert.equal(result.ok,true,JSON.stringify(result.checks.filter(c=>!c.ok)));
    assert.equal(JSON.stringify(built.project),original,'verification must not mutate the design');
    if(!meta.sequential)assert.equal(result.checks.length,2**built.project.circuit.inputs.length,'all binary input combinations must be covered');
    const entry=await Library.entry(meta.id);
    assert.equal(entry.definition.model.kind,'composite');
    assert.equal(entry.definition.stableId,meta.stableId);
    assert.equal(entry.definition.revision,1);
    assert.equal(entry.definition.contentHash,Lab.hashDefinition(entry.definition));
    const wrapper=await packaged(entry),wrappedResult=await Library.verify(meta.id,wrapper);
    assert.equal(wrappedResult.ok,true,JSON.stringify(wrappedResult.checks.filter(c=>!c.ok)));
  });
}

for(const meta of Library.boards){
  test(meta.id+': composite application board has observed working behavior',async()=>{
    const built=await Library.buildBoard(meta.id),validation=await Lab.validate(built.project);
    assert.equal(validation.ok,true,JSON.stringify(validation.errors));
    assert.ok(built.project.circuit.instances.some(n=>n.definition.stableId.startsWith('lib.')));
    const result=await Library.verifyBoard(meta.id,built.project);
    assert.equal(result.ok,true,JSON.stringify(result.checks.filter(c=>!c.ok)));
    const imported=await Lab.importProject(JSON.stringify(built.project));
    assert.equal((await Library.verifyBoard(meta.id,imported)).ok,true,'export/import preserves board behavior');
  });
}

test('nested packaged memory preserves state isolation and shared synchronous sampling',async()=>{
  const inner=await Library.entry('register2');
  const project=await packaged(inner);
  const outer=await Lab.encapsulate(project,'嵌套寄存器','lib.test_nested_register');
  project.definitions.push(outer);project.locks.push(Lab.identity(outer));
  project.circuit.instances=[];project.circuit.wires=[];
  project.circuit.outputs=[];
  Lab.addInput(project,'en_b','B写入',0);
  for(const id of ['a0','a1','b0','b1'])Lab.addOutput(project,id,id);
  for(const id of ['a','b']){
    Lab.createInstance(project,outer.stableId,id);
    for(const p of ['d0','d1','reset'])Lab.addWire(project,id+'_'+p,Lab.boundary(p),Lab.ep(id,p));
    Lab.addWire(project,id+'_en',Lab.boundary(id==='a'?'en':'en_b'),Lab.ep(id,'en'));
    for(let n=0;n<2;n++)Lab.addWire(project,id+'_q'+n,Lab.ep(id,'q'+n),Lab.boundary(id+n));
  }
  const rt=new Lab.Runtime(project);
  const state=()=>['a0','a1','b0','b1'].map(id=>Lab.scalar(rt.getPort('$.'+id)));
  rt.setInput('d0',1);rt.setInput('d1',1);rt.advance(1n,{force:true});assert.deepEqual(state(),[1,1,0,0]);
  rt.setInput('en',0);rt.setInput('en_b',1);rt.setInput('d1',0);rt.advance(1n,{force:true});assert.deepEqual(state(),[1,1,1,0]);
  rt.setInput('reset',1);rt.advance(1n,{force:true});assert.deepEqual(state(),[0,0,0,0]);
});

test('verification detects broken functionality rather than catalog names',async()=>{
  for(const id of ['adder4','counter4','shift4','edge-pulse']){
    const {project}=await Library.build(id);
    project.circuit.wires=project.circuit.wires.filter(w=>!(w.to.kind==='boundary'&&w.to.port===project.circuit.outputs[0].id));
    assert.equal((await Library.verify(id,project)).ok,false,id+' must reject a disconnected output');
  }
  const {project}=await Library.buildBoard('running-lights');
  project.circuit.wires=project.circuit.wires.filter(w=>w.to.kind!=='instance'||w.to.instance!=='decoder');
  assert.equal((await Library.verifyBoard('running-lights',project)).ok,false);
});

test('builders return independent deterministic definitions with no shared mutable project',async()=>{
  const a=await Library.entry('adder4'),b=await Library.entry('adder4');
  assert.equal(a.definition.contentHash,b.definition.contentHash);
  a.project.circuit.instances[0].label='changed';
  assert.notEqual(a.project.circuit.instances[0].label,b.project.circuit.instances[0].label);
  a.definition.name='changed';
  assert.notEqual(a.definition.name,b.definition.name);
});

test('unknown circuit and board identifiers are explicit failures',async()=>{
  await assert.rejects(()=>Library.build('unknown'),/未知芯片/);
  await assert.rejects(()=>Library.entry('unknown'),/未知芯片/);
  await assert.rejects(()=>Library.buildBoard('unknown'),/未知应用板/);
  assert.equal((await Library.verify('unknown')).ok,false);
  assert.equal((await Library.verifyBoard('unknown')).ok,false);
});
