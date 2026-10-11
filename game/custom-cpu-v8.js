(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./custom-architecture-v6.js'):root.CustomArchitectureV6);if(typeof module==='object'&&module.exports)module.exports=api;else root.CustomCpuV8=api;})(typeof globalThis!=='undefined'?globalThis:this,function(Base){
 'use strict';
 const CPU='std.custom-cpu16/2',ISA_SCHEMA='silicon-lab.isa/2',copy=x=>JSON.parse(JSON.stringify(x));
 const ok=(v,m)=>{if(!v)throw Error(m);},integer=(v,min=0,max=65535)=>Number.isInteger(v)&&v>=min&&v<=max,word=v=>integer(v),stamp=v=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v);
 const IRQ_OPS=['irq_enable','irq_disable','iret'],EXTRA=['ie','irqFrame','irqBlocked','irqAck','irqCount'];
 const IRQ_FAULTS=['F_IRQ_UNKNOWN','F_IRQ_VECTOR_UNKNOWN','F_IRQ_VECTOR','F_IRET','F_IRQ_RETURN'];
 function shape(o,keys){ok(o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join('|')===keys.slice().sort().join('|'),'字段不符合约定：'+keys.join(', '));}
 function parse(raw){if(typeof raw==='string'){ok(raw.length<=60000,'指令集文本最多60000字符');try{return JSON.parse(raw);}catch{throw Error('指令集必须是有效 JSON');}}return copy(raw);}
 // Reuse the frozen v1 assembler/operand validator, not another CPU execution engine.
 // New IRQ operations become NOP only in this validation/encoding projection.
 function projection(isa){const p=copy(isa);p.schema=Base.ISA_SCHEMA;for(const i of p.instructions)for(let j=0;j<i.steps.length;j++)if(IRQ_OPS.includes(i.steps[j].op))i.steps[j]={op:'nop'};return p;}
 function validateISA(raw){const isa=parse(raw);shape(isa,['schema','name','registerCount','instructions']);ok(isa.schema===ISA_SCHEMA,'此模型只接受 silicon-lab.isa/2；旧 ISA 不会自动升级');ok(Array.isArray(isa.instructions),'指令集需要 instructions 数组');
  for(const ins of isa.instructions){ok(ins&&Array.isArray(ins.steps),'指令需要微操作数组');for(let index=0;index<ins.steps.length;index++){const op=ins.steps[index];if(IRQ_OPS.includes(op?.op)){shape(op,['op']);if(op.op==='iret')ok(index===ins.steps.length-1,'iret 必须是最后一个微操作');}}}
  Base.validateISA(projection(isa));return isa;
 }
 const memo=new Map();function cached(key,fn){if(memo.has(key))return memo.get(key);const value=fn();if(memo.size>=48)memo.delete(memo.keys().next().value);memo.set(key,value);return value;}
 function profile(raw){const text=typeof raw==='string'?raw:JSON.stringify(raw);return cached('isa:'+text,()=>validateISA(text));}
 function assemble(isa,source){try{return Base.assemble(projection(profile(isa)),source);}catch(e){return{ok:false,words:[],sourceMap:[],labels:{},error:e.message};}}
 function disassemble(isa,words){try{return Base.disassemble(projection(profile(isa)),words);}catch(e){return{ok:false,source:'',error:e.message};}}
 function decode(isa,raw){return Base.decode(profile(isa),raw);}
 function image(p){return cached('program:'+p.isa+'\n'+p.source,()=>{const a=assemble(p.isa,p.source);ok(a.ok,a.error);return a;});}
 const defaultProfile=JSON.parse(Base.DEFAULT_ISA);defaultProfile.schema=ISA_SCHEMA;defaultProfile.name='我的中断 CPU · 单层现场';
 const instruction=(mnemonic,opcode,form,steps)=>defaultProfile.instructions.push({mnemonic,opcode,form,steps});
 for(const[name,code,kind]of[['SUB',7,'sub'],['AND',8,'and'],['OR',9,'or'],['MUL',14,'mul']])instruction(name,code,'rr',[{op:'alu',kind,dst:'rd',a:'rd',b:'rs'}]);
 for(const[name,code,kind]of[['ADDI',10,'add'],['SUBI',11,'sub'],['SHL',12,'shl'],['SHR',13,'shr']])instruction(name,code,'ri',[{op:'alu',kind,dst:'rd',a:'rd',b:'imm'}]);
 instruction('LDI',15,'ri',[{op:'set',dst:'rd',src:'imm'}]);
 instruction('LDR',18,'ri',[{op:'read',address:'imm',dst:'rd'}]);instruction('STR',19,'ri',[{op:'write',address:'imm',data:'rd'}]);
 instruction('JNZ',34,'rt',[{op:'jump',target:'imm',when:'nonzero',test:'rd'}]);instruction('JMP',35,'target',[{op:'jump',target:'imm',when:'always'}]);instruction('JZ',36,'rt',[{op:'jump',target:'imm',when:'zero',test:'rd'}]);instruction('RET',52,'none',[{op:'ret'}]);
 instruction('EI',64,'none',[{op:'irq_enable'}]);instruction('DI',65,'none',[{op:'irq_disable'}]);instruction('IRET',66,'none',[{op:'iret'}]);
 const DEFAULT_ISA=JSON.stringify(defaultProfile,null,2),model=copy(Base.models[Base.CPU]);
 Object.assign(model,{modelId:CPU,name:'自定义 ISA · 带中断 CPU16',description:'完整可配置微操作与单层中断现场，所有数据访存经过实际外部总线'});
 const pin=(id,direction,width=1)=>({id,name:id.toUpperCase(),direction,kind:'digital',width});model.ports.push(pin('irq','in'),pin('vector','in',16),pin('irq_ack','out'),pin('ie','out'),pin('in_irq','out'));
 model.parameters.find(p=>p.id==='isa').default=DEFAULT_ISA;model.dependencies=model.ports.filter(p=>p.direction==='out').map(p=>({from:'reset',to:p.id}));
 const models={[CPU]:model},list=[{id:CPU,name:model.name,description:'可修改指令与微操作；指令边界接受一个外部中断，不支持嵌套',category:'自定义架构',width:16}];
 const supported=id=>id===CPU;
 function defaultParameters(id=CPU){ok(supported(id),'未知模型');return Object.fromEntries(model.parameters.map(p=>[p.id,copy(p.default)]));}
 function validateParameters(id,p){ok(supported(id),'未知模型');shape(p,['isa','source','busTimeout']);ok(typeof p.isa==='string'&&p.isa.length<=60000&&typeof p.source==='string'&&p.source.length<=60000&&integer(p.busTimeout,1,65535),'CPU 参数或预算无效');profile(p.isa);image(p);return p;}
 function fresh(id,p){validateParameters(id,p);return{pc:0,ir:0,micro:0,tmp:0,regs:Array(profile(p.isa).registerCount).fill(0),stack:[],phase:'fetch',pending:null,fault:null,faultAt:null,retired:'0',ticks:'0',access:null,ie:false,irqFrame:null,irqBlocked:false,irqAck:0,irqCount:'0'};}
 function reset(id,p){return fresh(id,p);}
 const known=Base.known;
 function output(id,name,p,s,read,api){ok(supported(id),'未知模型');const sig=v=>api.signal(v,model.ports.find(x=>x.id===name).width),rst=known(read('reset'),api);if(name==='fault')return sig(s.fault||rst===null?1:0);if(/^r\d+$/.test(name))return sig(s.regs[Number(name.slice(1))]||0);const a=s.pending,active=rst===0&&!s.fault;return sig(({req:active&&s.phase==='bus'?1:0,we:a?.write?1:0,address:a?.address||0,wdata:a?.data||0,pc:s.pc,ir:s.ir,micro:s.micro,sp:s.stack.length,halted:['halted','fault'].includes(s.phase)?1:0,irq_ack:active?s.irqAck:0,ie:active&&s.ie?1:0,in_irq:active&&s.irqFrame?1:0})[name]);}
 const FAULTS=['F_RESET_UNKNOWN','F_PC','F_ENCODING','F_STACK_OVERFLOW','F_STACK_UNDERFLOW','F_RETURN','F_BUS_UNKNOWN','F_BUS_ERROR','F_BUS_TIMEOUT',...IRQ_FAULTS];
 function fail(s,code){s.fault=code;s.faultAt={pc:s.pc,micro:s.micro};s.phase='fault';s.pending=null;s.irqAck=0;return s;}
 function validFrame(f,p){const isa=profile(p.isa),program=image(p);shape(f,['pc','ir','tmp','regs','stack','ie','vector']);ok(integer(f.pc,0,program.words.length-1)&&integer(f.vector,0,program.words.length-1)&&integer(f.ir,0,4294967295)&&program.words.includes(f.ir)&&word(f.tmp),'中断返回地址或指令现场无效');ok(Array.isArray(f.regs)&&f.regs.length===isa.registerCount&&f.regs.every(word)&&Array.isArray(f.stack)&&f.stack.length<=64&&f.stack.every(word)&&f.ie===true,'中断寄存器、栈或屏蔽现场无效');return f;}
 function sample(id,p,state,read,api){ok(supported(id),'未知模型');const s=copy(state),n=k=>known(read(k),api),rst=n('reset');s.irqAck=0;if(rst===1)return fresh(CPU,p);if(rst===null)return fail(s,'F_RESET_UNKNOWN');if(['fault','halted'].includes(s.phase))return s;
  s.ticks=String(BigInt(s.ticks)+1n);const irq=n('irq');if(irq===0)s.irqBlocked=false;const isa=profile(p.isa),program=image(p),retire=target=>{s.pc=target;s.micro=0;s.phase='fetch';s.retired=String(BigInt(s.retired)+1n);},finish=d=>{s.micro++;s.phase='micro';if(s.micro>=d.ins.steps.length)retire(s.pc+1);};
  if(s.phase==='fetch'){
   if(s.pc>=program.words.length)return fail(s,'F_PC');
   if(s.ie&&s.irqFrame===null&&!s.irqBlocked){if(irq===null)return fail(s,'F_IRQ_UNKNOWN');if(irq===1){const vector=n('vector');if(vector===null)return fail(s,'F_IRQ_VECTOR_UNKNOWN');if(vector>=program.words.length)return fail(s,'F_IRQ_VECTOR');s.irqFrame={pc:s.pc,ir:s.ir,tmp:s.tmp,regs:s.regs.slice(),stack:s.stack.slice(),ie:s.ie,vector};s.ie=false;s.irqBlocked=true;s.irqAck=1;s.irqCount=String(BigInt(s.irqCount)+1n);s.pc=vector;s.ir=0;s.micro=0;s.tmp=0;s.stack=[];return s;}}
   s.ir=program.words[s.pc];s.micro=0;s.tmp=0;s.phase='micro';return s;
  }
  let d;try{d=Base.decode(isa,s.ir);}catch{return fail(s,'F_ENCODING');}const micro=d.ins.steps[s.micro];if(!micro)return fail(s,'F_ENCODING');
  const src=v=>typeof v==='number'?v:v==='imm'?d.imm:v==='tmp'?s.tmp:s.regs[v==='rd'?d.rd:d.rs],put=(dst,value)=>{if(dst==='tmp')s.tmp=value&65535;else s.regs[dst==='rd'?d.rd:d.rs]=value&65535;};
  if(s.phase==='bus'){const ready=n('ready');if(ready===null)return fail(s,'F_BUS_UNKNOWN');if(ready===1){const error=n('error');if(error===null)return fail(s,'F_BUS_UNKNOWN');if(error===1)return fail(s,'F_BUS_ERROR');const value=s.pending.write?s.pending.data:n('rdata');if(value===null)return fail(s,'F_BUS_UNKNOWN');if(!s.pending.write)put(s.pending.dst,value);s.access={pc:s.pc,micro:s.micro,address:s.pending.address,write:s.pending.write,value};s.pending=null;s.phase='gap';return s;}if(++s.pending.waited>=p.busTimeout)return fail(s,'F_BUS_TIMEOUT');return s;}
  if(s.phase==='gap'){finish(d);return s;}
  switch(micro.op){
   case'nop':break;case'set':put(micro.dst,src(micro.src));break;
   case'alu':{const a=src(micro.a),b=src(micro.b),value={add:()=>a+b,sub:()=>a-b,mul:()=>a*b,and:()=>a&b,or:()=>a|b,xor:()=>a^b,shl:()=>a<<(b&15),shr:()=>a>>>(b&15)}[micro.kind]();put(micro.dst,value);break;}
   case'read':case'write':s.pending={address:src(micro.address),write:micro.op==='write',data:micro.op==='write'?src(micro.data):0,dst:micro.op==='read'?micro.dst:null,waited:0};s.phase='bus';return s;
   case'push':if(s.stack.length>=64)return fail(s,'F_STACK_OVERFLOW');s.stack.push(src(micro.src));break;
   case'pop':if(!s.stack.length)return fail(s,'F_STACK_UNDERFLOW');put(micro.dst,s.stack.pop());break;
   case'call':{const target=src(micro.target);if(target>=program.words.length||s.pc+1>=program.words.length)return fail(s,'F_RETURN');if(s.stack.length>=64)return fail(s,'F_STACK_OVERFLOW');s.stack.push(s.pc+1);retire(target);return s;}
   case'ret':{if(!s.stack.length)return fail(s,'F_STACK_UNDERFLOW');const target=s.stack.at(-1);if(target>=program.words.length)return fail(s,'F_RETURN');s.stack.pop();retire(target);return s;}
   case'jump':{const take=micro.when==='always'||(src(micro.test)===0)===(micro.when==='zero');if(take){const target=src(micro.target);if(target>=program.words.length)return fail(s,'F_PC');retire(target);return s;}break;}
   case'irq_enable':s.ie=true;break;case'irq_disable':s.ie=false;break;
   case'iret':{if(!s.irqFrame)return fail(s,'F_IRET');const frame=s.irqFrame;try{validFrame(frame,p);}catch{return fail(s,'F_IRQ_RETURN');}s.regs=frame.regs.slice();s.stack=frame.stack.slice();s.tmp=frame.tmp;s.ir=frame.ir;s.ie=frame.ie;s.irqFrame=null;retire(frame.pc);return s;}
   case'halt':s.phase='halted';s.retired=String(BigInt(s.retired)+1n);return s;
   default:return fail(s,'F_ENCODING');
  }finish(d);return s;
 }
 function validateState(id,p,s){validateParameters(id,p);shape(s,Object.keys(fresh(id,p)));ok(s.fault===null||FAULTS.includes(s.fault),'未知故障代码');const isa=profile(p.isa),program=image(p);
  ok(integer(s.pc,0,program.words.length)&&integer(s.ir,0,4294967295)&&integer(s.micro,0,7)&&word(s.tmp)&&Array.isArray(s.regs)&&s.regs.length===isa.registerCount&&s.regs.every(word)&&Array.isArray(s.stack)&&s.stack.length<=64&&s.stack.every(word),'CPU 寄存器或公共栈状态无效');
  ok(['fetch','micro','bus','gap','halted','fault'].includes(s.phase)&&stamp(s.retired)&&stamp(s.ticks)&&stamp(s.irqCount),'CPU 阶段或计数无效');ok(BigInt(s.retired)<=BigInt(s.ticks)&&BigInt(s.irqCount)<=BigInt(s.ticks),'CPU 退休/中断次数超出实际拍数');ok(typeof s.ie==='boolean'&&typeof s.irqBlocked==='boolean'&&integer(s.irqAck,0,1),'中断控制字段无效');
  ok((s.phase==='fault')===(s.fault!==null)&&(s.fault!==null)===(s.faultAt!==null),'故障现场不一致');if(s.faultAt!==null){shape(s.faultAt,['pc','micro']);ok(s.faultAt.pc===s.pc&&s.faultAt.micro===s.micro,'故障定位无效');}ok((s.phase==='bus')===(s.pending!==null),'总线阶段与在途请求不一致');
  let d;if(!['fetch','fault'].includes(s.phase)){ok(s.pc<program.words.length&&s.ir===program.words[s.pc],'IR 与生效程序不一致');d=Base.decode(isa,s.ir);ok(s.micro<d.ins.steps.length,'微操作位置越界');if(s.phase==='halted')ok(d.ins.steps[s.micro].op==='halt','停止现场不是 halt');if(s.phase==='gap')ok(['read','write'].includes(d.ins.steps[s.micro].op),'完成间隔不是总线微操作');}
  if(s.phase==='fetch')ok(s.micro===0,'取指边界微操作位置必须为0');
  if(s.pending!==null){shape(s.pending,['address','write','data','dst','waited']);const a=s.pending,m=d.ins.steps[s.micro],src=v=>typeof v==='number'?v:v==='imm'?d.imm:v==='tmp'?s.tmp:s.regs[v==='rd'?d.rd:d.rs];ok(['read','write'].includes(m.op)&&word(a.address)&&word(a.data)&&typeof a.write==='boolean'&&integer(a.waited,0,p.busTimeout-1),'在途请求字段无效');ok(a.write===(m.op==='write')&&a.address===src(m.address)&&a.data===(a.write?src(m.data):0)&&a.dst===(a.write?null:m.dst),'在途请求与真实微操作不一致');}
  if(s.access!==null){shape(s.access,['pc','micro','address','write','value']);ok(integer(s.access.pc,0,program.words.length-1)&&integer(s.access.micro,0,7)&&word(s.access.address)&&word(s.access.value)&&typeof s.access.write==='boolean','访存记录无效');const accessed=Base.decode(isa,program.words[s.access.pc]).ins.steps[s.access.micro];ok(accessed&&accessed.op===(s.access.write?'write':'read'),'访存观察不对应程序中的真实访存');}
  if(s.irqFrame!==null){validFrame(s.irqFrame,p);ok(BigInt(s.irqCount)>0n,'中断现场存在但没有进入记录');}
  if(s.irqAck){ok(s.irqFrame!==null&&s.phase==='fetch'&&!s.ie&&s.irqBlocked&&s.pc===s.irqFrame.vector&&s.ir===0&&s.tmp===0&&s.stack.length===0,'中断确认只允许在成功进入的一拍');}
  if(s.fault)ok(s.irqAck===0,'故障不能发出中断确认');return s;
 }
 const IRQ_SOURCE='LIT R0,1\nEI\nmain: JUMP main\nhandler: LIT R0,42\nLIT R1,0\nSTORE R0,R1\nIRET';
 const renamed=copy(defaultProfile);renamed.name='我定义的中断指令';Object.assign(renamed.instructions.find(i=>i.mnemonic==='EI'),{mnemonic:'ALLOW',opcode:112});Object.assign(renamed.instructions.find(i=>i.mnemonic==='IRET'),{mnemonic:'BACK',opcode:114});
 const SAMPLES=[{id:'custom-irq',name:'自定义 CPU · 保存与返回',description:'给 IRQ 一个真实请求，处理程序写 RAM[0]=42 后返回，R0 恢复1；单层、不嵌套。',isa:DEFAULT_ISA,source:IRQ_SOURCE,vector:3},{id:'custom-irq-renamed',name:'我的 ALLOW / BACK 指令',description:'改变中断助记符和机器操作码，仍由真实微操作进入和恢复。',isa:JSON.stringify(renamed,null,2),source:IRQ_SOURCE.replace('EI','ALLOW').replace('IRET','BACK'),vector:3}];
 function circuit(){return typeof module==='object'&&module.exports?require('./circuit.js'):globalThis.CircuitLab;}
 async function build(id='custom-irq'){const item=SAMPLES.find(x=>x.id===id);ok(item,'未知中断 CPU 示例');const C=circuit(),p=await C.createProject(item.name),view={positions:{}},cpu=C.createInstance(p,CPU,'custom_cpu');Object.assign(cpu.parameters,{isa:item.isa,source:item.source});C.createInstance(p,'std.busram16/1','ram');const E=C.ep,B=C.boundary,w=(id,from,to)=>C.addWire(p,id,from,to);for(const k of['req','we','address','wdata'])w('bus_'+k,E('custom_cpu',k),E('ram',k));for(const k of['rdata','ready','error'])w('bus_'+k,E('ram',k),E('custom_cpu',k));for(const[id,name,value,width]of[['reset','复位',0,1],['irq','中断请求',0,1],['vector','中断向量（指令索引）',item.vector,16]]){C.addInput(p,id,name,value,width);w('input_'+id,B(id),E('custom_cpu',id));}w('ram_reset',B('reset'),E('ram','reset'));for(const[id,width]of[['irq_ack',1],['ie',1],['in_irq',1],['r0',16],['fault',1]]){C.addOutput(p,id,id,width);w('output_'+id,E('custom_cpu',id),B(id));}view.positions.custom_cpu={x:380,y:80};view.positions.ram={x:820,y:80};return{project:await C.importProject(p),view,sources:{'customarch2:custom_cpu':item.source},lesson:null};}
 const table=(headers,rows)=>({headers,rows}),section=(id,title,paragraphs,rest={})=>({id,title,paragraphs,...rest});
 const portHints={[CPU]:{...copy(Base.manuals.portHints[Base.CPU]),irq:'1 请求中断；仅已使能、非处理程序内且已重新武装的完整指令边界接受。接收后需至少一拍0才允许下一次请求。',vector:'16位无符号程序指令索引，仅接受IRQ的同一拍采样；不是字地址、不是中断编号。',irq_ack:'成功进入中断时输出一拍1。未知/非法向量、屏蔽、总线等待或ISR内均不确认。',ie:'全局中断使能观察。处理程序内即使为1，本模型仍禁止嵌套。',in_irq:'当前是否保存了一份中断返回现场；最大1层。'}};
 const defaultRows=defaultProfile.instructions.map(i=>[i.mnemonic,'0x'+i.opcode.toString(16).padStart(2,'0'),i.form,JSON.stringify(i.steps)]);
 const baseEntry=Base.manuals.entries.find(e=>e.appliesTo.includes(Base.CPU));
 const manuals={portHints,entries:[{id:'custom-cpu16-v8',title:'自定义 ISA · 带单层中断 CPU16',category:'自定义架构',summary:'保留可配置指令和实际外部总线，增加可保存、可返回的一个中断现场。明确不支持嵌套。',appliesTo:[CPU],sections:[
  section('architecture','架构与可见状态',['16 位数据与外部字地址，1—16 个通用寄存器；32 位机器指令、最多1024条。没有内置数据 RAM，read/write 必须连接实际外部总线。PC 是指令索引。每拍为1虚拟微秒。','取指后每拍执行一个微操作；总线微操作可能等待多拍，并保留应答后低请求间隔。同一条指令已完成的微操作和已提交外部写入不会因为后续故障撤销。','PC、IR、micro、TMP、寄存器、64词公共调用栈与故障位置保留原有观察方式。新增 ie、irqFrame、irqBlocked、irqAck、irqCount；irqFrame 最多1份，没有隐藏嵌套。']),
  section('schema','ISA2 数据合同与兼容',['参数仍为 isa、source、busTimeout。isa/source 各最多60000字符；busTimeout 为1—65535拍，默认256。ISA根字段恰好为 schema/name/registerCount/instructions，新schema为 silicon-lab.isa/2。不会自动修改旧/1模型或旧schema。','1—64条指令；每条1—8个微操作，总数不超过512。全部旧操作数格式和原微操作保留。玩家可以修改中断指令的名字、操作码和微操作编排。','指令字段为 mnemonic/opcode/form/steps。机器编码保持 opcode[31:24] | rd[23:20] | rs[19:16] | imm[15:0]，未使用位必须为0。没有任意脚本执行。']),
  ...baseEntry.sections.filter(s=>['operands'].includes(s.id)).map(copy),
  section('forms','完整操作数格式',[],{table:table(['form','汇编形式','字段'],[['none','无操作数','全部操作数字段为0'],['r','Rn','rd'],['rr','Rn,Rm','rd/rs'],['ri','Rn,0..65535','rd/imm'],['target','标签或指令索引','imm，必须指向程序内指令'],['rt','Rn,标签或指令索引','rd/imm']])}),
  section('microops','所有微操作',['源为0—65535常量、tmp、当前格式允许的rd/rs/imm；目标为tmp或当前格式允许的rd/rs。jump/call/ret/halt/iret必须位于指令末尾。没有隐式标志寄存器，条件跳转直接查看源值。'],{table:table(['op','附加字段','效果'],[['nop','无','一拍空操作'],['set','dst,src','复制16位源到目标'],['alu','kind,dst,a,b','add/sub/mul/and/or/xor/shl/shr；低16位，移位量低4位'],['read','address,dst','外部总线读，成功完成后修改目标'],['write','address,data','外部总线写，等待真实应答'],['push / pop','src / dst','64词公共栈压入/弹出'],['jump','target,when；条件式另加test','always/zero/nonzero，目标为指令索引'],['call / ret','target / 无','公共栈保存返回地址/检查并返回'],['halt','无','停止CPU，不响应中断唤醒'],['irq_enable','无','设置ie=true，仍要等完整指令退休边界'],['irq_disable','无','设置ie=false，屏蔽后续进入'],['iret','无','检查单份现场并原子恢复；没有现场则故障']])}),
  section('default','默认指令集（同源生成）',['以下每行来自实际默认ISA。LOAD/STORE 的第二操作数是地址寄存器；LDR/STR 的第二操作数是直接字地址。旧基础助记符保留，新增兼容别名方便迁移。'],{table:table(['助记符','操作码','格式','实际微操作'],defaultRows)}),
  section('irq','中断入口、屏蔽与单层返回',['复位后ie=false。EI的微操作只设置使能；只有phase=fetch，也就是上一整条指令全部微操作完成之后，才会接受新的IRQ。bus等待、完成间隔、指令内部微操作均不会被打断。','有效入口同时要求：ie=true、没有irqFrame、请求已武装且irq=1、vector全部已知并指向程序中的指令。入口独占一拍，不退休普通指令；irq_ack拉高一拍，然后开始取处理程序指令。','入口保存下一PC、上次IR、TMP、所有通用寄存器、完整公共栈和旧IE。处理程序初始保留寄存器值，TMP/IR清0，公共栈从空开始；独立现场不占用64词调用栈容量。入口将IE清0。','本版不嵌套：处理程序内即使执行EI，也不会再保存第二份现场。IRET恢复全部保存内容并返回；需要留下的处理结果应写外部RAM或设备。处理程序自己的临时栈和寄存器修改随后被恢复值替代。','irq_ack之后必须看到irq=0至少一拍才重新武装；持续高电平不会重复进入。屏蔽或处理程序运行期间出现并保持的请求可在之后进入；短脉冲若没有外部控制器锁存则可能错过。']),
  section('wiring','与外部中断控制器连接',['std.irq4/1输出的是2位irq_id，本CPU输入vector是16位指令索引，两者不能直接连接。用真实多路选择器和向量常量完成译码；irq接irq，irq_ack回控制器ack，当前irq_id回ack_id。','req/we/address/wdata为主机输出，rdata/ready/error为从机输入。请求与字段锁定到真实应答，ready=0忽略error和rdata，ready=1检查error和有效读值。未知应答、设备拒绝、超时各自故障。','reset=1优先清CPU及中断现场并撤请求；未知reset立即屏蔽req与ack，下一拍故障。冷暖复位均清CPU现场，但外部RAM是否保留由RAM模型规定。暂停冻结全部拍数。']),
  section('faults','故障、快照与边界',['故障不发中断确认，保持精确PC与微操作位置，取消未完成的CPU请求。不会承诺撤销外部设备已经提交的事务。','快照保留全部原CPU状态和单层现场。导入验证寄存器/栈预算、实际机器字、在途微操作、返回位置和确认阶段；拒绝非法现场，不修补成可运行状态。','IRQ在被屏蔽、处理程序中或尚未重新武装时不会采样vector；这些状态的未知vector不被虚构成0。只有可接受新中断的完整边界，未知IRQ才是故障。'],{table:table(['故障','含义'],[['F_IRQ_UNKNOWN','可接受中断的边界IRQ为X/Z'],['F_IRQ_VECTOR_UNKNOWN','请求有效但向量存在未知位'],['F_IRQ_VECTOR','向量超出程序镜像'],['F_IRET','没有已保存现场时返回'],['F_IRQ_RETURN','已有现场的返回内容非法；严格快照导入也会拒绝'],['F_PC / F_ENCODING','取指、实际跳转或微操作/编码非法'],['F_STACK_OVERFLOW / F_STACK_UNDERFLOW / F_RETURN','公共栈边界或CALL/RET返回非法'],['F_BUS_UNKNOWN / F_BUS_ERROR / F_BUS_TIMEOUT','外部握手未知、拒绝或等待超限'],['F_RESET_UNKNOWN','复位控制未知']])}),
  section('example','最小可运行中断程序',['按示例连接外部RAM，reset=0、irq=0、vector=3。运行到主循环后让irq=1；处理程序真实写RAM[0]=42，再IRET。主程序R0恢复1，栈恢复为空。观察irq_ack后把irq拉低才能再次请求。'],{code:IRQ_SOURCE,codeTitle:'默认ISA2：真实IRQ进入、写RAM、返回',codeTarget:'custom-isa-v8'}),
  section('limits','可信抽象与版本',['这是功能级教学CPU，最多一层中断，不宣称ARM/RISC-V兼容或物理时序。微操作解释器有固定预算，不执行任意JavaScript。','旧std.custom-cpu16/1仍使用silicon-lab.isa/1且没有中断；两种模型可以同时保存在同一工程里。更换模型是显式创作选择，不是自动修改旧芯片身份。'])
 ]}]};
 return{CPU,ISA_SCHEMA,models,list,supported,defaultParameters,validateParameters,fresh,reset,output,sample,validateState,known,validateISA,assemble,disassemble,decode,encode:Base.encode,DEFAULT_ISA,defaultProfile:()=>copy(defaultProfile),SAMPLES,build,manuals};
});
