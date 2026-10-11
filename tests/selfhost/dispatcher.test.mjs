import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import C from '../../game/circuit.js';
import U from '../../game/custom-cpu-v8.js';
import {openDatabase} from '../../selfhost/database.mjs';
import {createCloudDispatcher} from '../../selfhost/cloud-dispatcher.mjs';

function fixture(t) {
  const directory=mkdtempSync(path.join(tmpdir(),'silicon-dispatcher-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  return path.join(directory,'silicon.db');
}
function request(url='session',method='GET',body,user='dispatcher-owner') {
  return new Request(`http://localhost/api/${url}`,{method,headers:{origin:'http://localhost','content-type':'application/json','oai-authenticated-user-id':user},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
async function json(dispatcher,url,method,body,user) {
  const response=await dispatcher.handle(request(url,method,body,user));
  return {status:response.status,body:await response.json()};
}

test('real worker bounds its queue deterministically and continues after overflow',async t=>{
  let dispatcher;t.after(async()=>{await dispatcher?.close();});const file=fixture(t);
  dispatcher=await createCloudDispatcher(file,{maxQueue:2});assert.equal(dispatcher.ready,true);
  // All three submissions happen in one event-loop turn before the worker can
  // deliver a response: one active item, one queued item, then overflow.
  const first=dispatcher.handle(request()),second=dispatcher.handle(request()),overflow=dispatcher.handle(request());
  const responses=await Promise.all([first,second,overflow]);
  assert.deepEqual(responses.map(r=>r.status),[200,200,429]);
  assert.equal((await dispatcher.handle(request())).status,200);
});

test('close resolves active and queued requests, is repeatable, and blocks future dispatch',async t=>{
  let dispatcher;t.after(async()=>{await dispatcher?.close();});const file=fixture(t);
  dispatcher=await createCloudDispatcher(file);
  const first=dispatcher.handle(request()),second=dispatcher.handle(request());
  await dispatcher.close();
  assert.equal(dispatcher.ready,false);assert.deepEqual((await Promise.all([first,second])).map(r=>r.status),[503,503]);
  await dispatcher.close();assert.equal((await dispatcher.handle(request())).status,503);
  // The worker has actually exited: another connection can exclusively open
  // and close the database without waiting on an outstanding transaction.
  const db=openDatabase(file);db.sqlite.exec('BEGIN EXCLUSIVE; ROLLBACK;');db.close();
});

test('native custom MCU room execution matches local runtime and persists across worker restart',async t=>{
  let dispatcher;t.after(async()=>{await dispatcher?.close();});const file=fixture(t);
  dispatcher=await createCloudDispatcher(file);
  const workspace=await U.build(),local=new C.Runtime(workspace.project);local.pause();
  const created=await json(dispatcher,'rooms','POST',{workspace:{project:workspace.project,view:workspace.view,sources:workspace.sources}});
  assert.equal(created.status,201,JSON.stringify(created.body));let room=created.body;
  assert.deepEqual(room.snapshot,local.snapshot());
  let sequence=0;
  for(const operation of[{kind:'advance',single:true,microseconds:8},{kind:'input',port:'irq',value:1},{kind:'advance',single:true,microseconds:100}]){
    const packet={clientId:'actual-worker-test',sequence:++sequence,epoch:room.epoch,operation};
    const response=await json(dispatcher,`rooms/${room.id}/operations`,'POST',packet);
    assert.equal(response.status,200,JSON.stringify(response.body));room=response.body;
    if(operation.kind==='advance')local.advance(BigInt(operation.microseconds),{force:true});else local.setInput(operation.port,operation.value);
    assert.deepEqual(room.snapshot,local.snapshot());
    const duplicate=await json(dispatcher,`rooms/${room.id}/operations`,'POST',packet);
    assert.equal(duplicate.status,200);assert.deepEqual(duplicate.body.snapshot,room.snapshot);
  }
  assert.equal(local.inspect().instances.ram.hardware.memory[0],42);
  assert.equal((await json(dispatcher,`rooms/${room.id}`,'GET',undefined,'uninvited-user')).status,403);
  await dispatcher.close();dispatcher=await createCloudDispatcher(file);
  const restored=await json(dispatcher,`rooms/${room.id}`);
  assert.equal(restored.status,200);assert.deepEqual(restored.body.snapshot,local.snapshot());
});
