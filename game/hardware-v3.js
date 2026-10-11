(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.HardwareV3=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const models={},list=[];
  const port=(id,direction,width=1)=>({id,name:id.toUpperCase(),direction,kind:'digital',width});
  function add(id,name,description,ports,stateful=false,parameters=[],dependencies=null,preserve=[]){
    const inputs=ports.filter(p=>p.direction==='in'),outputs=ports.filter(p=>p.direction==='out');
    models[id]={modelId:id,name,kind:'behavioral',ports,timing:stateful?'stateful':'combinational',parameters,dependencies:dependencies||(!stateful?inputs.flatMap(a=>outputs.map(b=>({from:a.id,to:b.id}))):[]),power:'implicit',preserve};
    list.push({id,name,description,width:Math.max(...ports.map(p=>p.width)),category:stateful?'存储与时序':'运算与总线'});
  }
  const number=(id,width,def=0)=>({id,type:'integer',min:0,max:2**width-1,default:def});
  const memory=(width)=>[{id:'contents',type:'words',width,maxLength:256,default:[]}];
  for(const width of [8,16]){
    add('std.iszero'+width+'/1',width+' 位零比较','观察整个总线是否为零',[port('in','in',width),port('zero','out')]);
    add('std.alu'+width+'/1',width+' 位 ALU','加减、位运算、移位、乘法和比较',[port('a','in',width),port('b','in',width),port('op','in',4),port('out','out',width),port('zero','out'),port('carry','out')]);
    add('std.register'+width+'/1',width+' 位寄存器','每拍使能采样，未知位会被保留',[port('d','in',width),port('en','in'),port('reset','in'),port('q','out',width)],true,[number('initial',width)]);
    add('std.ram'+width+'/1','256 × '+width+' RAM','异步读取、同步写入；暖复位保留内存',[port('address','in',8),port('data','in',width),port('write','in'),port('reset','in'),port('out','out',width),port('fault','out')],true,memory(width),[{from:'address',to:'out'}],['memory']);
    add('std.rom'+width+'/1','256 × '+width+' ROM','参数中编辑内容，地址组合读取',[port('address','in',width===16?16:8),port('out','out',width),port('fault','out')],false,[...memory(width),{id:'source',type:'text',maxLength:30000,default:''}]);
    add('std.mux'+width+'/1',width+' 位四路选择','SEL=0/1/2/3 选择 A/B/C/D',[...['a','b','c','d'].map(id=>port(id,'in',width)),port('sel','in',2),port('out','out',width)]);
    add('std.fifo'+width+'/1',width+' 位 FIFO','同步推入/弹出；同时操作先弹出再推入',[port('data','in',width),port('push','in'),port('pop','in'),port('reset','in'),port('out','out',width),port('empty','out'),port('full','out'),port('count','out',9),port('fault','out')],true,[{id:'capacity',type:'integer',min:1,max:256,default:16}]);
    add('std.constant'+width+'/1',width+' 位常量','可编辑的固定数字源',[port('out','out',width)],false,[number('value',width)]);
  }
  add('std.split8/1','8 位拆线','将总线拆成 8 个独立数字引脚',[port('in','in',8),...Array.from({length:8},(_,i)=>port('b'+i,'out'))]);
  add('std.merge8/1','8 位合线','将 8 个数字引脚合成总线',[...Array.from({length:8},(_,i)=>port('b'+i,'in')),port('out','out',8)]);
  add('std.split16/1','16 位拆分','拆成低/高 8 位，保留 X/Z',[port('in','in',16),port('lo','out',8),port('hi','out',8)]);
  add('std.merge16/1','16 位合并','将低/高 8 位合为 16 位',[port('lo','in',8),port('hi','in',8),port('out','out',16)]);
  add('std.display8/1','字节显示器','观察实际 8 位输入，可显示数值/字符',[port('in','in',8),port('out','out',8)]);
  add('std.pc16/1','16 位程序计数器','使能加一，LOAD 跳转，HALT 停止',[port('en','in'),port('load','in'),port('target','in',16),port('halt','in'),port('reset','in'),port('out','out',16),port('halted','out')],true,[number('initial',16)]);
  add('std.fetch-execute/1','取指/执行控制','先取指再执行，每条指令两拍',[port('halt','in'),port('reset','in'),port('fetch','out'),port('execute','out'),port('halted','out')],true);
  add('std.build8-decoder/1','Build8 控制译码','只把 IR/零标志译成控制线，不执行指令',[port('instruction','in',16),port('execute','in'),port('zero','in'),port('immediate','out',8),port('address','out',8),port('target','out',16),port('alu','out',4),port('select','out',2),...['load_a','write_ram','write_out','pc_enable','pc_load','stop','fault'].map(id=>port(id,'out'))]);
  function supported(id){return Object.hasOwn(models,id);}
  function defaultParameters(id){return Object.fromEntries((models[id]?.parameters||[]).map(p=>[p.id,Array.isArray(p.default)?p.default.slice():p.default]));}
  function validateParameters(id,params){const specs=models[id].parameters;if(!params||Object.keys(params).length!==specs.length||Object.keys(params).some(k=>!specs.some(p=>p.id===k)))throw new Error('参数字段不符合 '+id);for(const s of specs){const v=params[s.id];if(s.type==='integer'){if(!Number.isInteger(v)||v<s.min||v>s.max)throw new Error(s.id+' 参数越界');}else if(s.type==='text'){if(typeof v!=='string'||v.length>s.maxLength)throw new Error(s.id+' 文本超限');}else if(!Array.isArray(v)||v.length>s.maxLength||!v.every(n=>Number.isInteger(n)&&n>=0&&n<2**s.width))throw new Error(s.id+' 必须是最多256个有效字的数组');}return params;}
  function widthOf(id){return /16\//.test(id)?16:8;}
  function fresh(id,params,api){validateParameters(id,params);const width=widthOf(id);if(id.includes('.register'))return {q:api.signal(params.initial,width)};if(id.includes('.ram'))return {memory:Array.from({length:256},(_,i)=>params.contents[i]||0),fault:null};if(id.includes('.fifo'))return {queue:[],fault:null};if(id==='std.pc16/1')return {q:api.signal(params.initial,16),halted:false,fault:null};if(id==='std.fetch-execute/1')return {phase:0,halted:false,ticks:'0',fault:null};return {};}
  function reset(id,params,state,kind,api){const next=fresh(id,params,api);if(kind==='warm'&&id.includes('.ram'))next.memory=state.memory.slice();return next;}
  function known(v,api){const a=api.bits(v);return a.every(x=>x===0||x===1)?Number(BigInt(v.value)):null;}
  function output(id,name,params,state,read,api){
    const width=models[id].ports.find(p=>p.id===name).width,sig=v=>api.signal(v,width),num=p=>known(read(p),api),x=()=>sig('X');
    if(id.includes('.constant'))return sig(params.value);
    if(id.includes('.iszero')){const a=api.bits(read('in'));return sig(a.includes(1)?0:a.every(v=>v===0)?1:'X');}
    if(id.includes('.register'))return state.q;
    if(id.includes('.ram')){if(name==='fault')return sig(state.fault?1:0);const address=num('address');return address===null?x():sig(state.memory[address]);}
    if(id.includes('.rom')){const address=num('address'),bad=address===null||address>=256;if(name==='fault')return sig(bad?1:0);return bad?x():sig(params.contents[address]||0);}
    if(id.includes('.fifo'))return name==='out'?state.queue.length?sig(state.queue[0]):x():sig(name==='count'?state.queue.length:name==='empty'?state.queue.length===0?1:0:name==='full'?state.queue.length===params.capacity?1:0:state.fault?1:0);
    if(id.includes('.mux')){const select=num('sel');if(select!==null)return read(['a','b','c','d'][select]);const all=['a','b','c','d'].map(k=>api.bits(read(k)));return api.fromBits(all[0].map((v,i)=>all.every(a=>a[i]===v)&&(v===0||v===1)?v:'X'));}
    if(id==='std.display8/1')return read('in');
    if(id==='std.split8/1')return sig(api.bits(read('in'))[Number(name.slice(1))]);
    if(id==='std.merge8/1')return api.fromBits(Array.from({length:8},(_,i)=>api.bits(read('b'+i))[0]));
    if(id==='std.split16/1')return api.fromBits(api.bits(read('in')).slice(name==='lo'?0:8,name==='lo'?8:16));
    if(id==='std.merge16/1')return api.fromBits([...api.bits(read('lo')),...api.bits(read('hi'))]);
    if(id==='std.pc16/1')return name==='out'?state.q:sig(state.halted?1:0);
    if(id==='std.fetch-execute/1')return sig(name==='halted'?state.halted?1:0:state.halted?0:name==='fetch'?1-state.phase:state.phase);
    if(id.includes('.alu')){const a=num('a'),b=num('b'),op=num('op'),w=widthOf(id),mask=2**w-1;if(a===null||b===null||op===null||op>13)return x();let result,carry=0;switch(op){case 0:result=b;break;case 1:result=a+b;carry=result>mask?1:0;break;case 2:result=a-b;carry=a>=b?1:0;break;case 3:result=a&b;break;case 4:result=a|b;break;case 5:result=a^b;break;case 6:result=~a;break;case 7:result=a*(2**(b&(w-1)));carry=result>mask?1:0;break;case 8:result=a>>>(b&(w-1));break;case 9:result=a;break;case 10:result=a*b;carry=result>mask?1:0;break;case 11:result=a===b?1:0;break;case 12:result=a<b?1:0;break;case 13:result=a>b?1:0;break;}result&=mask;return sig(name==='out'?result:name==='zero'?result===0?1:0:carry);}
    if(id==='std.build8-decoder/1'){
      const instruction=num('instruction'),execute=num('execute'),zero=num('zero'),opcode=instruction===null?-1:instruction>>>8,operand=instruction===null?0:instruction&255;
      const bad=instruction===null||opcode>15||([0,11,12,13].includes(opcode)&&operand!==0)||([14,15].includes(opcode)&&operand>7)||execute===null||(execute===1&&opcode===10&&zero===null);
      const active=execute===1&&!bad,values={immediate:operand,address:operand,target:operand,alu:opcode>=2&&opcode<=6?opcode-1:opcode===14?7:opcode===15?8:0,select:opcode===7?1:opcode===12?2:0,load_a:active&&[1,2,3,4,5,6,7,12,14,15].includes(opcode)?1:0,write_ram:active&&opcode===8?1:0,write_out:active&&opcode===11?1:0,pc_enable:active&&opcode!==13?1:0,pc_load:active&&(opcode===9||opcode===10&&zero===1)?1:0,stop:execute===1&&(bad||opcode===13)?1:0,fault:execute===1&&bad?1:0};return sig(values[name]);
    }
    return x();
  }
  function sample(id,params,state,read,api){
    const num=p=>known(read(p),api),r=num('reset');if(r===1)return reset(id,params,state,'cold',api);
    const next=JSON.parse(JSON.stringify(state));
    if(id.includes('.register')){const en=num('en');if(r===null||en===null)next.q=api.signal('X',widthOf(id));else if(en===1)next.q=api.fromBits(api.bits(read('d')).map(x=>x==='Z'?'X':x));return next;}
    if(id.includes('.ram')){const write=num('write');if(r===null||write===null){next.fault='E_UNKNOWN_CONTROL';return next;}if(write===1){const address=num('address'),data=num('data');if(address===null||data===null)next.fault='E_UNKNOWN_WRITE';else next.memory[address]=data;}return next;}
    if(id.includes('.fifo')){const push=num('push'),pop=num('pop');if(r===null||push===null||pop===null){next.fault='E_UNKNOWN_CONTROL';return next;}if(pop===1){if(next.queue.length)next.queue.shift();else next.fault='E_FIFO_EMPTY';}if(push===1){const value=num('data');if(value===null)next.fault='E_UNKNOWN_WRITE';else if(next.queue.length>=params.capacity)next.fault='E_FIFO_FULL';else next.queue.push(value);}return next;}
    if(id==='std.pc16/1'){if(state.halted)return next;const en=num('en'),halt=num('halt'),load=num('load');if(r===null||halt===null||en===null||en===1&&load===null){next.q=api.signal('X',16);next.halted=true;next.fault='E_UNKNOWN_CONTROL';return next;}if(halt===1){next.halted=true;return next;}if(en===1){const value=load===1?num('target'):known(state.q,api);if(value===null){next.q=api.signal('X',16);next.halted=true;next.fault='E_UNKNOWN_PC';}else next.q=api.signal(load===1?value:(value+1)&65535,16);}return next;}
    if(id==='std.fetch-execute/1'){if(state.halted)return next;const halt=num('halt');if(r===null||halt===null){next.fault='E_UNKNOWN_CONTROL';next.halted=true;}else if(halt===1)next.halted=true;else{next.phase=1-state.phase;next.ticks=String(BigInt(state.ticks)+1n);}return next;}
    return next;
  }
  function validateState(id,params,state,api){
    const expected=Object.keys(fresh(id,params,api)).sort();if(!state||Object.keys(state).sort().join(',')!==expected.join(','))throw new Error('硬件快照字段不符');
    const width=widthOf(id),word=v=>Number.isInteger(v)&&v>=0&&v<2**width;
    if(Object.hasOwn(state,'q'))api.checkSignal(state.q,id==='std.pc16/1'?16:width);
    if(Object.hasOwn(state,'fault')&&state.fault!==null&&!['E_UNKNOWN_CONTROL','E_UNKNOWN_WRITE','E_FIFO_EMPTY','E_FIFO_FULL','E_UNKNOWN_PC'].includes(state.fault))throw new Error('硬件故障快照无效');
    if(Object.hasOwn(state,'memory')&&(!Array.isArray(state.memory)||state.memory.length!==256||!state.memory.every(word)))throw new Error('RAM快照无效');
    if(Object.hasOwn(state,'queue')&&(!Array.isArray(state.queue)||state.queue.length>params.capacity||!state.queue.every(word)))throw new Error('FIFO快照无效');
    if(Object.hasOwn(state,'halted')&&typeof state.halted!=='boolean')throw new Error('停止状态无效');
    if(Object.hasOwn(state,'phase')&&(![0,1].includes(state.phase)||typeof state.ticks!=='string'||!/^(0|[1-9][0-9]*)$/.test(state.ticks)))throw new Error('取指状态无效');
    return state;
  }
  const boards=[{id:'calculator8',name:'8 位计算器',description:'改变两个数字和运算码，真实 ALU 计算结果。'},{id:'keyboard-display',name:'键盘与显示',description:'字节输入经过寄存器，在下一拍更新显示。'},{id:'memory-lab',name:'存储读写实验',description:'选择地址与数据，开启写使能后走一拍，再从 RAM 读回。'},{id:'fifo-lab',name:'消息队列',description:'逐拍推入和弹出字节，观察先进先出和容量。'}];
  function circuit(){return typeof module==='object'&&module.exports?require('./circuit.js'):globalThis.CircuitLab;}
  async function buildBoard(id){const C=circuit(),p=await C.createProject(boards.find(b=>b.id===id)?.name||id),view={positions:{}},input=(id,width,value=0)=>{C.addInput(p,id,id,value,width);},output=(id,width)=>C.addOutput(p,id,id,width),wire=(id,a,b)=>C.addWire(p,id,a,b),B=C.boundary,E=C.ep;
    if(id==='calculator8'){input('a',8,7);input('b',8,5);input('operation',4,1);C.createInstance(p,'std.alu8/1','alu');output('result',8);output('zero',1);output('carry',1);for(const x of ['a','b'])wire(x,B(x),E('alu',x));wire('op',B('operation'),E('alu','op'));for(const [a,b]of [['out','result'],['zero','zero'],['carry','carry']])wire(a,E('alu',a),B(b));}
    else if(id==='keyboard-display'){input('key',8,65);input('latch',1,1);input('reset',1);C.createInstance(p,'std.register8/1','key_register');C.createInstance(p,'std.display8/1','display');output('character',8);for(const[a,b]of[['key','d'],['latch','en'],['reset','reset']])wire(a,B(a),E('key_register',b));wire('held',E('key_register','q'),E('display','in'));wire('screen',E('display','out'),B('character'));}
    else if(id==='memory-lab'){for(const[id,w,value]of[['address',8,3],['data',8,42],['write',1,0],['reset',1,0]])input(id,w,value);C.createInstance(p,'std.ram8/1','ram');output('read',8);output('fault',1);for(const id of ['address','data','write','reset'])wire(id,B(id),E('ram',id));wire('read',E('ram','out'),B('read'));wire('fault',E('ram','fault'),B('fault'));}
    else if(id==='fifo-lab'){for(const[id,w,value]of[['data',8,65],['push',1,0],['pop',1,0],['reset',1,0]])input(id,w,value);C.createInstance(p,'std.fifo8/1','fifo');for(const id of ['data','push','pop','reset'])wire(id,B(id),E('fifo',id));for(const[id,w]of[['out',8],['empty',1],['full',1],['count',9],['fault',1]]){output(id,w);wire('show_'+id,E('fifo',id),B(id));}}
    else throw new Error('未知硬件实验：'+id);
    let i=0;for(const n of p.circuit.instances)view.positions[n.id]={x:400+(i++%3)*300,y:150};i=0;for(const port of p.circuit.inputs)view.positions['boundary:'+port.id]={x:40,y:30+i++*140};i=0;for(const port of p.circuit.outputs)view.positions['boundary:'+port.id]={x:1000,y:30+i++*140};return {project:await C.importProject(p),view,source:'',sources:{}};
  }
  return {models,list,boards,supported,defaultParameters,validateParameters,fresh,reset,output,sample,validateState,known,buildBoard};
});
