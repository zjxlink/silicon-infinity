(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./circuit.js'):root.CircuitLab);if(typeof module==='object'&&module.exports)module.exports=api;else root.ScaleV9=api;})(globalThis,function(C){
 'use strict';
 const copy=x=>JSON.parse(JSON.stringify(x)),list=[
  {id:'logic-100',title:'组合逻辑 · 100 门',kind:'logic',size:100},
  {id:'logic-500',title:'组合逻辑 · 500 门',kind:'logic',size:500},
  {id:'logic-1000',title:'组合逻辑 · 1000 门',kind:'logic',size:1000},
  {id:'registers-64',title:'顺序电路 · 64 级寄存',kind:'registers',size:64},
  {id:'registers-256',title:'顺序电路 · 256 级寄存',kind:'registers',size:256},
  {id:'nested-64',title:'模块阵列 · 64 × 8 门',kind:'nested',size:64},
  {id:'cpu-dma',title:'CPU 与 DMA 共享总线',kind:'system'},
  {id:'terminal-fixed',title:'完整 MCU · 固定核心',kind:'terminal',core:'fixed'},
  {id:'terminal-custom',title:'完整 MCU · 自定义核心',kind:'terminal',core:'custom'}
 ];
 async function build(id){const entry=list.find(x=>x.id===id);if(!entry)throw Error('未知规模样板');
  if(entry.kind==='system'){const S=typeof module==='object'&&module.exports?require('./systems-v5.js'):globalThis.SystemsV5;return S.build('cpu-dma');}
  if(entry.kind==='terminal'){const T=typeof module==='object'&&module.exports?require('./terminal-v8.js'):globalThis.TerminalV8;return T.build(entry.core);}
  const p=await C.createProject(entry.title),view={positions:{}},input=C.boundary('in');C.addInput(p,'in','测试输入',0);C.addOutput(p,'out','真实输出');let from=input;
  view.positions['boundary:in']={x:30,y:90};
  if(entry.kind==='registers'){C.addInput(p,'enable','使能',1);C.addInput(p,'reset','复位',0);}
  let modulePackage;
  if(entry.kind==='nested'){const child=await C.createProject('八级反相链');C.addInput(child,'in','in',0);C.addOutput(child,'out','out');let source=C.boundary('in');for(let i=0;i<8;i++){C.createInstance(child,'std.not/1','g'+i);C.addWire(child,'w'+i,source,C.ep('g'+i,'in'));source=C.ep('g'+i,'out');}C.addWire(child,'outwire',source,C.boundary('out'));modulePackage=await C.packageModule(child,'八级反相链','user.scale-eight');}
  for(let i=0;i<entry.size;i++){const id='n'+i;
   if(modulePackage)await C.placeModule(p,modulePackage,id,undefined,{exposePorts:false});else C.createInstance(p,entry.kind==='registers'?'std.dff/1':'std.not/1',id);
   C.addWire(p,'data'+i,from,C.ep(id,entry.kind==='registers'?'d':'in'));
   if(entry.kind==='registers'){C.addWire(p,'enable'+i,C.boundary('enable'),C.ep(id,'en'));C.addWire(p,'reset'+i,C.boundary('reset'),C.ep(id,'reset'));}
   from=C.ep(id,entry.kind==='registers'?'q':'out');view.positions[id]={x:260+(i%8)*240,y:70+Math.floor(i/8)*250};
  }
  C.addWire(p,'result',from,C.boundary('out'));view.positions['boundary:out']={x:2200,y:70+Math.floor((entry.size-1)/8)*250};
  return{project:await C.importProject(p),view,sources:{},lesson:null};
 }
 function workload(runtime,step){
  if(Object.hasOwn(runtime.inputs,'in'))runtime.setInput('in',step%7===0?'X':step%11===0?'Z':step%2);
  if(Object.hasOwn(runtime.inputs,'sense'))runtime.setInput('sense',(step*17)%126);
  if(Object.hasOwn(runtime.inputs,'dma_trigger')){runtime.setInput('dma_trigger',step%8===0?1:0);if(Object.hasOwn(runtime.inputs,'dma_count'))runtime.setInput('dma_count',4);}
  if(step===9)runtime.reset('warm');
 }
 async function measure(id,{ticks=24,signal,onProgress}={}){if(!Number.isInteger(ticks)||ticks<4||ticks>2000)throw Error('规模测试需要4—2000个采样点');
  const built=await build(id),a=new C.Runtime(built.project),b=new C.Runtime(built.project,{referenceSolver:true}),times={optimized:[],reference:[]};let compared=0;
  const now=()=>globalThis.performance?.now()??Date.now();
  for(let i=0;i<ticks;i++){if(signal?.aborted)return{cancelled:true,id,compared};for(const r of[a,b])workload(r,i);for(const[key,r]of[['optimized',a],['reference',b]]){const t=now();r.advance(1n,{force:true});times[key].push(now()-t);}if(C.canonicalStringify(a.snapshot())!==C.canonicalStringify(b.snapshot()))throw Error('参考与当前求解器在第 '+(i+1)+' 拍不一致');compared++;onProgress?.({id,compared,total:ticks});if(i%4===3)await new Promise(r=>setTimeout(r,0));}
  const percentile=(xs,p)=>[...xs].sort((a,b)=>a-b)[Math.min(xs.length-1,Math.floor(xs.length*p))],stats=xs=>({totalMs:xs.reduce((a,b)=>a+b,0),p50Ms:percentile(xs,.5),p95Ms:percentile(xs,.95),maxMs:Math.max(...xs)});
  return{id,engine:C.VERSION,projectHash:a.projectHash,equivalent:true,compared,nodes:a.compiled.nodes.size,wires:a.compiled.wires.length,containers:a.compiled.containers.size,snapshotBytes:new TextEncoder().encode(JSON.stringify(a.snapshot())).length,optimized:stats(times.optimized),reference:stats(times.reference),solver:copy(a.solverStats),limits:copy(C.LIMITS),note:'本机每拍测量；不代表物理芯片频率，也不代表所有同规模电路。原工作台未改变。'};
 }
 return{list,build,measure,workload};
});
