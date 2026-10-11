(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ArchitectureV5=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const CPU='std.cpu16/1',RAM='std.busram16/1',FSM='std.fsm16/1',DEV='std.register-device16/1';
  const clone=x=>JSON.parse(JSON.stringify(x)),int=(v,min=0,max=65535)=>Number.isInteger(v)&&v>=min&&v<=max,word=v=>int(v),decimal=v=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v);
  const assert=(ok,message)=>{if(!ok)throw new Error(message);},shape=(o,keys)=>assert(o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join('|')===keys.slice().sort().join('|'),'字段不符合约定：'+keys.join(', '));
  const models={},list=[],port=(id,direction,width=1)=>({id,name:id.toUpperCase(),direction,kind:'digital',width});
  const integer=(id,min,max,value)=>({id,type:'integer',min,max,default:value}),text=(id,value,maxLength=60000)=>({id,type:'text',maxLength,default:value});
  const master=[port('req','out'),port('we','out'),port('address','out',16),port('wdata','out',16),port('rdata','in',16),port('ready','in'),port('error','in')];
  const slave=[port('req','in'),port('we','in'),port('address','in',16),port('wdata','in',16),port('rdata','out',16),port('ready','out'),port('error','out'),port('reset','in')];
  const DEFAULT_FSM=JSON.stringify({initial:'off',states:[{id:'off',output:0,transitions:[{mask:1,value:1,next:'on'}]},{id:'on',output:1,transitions:[{mask:1,value:0,next:'off'}]}]},null,2);
  const DEFAULT_REGISTERS=JSON.stringify({registers:[{address:0,name:'OUTPUT',access:'rw',reset:0},{address:1,name:'INPUT',access:'ro',reset:0,source:'input'},{address:2,name:'FLAGS',access:'w1c',reset:15},{address:3,name:'EVENTS',access:'rc',reset:7}]},null,2);
  function add(id,name,description,ports,parameters,preserve=[]){models[id]={modelId:id,name,kind:'behavioral',ports,timing:'stateful',parameters,dependencies:[],power:'implicit',preserve};list.push({id,name,description,category:'架构与控制',width:16});}
  add(CPU,'CPU16 · 可编程教学处理器','16 位寄存器、外部数据总线、间接寻址、有界栈与中断',[...master,port('reset','in'),port('irq','in'),port('irq_id','in',2),port('irq_ack','out'),port('irq_ack_id','out',2),port('pc','out',16),port('sp','out',7),...Array.from({length:8},(_,i)=>port('r'+i,'out',16)),port('halted','out'),port('fault','out')],[text('source','HALT'),integer('busTimeout',1,65535,256),...Array.from({length:4},(_,i)=>integer('vector'+i,0,1023,0)),...Array.from({length:4},(_,i)=>integer('priority'+i,0,3,i))]);
  add(RAM,'CPU16 · 外部总线 RAM','16 位数据，响应握手，暖复位保留内容',[...slave,port('fault','out')],[integer('depth',1,4096,256),integer('latency',1,256,1),{id:'contents',type:'words',width:16,maxLength:4096,default:[]}],['memory']);
  add(FSM,'可编辑状态机','JSON 状态与转移表，每拍观察输入再转移',[port('input','in',16),port('reset','in'),port('out','out',16),port('state','out',6),port('fault','out')],[text('table',DEFAULT_FSM)]);
  add(DEV,'自定义寄存器设备','可编辑地址、读写权限、输入寄存器及读写副作用',[...slave,port('input','in',16),port('out','out',16),port('fault','out')],[text('registers',DEFAULT_REGISTERS),integer('latency',1,256,1),integer('outputAddress',0,65535,0)]);
  models[DEV].dependencies=[{from:'input',to:'out'}];
  const NAMES=['NOP','LDI','MOV','ADD','ADDI','SUB','SUBI','AND','OR','XOR','NOT','SHL','SHR','LOAD','STORE','JMP','JZ','JNZ','CALL','RET','PUSH','POP','EI','DI','IRET','HALT'];
  function assemble(source){
    try{
      assert(typeof source==='string'&&source.length<=60000,'程序文本最多 60000 个字符');
      const labels=Object.create(null),rows=[];source.split(/\r?\n/).forEach((line,index)=>{
        let code=line.split(';')[0].trim();if(!code)return;
        const mark=/^([A-Za-z_][A-Za-z0-9_]*):/.exec(code);if(mark){assert(!Object.hasOwn(labels,mark[1]),'第 '+(index+1)+' 行：标签重复');labels[mark[1]]=rows.length;code=code.slice(mark[0].length).trim();}
        if(code)rows.push({code,line:index+1});
      });assert(rows.length>0&&rows.length<=1024,'程序必须包含 1—1024 条指令');
      const num=(raw,line,max=65535,allowLabel=false)=>{let value;if(allowLabel&&Object.hasOwn(labels,raw))value=labels[raw];else{assert(/^(?:0x[0-9a-f]+|\d+)$/i.test(raw),'第 '+line+' 行：无效数字或标签 '+raw);value=Number(raw);}assert(int(value,0,max),'第 '+line+' 行：数字越界 '+raw);return value;};
      const reg=(raw,line)=>{assert(/^R[0-7]$/i.test(raw),'第 '+line+' 行：寄存器必须是 R0—R7');return Number(raw[1]);};
      const instructions=rows.map(({code,line})=>{
        const m=/^([A-Za-z]+)(?:\s+(.*))?$/.exec(code);assert(m,'第 '+line+' 行：指令格式无效');const op=m[1].toUpperCase(),args=m[2]?m[2].split(',').map(x=>x.trim()):[];assert(NAMES.includes(op),'第 '+line+' 行：未知指令 '+op);const count=n=>assert(args.length===n&&args.every(Boolean),'第 '+line+' 行：'+op+' 需要 '+n+' 个操作数');
        if(['NOP','RET','EI','DI','IRET','HALT'].includes(op)){count(0);return{op};}
        if(['NOT','PUSH','POP'].includes(op)){count(1);return{op,r:reg(args[0],line)};}
        if(['JMP','CALL'].includes(op)){count(1);return{op,target:num(args[0],line,rows.length-1,true)};}
        if(['JZ','JNZ'].includes(op)){count(2);return{op,r:reg(args[0],line),target:num(args[1],line,rows.length-1,true)};}
        count(2);const r=reg(args[0],line);
        if(['LDI','ADDI','SUBI','SHL','SHR'].includes(op))return{op,r,value:num(args[1],line,['SHL','SHR'].includes(op)?15:65535)};
        if(['LOAD','STORE'].includes(op)){const indirect=/^\[(R[0-7])\]$/i.exec(args[1]);return indirect?{op,r,indirect:reg(indirect[1],line)}:{op,r,address:num(args[1],line)};}
        return{op,r,s:reg(args[1],line)};
      });return{ok:true,instructions,sourceMap:rows.map(r=>r.line),labels:{...labels},error:null};
    }catch(e){return{ok:false,instructions:[],sourceMap:[],labels:{},error:e.message};}
  }
  // Bounded compiled-data caches: designs may contain arbitrary source, never executable JavaScript.
  const cache=new Map();function cached(key,fn){if(cache.has(key))return cache.get(key);const value=fn();if(cache.size>=64)cache.delete(cache.keys().next().value);cache.set(key,value);return value;}
  function program(source){return cached('p:'+source,()=>{const a=assemble(source);assert(a.ok,a.error);return a;});}
  function fsmTable(source){return cached('f:'+source,()=>{let t;try{t=JSON.parse(source);}catch{throw new Error('状态机必须是有效 JSON');}shape(t,['initial','states']);assert(typeof t.initial==='string'&&Array.isArray(t.states)&&t.states.length>=1&&t.states.length<=64,'状态机需要 1—64 个状态');const ids=new Set();let transitions=0;for(const s of t.states){shape(s,['id','output','transitions']);assert(typeof s.id==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(s.id)&&!ids.has(s.id),'状态名称无效或重复');ids.add(s.id);assert(word(s.output)&&Array.isArray(s.transitions),'状态输出或转移表无效');for(const tr of s.transitions){shape(tr,['mask','value','next']);assert(word(tr.mask)&&word(tr.value)&&(tr.value&~tr.mask)===0&&typeof tr.next==='string','转移掩码/值无效');}transitions+=s.transitions.length;}assert(transitions<=256&&ids.has(t.initial),'转移最多 256 条，初态必须存在');for(const s of t.states)for(const tr of s.transitions)assert(ids.has(tr.next),'转移目标不存在：'+tr.next);return t;});}
  function registers(source){return cached('d:'+source,()=>{let t;try{t=JSON.parse(source);}catch{throw new Error('寄存器说明必须是有效 JSON');}shape(t,['registers']);assert(Array.isArray(t.registers)&&t.registers.length>=1&&t.registers.length<=64,'设备需要 1—64 个寄存器');const addresses=new Set();for(const r of t.registers){shape(r,['address','name','access','reset',...(Object.hasOwn(r,'source')?['source']:[])]);assert(word(r.address)&&!addresses.has(r.address),'寄存器地址无效或重复');addresses.add(r.address);assert(typeof r.name==='string'&&r.name.length<=40&&['rw','ro','w1c','rc'].includes(r.access)&&word(r.reset),'寄存器定义无效');if('source'in r)assert(r.source==='input'&&r.access==='ro','外部输入寄存器只能是 ro');}return t.registers;});}
  function supported(id){return Object.hasOwn(models,id);}
  function defaultParameters(id){return Object.fromEntries(models[id].parameters.map(s=>[s.id,clone(s.default)]));}
  function validateParameters(id,params){assert(supported(id),'未知架构元件');shape(params,models[id].parameters.map(s=>s.id));for(const s of models[id].parameters){const v=params[s.id];if(s.type==='integer')assert(int(v,s.min,s.max),s.id+' 参数越界');else if(s.type==='text')assert(typeof v==='string'&&v.length<=s.maxLength,s.id+' 文本超限');else assert(Array.isArray(v)&&v.length<=s.maxLength&&v.every(word),'初始存储内容必须是 16 位字');}if(id===CPU)program(params.source);if(id===FSM)fsmTable(params.table);if(id===DEV){const rs=registers(params.registers);assert(rs.some(r=>r.address===params.outputAddress),'输出地址必须对应已有寄存器');}if(id===RAM)assert(params.contents.length<=params.depth,'初始内容超过 RAM 容量');return params;}
  const faultCodes=['F_RESET_UNKNOWN','F_PC','F_STACK_OVERFLOW','F_STACK_UNDERFLOW','F_RETURN','F_BUS_UNKNOWN','F_BUS_ERROR','F_BUS_TIMEOUT','F_IRQ_UNKNOWN','F_IRQ_OVERFLOW','F_IRET','F_INPUT_UNKNOWN','F_REQUEST_UNKNOWN'];
  function fresh(id,params){validateParameters(id,params);
    if(id===CPU)return{pc:0,regs:Array(8).fill(0),stack:[],phase:'fetch',pending:null,retired:'0',ticks:'0',fault:null,ie:false,frames:[],irqBlocked:false,ack:0,ackId:0,lastAccess:null};
    if(id===FSM){const t=fsmTable(params.table);return{index:t.states.findIndex(s=>s.id===t.initial),transitions:'0',fault:null};}
    const bus={active:null,response:null,armed:false,transactions:'0',fault:null};return id===RAM?{...bus,memory:Array.from({length:params.depth},(_,i)=>params.contents[i]||0)}:{...bus,values:registers(params.registers).map(r=>r.reset)};
  }
  function reset(id,params,state,kind,api){const n=fresh(id,params,api);if(id===RAM&&kind==='warm')n.memory=state.memory.slice();return n;}
  function known(value,api){const bits=api.bits(value);return bits.every(x=>x===0||x===1)?Number(BigInt(value.value)):null;}
  function output(id,name,params,state,read,api){const width=models[id].ports.find(p=>p.id===name).width,sig=v=>api.signal(v,width);if(name==='fault')return sig(state.fault?1:0);
    if(id===CPU){if(/^r[0-7]$/.test(name))return sig(state.regs[Number(name[1])]);const p=state.pending;return sig(({req:state.phase==='bus'?1:0,we:p?.write?1:0,address:p?.address||0,wdata:p?.data||0,pc:state.pc,sp:state.stack.length,halted:['halted','fault'].includes(state.phase)?1:0,irq_ack:state.ack,irq_ack_id:state.ackId})[name]);}
    if(id===FSM)return sig(name==='state'?state.index:fsmTable(params.table).states[state.index].output);
    if(name==='out'){const i=registers(params.registers).findIndex(r=>r.address===params.outputAddress),r=registers(params.registers)[i];return r.source==='input'?read('input'):sig(state.values[i]);}
    return sig(name==='ready'?state.response?1:0:name==='error'?state.response?.error?1:0:state.response?.data||0);
  }
  function failure(n,code){n.fault=code;if('phase'in n){n.phase='fault';n.pending=null;}return n;}
  function sampleCPU(params,state,read,api){const n=clone(state),num=p=>known(read(p),api);n.ticks=String(BigInt(n.ticks)+1n);n.ack=0;const r=num('reset');if(r===1)return fresh(CPU,params);if(r===null)return failure(n,'F_RESET_UNKNOWN');if(['fault','halted'].includes(n.phase))return n;
    const p=program(params.source),irq=num('irq');if(irq===0)n.irqBlocked=false;
    const retire=()=>{n.retired=String(BigInt(n.retired)+1n);n.phase='fetch';n.pending=null;};
    if(n.phase==='bus'){
      const ready=num('ready');if(ready===null)return failure(n,'F_BUS_UNKNOWN');if(ready===1){const error=num('error');if(error===null)return failure(n,'F_BUS_UNKNOWN');if(error===1)return failure(n,'F_BUS_ERROR');const value=n.pending.write?n.pending.data:num('rdata');if(value===null)return failure(n,'F_BUS_UNKNOWN');if(!n.pending.write)n.regs[n.pending.r]=value;n.lastAccess={address:n.pending.address,write:n.pending.write,value,pc:n.pc,serial:String(BigInt(n.retired)+1n)};n.pc++;retire();return n;}n.pending.waited++;if(n.pending.waited>=params.busTimeout)return failure(n,'F_BUS_TIMEOUT');return n;
    }
    if(n.phase==='fetch'){
      if(n.ie){if(irq===null)return failure(n,'F_IRQ_UNKNOWN');if(irq===1&&!n.irqBlocked){const id=num('irq_id');if(id===null)return failure(n,'F_IRQ_UNKNOWN');const priority=params['priority'+id];if(!n.frames.length||priority<n.frames.at(-1).priority){if(n.frames.length>=4)return failure(n,'F_IRQ_OVERFLOW');const target=params['vector'+id];if(target>=p.instructions.length)return failure(n,'F_PC');n.frames.push({pc:n.pc,regs:n.regs.slice(),stack:n.stack.slice(),ie:n.ie,priority,id});n.pc=target;n.ie=false;n.irqBlocked=true;n.ack=1;n.ackId=id;return n;}}}
      if(n.pc>=p.instructions.length)return failure(n,'F_PC');n.phase='execute';return n;
    }
    if(n.pc>=p.instructions.length)return failure(n,'F_PC');const ins=p.instructions[n.pc],a=n.regs[ins.r],b=n.regs[ins.s];let target=n.pc+1;
    switch(ins.op){
      case'NOP':break;case'LDI':n.regs[ins.r]=ins.value;break;case'MOV':n.regs[ins.r]=b;break;
      case'ADD':n.regs[ins.r]=(a+b)&65535;break;case'ADDI':n.regs[ins.r]=(a+ins.value)&65535;break;case'SUB':n.regs[ins.r]=(a-b)&65535;break;case'SUBI':n.regs[ins.r]=(a-ins.value)&65535;break;
      case'AND':n.regs[ins.r]=a&b;break;case'OR':n.regs[ins.r]=a|b;break;case'XOR':n.regs[ins.r]=a^b;break;case'NOT':n.regs[ins.r]=(~a)&65535;break;case'SHL':n.regs[ins.r]=(a<<ins.value)&65535;break;case'SHR':n.regs[ins.r]=a>>>ins.value;break;
      case'LOAD':case'STORE':n.pending={address:'indirect'in ins?n.regs[ins.indirect]:ins.address,write:ins.op==='STORE',data:ins.op==='STORE'?a:0,r:ins.r,waited:0};n.phase='bus';return n;
      case'JMP':target=ins.target;break;case'JZ':if(a===0)target=ins.target;break;case'JNZ':if(a!==0)target=ins.target;break;
      case'CALL':if(n.stack.length>=64)return failure(n,'F_STACK_OVERFLOW');if(target>=p.instructions.length)return failure(n,'F_RETURN');n.stack.push(target);target=ins.target;break;
      case'RET':if(!n.stack.length)return failure(n,'F_STACK_UNDERFLOW');target=n.stack.at(-1);if(target>=p.instructions.length)return failure(n,'F_RETURN');n.stack.pop();break;
      case'PUSH':if(n.stack.length>=64)return failure(n,'F_STACK_OVERFLOW');n.stack.push(a);break;
      case'POP':if(!n.stack.length)return failure(n,'F_STACK_UNDERFLOW');n.regs[ins.r]=n.stack.pop();break;
      case'EI':n.ie=true;break;case'DI':n.ie=false;break;
      case'IRET':{if(!n.frames.length)return failure(n,'F_IRET');const f=n.frames.at(-1);if(f.pc>=p.instructions.length)return failure(n,'F_RETURN');n.frames.pop();target=f.pc;n.regs=f.regs.slice();n.stack=f.stack.slice();n.ie=f.ie;break;}
      case'HALT':n.retired=String(BigInt(n.retired)+1n);n.phase='halted';return n;
    }
    n.pc=target;retire();return n;
  }
  function sampleBus(id,params,state,read,api){const n=clone(state),num=p=>known(read(p),api),req=num('req'),r=num('reset');if(r===1)return fresh(id,params);if(r===null){n.active=null;n.response=null;n.armed=false;return failure(n,'F_RESET_UNKNOWN');}if(req===0){n.active=null;n.response=null;n.armed=true;return n;}if(req===null){n.active=null;n.response=null;n.armed=false;return failure(n,'F_REQUEST_UNKNOWN');}if(!n.armed||n.response)return n;
    if(!n.active){const we=num('we'),address=num('address'),data=we===1?num('wdata'):0;if(we===null||address===null||data===null){n.response={data:0,error:1};return failure(n,'F_REQUEST_UNKNOWN');}n.active={address,write:we===1,data,remaining:params.latency};return n;}
    const a=n.active;if(--a.remaining>0)return n;let error=0,data=0;
    if(id===RAM){if(a.address>=params.depth)error=1;else if(a.write){n.memory[a.address]=a.data;data=a.data;}else data=n.memory[a.address];}
    else{const rs=registers(params.registers),i=rs.findIndex(r=>r.address===a.address),r=rs[i];if(!r)error=1;else if(a.write){if(['ro','rc'].includes(r.access))error=1;else{n.values[i]=r.access==='w1c'?n.values[i]&(~a.data&65535):a.data;data=n.values[i];}}else{data=r.source==='input'?num('input'):n.values[i];if(data===null){error=1;data=0;n.fault='F_INPUT_UNKNOWN';}else if(r.access==='rc')n.values[i]=0;}}
    n.response={data,error};n.active=null;n.transactions=String(BigInt(n.transactions)+1n);return n;
  }
  function sample(id,params,state,read,api){if(id===CPU)return sampleCPU(params,state,read,api);if(id!==FSM)return sampleBus(id,params,state,read,api);const n=clone(state),r=known(read('reset'),api);if(r===1)return fresh(id,params);if(r===null)return failure(n,'F_RESET_UNKNOWN');if(n.fault)return n;const t=fsmTable(params.table),bits=api.bits(read('input'));for(const tr of t.states[n.index].transitions){let match=true;for(let i=0;i<16;i++)if((tr.mask>>>i)&1){if(bits[i]!==0&&bits[i]!==1)return failure(n,'F_INPUT_UNKNOWN');if(bits[i]!==((tr.value>>>i)&1))match=false;}if(match){n.index=t.states.findIndex(s=>s.id===tr.next);n.transitions=String(BigInt(n.transitions)+1n);break;}}return n;}
  function validateState(id,params,state){
    validateParameters(id,params);shape(state,Object.keys(fresh(id,params)));
    assert(state.fault===null||faultCodes.includes(state.fault),'故障状态无效');
    if(id===CPU){
      const p=program(params.source),regs=a=>Array.isArray(a)&&a.length===8&&a.every(word),stack=a=>Array.isArray(a)&&a.length<=64&&a.every(word);
      assert(int(state.pc,0,p.instructions.length)&&regs(state.regs)&&stack(state.stack),'CPU 寄存器或栈无效');
      assert(['fetch','execute','bus','halted','fault'].includes(state.phase)&&decimal(state.retired)&&decimal(state.ticks)&&typeof state.ie==='boolean'&&typeof state.irqBlocked==='boolean'&&int(state.ack,0,1)&&int(state.ackId,0,3),'CPU 控制状态无效');
      assert((state.phase==='fault')===!!state.fault,'CPU 故障阶段不一致');
      assert(!['execute','halted'].includes(state.phase)||state.pc<p.instructions.length,'执行地址无效');
      assert((state.phase==='bus')===(state.pending!==null),'总线状态不一致');
      if(state.pending!==null){
        shape(state.pending,['address','write','data','r','waited']);const v=state.pending;
        assert(word(v.address)&&word(v.data)&&typeof v.write==='boolean'&&int(v.r,0,7)&&int(v.waited,0,params.busTimeout-1)&&state.pc<p.instructions.length,'CPU 总线请求无效');
        const ins=p.instructions[state.pc];
        assert(['LOAD','STORE'].includes(ins.op)&&v.write===(ins.op==='STORE')&&v.r===ins.r&&v.address===('indirect'in ins?state.regs[ins.indirect]:ins.address)&&v.data===(v.write?state.regs[ins.r]:0),'请求与实际指令不一致');
      }
      assert(Array.isArray(state.frames)&&state.frames.length<=4,'中断帧数量无效');
      for(const f of state.frames){shape(f,['pc','regs','stack','ie','priority','id']);assert(int(f.pc,0,p.instructions.length)&&regs(f.regs)&&stack(f.stack)&&typeof f.ie==='boolean'&&int(f.priority,0,3)&&int(f.id,0,3)&&f.priority===params['priority'+f.id],'中断帧无效');}
      for(let i=1;i<state.frames.length;i++)assert(state.frames[i].priority<state.frames[i-1].priority,'中断嵌套优先级无效');
      if(state.lastAccess!==null){shape(state.lastAccess,['address','write','value','pc','serial']);assert(word(state.lastAccess.address)&&word(state.lastAccess.value)&&typeof state.lastAccess.write==='boolean'&&int(state.lastAccess.pc,0,p.instructions.length-1)&&decimal(state.lastAccess.serial)&&BigInt(state.lastAccess.serial)<=BigInt(state.retired),'访存记录无效');}
    }else if(id===FSM){assert(int(state.index,0,fsmTable(params.table).states.length-1)&&decimal(state.transitions),'状态机状态无效');}
    else{
      assert(decimal(state.transactions)&&typeof state.armed==='boolean','事务计数/武装状态无效');
      if(state.active!==null){shape(state.active,['address','write','data','remaining']);assert(state.armed&&word(state.active.address)&&word(state.active.data)&&typeof state.active.write==='boolean'&&int(state.active.remaining,1,params.latency),'在途事务无效');}
      if(state.response!==null){shape(state.response,['data','error']);assert(state.armed&&word(state.response.data)&&int(state.response.error,0,1)&&state.active===null,'总线响应无效');}
      const values=id===RAM?state.memory:state.values;assert(Array.isArray(values)&&values.length===(id===RAM?params.depth:registers(params.registers).length)&&values.every(word),'设备存储无效');
    }
    return state;
  }
  const SAMPLES=[
    {id:'array-stack',name:'数组求和与子程序',description:'通过寄存器间接寻址填充 8 个数组元素；CALL/RET 求和，PUSH/POP 保存寄存器；外部 RAM[16] 得到 36。',source:'LDI R0,0\nLDI R1,1\nLDI R2,8\nfill: STORE R1,[R0]\nADDI R0,1\nADDI R1,1\nSUBI R2,1\nJNZ R2,fill\nCALL sum\nSTORE R3,16\nHALT\nsum: PUSH R0\nPUSH R1\nPUSH R2\nLDI R0,0\nLDI R2,8\nLDI R3,0\nloop: LOAD R1,[R0]\nADD R3,R1\nADDI R0,1\nSUBI R2,1\nJNZ R2,loop\nPOP R2\nPOP R1\nPOP R0\nRET'},
    {id:'register-device',name:'自定义寄存器设备',description:'写 OUTPUT、读实际 INPUT、清标志与读清事件。修改设备权限或断开响应线都会改变结果。',source:'LDI R0,90\nSTORE R0,0\nLOAD R1,1\nLDI R0,5\nSTORE R0,2\nLOAD R2,2\nLOAD R3,3\nLOAD R4,3\nHALT'},
    {id:'state-machine',name:'可编辑状态机',description:'输入 bit0=1 进入 on，bit0=0 回到 off。状态表可以改成交通灯或握手控制器。'}
  ];
  function circuit(){return typeof module==='object'&&module.exports?require('./circuit.js'):globalThis.CircuitLab;}
  async function build(id='array-stack'){
    const C=circuit(),sample=SAMPLES.find(s=>s.id===id),p=await C.createProject(sample?.name||'CPU16 工作台'),view={positions:{}},w=(id,a,b)=>C.addWire(p,id,a,b),E=C.ep,B=C.boundary;
    C.addInput(p,'reset','复位',0);const add=(model,id,params)=>{const n=C.createInstance(p,model,id);if(params)n.parameters=params;return n;};
    if(id==='state-machine'){C.addInput(p,'input','输入',0,16);add(FSM,'fsm');C.addOutput(p,'output','输出',16);C.addOutput(p,'state','状态',6);w('input',B('input'),E('fsm','input'));w('reset',B('reset'),E('fsm','reset'));w('out',E('fsm','out'),B('output'));w('state',E('fsm','state'),B('state'));}
    else{const params=defaultParameters(CPU);params.source=sample?.source||id;add(CPU,'cpu',params);const peripheral=id==='register-device',device=peripheral?'device':'ram';add(peripheral?DEV:RAM,device);C.addInput(p,'irq','中断请求',0);C.addInput(p,'irq_id','中断来源',0,2);w('irq',B('irq'),E('cpu','irq'));w('irq_id',B('irq_id'),E('cpu','irq_id'));for(const port of ['req','we','address','wdata'])w('bus_'+port,E('cpu',port),E(device,port));for(const port of ['rdata','ready','error'])w('bus_'+port,E(device,port),E('cpu',port));for(const node of ['cpu',device])w('reset_'+node,B('reset'),E(node,'reset'));C.addOutput(p,'result','R3',16);w('result',E('cpu','r3'),B('result'));if(peripheral){C.addInput(p,'input','设备输入',65,16);C.addOutput(p,'device_out','设备输出',16);w('input',B('input'),E(device,'input'));w('device_out',E(device,'out'),B('device_out'));}}
    let i=0;for(const n of p.circuit.instances)view.positions[n.id]={x:360+i++*430,y:100};i=0;for(const pin of p.circuit.inputs)view.positions['boundary:'+pin.id]={x:30,y:40+i++*140};i=0;for(const pin of p.circuit.outputs)view.positions['boundary:'+pin.id]={x:1250,y:60+i++*140};return{project:await C.importProject(p),view,sources:p.circuit.instances.some(n=>n.id==='cpu')?{'architecture:cpu':p.circuit.instances.find(n=>n.id==='cpu').parameters.source}:{},lesson:null};
  }
  // The UI and external automation use the same state-based stop checks. No execution driver is replaced.
  class DebugSession{
    constructor(runtime,path='cpu'){this.runtime=runtime;this.path=path;this.breakpoints=new Set();this.watches=[];this.skip=null;this.lastHit=null;}
    state(){return this.runtime.states.get(this.path)?.hardware;}
    parameters(){return this.runtime.compiled.nodes.get(this.path)?.instance.parameters;}
    addBreakpoint(line){const p=this.parameters();assert(p,'CPU 实例不存在');assert(program(p.source).sourceMap.includes(line),'这一行没有可执行指令');this.breakpoints.add(line);}
    addWatch(address,mode='write'){assert(word(address)&&['read','write','any'].includes(mode),'观察点地址或模式无效');this.watches.push({address,mode});}
    guard(){const s=this.state();if(!s||['fault','halted'].includes(s.phase))return null;const p=this.parameters(),line=program(p.source).sourceMap[s.pc],token=s.pc+':'+s.phase+':'+s.retired;let hit=null;
      if(s.phase==='execute'&&this.breakpoints.has(line))hit={kind:'line',line,pc:s.pc,reason:'CPU16 第 '+line+' 行：指令执行前暂停'};
      if(s.phase==='execute'){const ins=program(p.source).instructions[s.pc];if(['LOAD','STORE'].includes(ins.op)){const address='indirect'in ins?s.regs[ins.indirect]:ins.address,write=ins.op==='STORE';if(this.watches.some(w=>w.address===address&&(w.mode==='any'||w.mode===(write?'write':'read'))))hit={kind:'watch',line,pc:s.pc,address,write,reason:'CPU16 '+(write?'写入':'读取')+' 0x'+address.toString(16)+' 前暂停'};}}
      if(hit&&this.skip!==token){this.lastHit={...hit,token};return hit;}return null;
    }
    continueOnce(){const s=this.state();if(s)this.skip=s.pc+':'+s.phase+':'+s.retired;this.lastHit=null;}
    advance(ticks=1){let n=0;for(;n<ticks;n++){if(this.guard())break;this.runtime.advance(1n,{force:true});if(this.runtime._observerStop){n++;break;}}return{advanced:n,hit:this.lastHit,stopped:!!this.runtime._observerStop};}
    stepInstruction(){const s=this.state();assert(s&&!['halted','fault'].includes(s.phase),'CPU 当前无法单步');const before=s.retired;this.continueOnce();let n=0;while(n++<this.parameters().busTimeout+8){this.runtime.advance(1n,{force:true});const x=this.state();if(this.runtime._observerStop||x.retired!==before||['halted','fault'].includes(x.phase))return x;}throw new Error('单步预算已用完');}
  }
  const instructionRows=[
    ['NOP','无操作数','不改变寄存器'],['LDI Rd,n','n=0—65535','Rd=n'],['MOV Rd,Rs','R0—R7','复制寄存器'],['ADD / SUB Rd,Rs','R0—R7','加减，结果按 65536 回绕'],['ADDI / SUBI Rd,n','n=0—65535','立即数加减，结果回绕'],['AND / OR / XOR Rd,Rs','R0—R7','逐位运算'],['NOT Rd','R0—R7','16 位取反'],['SHL / SHR Rd,n','n=0—15','逻辑移位，移出位丢弃，补零'],['LOAD Rd,address 或 LOAD Rd,[Ra]','地址=0x0000—0xFFFF，或地址寄存器','发出外部读请求；握手成功才写 Rd'],['STORE Rs,address 或 STORE Rs,[Ra]','字地址，非字节地址','发出外部写请求；握手成功才退休'],['JMP target','标签或程序指令索引','无条件跳转'],['JZ / JNZ Rn,target','标签或程序指令索引','比较该寄存器是否为零，无独立标志寄存器'],['CALL target','目标必须在已装程序内','压入下一条指令索引，再跳转'],['RET','无操作数','检查栈顶返回地址有效后弹出并跳转'],['PUSH / POP Rn','64 词公共数据/调用栈','保存或恢复一个 16 位字'],['EI / DI','无操作数','允许/禁止外部中断'],['IRET','无操作数','恢复独立中断帧中的 PC、8 个寄存器、完整调用栈和中断允许位'],['HALT','无操作数','CPU 停止，外部 RAM/状态机等仍可运行']
  ];
  const manual={entries:[
    {id:'architecture-cpu16',title:'CPU16 · 寄存器、指令、外部总线与中断',category:'教学 CPU',summary:'具备数组、子程序、有界栈与外部总线的 16 位功能级 CPU。',appliesTo:[CPU],sections:[
      {id:'state',title:'架构与状态',paragraphs:['这是新的教学指令集，不兼容 Core8、Build8、ARM 或 RISC-V。内部程序 ROM 来自 source 参数，最多 1024 条指令；汇编器将文本解析为受限指令记录，没有任意脚本执行。PC 是指令索引，不是字节地址。','R0—R7 均为 16 位无符号通用寄存器。SP 是内部栈当前深度 0—64；CALL/RET 与 PUSH/POP 共用这一栈。数据 RAM 不在 CPU 内，全部 LOAD/STORE 都经过画布上的实际总线。','冷启动、暖复位和 reset=1 均清空 CPU 寄存器、栈、中断帧、计数与待处理请求，程序保留。暂停冻结仿真时刻。HALT 或 CPU 故障不停止其他元件。'],table:{headers:['状态/参数','含义与复位值'],rows:[['PC','初值 0；0—1023 为程序索引；执行到 ROM 末尾之后会 F_PC'],['R0—R7','初值 0；全部运算结果为 16 位'],['SP / stack','初值 0 / 空；64 词上限；不可越界'],['phase','fetch → execute → 可选 bus；初值 fetch'],['retired / ticks','初值 0；已完成指令数 / CPU 已采样微秒数'],['busTimeout','初值 256；等待 ready 的最大采样次数，1—65535'],['vector0—3','初值 0；对应中断处理程序的指令索引'],['priority0—3','初值 0、1、2、3；数字较小者优先'],['ie / frames','初值 false / 空；最多 4 层独立中断现场']] }},
      {id:'isa',title:'完整指令表 · 26 条指令',paragraphs:['寄存器名称不区分大小写；标签区分大小写；数字支持十进制与 0x 十六进制；分号后的文字为注释。操作数以逗号分隔。所有静态分支目标在汇编时检查，即使分支最终未执行。'],table:{headers:['汇编','操作数','效果'],rows:instructionRows}},
      {id:'bus',title:'外部总线与精确时序',paragraphs:['一个普通指令用一拍取指、一拍执行，每拍为 1 虚拟微秒。LOAD/STORE 在执行拍末锁定地址、方向与写数据，并把 req 拉高；它们等待实际 ready=1 后才完成。等待中请求保持稳定。完成后进入下一条取指，因此至少有一整拍 req=0。','req=1 表示有效请求；we=1 写、we=0 读；address 为 16 位字地址；wdata/rdata 为 16 位数据。ready=1 时 error 才有效；error=1 表示设备拒绝。ready=0 时忽略 error/rdata。CPU 不凭等待时间伪造完成。','总线断线产生 X：未知 ready/error/读数据触发 F_BUS_UNKNOWN；拒绝触发 F_BUS_ERROR；等待超限触发 F_BUS_TIMEOUT。失败的 LOAD 不改目的寄存器、PC 或退休计数。外部设备已经完成的事务不会因为后来断线而自动撤销。']},
      {id:'interrupts',title:'中断与嵌套',paragraphs:['EI 后在取指边界检查 irq 和 irq_id。只有比当前中断更高的优先级才能嵌套；相同或较低优先级保持待处理。进入时保存 PC、全部寄存器、完整调用栈和 ie，清 ie，并输出一拍 irq_ack 与对应 irq_ack_id。','外部控制器必须在收到 ack 后至少一拍拉低 irq，之后才能提出新请求。CPU 对保持高电平的同一次请求只确认一次。处理程序需要显式 EI 才允许更高优先级嵌套。IRET 恢复完整现场；持久结果应写外部 RAM 或设备。','中断没有隐藏的定时器或 GPIO；需要真实连接外置中断控制器。未执行 EI 时可以不连接中断输入，EI 后输入悬空会 F_IRQ_UNKNOWN。HALT 不会被中断唤醒。']},
      {id:'faults',title:'故障与调试',paragraphs:['错误不会悄悄改成零。故障后 req=0，需复位或重新应用程序恢复。程序编辑窗口的草稿不会直接改变当前正在执行的程序；只有应用后才重新启动。源码断点停在该行的执行拍之前，读写观察点停在发出请求之前。'],table:{headers:['故障','原因'],rows:[['F_PC / F_RETURN','PC、向量或返回地址不属于程序'],['F_STACK_OVERFLOW / F_STACK_UNDERFLOW','调用/压栈超过 64 词，或空栈弹出'],['F_IRET / F_IRQ_OVERFLOW','无中断现场时返回，或中断帧容量超过 4'],['F_IRQ_UNKNOWN / F_RESET_UNKNOWN','有效控制输入为 X/Z'],['F_BUS_UNKNOWN / F_BUS_ERROR / F_BUS_TIMEOUT','读响应未知、设备拒绝、等待超时']]}},
      {id:'example',title:'数组与子程序',paragraphs:['把 CPU 总线接到外部 RAM，reset、irq、irq_id 初值为 0。运行后 RAM[0—7] 为 1—8，RAM[16] 与 R3 为 36。'],code:SAMPLES[0].source,codeTitle:'CPU16 数组求和',codeTarget:'architecture16'}
    ]},
    {id:'architecture-ram16',title:'CPU16 · 外部握手 RAM',category:'存储与总线',summary:'有容量、初始内容及响应延迟参数的独立 16 位数据 RAM。',appliesTo:[RAM],sections:[
      {id:'parameters',title:'参数与存储',paragraphs:['depth=1—4096 词，默认 256；contents 是从地址 0 开始的 16 位初值，不足部分补零；latency=1—256，默认 1。数据地址是字索引，超出 depth 不回绕，而是返回 error=1。','全局暖复位保留 RAM 内容并取消在途事务；冷启动、失电再上电或 reset 引脚=1 重新装入 contents。快照保存完整存储、在途请求和响应。']},
      {id:'handshake',title:'握手与复位边界',paragraphs:['启动或复位后先观察 req=0 一拍才接受请求。采到新 req=1 时锁定 we/address/wdata；再经过 latency 拍后完成读写并拉高 ready。完成前 req 变低会取消事务，没有存储副作用。','ready/error/rdata 保持到 req=0；持续 req 不会重复写入。未知请求字段产生拒绝与 F_REQUEST_UNKNOWN。写数据只在 we=1 时检查；读请求不要求 wdata 已连接。']}
    ]},
    {id:'architecture-fsm16',title:'可编辑状态机 · 状态与转移表',category:'控制器',summary:'使用有限 JSON 控制表定义自己的控制功能。',appliesTo:[FSM],sections:[
      {id:'table',title:'状态表格式',paragraphs:['table 包含 initial 和 states。每个状态包含唯一 id、16 位 output 和有序 transitions；每个转移包含 mask、value、next。每拍按顺序选择第一条满足 (input & mask) === value 的转移；都不满足则保持。输出是当前状态的 output。','最多 64 个状态、总计 256 条转移。value 不得在 mask 之外置位。mask=0 是无条件转移，可用于自动序列；next 必须存在。没有任意代码、动态对象路径或无限循环。','state 输出当前状态在 states 数组中的索引，out 输出 16 位值。reset=1 回到 initial；被检查的输入位为 X/Z 会停止转移并输出 fault。复位恢复。'],code:DEFAULT_FSM,codeTitle:'按输入切换的两状态控制器',codeTarget:'json-fsm'}
    ]},
    {id:'architecture-register-device16',title:'自定义寄存器设备 · 地址与副作用',category:'可编辑外设',summary:'把用户定义的寄存器合同变成真实的数字握手设备。',appliesTo:[DEV],sections:[
      {id:'registers',title:'自定义寄存器',paragraphs:['registers 参数是 JSON，包含 1—64 个唯一 16 位地址。每项定义 address、name、access、reset，可选 source:"input"。这是数字请求/响应设备，不自动假装成 UART、SPI 或 I²C 电气接口。','外部 input 为 16 位；source:"input" 只允许 ro，它在读取事务完成时采样实际输入。outputAddress 选择 out 对应的寄存器，默认地址 0。若该寄存器来自 input，out 直接反映输入。'],table:{headers:['access','读','写'],rows:[['rw','返回当前值','替换全部 16 位'],['ro','返回当前值或实际 input','error=1，不改变值'],['w1c','返回当前值','写 1 清对应位，写 0 保持'],['rc','返回旧值后清零','error=1，不改变值']]},code:DEFAULT_REGISTERS,codeTitle:'默认寄存器定义',codeTarget:'json-registers'},
      {id:'timing',title:'事务时序与错误',paragraphs:['使用与外部 RAM 相同的 req/we/address/wdata/ready/error/rdata 握手。latency 默认 1；请求先锁存，再等待相应拍数完成。持续 req 只做一次读清或写入，复位后必须先看到低电平才重新接受。','不存在的地址、写只读/读清寄存器返回 error；读取 source 输入但输入未知返回 error 和 F_INPUT_UNKNOWN，保留原寄存器内容。reset、暖复位、冷启动均恢复各寄存器 reset 值并取消在途事务。'],code:SAMPLES[1].source,codeTitle:'CPU16 操作默认设备',codeTarget:'architecture16'}
    ]}
  ],portHints:{}};
  for(const id of Object.keys(models)){manual.portHints[id]={};for(const p of models[id].ports){const common={req:'请求电平：保持到 ready 完成，再至少一拍拉低。',we:'0 读取，1 写入；仅有效请求时采样。',address:'16 位字地址，不是字节地址。',wdata:'写事务的 16 位数据。',rdata:'读响应的 16 位数据；ready=1 且 error=0 才有效。',ready:'事务完成；保持到请求拉低。',error:'ready=1 同拍有效，1 表示设备拒绝。',reset:'同步高有效冷复位；1 优先于本拍操作。',fault:'1 表示已记录控制或执行故障。',input:'来自实际连线的 16 位输入。',out:'当前状态或所选寄存器的 16 位输出。',pc:'当前指令索引；不是字节地址。',sp:'内部调用/数据栈深度 0—64。',halted:'CPU HALT 或 fault 时为 1。',state:'当前状态在 JSON states 数组中的索引。',irq:'外部中断请求；ack 后至少一拍拉低。',irq_id:'当前中断来源编号 0—3。',irq_ack:'进入中断时的单拍确认。',irq_ack_id:'本拍确认的中断来源编号。'};manual.portHints[id][p.id]=common[p.id]||('通用寄存器 '+p.id.toUpperCase()+' 的实际 16 位值，复位为 0。');}}
  return{CPU,RAM,FSM,DEV,models,list,supported,defaultParameters,validateParameters,fresh,reset,output,sample,validateState,known,assemble,NAMES,SAMPLES,build,DebugSession,manuals:manual,manual,DEFAULT_FSM,DEFAULT_REGISTERS};
});
