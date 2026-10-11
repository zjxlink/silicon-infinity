'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../game/circuit.js'),R=require('../game/recorder-v7.js'),A=require('../game/architecture-v5.js'),B=require('../game/testbench-v5.js');
const cp=x=>JSON.parse(JSON.stringify(x)),h=(r,id)=>r.inspect().instances[id].hardware;
async function fixture(program='polling',options={}){const w=await R.build('reference',{program}),r=new C.Runtime(w.project,options);r.advance(400n,{force:true});assert.equal(R.inspect(r).initialized,true);return{w,r};}
function advance(r,n=400){r.advance(BigInt(n),{force:true});}
function submit(r,value,options={}){const event=R.submit(r,value,options);advance(r);return event;}

test('three valid starting points use only existing models and preserve the public RAM/input contract',async()=>{
 for(const mode of R.startModes){const w=await R.build(mode.id);await C.importProject(w.project);assert.deepEqual(Object.keys(w.view),['positions']);assert.deepEqual(w.project.circuit.inputs.map(x=>[x.id,x.width]),[['sample',16],['control',16],['reset',1]]);assert.equal(w.project.circuit.instances.length,mode.id==='interface'?3:6);assert.equal(w.project.circuit.instances.find(x=>x.id==='ram').parameters.depth,64);}
 assert.equal(R.programs.length,2);for(const p of R.programs)assert.equal(A.assemble(p.source).ok,true,p.id);assert.notEqual(R.programs[0].source,R.programs[1].source);assert.match(R.programs[1].source,/CALL append/);for(const s of [...R.stages,{id:'all'}])B.validate(R.contract(s.id));
});
for(const program of ['polling','subroutine'])test(program+' satisfies all 52 actual public-memory checks without altering the supplied workspace',async()=>{
 const w=await R.build('reference',{program}),before=JSON.stringify(w),result=await R.verify(w);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.checks.length,52);assert.equal(result.stageId,'all');assert.equal(JSON.stringify(w),before);assert.equal(result.stats.time,R.contract().duration);
});
test('submission only schedules actual inputs; repeated queued submissions allocate distinct sequence numbers',async()=>{
 const{r}=await fixture(),before=cp(h(r,'ram').memory),t=r.time;const first=R.submit(r,25),second=R.submit(r,26);assert.equal(first.sequence,1);assert.equal(second.sequence,2);assert.equal(r.time,t);assert.deepEqual(h(r,'ram').memory,before);assert.equal(R.inspect(r).count,0);advance(r);assert.deepEqual(R.inspect(r).records.map(x=>[x.sequence,x.value]),[[2,26]]);assert.throws(()=>R.submit(r,256),/0—255/);assert.throws(()=>R.submit(r,1,{sequence:-1}),/0—255/);
});
test('a payload physically written before the count publication never appears as a committed record',async()=>{
 const{r}=await fixture();R.submit(r,73);let seen=false;for(let i=0;i<350;i++){advance(r,1);const mem=h(r,'ram').memory;if(mem[16]===0x0149&&mem[1]===0){seen=true;assert.deepEqual(R.inspect(r).records,[]);break;}}assert.equal(seen,true);advance(r);assert.equal(R.inspect(r).count,1);assert.equal(R.inspect(r).records[0].value,73);
});
test('runtime pause freezes time and queued input; recording pause is independently consumed by the program',async()=>{
 const{r}=await fixture();r.pause();R.submit(r,22);const before=r.snapshot();r.advance(400n);assert.deepEqual(r.snapshot(),before);advance(r);assert.equal(R.inspect(r).count,1);R.setRunning(r,false);advance(r);assert.equal(R.inspect(r).status,2);submit(r,23);submit(r,24);assert.equal(R.inspect(r).count,1);R.setRunning(r,true);advance(r);assert.deepEqual(R.inspect(r).records.map(x=>x.value),[22,24]);
});
test('clear is a numbered input request with no host RAM mutation and baselines the current sample',async()=>{
 const{r}=await fixture();submit(r,31);const memory=cp(h(r,'ram').memory),result=R.clear(r);assert.equal(result.clearToken,1);assert.deepEqual(h(r,'ram').memory,memory);advance(r);assert.equal(R.inspect(r).clearToken,1);assert.equal(R.inspect(r).status,2);assert.equal(R.inspect(r).count,0);assert.equal(h(r,'ram').memory[16],0x011f);R.setRunning(r,true);advance(r);assert.equal(R.inspect(r).count,0);submit(r,32);assert.deepEqual(R.inspect(r).records.map(x=>x.value),[32]);
});
test('cold and warm reset start empty logical sessions; warm retained payload is never presented as a new record',async()=>{
 for(const kind of ['cold','warm']){const{r}=await fixture();submit(r,41);r.reset(kind);advance(r,1);assert.equal(R.inspect(r).initialized,false);assert.deepEqual(R.inspect(r).records,[]);if(kind==='warm')assert.equal(h(r,'ram').memory[16],0x0129);for(let i=0;i<200;i++){advance(r,1);assert.equal(R.inspect(r).records.length,0,'old record visible at '+r.time);}assert.equal(R.inspect(r).initialized,true);assert.equal(R.inspect(r).count,0);submit(r,42);assert.deepEqual(R.inspect(r).records.map(x=>x.value),[42]);}
});
test('startup treats the current input as a baseline and accepts the next explicitly sequenced sample',async()=>{
 const w=await R.build(),r=new C.Runtime(w.project);R.submit(r,25,{sequence:1});advance(r);assert.equal(R.inspect(r).lastSequence,1);assert.equal(R.inspect(r).count,0);submit(r,25,{sequence:2});assert.equal(R.inspect(r).count,1);
});
test('snapshot roundtrip restores an in-flight write and queued controls with identical continued state',async()=>{
 const{w,r}=await fixture('subroutine');R.submit(r,51);let pending=false;for(let i=0;i<250;i++){advance(r,1);const cpu=h(r,'cpu');if(cpu.pending?.write&&cpu.pending.address===16){pending=true;break;}}assert.equal(pending,true);r.setInput('control',0,r.time+200n);const restored=await C.Runtime.fromSnapshot(w.project,r.snapshot());assert.deepEqual(restored.snapshot(),r.snapshot());advance(r);advance(restored);assert.deepEqual(restored.snapshot(),r.snapshot());assert.equal(R.inspect(restored).records[0].value,51);
});
test('two packaged recorder instances preserve independent RAM, input maps, effective source and snapshots',async()=>{
 const w=await R.build(),pkg=await C.packageModule(w.project,'本地记录器','user.recorder-test'),p=await C.createProject('两个记录器'),left=await C.placeModule(p,pkg,'left'),right=await C.placeModule(p,pkg,'right'),r=new C.Runtime(await C.importProject(p));advance(r);R.submit(r,61,{scope:'left',inputMap:left.boundaryMap});advance(r);assert.equal(R.inspect(r,'left').count,1);assert.equal(R.inspect(r,'right').count,0);R.submit(r,62,{scope:'right',inputMap:right.boundaryMap});advance(r);assert.deepEqual(R.inspect(r,'left').records.map(x=>x.value),[61]);assert.deepEqual(R.inspect(r,'right').records.map(x=>x.value),[62]);assert.throws(()=>R.submit(r,63,{scope:'left'}),/inputMap/);const restored=await C.Runtime.fromSnapshot(r.project,r.snapshot());assert.deepEqual(restored.snapshot(),r.snapshot());assert.ok(pkg.definitions.some(d=>d.model.kind==='behavioral'&&d.model.id==='std.cpu16/1'));assert.equal(pkg.definition.model.circuit.instances.find(n=>n.id==='cpu').parameters.source,R.programs[0].source);
});
test('missing or renamed public observation/input roles report interface incompatibility explicitly',async()=>{
 const w=await R.build('interface');w.project.circuit.instances=w.project.circuit.instances.filter(n=>n.id!=='ram');const result=await R.verify(w);assert.equal(result.error.code,'E_RECORDER_INTERFACE');assert.equal(result.firstFailure,null);const good=await R.build();good.project.circuit.inputs.find(x=>x.id==='sample').width=8;assert.equal((await R.verify(good)).error.code,'E_RECORDER_INTERFACE');
});
test('interface and skeleton starts cannot pass by showing a prerecorded result',async()=>{
 for(const mode of ['interface','skeleton']){const w=await R.build(mode),result=await R.verify(w,{stageId:'sample'});assert.equal(result.ok,false);assert.ok(result.firstFailure);assert.equal(result.firstFailure.target,'ram');assert.equal(result.error,undefined);assert.equal(R.inspect(new C.Runtime(w.project)).records.length,0);}
});
test('disconnecting the real sample wire fails the actual read and creates no record',async()=>{
 const{r}=await fixture();r.setConnection('sample_input',false);R.submit(r,71);advance(r);assert.equal(R.inspect(r).count,0);assert.equal(h(r,'sample_device').fault,'F_INPUT_UNKNOWN');assert.equal(h(r,'cpu').fault,'F_BUS_ERROR');assert.ok(R.inspect(r).faults.some(x=>x.path==='sample_device'));
});
test('disconnecting RAM acknowledgement causes a CPU failure and cannot manufacture a committed record',async()=>{
 const{r}=await fixture();r.setConnection('ram_ready',false);R.submit(r,72);advance(r);assert.ok(h(r,'cpu').fault);assert.equal(R.inspect(r).count,0);r.setConnection('ram_ready',true);r.reset('warm');advance(r);assert.equal(R.inspect(r).count,0);submit(r,73);assert.deepEqual(R.inspect(r).records.map(x=>x.value),[73]);
});
test('edited executable code changes real behavior and is rejected by the same functional contract',async()=>{
 const w=await R.build();const cpu=w.project.circuit.instances.find(x=>x.id==='cpu');cpu.parameters.source=cpu.parameters.source.replace('STORE R4, [R6]','STORE R0, [R6]');w.sources['architecture:cpu']=cpu.parameters.source;const result=await R.verify(w,{stageId:'sample'});assert.equal(result.ok,false);assert.equal(result.firstFailure.actual,0);assert.equal(result.firstFailure.expected,0x0125);
});
test('observer rejects invalid metadata produced by a real program and never repairs RAM',async()=>{
 const w=await R.build(),cpu=w.project.circuit.instances.find(x=>x.id==='cpu');cpu.parameters.source='LDI R0, 0x5243\nSTORE R0, 0\nLDI R0, 9\nSTORE R0, 1\nLDI R0, 8\nSTORE R0, 5\nLDI R0, 1\nSTORE R0, 2\nHALT';const r=new C.Runtime(w.project);advance(r);const before=r.snapshot();assert.equal(R.inspect(r).initialized,false);assert.match(R.inspect(r).reason,/元数据/);assert.deepEqual(R.inspect(r).records,[]);assert.deepEqual(r.snapshot(),before);
});
test('optimized and reference solvers agree through input, pause and clear with the actual CPU board',async()=>{
 const w=await R.build(),fast=new C.Runtime(w.project),reference=new C.Runtime(w.project,{referenceSolver:true});for(const r of [fast,reference]){advance(r);submit(r,81);R.setRunning(r,false);advance(r);R.clear(r);advance(r);R.setRunning(r,true);submit(r,82);}assert.deepEqual(fast.snapshot(),reference.snapshot());
});
test('verification cancellation and role-compatible alternate programs preserve the active runtime',async()=>{
 const{w,r}=await fixture(),before=r.snapshot(),abort=new AbortController();abort.abort();const cancelled=await R.verify(w,{stageId:'sample',signal:abort.signal});assert.equal(cancelled.cancelled,true);assert.deepEqual(r.snapshot(),before);const result=await R.verify(w,{stageId:'sample'});assert.equal(result.ok,true);assert.deepEqual(r.snapshot(),before);
});
test('0.6 snapshot and test package versions remain importable while content hashes are still enforced',async()=>{
 const{w,r}=await fixture();const old=r.snapshot();old.engineVersion='0.6.0';const restored=await C.Runtime.fromSnapshot(w.project,old);assert.deepEqual(restored.snapshot(),r.snapshot());const broken=cp(old);broken.projectHash='sha256:'+'0'.repeat(64);assert.throws(()=>C.Runtime.fromSnapshot(w.project,broken),/工程|依赖/);const pkg=await B.createPackage({title:'旧版公开合同',workspace:w,testbench:R.contract('sample')});pkg.engineVersion='0.6.0';delete pkg.contentHash;pkg.contentHash=C.hashBytes(new TextEncoder().encode(C.canonicalStringify(pkg)));assert.equal((await B.importPackage(pkg)).engineVersion,'0.6.0');pkg.workspace.project.name+=' altered';await assert.rejects(()=>B.importPackage(pkg),/哈希|hash/i);
});
