(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./circuit.js'):root.CircuitLab,typeof module==='object'&&module.exports?require('./testbench-v5.js'):root.LabTestbench);if(typeof module==='object'&&module.exports)module.exports=api;else root.RecorderV7=api;})(typeof globalThis!=='undefined'?globalThis:this,function(C,B){
 'use strict';
 const CAPACITY=8,MAGIC=0x5243,SETTLE_US=400,clone=x=>JSON.parse(JSON.stringify(x));
 const layout=Object.freeze({ram:'ram',words:64,magic:0,count:1,status:2,clearToken:3,lastSequence:4,capacity:5,records:16,sampleAddress:0x1000,controlAddress:0x1001});
 const startModes=[{id:'interface',name:'从接口开始',description:'保留输入设备、RAM 与公开接口，自己加入 CPU 和地址译码并接线。'},{id:'skeleton',name:'从骨架开始',description:'总线已接好，初始化程序会暂停；补上实际采集、去重和有限存储。'},{id:'reference',name:'运行参考作品',description:'真实 CPU 读取输入寄存器，提交最多 8 条 RAM 记录。'}];
 const stages=[{id:'sample',title:'写入第一条记录',description:'序号和数值穿过输入设备、CPU、总线，写入 RAM 后再提交。'},{id:'sequence',title:'变化输入与去重',description:'同序号不重复记录；不同序号允许相同数值，255 到 0 可继续。'},{id:'control',title:'暂停、恢复与清空',description:'暂停期间不提交，恢复只读取最新值；清空需程序确认。'},{id:'capacity',title:'有限缓冲',description:'8 条后停止追加并报告已满；不覆盖已有记录。'}];
 const init=`; RAM[1] 是提交点。先取消旧标记，最后发布新会话。
LDI R7, 0
STORE R7, 0
LDI R0, 0
LOAD R1, 0x1000
SHR R1, 8
STORE R0, 1
STORE R1, 4
LOAD R2, 0x1001
SHR R2, 8
STORE R2, 3
LDI R7, 8
STORE R7, 5
LDI R7, 2
STORE R7, 2
LDI R7, 0x5243
STORE R7, 0`;
 const polling=init+`
loop: LOAD R3, 0x1001
MOV R5, R3
SHR R5, 8
XOR R5, R2
JNZ R5, clear
MOV R5, R3
LDI R6, 1
AND R5, R6
JZ R5, paused
MOV R5, R0
SUBI R5, 8
JZ R5, full
LDI R7, 1
STORE R7, 2
LOAD R4, 0x1000
MOV R5, R4
SHR R5, 8
XOR R5, R1
JZ R5, loop
MOV R6, R0
ADDI R6, 16
STORE R4, [R6]
MOV R1, R4
SHR R1, 8
STORE R1, 4
ADDI R0, 1
STORE R0, 1
JMP loop
paused: LDI R7, 2
STORE R7, 2
JMP loop
full: LDI R7, 3
STORE R7, 2
JMP loop
clear: LDI R7, 0
STORE R7, 0
LDI R0, 0
STORE R0, 1
LOAD R1, 0x1000
SHR R1, 8
STORE R1, 4
MOV R2, R3
SHR R2, 8
LDI R7, 2
STORE R7, 2
STORE R2, 3
LDI R7, 0x5243
STORE R7, 0
JMP loop`;
 const subroutine=init+`
; 此方案每轮从 RAM 读取游标，以 CALL/RET 分开提交和清空。
loop: LOAD R3, 0x1001
LOAD R2, 3
MOV R5, R3
SHR R5, 8
XOR R5, R2
JNZ R5, request_clear
MOV R5, R3
LDI R6, 1
AND R5, R6
JZ R5, paused
LOAD R0, 1
MOV R5, R0
SUBI R5, 8
JZ R5, full
LDI R7, 1
STORE R7, 2
LOAD R4, 0x1000
LOAD R1, 4
MOV R5, R4
SHR R5, 8
XOR R5, R1
JZ R5, loop
CALL append
JMP loop
request_clear: CALL clear
JMP loop
paused: LDI R7, 2
STORE R7, 2
JMP loop
full: LDI R7, 3
STORE R7, 2
JMP loop
append: PUSH R6
MOV R6, R0
ADDI R6, 16
STORE R4, [R6]
MOV R1, R4
SHR R1, 8
STORE R1, 4
ADDI R0, 1
STORE R0, 1
POP R6
RET
clear: LDI R7, 0
STORE R7, 0
STORE R7, 1
LOAD R1, 0x1000
SHR R1, 8
STORE R1, 4
MOV R2, R3
SHR R2, 8
LDI R7, 2
STORE R7, 2
STORE R2, 3
LDI R7, 0x5243
STORE R7, 0
RET`;
 const programs=[{id:'polling',name:'寄存器游标轮询',description:'计数和上一序号保存在 CPU 寄存器中，按顺序提交 RAM。',source:polling},{id:'subroutine',name:'RAM 游标与子程序',description:'从 RAM 读取游标，用 CALL/RET 与栈拆分追加、清空过程。',source:subroutine}];
 const skeleton=init+'\n; 从这里补上采集循环。HALT 不会代替你完成记录。\nHALT';
 function error(code,message){const e=new Error(message);e.code=code;return e;}
 function expect(ok,message,code='E_RECORDER_INPUT'){if(!ok)throw error(code,message);}
 function word(v){return Number.isInteger(v)&&v>=0&&v<=65535;}
 async function build(mode='reference',options={}){
  expect(startModes.some(x=>x.id===mode),'起点必须为 interface / skeleton / reference');
  const program=programs.find(x=>x.id===(options.program||'polling'));expect(program,'未知记录程序');
  const p=await C.createProject('本地数据记录器 · '+startModes.find(x=>x.id===mode).name),view={positions:{}},sources={};
  const add=(model,id,label,x,y,params={})=>{const n=C.createInstance(p,model,id,label);Object.assign(n.parameters,params);view.positions[id]={x,y};return n;};
  const wire=(id,from,to)=>C.addWire(p,id,from,to),E=C.ep,D=C.boundary;
  C.addInput(p,'sample','样本：高8位序号 / 低8位数值',0,16);C.addInput(p,'control','控制：高8位清空编号 / bit0记录',1,16);C.addInput(p,'reset','复位（高有效）',0,1);
  add('std.bus-ram16/1','ram','记录 RAM · 64词',1060,90,{depth:64,contents:[],latency:1});
  for(const[id,label,y]of[['sample_device','样本输入寄存器',430],['control_device','运行与清空寄存器',730]]){
   add('std.register-device16/1',id,label,1060,y,{registers:JSON.stringify({registers:[{address:0,name:id==='sample_device'?'SAMPLE':'CONTROL',access:'ro',reset:0,source:'input'}]}),latency:1,outputAddress:0});
   wire(id+'_reset',D('reset'),E(id,'reset'));wire(id==='sample_device'?'sample_input':'control_input',D(id==='sample_device'?'sample':'control'),E(id,'input'));
  }
  wire('ram_reset',D('reset'),E('ram','reset'));
  if(mode!=='interface'){
   const source=mode==='skeleton'?skeleton:program.source;add('std.cpu16/1','cpu','记录程序 · CPU16',40,90,{source,busTimeout:256});sources['architecture:cpu']=source;
   add('std.bus-decoder16/1','memory_map','RAM / 输入设备地址译码',380,90,{base0:0,size0:64,base1:4096,size1:2});
   add('std.bus-decoder16/1','device_map','两个输入寄存器地址译码',710,490,{base0:0,size0:1,base1:1,size1:1});
   const bus=(name,master,mp,slave,sp='')=>{for(const k of['req','we','address','wdata'])wire(name+'_'+k,E(master,mp+k),E(slave,sp+k));for(const k of['rdata','ready','error'])wire(name+'_'+k,E(slave,sp+k),E(master,mp+k));};
   bus('cpu','cpu','','memory_map');bus('ram','memory_map','s0_','ram');bus('devices','memory_map','s1_','device_map');bus('sample_bus','device_map','s0_','sample_device');bus('control_bus','device_map','s1_','control_device');wire('cpu_reset',D('reset'),E('cpu','reset'));
  }
  return{project:await C.importProject(p),view,sources,lesson:'recorder-v7'};
 }
 function numeric(s){return s&&C.bits(s).every(x=>x===0||x===1)?Number(BigInt(s.value)):null;}
 function scoped(scope,id){return scope?scope.replace(/\/$/,'')+'/'+id:id;}
 function inspect(rt,scope=''){
  const all=rt.inspect(),path=scoped(scope,'ram'),ram=all.instances[path],cpu=all.instances[scoped(scope,'cpu')],memory=ram?.hardware?.memory;
  const out={available:!!ram,compatible:ram?.modelId==='std.bus-ram16/1'&&Array.isArray(memory)&&memory.length>=24,initialized:false,capacity:CAPACITY,count:0,status:0,statusName:'启动中',clearToken:null,lastSequence:null,records:[],faults:[],time:all.time,reason:''};
  for(const[path,n]of Object.entries(all.instances))if(!scope||path.startsWith(scope.replace(/\/$/,'')+'/'))if(n.hardware?.fault)out.faults.push({path,code:n.hardware.fault});
  if(!out.compatible){out.reason='缺少公开 RAM 角色 '+path+'（std.bus-ram16/1，至少24词），此任务的观察接口不兼容。';return out;}
  // A warm reset preserves physical RAM. A newly reset CPU has not invalidated the old marker yet.
  const booting=cpu?.hardware&&BigInt(cpu.hardware.retired||'0')<2n;
  if(!ram.powered||booting||memory[0]!==MAGIC){out.reason='固件尚未提交完整的会话标记。';return out;}
  const count=memory[1],valid=memory[5]===CAPACITY&&Number.isInteger(count)&&count>=0&&count<=CAPACITY&&[1,2,3].includes(memory[2])&&Number.isInteger(memory[3])&&memory[3]>=0&&memory[3]<=255&&Number.isInteger(memory[4])&&memory[4]>=0&&memory[4]<=255&&memory.slice(16,16+count).every(word);
  if(!valid){out.reason='会话元数据或已提交数据不符合公开 RAM 合同。';return out;}
  Object.assign(out,{initialized:true,count,status:memory[2],statusName:({1:'记录中',2:'已暂停',3:'缓冲已满'})[memory[2]],clearToken:memory[3],lastSequence:memory[4]});
  out.records=memory.slice(16,16+count).map((raw,index)=>({index,sequence:raw>>>8,value:raw&255,raw}));return out;
 }
 function inputId(rt,id,options={}){const name=options.inputMap?.[id]||(!options.scope?id:null);expect(name&&rt.project.circuit.inputs.some(p=>p.id===name&&p.width===(id==='reset'?1:16)),'封装实例请传入 placeModule 返回的 inputMap（boundaryMap）；输入接口不存在。','E_RECORDER_INTERFACE');return name;}
 function latest(rt,id){const pending=[...rt.events].reverse().find(e=>e.type==='input'&&e.id===id);return numeric(pending?.value||rt.inputs[id]);}
 function submit(rt,value,options={}){expect(Number.isInteger(value)&&value>=0&&value<=255,'样本数值必须为0—255整数');const id=inputId(rt,'sample',options),current=latest(rt,id);expect(current!==null,'当前样本输入未知，请显式恢复有效输入');const sequence=options.sequence??(((current>>>8)+1)&255);expect(Number.isInteger(sequence)&&sequence>=0&&sequence<=255,'序号必须为0—255整数');const raw=(sequence<<8)|value;return{sequence,value,raw,event:rt.setInput(id,raw)};}
 function setRunning(rt,running,options={}){expect(typeof running==='boolean','记录开关必须为布尔值');const id=inputId(rt,'control',options),v=latest(rt,id);expect(v!==null,'当前控制输入未知');const raw=(v&0xff00)|(running?1:0);return{running,raw,event:rt.setInput(id,raw)};}
 function clear(rt,options={}){const id=inputId(rt,'control',options),v=latest(rt,id);expect(v!==null,'当前控制输入未知');const clearToken=((v>>>8)+1)&255,raw=clearToken<<8;return{clearToken,raw,event:rt.setInput(id,raw)};}
 function scenario(id){
  const events=[],checks=[];const input=(at,target,value)=>events.push({at:String(at),kind:'input',target,value});
  const check=(at,index,value,label)=>checks.push({id:id+'_'+checks.length,label,at:String(at),kind:'state',target:'ram',path:['hardware','memory',index],op:'eq',value});
  check(400,0,MAGIC,'固件完成会话初始化');check(400,1,0,'初始没有已提交记录');check(400,5,8,'容量为8条');
  if(id==='sample'){input(401,'sample',0x0125);check(800,16,0x0125,'第一条保存真实序号和数值');check(800,1,1,'数据写入后提交计数');return{events,checks,duration:800};}
  if(id==='sequence'){
   for(const[at,raw,count]of[[401,0x0125,1],[801,0x0177,1],[1201,0x0225,2],[1601,0xff10,3],[2001,0x0011,4]]){input(at,'sample',raw);check(at+399,1,count,'变化序号与重复序号的实际提交数');}
   [0x0125,0x0225,0xff10,0x0011].forEach((v,i)=>check(2400,16+i,v,'保留顺序，包括序号回绕 '+i));return{events,checks,duration:2400};
  }
  if(id==='control'){
   input(401,'sample',0x0119);check(800,1,1,'暂停前已有一条记录');input(801,'control',0);check(1200,2,2,'程序确认暂停');input(1201,'sample',0x021a);input(1601,'sample',0x031b);check(2000,1,1,'暂停期间输入不追加');input(2001,'control',1);check(2400,1,2,'恢复仅追加最新输入');check(2400,17,0x031b,'恢复读取实际最新样本');input(2401,'control',256);check(2800,3,1,'程序确认新的清空编号');check(2800,1,0,'清空后提交计数为零');check(2800,2,2,'清空保持暂停');input(2801,'sample',0x041c);check(3200,1,0,'清空后仍需恢复');input(3201,'control',257);check(3600,1,1,'恢复后重新提交');check(3600,16,0x041c,'新会话记录实际样本');return{events,checks,duration:3600};
  }
  expect(id==='capacity','未知阶段');for(let i=1;i<=9;i++){input(401+(i-1)*400,'sample',(i<<8)|(20+i));check(800+(i-1)*400,1,Math.min(i,8),'第'+i+'次输入后的有限提交数');}for(let i=0;i<8;i++)check(4000,16+i,((i+1)<<8)|(21+i),'已满后不覆盖第'+(i+1)+'条');check(4000,2,3,'容量到达后报告已满');return{events,checks,duration:4000};
 }
 function contract(stageId='all'){
  expect(stageId==='all'||stages.some(s=>s.id===stageId),'未知阶段');const ids=stageId==='all'?stages.map(s=>s.id):[stageId],out={schema:B.SCHEMA,seed:7001,duration:'0',events:[],random:[],checks:[],invariants:[]};let offset=0;
  for(const id of ids){if(offset){for(const[target,value]of[['sample',0],['control',1],['reset',0]])out.events.push({at:String(offset+1),kind:'input',target,value});out.events.push({at:String(offset+1),kind:'reset',target:'all',mode:'warm'});}const s=scenario(id);out.events.push(...s.events.map(e=>({...e,at:String(Number(e.at)+offset)})));out.checks.push(...s.checks.map(c=>({...c,at:String(Number(c.at)+offset)})));offset+=s.duration+200;}out.duration=String(offset-200);return B.validate(out);
 }
 function interfaceError(workspace){const p=workspace?.project||workspace,ram=p?.circuit?.instances?.find(n=>n.id==='ram');if(!ram)return '缺少任务公开 RAM 角色 ram；如需改名，需同时修改测试合同。';const d=p.definitions?.find(d=>d.stableId===ram.definition?.stableId&&d.revision===ram.definition?.revision&&d.contentHash===ram.definition?.contentHash);if(d?.model?.id!=='std.bus-ram16/1'||ram.parameters.depth<24)return '公开 RAM 角色需要 std.bus-ram16/1 且至少24词，当前观察接口不兼容。';for(const[id,width]of[['sample',16],['control',16],['reset',1]])if(!p.circuit.inputs.some(p=>p.id===id&&p.width===width))return '缺少公开输入 '+id+' / '+width+'位；当前任务接口不兼容。';return null;}
 async function verify(workspace,options={}){const stageId=options.stageId||'all',problem=interfaceError(workspace);if(problem)return{ok:false,cancelled:false,checks:[],firstFailure:null,error:{code:'E_RECORDER_INTERFACE',message:problem},stageId,stats:{time:'0',work:0,advances:0,wallMs:0}};const result=await B.run(workspace,contract(stageId),{signal:options.signal,onProgress:options.onProgress});return{...result,stageId};}
 return{VERSION:'0.7.0',CAPACITY,MAGIC,SETTLE_US,layout,list:startModes,startModes,programs,stages,build,inspect,submit,setRunning,clear,contract,spec:contract,verify};
});
