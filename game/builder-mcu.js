(function(root,factory){const api=typeof module==='object'&&module.exports?factory(require('./circuit.js'),require('./hardware-v3.js')):factory(root.CircuitLab,root.HardwareV3);if(typeof module==='object'&&module.exports)module.exports=api;else root.BuilderMCU=api;})(typeof globalThis!=='undefined'?globalThis:this,function(C,H){
  'use strict';
  const NAMES=['NOP','LDI','ADDI','SUBI','ANDI','ORI','XORI','LOAD','STORE','JMP','JZ','OUT','IN','HALT','SHL','SHR'];
  const clone=x=>JSON.parse(JSON.stringify(x));
  function assemble(source){
    const bad=(line,error)=>({ok:false,words:[],sourceMap:[],error:'第 '+line+' 行：'+error,line});
    if(typeof source!=='string'||source.length>30000)return bad(1,'程序需要不超过30000字符的文本');
    const labels=new Map(),instructions=[];const lines=source.split(/\r?\n/);
    for(let i=0;i<lines.length;i++){let text=lines[i].split(';')[0].trim();if(!text)continue;const label=/^([A-Z_][A-Z0-9_]*):/i.exec(text);if(label){const name=label[1].toUpperCase();if(labels.has(name))return bad(i+1,'重复标签');labels.set(name,instructions.length);text=text.slice(label[0].length).trim();if(!text)continue;}const parsed=/^([A-Z]+)(?:\s+([^\s,]+))?$/i.exec(text);if(!parsed||!NAMES.includes(parsed[1].toUpperCase()))return bad(i+1,'未知指令或参数格式');instructions.push({op:NAMES.indexOf(parsed[1].toUpperCase()),arg:parsed[2],line:i+1});if(instructions.length>256)return bad(i+1,'ROM最多256条指令');}
    if(!instructions.length)return bad(1,'至少需要一条指令');const words=[],sourceMap=[];
    for(let address=0;address<instructions.length;address++){const p=instructions[address],unary=[0,11,12,13].includes(p.op);if(unary&&p.arg!==undefined||!unary&&p.arg===undefined)return bad(p.line,unary?'该指令不接参数':'该指令需要一个字节参数或跳转标签');let value=0;if(!unary){if([9,10].includes(p.op)&&labels.has(p.arg.toUpperCase())){value=labels.get(p.arg.toUpperCase());if(value>=instructions.length)return bad(p.line,'标签后没有指令');}else{if(!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(p.arg))return bad(p.line,'未知标签或无效数字');value=Number(p.arg);}if(!Number.isInteger(value)||value<0||value>255||[14,15].includes(p.op)&&value>7)return bad(p.line,'参数超出范围');}words.push((p.op<<8)|value);sourceMap.push({address,line:p.line});}
    return {ok:true,words,sourceMap,error:null,line:null};
  }
  const SAMPLES=[
    {id:'build8-calculator',name:'自己组装 · 计算并显示',description:'7+5 写入 RAM[3]，由独立输出寄存器显示 12。',source:'LDI 7\nADDI 5\nSTORE 3\nOUT\nHALT'},
    {id:'build8-counter',name:'自己组装 · 程序计数',description:'可观察 PC、IR、ALU、累加器与 RAM，程序循环计数。',source:'LDI 0\nloop: OUT\nADDI 1\nSTORE 0\nJMP loop'},
    {id:'build8-keyboard',name:'自己组装 · 键盘回显',description:'每轮 IN 从实际输入总线读键值，再写到输出寄存器。',source:'loop: IN\nSTORE 1\nOUT\nJMP loop'},
    {id:'build8-branch',name:'自己组装 · 条件分支',description:'从3递减，到零时跳转并显示99。',source:'LDI 3\nloop: SUBI 1\nJZ done\nJMP loop\ndone: LDI 99\nOUT\nHALT'}
  ];
  const steps=[
    {title:'建立计算路径',description:'ALU 的 A 接累加寄存器 Q，B 接译码器 IMMEDIATE，OUT 经四路选择器接回累加寄存器 D。'},
    {title:'建立程序读取',description:'PC.OUT 接 ROM.ADDRESS，ROM.OUT 接指令寄存器 D，指令寄存器 Q 接译码器 INSTRUCTION。'},
    {title:'分开取指和执行',description:'控制器 FETCH 接指令寄存器 EN，EXECUTE 接译码器 EXECUTE；只有执行拍能改累加器、RAM、PC 和输出。'},
    {title:'加入数据与输入输出',description:'译码器控制 RAM.WRITE 和输出寄存器 EN；RAM.OUT 与键盘总线分别接选择器 B/C。'},
    {title:'运行并主动改造',description:'先逐拍运行计算示例；改 ROM 程序、断开 ALU 反馈线或替换运算元件，观察行为真实改变。'}
  ];
  async function build(source=SAMPLES[0].source){
    const sample=SAMPLES.find(s=>s.id===source);if(sample)source=sample.source;const a=assemble(source);if(!a.ok)throw new Error(a.error);
    const project=await C.createProject(sample?.name||'Build8 · 自组装 MCU'),view={positions:{}},E=C.ep,B=C.boundary;
    C.addInput(project,'key','键盘字节',65,8);C.addInput(project,'reset','同步复位',0,1);
    for(const[id,name,width]of[['value','输出数值',8],['pc','程序地址',16],['instruction','指令字',16],['accumulator','累加器',8],['fetch','取指拍',1],['execute','执行拍',1],['halted','停止',1],['fault','非法指令',1]])C.addOutput(project,id,name,width);
    const items=[['pc','std.pc16/1','程序计数器',70,100],['program_rom','std.rom16/1','程序 ROM',360,100],['instruction_register','std.register16/1','指令寄存器',670,100],['control','std.build8-decoder/1','控制译码',1000,100],['sequencer','std.fetch-execute/1','两拍时序',70,480],['accumulator','std.register8/1','累加寄存器',650,750],['zero','std.iszero8/1','零标志',1020,790],['alu','std.alu8/1','实际运算单元',650,430],['data_ram','std.ram8/1','数据 RAM',1380,100],['bus','std.mux8/1','写回总线选择',1370,620],['output','std.register8/1','GPIO 输出寄存器',1740,470],['display','std.display8/1','数值/字符显示',2060,470],['zero_byte','std.constant8/1','备用总线常量',1030,1080]];
    for(const[id,model,label,x,y]of items){C.createInstance(project,model,id,label);view.positions[id]={x,y};}
    Object.assign(project.circuit.instances.find(n=>n.id==='program_rom').parameters,{contents:a.words,source});
    let index=0;const wire=(from,to,id)=>C.addWire(project,id||'signal_'+index++,from,to),link=(a,b,c,d,id)=>wire(E(a,b),E(c,d),id);
    link('pc','out','program_rom','address','pc_to_rom');link('program_rom','out','instruction_register','d','rom_to_ir');link('instruction_register','q','control','instruction','ir_to_control');
    link('sequencer','fetch','instruction_register','en','fetch_enable');link('sequencer','execute','control','execute','execute_enable');link('control','stop','sequencer','halt','stop_sequence');link('control','stop','pc','halt','stop_pc');
    link('control','pc_enable','pc','en');link('control','pc_load','pc','load');link('control','target','pc','target');
    link('accumulator','q','alu','a','acc_to_alu');link('control','immediate','alu','b','immediate_to_alu');link('control','alu','alu','op','operation_to_alu');link('alu','out','bus','a','alu_writeback');
    link('data_ram','out','bus','b','ram_writeback');wire(B('key'),E('bus','c'),'key_to_bus');link('zero_byte','out','bus','d');link('control','select','bus','sel');link('bus','out','accumulator','d','bus_to_acc');link('control','load_a','accumulator','en');
    link('accumulator','q','zero','in');link('zero','zero','control','zero');link('control','address','data_ram','address');link('accumulator','q','data_ram','data');link('control','write_ram','data_ram','write');
    link('accumulator','q','output','d','acc_to_output');link('control','write_out','output','en');link('output','q','display','in');
    for(const id of ['pc','instruction_register','sequencer','accumulator','data_ram','output'])wire(B('reset'),E(id,'reset'),'reset_'+id);
    for(const[node,port,id]of [['display','out','value'],['pc','out','pc'],['instruction_register','q','instruction'],['accumulator','q','accumulator'],['sequencer','fetch','fetch'],['sequencer','execute','execute'],['sequencer','halted','halted'],['control','fault','fault']])wire(E(node,port),B(id),'observe_'+id);
    view.positions['boundary:key']={x:980,y:1120};view.positions['boundary:reset']={x:40,y:820};index=0;for(const p of project.circuit.outputs)view.positions['boundary:'+p.id]={x:2420,y:30+index++*160};
    return {project:await C.importProject(project),view,source,sources:{'build8:program_rom':source},lesson:null};
  }
  async function applyProgram(project,source,romId='program_rom'){const assembled=assemble(source);if(!assembled.ok)throw new Error(assembled.error);const next=clone(project),n=next.circuit.instances.find(n=>n.id===romId);if(!n)throw new Error('程序ROM不存在');const d=next.definitions.find(d=>d.stableId===n.definition.stableId&&d.revision===n.definition.revision);if(d?.model.id!=='std.rom16/1')throw new Error('程序需要16位ROM');Object.assign(n.parameters,{contents:assembled.words,source});return C.importProject(next);}
  function inspect(runtime,scope=''){const p=scope?scope+'/':'',state=runtime.inspect(),instances=state.instances,value=id=>{const s=instances[p+id]?.hardware?.q;if(!s)return null;return H.known(s,C);};return {kind:'build8',time:state.time,pc:value('pc'),instruction:value('instruction_register'),accumulator:value('accumulator'),output:value('output'),phase:instances[p+'sequencer']?.hardware?.phase??null,halted:instances[p+'sequencer']?.hardware?.halted??null,ram:instances[p+'data_ram']?.hardware?.memory?.slice()||[],signals:state.ports};}
  async function verify(project,source,expected,ticks=64){const a=assemble(source);if(!a.ok)return {ok:false,error:a.error};if(!expected||!Object.keys(expected).length)return {ok:false,error:'验证需要明确的输出、寄存器或 RAM 预期'};if(!Number.isInteger(ticks)||ticks<0||ticks>100000)return {ok:false,error:'验证拍数应为0—100000'};const allowed=['output','pc','accumulator','halted','ram'];if(Object.keys(expected).some(k=>!allowed.includes(k)))return {ok:false,error:'未知验证字段'};const r=new C.Runtime(await C.importProject(project)),rom=project.circuit.instances.find(n=>n.id==='program_rom');if(!rom||JSON.stringify(rom.parameters.contents)!==JSON.stringify(a.words))return {ok:false,error:'当前 ROM 与待验证程序不一致'};r.advance(BigInt(ticks));const state=inspect(r),checks=Object.entries(expected).flatMap(([key,value])=>key==='ram'?Object.entries(value).map(([address,v])=>({field:'ram['+address+']',expected:v,actual:state.ram[Number(address)],ok:state.ram[Number(address)]===v})):[{field:key,expected:value,actual:state[key],ok:state[key]===value}]);return {ok:checks.length>0&&checks.every(c=>c.ok)&&!r.inspect().issues.length,checks,state};}
  return {NAMES,SAMPLES,steps,assemble,build,applyProgram,inspect,verify};
});
