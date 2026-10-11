/* Isolated, bounded computation. The same Host executes in a Worker and offline fallback. */
(function(root,factory){const node=typeof module==='object'&&module.exports,api=factory(root,node?require('./circuit.js'):root.CircuitLab,node?require('./testbench-v5.js'):root.LabTestbench,node?require('./verification-v6.js'):root.VerificationV6);if(node)module.exports=api;else root.ComputeV9=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root,C,B,V){
 'use strict';
 const PROTOCOL='silicon.compute/1',LIMITS=Object.freeze({messageBytes:12*1024*1024,queued:32,events:4096,advanceUs:1000000,wallMs:8000,sliceMs:10,batch:128,samples:120});
 const now=()=>typeof performance!=='undefined'?performance.now():Date.now(),yieldTask=()=>new Promise(r=>setTimeout(r,0)),clone=x=>JSON.parse(JSON.stringify(x));
 const hash=x=>C.hashBytes(new TextEncoder().encode(C.canonicalStringify(x)));
 function error(code,message){return Object.assign(new Error(message),{code});}function need(x,message,code='E_COMPUTE_SCHEMA'){if(!x)throw error(code,message);}
 function plain(raw){const s=JSON.stringify(raw);need(typeof s==='string'&&new TextEncoder().encode(s).length<=LIMITS.messageBytes,'后台消息超过12 MiB预算');return C.parseJSON(s);}
 const decimal=x=>typeof x==='string'&&/^(0|[1-9][0-9]*)$/.test(x);
 const cancelledReport=()=>({ok:false,cancelled:true,checks:[],trace:[],firstFailure:null,stats:{time:'0',work:0,advances:0,wallMs:0}});
 class Host{
  constructor(){this.session=null;this.job=null;this.disposed=false;this.loadGeneration=0;this.requests=0;this.slices=0;this.maxSliceMs=0;}
  async handle(raw,send){let m;try{m=plain(raw);need(m.protocol===PROTOCOL&&m.engineVersion===C.VERSION,'后台引擎或协议版本不匹配','E_COMPUTE_VERSION');need(Number.isSafeInteger(m.generation)&&m.generation>0&&Number.isSafeInteger(m.seq)&&m.seq>0,'代次/序号无效');need(typeof m.projectRevision==='string'&&m.projectRevision.length<=200&&typeof m.projectHash==='string','工程版本无效');need(!this.disposed,'后台实例已关闭','E_COMPUTE_CLOSED');this.requests++;
   const reply=(result,type='result')=>send({...m,payload:undefined,type,result});
   if(m.kind==='load'){
    need(m.generation>this.loadGeneration,'过期载入','E_COMPUTE_STALE');this.loadGeneration=m.generation;
    const candidate=await C.importProject(m.payload.project),candidateHash=hash(candidate);need(!this.disposed&&m.generation===this.loadGeneration,'载入已被新工程取代','E_COMPUTE_STALE');need(candidateHash===m.projectHash,'工程指纹不匹配');
    const rt=m.payload.snapshot?C.Runtime.fromSnapshot(candidate,m.payload.snapshot):new C.Runtime(candidate,{referenceSolver:!!m.payload.referenceSolver});
    if(this.job){this.job.controller.abort();await this.job.done;}
    need(!this.disposed&&m.generation===this.loadGeneration&&(!this.session||m.generation>this.session.generation),'载入已被新工程取代','E_COMPUTE_STALE');
    this.session={generation:m.generation,projectRevision:m.projectRevision,projectHash:m.projectHash,seq:m.seq,rt};reply(this.checkpoint());return;
   }
   const s=this.session;need(s&&m.generation===s.generation&&m.projectRevision===s.projectRevision&&m.projectHash===s.projectHash,'工程或运行代次已过期','E_COMPUTE_STALE');need(m.seq>s.seq,'命令序号重复或倒序','E_COMPUTE_SEQUENCE');s.seq=m.seq;
   if(m.kind==='cancel'||m.kind==='pause'){if(this.job){this.job.controller.abort();await this.job.done;}if(m.kind==='pause')s.rt.pause();reply(this.checkpoint());return;}
   need(!this.job,'后台已有计算任务，请先暂停','E_COMPUTE_BUSY');
   if(m.kind==='checkpoint'){reply(this.checkpoint(m.payload?.probes));return;}
   if(m.kind==='verify'||m.kind==='observe'){
    const job=this.startJob(),opts={...m.payload.options,signal:job.controller.signal,onProgress:progress=>reply(progress,'progress')};
    try{let result;if(m.kind==='verify')result=await B.run(m.payload.workspace,m.payload.spec,opts);else {need(V&&typeof V.observe==='function','波形模块未加载');result=await V.observe(m.payload.workspace,m.payload.spec,m.payload.observation,opts);}if(job.controller.signal.aborted){result.cancelled=true;if(m.kind==='verify')result.ok=false;else result.complete=false;}reply(result);}finally{this.endJob(job);}return;
   }
   if(m.kind==='advance'){
    need(decimal(m.payload.delta)&&BigInt(m.payload.delta)<=BigInt(LIMITS.advanceUs),'一次推进最多1000000 μs');
    const job=this.startJob(),start=s.rt.time,target=start+BigInt(m.payload.delta),started=now();let batch=1,steps=0;
    try{while(s.rt.time<target&&!job.controller.signal.aborted){if(now()-started>LIMITS.wallMs)break;const count=BigInt(batch)<target-s.rt.time?BigInt(batch):target-s.rt.time,t=now(),before=s.rt.time;s.rt.advance(count,{force:true,inspect:false});const elapsed=now()-t,advanced=s.rt.time-before;steps++;this.slices++;this.maxSliceMs=Math.max(this.maxSliceMs,elapsed);if(advanced===0n)break;batch=Math.max(1,Math.min(LIMITS.batch,batch*2,Math.floor(Number(advanced)*LIMITS.sliceMs/Math.max(.1,elapsed))));await yieldTask();}
     reply({time:String(s.rt.time),advanced:String(s.rt.time-start),remaining:String(target-s.rt.time),cancelled:job.controller.signal.aborted,incomplete:s.rt.time<target,stats:{wallMs:now()-started,slices:steps}});
    }finally{this.endJob(job);}return;
   }
   need(s.rt.events.length<LIMITS.events,'后台排队输入达到4096条，请先推进或清理','E_COMPUTE_BUDGET');const p=m.payload||{},at=p.at===undefined?undefined:(need(decimal(p.at),'事件时刻无效'),BigInt(p.at));
   if(m.kind==='input')s.rt.setInput(p.id,p.value,at);else if(m.kind==='connection')s.rt.setConnection(p.id,p.enabled,at);else if(m.kind==='power')s.rt.setPower(p.domain,p.enabled,at);else if(m.kind==='reset')s.rt.reset(p.mode||'warm',p.target||'all',at);else if(m.kind==='uart')s.rt.injectTerminal(p.target,p.byte,at);else if(m.kind==='temperature')s.rt.setSensorTemperature(p.target,p.value,at);else throw error('E_COMPUTE_SCHEMA','不支持的后台命令');reply({time:String(s.rt.time),queued:s.rt.events.length});
  }catch(e){if(m)send({...m,payload:undefined,type:'error',error:{code:e.code||'E_COMPUTE',message:e.message}});else send({type:'fatal',error:{code:e.code||'E_COMPUTE',message:e.message}});}}
  startJob(){let resolve;const j={controller:new AbortController(),done:new Promise(r=>resolve=r),resolve};this.job=j;return j;}
  endJob(j){if(this.job===j)this.job=null;j.resolve();}
  checkpoint(probes=[]){need(Array.isArray(probes)&&probes.length<=64,'最多64个观察端口');const rt=this.session.rt;return {snapshot:rt.snapshot(),ports:Object.fromEntries(probes.map(p=>[p,rt.getPort(p)])),stats:{requests:this.requests,slices:this.slices,maxSliceMs:this.maxSliceMs,nodes:rt.states.size,queued:rt.events.length,history:rt.history.length,issues:rt.issues.length,heapBytes:typeof performance!=='undefined'?performance.memory?.usedJSHeapSize??null:null}};}
  dispose(){this.disposed=true;this.job?.controller.abort();this.session=null;}
 }
 class Client{
  constructor(options={}){this.options=options;this.mode=options.mode||'auto';need(['auto','worker','local'].includes(this.mode),'后台模式无效');this.backend='starting';this.reason='';this.generation=0;this.loadTicket=0;this.seq=0;this.pending=new Map();this.session=null;this.disposed=false;this.running=false;this.runEpoch=0;this.samples=[];this.staleReplies=0;this.ready=this.start();}
  async start(){if(this.mode==='worker'&&!root.Worker&&!this.options.workerFactory)throw error('E_COMPUTE_START','此环境不支持原生 Web Worker');if(this.mode==='local'||(this.mode==='auto'&&root.location?.protocol==='file:')||(!root.Worker&&!this.options.workerFactory)){this.backend='local';this.reason=this.mode==='local'?'已选择本地隔离计算':root.location?.protocol==='file:'?'离线文件模式：使用本地隔离分批计算':'此环境没有 Web Worker：使用本地隔离分批计算';this.host=new Host();return this;}
   try{const url=this.options.workerURL||new URL('compute-worker-v9.js',root.document?.currentScript?.src||root.location?.href).href;this.worker=this.options.workerFactory?this.options.workerFactory(url):new root.Worker(url);await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(error('E_COMPUTE_START','后台启动超时')),10000);this.worker.onmessage=e=>{if(e.data?.type==='ready'){clearTimeout(timeout);if(e.data.engineVersion!==C.VERSION)reject(error('E_COMPUTE_VERSION','后台缓存版本与当前引擎不符'));else resolve();}else this.receive(e.data);};this.worker.onerror=e=>{clearTimeout(timeout);reject(error('E_COMPUTE_WORKER',e.message||'后台脚本启动失败'));this.failAll(error('E_COMPUTE_WORKER','后台计算已中断，原工作台未改变'));};});this.backend='worker';return this;
   }catch(e){this.worker?.terminate();this.worker=null;if(this.mode==='worker')throw e;this.backend='local';this.failure=null;this.reason='Web Worker 未能启动，已回退本地隔离计算：'+e.message;this.host=new Host();return this;}}
  failAll(e){if(e.code==='E_COMPUTE_WORKER')this.failure=e;for(const p of this.pending.values())p.reject(e);this.pending.clear();this.running=false;}
  receive(m){const p=this.pending.get(m?.seq);if(!p||m.protocol!==PROTOCOL||m.engineVersion!==C.VERSION||m.generation!==p.message.generation||m.generation!==this.generation||m.projectRevision!==p.message.projectRevision||m.projectHash!==p.message.projectHash){this.staleReplies++;return;}
   if(m.type==='progress'){p.onProgress?.(m.result);return;}this.pending.delete(m.seq);if(m.type==='error')p.reject(error(m.error.code,m.error.message));else if(m.type==='result')p.resolve({...m.result,compute:{backend:this.backend,engineVersion:C.VERSION,projectRevision:m.projectRevision,projectHash:m.projectHash,generation:m.generation,seq:m.seq}});else p.reject(error('E_COMPUTE_PROTOCOL','后台回复格式无效'));}
  async request(kind,payload={},onProgress){await this.ready;need(!this.disposed,'后台计算已关闭','E_COMPUTE_CLOSED');if(this.failure)throw this.failure;need(this.session,'请先载入工程');need(this.pending.size<LIMITS.queued,'后台命令过多');const message=plain({protocol:PROTOCOL,engineVersion:C.VERSION,generation:this.generation,seq:++this.seq,projectRevision:this.session.projectRevision,projectHash:this.session.projectHash,kind,payload});return new Promise((resolve,reject)=>{this.pending.set(message.seq,{message,resolve,reject,onProgress});if(this.worker)this.worker.postMessage(message);else setTimeout(()=>this.host.handle(message,m=>this.receive(m)),0);});}
  async load({project,snapshot,projectRevision,referenceSolver=false}){const ticket=++this.loadTicket;await this.ready;need(!this.disposed,'后台计算已关闭','E_COMPUTE_CLOSED');const p=await C.importProject(project);need(!this.disposed&&ticket===this.loadTicket,'载入已被新工程或关闭操作取代','E_COMPUTE_STALE');if(snapshot)C.Runtime.fromSnapshot(p,snapshot);this.running=false;this.runEpoch++;this.failAll(error('E_COMPUTE_STALE','工程已切换，旧计算结果已丢弃'));this.generation++;this.session={projectRevision:projectRevision||hash(p),projectHash:hash(p)};return this.request('load',{project:p,snapshot,referenceSolver});}
  async command(command){const {kind,...payload}=command;need(!['load','verify','observe','pause','cancel'].includes(kind),'请使用对应的专用方法');return this.request(kind,payload);}
  checkpoint(probes=[]){return this.request('checkpoint',{probes});}
  async pause(){this.running=false;this.runEpoch++;return this.request('pause');}
  async cancel(){this.running=false;this.runEpoch++;return this.request('cancel');}
  async run({delta=128,onUpdate,updateMs=250,maxVirtualUs=null}={}){need(!this.running,'后台已经运行');need(Number.isInteger(delta)&&delta>=1&&delta<=1000000,'运行批量无效');const epoch=++this.runEpoch;this.running=true;let last=0,advanced=0n;try{while(this.running&&epoch===this.runEpoch&&!this.disposed){let n=BigInt(delta);if(maxVirtualUs!==null){const remain=BigInt(maxVirtualUs)-advanced;if(remain<=0n)break;if(n>remain)n=remain;}const r=await this.command({kind:'advance',delta:String(n)});advanced+=BigInt(r.advanced);if(now()-last>=Math.max(100,updateMs)){const state=await this.checkpoint();this.samples.push({at:now(),time:state.snapshot.time,stats:state.stats});if(this.samples.length>LIMITS.samples)this.samples.shift();onUpdate?.(state);last=now();}if(r.cancelled||r.advanced==='0')break;await yieldTask();}}finally{if(epoch===this.runEpoch)this.running=false;}return{advanced:String(advanced),cancelled:epoch!==this.runEpoch};}
  async verify(workspace,spec,options={}){return this.analysis('verify',workspace,spec,null,options);}
  async observe(workspace,spec,observation,options={}){return this.analysis('observe',workspace,spec,observation,options);}
  async analysis(kind,workspace,spec,observation,options){const cancelled=()=>kind==='verify'?cancelledReport():{complete:false,cancelled:true,frames:[],samples:0};if(options.signal?.aborted)return cancelled();const w=await B.workspace(workspace);if(options.signal?.aborted)return cancelled();await this.load({project:w.project,projectRevision:hash(w)});if(options.signal?.aborted)return cancelled();let aborted=false;const abort=()=>{aborted=true;this.cancel().catch(()=>{});};options.signal?.addEventListener('abort',abort,{once:true});try{const result=await this.request(kind,{workspace:w,spec,observation,options:{...(options.maxWallMs===undefined?{}:{maxWallMs:options.maxWallMs}),...(options.workBudget===undefined?{}:{workBudget:options.workBudget})}},options.onProgress);if(aborted){result.cancelled=true;if(kind==='verify')result.ok=false;else result.complete=false;}return result;}finally{options.signal?.removeEventListener('abort',abort);}}
  dispose(){if(this.disposed)return;this.disposed=true;this.loadTicket++;this.running=false;this.runEpoch++;this.generation++;this.failAll(error('E_COMPUTE_CLOSED','后台计算已关闭'));this.worker?.terminate();this.host?.dispose();}
 }
 return {PROTOCOL,LIMITS,Host,Client,create:options=>new Client(options),hash};
});


