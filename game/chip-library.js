/* ChipLibrary 0.2 — editable circuits made only from registered gates and DFFs. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChipLibrary = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const lab = () => root.CircuitLab || (typeof require === 'function' ? require('./circuit.js') : null);
  const bits = (prefix, width, name) => Array.from({length:width}, (_, i) => ({id:prefix+i,name:(name||prefix.toUpperCase())+i}));
  const port = (id, name) => ({id,name:name||id.toUpperCase()});
  const control = [port('en','EN · 允许更新'),port('reset','RESET · 清零')];
  const specs = [
    {id:'half-adder',name:'半加器',category:'算术',description:'两位相加，输出低位和进位。',inputs:[port('a','A'),port('b','B')],outputs:[port('sum','SUM · 和'),port('carry','CARRY · 进位')],usage:'输入 A、B；SUM + 2×CARRY 等于 A+B。'},
    {id:'full-adder',name:'全加器',category:'算术',description:'把 A、B 和输入进位一起相加。',inputs:[port('a','A'),port('b','B'),port('cin','CIN · 输入进位')],outputs:[port('sum','SUM · 和'),port('carry','CARRY · 进位')],usage:'CIN 可接上一级进位，也可固定为 0。'},
    ...[2,4].map(width=>({id:'adder'+width,name:width+' 位加法器',category:'算术',description:'逐位计算两个 '+width+' 位数，可继续级联。',width,inputs:[...bits('a',width,'A'),...bits('b',width,'B'),port('cin','CIN · 输入进位')],outputs:[...bits('s',width,'SUM'),port('carry','CARRY · 溢出进位')],usage:'a0、b0、s0 都是最低位；结果为 A+B+CIN，最高进位另行输出。'})),
    ...[2,4].map(width=>({id:'register'+width,name:width+' 位寄存器',category:'记忆',description:'同时记住 '+width+' 位数据，关闭使能后保持。',width,sequential:true,inputs:[...bits('d',width,'D'),...control],outputs:bits('q',width,'Q'),usage:'EN=1 时下一拍写入全部 D；EN=0 保持；RESET=1 下一拍清零，优先于 EN。'})),
    ...[2,4].map(width=>({id:'counter'+width,name:width+' 位计数器',category:'计数与时序',description:'每拍加一，可暂停、清零，并在最大值后回到零。',width,sequential:true,inputs:control,outputs:bits('q',width,'Q'),usage:'EN=1 每 1 µs 加一；EN=0 保持；RESET=1 下一拍清零。q0 是最低位。'})),
    {id:'decoder2x4',name:'2—4 译码器',category:'选择与编码',description:'把二位数字转换成四选一输出。',inputs:bits('a',2,'地址 A'),outputs:bits('y',4,'Y'),usage:'A=a0+2×a1；仅 YA 输出 1，其余输出 0。'},
    {id:'mux4',name:'四选一选择器',category:'选择与编码',description:'让四路数据中的一路通过。',inputs:[...bits('d',4,'D'),...bits('sel',2,'SEL')],outputs:[port('out','OUT · 选中数据')],usage:'SEL=sel0+2×sel1；输出对应的 D0—D3。'},
    {id:'comparator2',name:'2 位比较器',category:'算术',description:'比较两个二位数，分别输出大于、等于、小于。',inputs:[...bits('a',2,'A'),...bits('b',2,'B')],outputs:[port('gt','A > B'),port('eq','A = B'),port('lt','A < B')],usage:'a0、b0 是最低位；已知输入下 GT、EQ、LT 恰有一个为 1。'},
    {id:'d-memory',name:'可保持的一位记忆',category:'记忆',description:'把一枚 DFF 包装成带明确控制端的可复用芯片。',width:1,sequential:true,inputs:[port('d','D · 数据'),...control],outputs:[port('q','Q · 记忆值')],usage:'EN=1 下一拍记住 D；EN=0 保持；RESET=1 下一拍清零。'},
    {id:'shift4',name:'4 位移位寄存器',category:'记忆',description:'每拍把一位串行数据送入，并将原数据向高位移动。',sequential:true,inputs:[port('din','DIN · 串行输入'),...control],outputs:bits('q',4,'Q'),usage:'更新时 q0←DIN、q1←旧 q0、q2←旧 q1、q3←旧 q2；q3 可作串行输出。'},
    {id:'divider2',name:'二分频器',category:'计数与时序',description:'允许更新时每拍翻转，输出周期为两拍。',sequential:true,inputs:control,outputs:[port('q','Q · 二分频')],usage:'EN=1 时 Q 按 0、1、0、1 变化；EN=0 保持。RESET=1 下一拍回到 0。'},
    {id:'parity4',name:'4 位奇偶校验',category:'选择与编码',description:'判断四位数据中 1 的个数是奇数还是偶数。',inputs:bits('d',4,'D'),outputs:[port('odd','ODD · 奇数'),port('even','EVEN · 偶数')],usage:'ODD 是四位异或；EVEN 是其取反。全 0 时 EVEN=1。'},
    {id:'demux4',name:'一分四分配器',category:'选择与编码',description:'把一路数据送到选中的输出，其余输出为零。',inputs:[port('din','DIN · 数据'),...bits('sel',2,'SEL')],outputs:bits('y',4,'Y'),usage:'SEL=sel0+2×sel1；只有所选输出跟随 DIN。'},
    {id:'edge-pulse',name:'上升沿脉冲',category:'计数与时序',description:'比较前后两次采样，把 0→1 变化变成一拍脉冲。',sequential:true,inputs:[port('din','DIN · 观察输入'),...control],outputs:[port('pulse','PULSE · 上升沿')],usage:'EN=1 时采样，DIN 从上次采样的 0 变为 1 后输出一拍高。EN=0 停止采样并输出 0；RESET 清空两级记忆。'},
    {id:'alu2',name:'2 位逻辑算术单元',category:'算术',description:'同一组输入可以做与、或、异或或加法。',inputs:[...bits('a',2,'A'),...bits('b',2,'B'),...bits('op',2,'OP'),port('cin','CIN · 加法进位')],outputs:[...bits('r',2,'结果 R'),port('carry','CARRY · 加法进位')],usage:'OP=op0+2×op1：0 与、1 或、2 异或、3 加法。只有加法使用 CIN 并可能输出 CARRY。'}
  ];
  const list = specs.map(s=>({id:s.id,stableId:'lib.'+s.id.replace(/-/g,'_'),revision:1,name:s.name,category:s.category,description:s.description,usage:s.usage,sequential:!!s.sequential,editable:true,ports:[...s.inputs.map(p=>({...p,direction:'in',width:1})),...s.outputs.map(p=>({...p,direction:'out',width:1}))]}));
  const boards = [
    {id:'counter-display',name:'四位计数灯',category:'计数与时序',description:'一枚四位计数器驱动四盏灯，观察二进制计数、保持和清零。',usage:'Q0 是最低位。推荐逐拍运行；关闭 EN 后保持当前数值。',suggestedStepUs:1},
    {id:'running-lights',name:'四路流水灯',category:'计数与时序',description:'二位计数器经过译码器，让四盏灯依次亮起。',usage:'EN=1 时每拍移动一格；EN=0 保持；RESET=1 回到第一盏灯。',suggestedStepUs:1},
    {id:'arithmetic-board',name:'四位加法实验板',category:'算术',description:'输入两个 0—15 的数，以五盏灯表示完整结果。',usage:'A0、B0、SUM0 是最低位；CARRY 表示第 5 位。'},
    {id:'dual-registers',name:'两份独立记忆',category:'记忆',description:'两枚相同寄存器共享数据，但分别控制写入。',usage:'用 EN_A、EN_B 选择哪份记忆更新；另一份值保持不变。',suggestedStepUs:1},
    {id:'code-match',name:'二位代码匹配器',category:'选择与编码',description:'比较输入与预设代码，让匹配和不匹配指示灯互斥亮起。',usage:'把 CODE0/1 设为目标，改变 KEY0/1，MATCH 只在相等时亮。'},
    {id:'mini-alu',name:'四种运算实验板',category:'算术',description:'一枚可打开的二位 ALU，让同一组数据参与四种运算。',usage:'OP1 OP0：00 与、01 或、10 异或、11 加法；CIN 只参与加法。'}
  ];

  function cleanDefinitions(project) {
    const used=new Set(),visit=reference=>{
      const k=reference.stableId+'@'+reference.revision;if(used.has(k))return;used.add(k);
      const d=project.definitions.find(x=>x.stableId===reference.stableId&&x.revision===reference.revision);
      if(d?.model.kind==='composite')for(const n of d.model.circuit.instances)visit(n.definition);
    };
    for(const n of project.circuit.instances)visit(n.definition);
    project.definitions=project.definitions.filter(d=>used.has(d.stableId+'@'+d.revision));
    project.locks=project.definitions.map(lab().identity);
  }
  function builder(project, specification) {
    const L=lab(),view={positions:{},width:2200,height:1400,initialPaused:true,title:specification.name,...(specification.sequential?{suggestedStepUs:1}:{})};
    let sequence=0,wireNumber=0;
    const inputs={};
    for(const [i,p]of specification.inputs.entries()){
      L.addInput(project,p.id,p.name,p.id==='en'?1:0,1);inputs[p.id]=L.boundary(p.id);
      view.positions['boundary:'+p.id]={x:30+220*Math.floor(i/6),y:35+200*(i%6)};
    }
    for(const p of specification.outputs)L.addOutput(project,p.id,p.name,1);
    const connect=(from,to)=>L.addWire(project,'w'+(++wireNumber),from,to);
    const gate=(model,signals={},name)=>{
      const id='g'+(++sequence);L.createInstance(project,'std.'+model+'/1',id,name||L.catalog['std.'+model+'/1'].name);
      const i=sequence-1;view.positions[id]={x:520+230*Math.floor(i/6),y:35+200*(i%6)};
      for(const [p,signal]of Object.entries(signals))connect(signal,L.ep(id,p));
      return {id,out:L.ep(id,model==='dff'?'q':'out')};
    };
    const unary=(type,a)=>gate(type,{in:a}).out;
    const binary=(type,a,b)=>gate(type,{a,b}).out;
    const and=(a,b)=>binary('and',a,b),or=(a,b)=>binary('or',a,b),xor=(a,b)=>binary('xor',a,b),not=a=>unary('not',a);
    const mux=(a,b,sel)=>gate('mux',{a,b,sel}).out;
    const remember=(data,en=inputs.en,reset=inputs.reset,name)=>gate('dff',{...(data?{d:data}:{}),en,reset},name);
    const out=(id,value)=>connect(value,L.boundary(id));
    const half=(a,b)=>({sum:xor(a,b),carry:and(a,b)});
    const full=(a,b,cin)=>{const first=half(a,b),second=half(first.sum,cin);return {sum:second.sum,carry:or(first.carry,second.carry)};};
    const add=(a,b,cin)=>{const result=[];let carry=cin;for(let i=0;i<a.length;i++){const f=full(a[i],b[i],carry);result.push(f.sum);carry=f.carry;}return {result,carry};};
    const decode=(s0,s1)=>{const z0=not(s0),z1=not(s1);return [and(z0,z1),and(s0,z1),and(z0,s1),and(s0,s1)];};
    const finish=()=>{
      const x=Math.min(2130,Math.max(1040,570+230*Math.ceil(sequence/6)));
      specification.outputs.forEach((p,i)=>view.positions['boundary:'+p.id]={x,y:35+200*i});
      cleanDefinitions(project);return {project,view};
    };
    return {L,view,inputs,connect,gate,and,or,xor,not,mux,remember,out,half,full,add,decode,finish};
  }

  async function build(id) {
    const spec=specs.find(s=>s.id===id);if(!spec)throw new Error('未知芯片：'+id);
    const project=await lab().createProject(spec.name),b=builder(project,spec),i=b.inputs;
    if(id==='half-adder'||id==='full-adder'){
      const r=id==='half-adder'?b.half(i.a,i.b):b.full(i.a,i.b,i.cin);b.out('sum',r.sum);b.out('carry',r.carry);
    }else if(id.startsWith('adder')){
      const r=b.add(Array.from({length:spec.width},(_,n)=>i['a'+n]),Array.from({length:spec.width},(_,n)=>i['b'+n]),i.cin);
      r.result.forEach((s,n)=>b.out('s'+n,s));b.out('carry',r.carry);
    }else if(id.startsWith('register')||id==='d-memory'){
      for(let n=0;n<spec.width;n++){const single=id==='d-memory';b.out(single?'q':'q'+n,b.remember(i[single?'d':'d'+n],i.en,i.reset,'记忆位 '+n).out);}
    }else if(id.startsWith('counter')||id==='divider2'){
      const width=spec.width||1,qs=Array.from({length:width},(_,n)=>b.remember(null,i.en,i.reset,'计数位 '+n));
      for(let n=0;n<width;n++){
        let next;if(n===0)next=b.not(qs[n].out);else{let lower=qs[0].out;for(let k=1;k<n;k++)lower=b.and(lower,qs[k].out);next=b.xor(qs[n].out,lower);}
        b.connect(next,b.L.ep(qs[n].id,'d'));b.out(id==='divider2'?'q':'q'+n,qs[n].out);
      }
    }else if(id==='decoder2x4')b.decode(i.a0,i.a1).forEach((s,n)=>b.out('y'+n,s));
    else if(id==='mux4')b.out('out',b.mux(b.mux(i.d0,i.d1,i.sel0),b.mux(i.d2,i.d3,i.sel0),i.sel1));
    else if(id==='comparator2'){
      const sameHi=b.gate('xnor',{a:i.a1,b:i.b1}).out,sameLo=b.gate('xnor',{a:i.a0,b:i.b0}).out;
      b.out('eq',b.and(sameHi,sameLo));
      b.out('gt',b.or(b.and(i.a1,b.not(i.b1)),b.and(sameHi,b.and(i.a0,b.not(i.b0)))));
      b.out('lt',b.or(b.and(b.not(i.a1),i.b1),b.and(sameHi,b.and(b.not(i.a0),i.b0))));
    }else if(id==='shift4'){
      let previous=i.din;for(let n=0;n<4;n++){const q=b.remember(previous,i.en,i.reset,'移位 '+n).out;b.out('q'+n,q);previous=q;}
    }else if(id==='parity4'){
      const odd=b.xor(b.xor(i.d0,i.d1),b.xor(i.d2,i.d3));b.out('odd',odd);b.out('even',b.not(odd));
    }else if(id==='demux4')b.decode(i.sel0,i.sel1).forEach((s,n)=>b.out('y'+n,b.and(s,i.din)));
    else if(id==='edge-pulse'){
      const current=b.remember(i.din,i.en,i.reset,'本次采样').out,previous=b.remember(current,i.en,i.reset,'上次采样').out;
      b.out('pulse',b.and(i.en,b.and(current,b.not(previous))));
    }else if(id==='alu2'){
      const added=b.add([i.a0,i.a1],[i.b0,i.b1],i.cin);
      for(let n=0;n<2;n++){
        const a=i['a'+n],c=i['b'+n],lower=b.mux(b.and(a,c),b.or(a,c),i.op0),higher=b.mux(b.xor(a,c),added.result[n],i.op0);
        b.out('r'+n,b.mux(lower,higher,i.op1));
      }
      b.out('carry',b.and(added.carry,b.and(i.op0,i.op1)));
    }
    return b.finish();
  }

  async function entry(id) {
    const built=await build(id),meta=list.find(m=>m.id===id);
    const definition=await lab().encapsulate(built.project,meta.name,meta.stableId);
    return {definition:clone(definition),dependencies:clone(built.project.definitions),project:built.project,view:built.view};
  }
  function addDefinitions(project,definitions) {
    for(const definition of definitions){
      const old=project.definitions.find(d=>d.stableId===definition.stableId&&d.revision===definition.revision);
      if(old){if(old.contentHash!==definition.contentHash)throw new Error('定义版本冲突：'+definition.stableId);continue;}
      project.definitions.push(clone(definition));project.locks.push(lab().identity(definition));
    }
  }
  async function buildBoard(id) {
    const meta=boards.find(s=>s.id===id);if(!meta)throw new Error('未知应用板：'+id);
    const L=lab(),project=await L.createProject(meta.name),view={positions:{},width:2000,height:1400,initialPaused:true,title:meta.name,...(meta.suggestedStepUs?{suggestedStepUs:meta.suggestedStepUs}:{})};
    let wi=0,ni=0,inputs=0,outputs=0;
    const input=(portId,name,value=0)=>{L.addInput(project,portId,name,value,1);const p=inputs++;view.positions['boundary:'+portId]={x:30+220*Math.floor(p/6),y:35+200*(p%6)};return L.boundary(portId);};
    const output=(portId,name)=>{L.addOutput(project,portId,name,1);const p=outputs++;view.positions['boundary:'+portId]={x:1560+210*Math.floor(p/6),y:35+200*(p%6)};return L.boundary(portId);};
    const wire=(from,to)=>L.addWire(project,'w'+(++wi),from,to);
    const chip=async(libraryId,nodeId,x,y)=>{const e=await entry(libraryId);addDefinitions(project,[...e.dependencies,e.definition]);L.createInstance(project,e.definition.stableId,nodeId,e.definition.name);view.positions[nodeId]={x,y};return p=>L.ep(nodeId,p);};
    const simple=async(libraryId,nodeId)=>{
      const meta=list.find(s=>s.id===libraryId),p=await chip(libraryId,nodeId,720,150);
      for(const port of meta.ports){if(port.direction==='in')wire(input(port.id,port.name,port.id==='en'?1:0),p(port.id));else wire(p(port.id),output(port.id,port.name));}
    };
    if(id==='counter-display')await simple('counter4','counter');
    else if(id==='arithmetic-board')await simple('adder4','adder');
    else if(id==='mini-alu')await simple('alu2','alu');
    else if(id==='running-lights'){
      const counter=await chip('counter2','counter',530,100),decoder=await chip('decoder2x4','decoder',990,100);
      wire(input('en','EN · 继续流动',1),counter('en'));wire(input('reset','RESET · 回到起点'),counter('reset'));
      for(let n=0;n<2;n++)wire(counter('q'+n),decoder('a'+n));
      for(let n=0;n<4;n++)wire(decoder('y'+n),output('led'+n,'灯 '+(n+1)));
    }else if(id==='dual-registers'){
      const a=await chip('register2','memory_a',670,40),b=await chip('register2','memory_b',1010,590),data=[input('d0','共同数据 D0'),input('d1','共同数据 D1')],reset=input('reset','RESET · 同时清零');
      const ena=input('en_a','EN_A · 写入 A',1),enb=input('en_b','EN_B · 写入 B',0);
      for(let n=0;n<2;n++){wire(data[n],a('d'+n));wire(data[n],b('d'+n));wire(a('q'+n),output('a'+n,'A 记忆 '+n));wire(b('q'+n),output('b'+n,'B 记忆 '+n));}
      wire(ena,a('en'));wire(enb,b('en'));wire(reset,a('reset'));wire(reset,b('reset'));
    }else if(id==='code-match'){
      const compare=await chip('comparator2','compare',670,100);
      for(let n=0;n<2;n++){wire(input('key'+n,'输入 KEY'+n),compare('a'+n));wire(input('code'+n,'目标 CODE'+n,n===0?1:0),compare('b'+n));}
      const inverter='n'+(++ni);L.createInstance(project,'std.not/1',inverter,'不匹配');view.positions[inverter]={x:1120,y:370};
      wire(compare('eq'),output('match','MATCH · 匹配'));wire(compare('eq'),L.ep(inverter,'in'));wire(L.ep(inverter,'out'),output('different','DIFFERENT · 不匹配'));
    }
    cleanDefinitions(project);return {project,view};
  }

  const number=(values,prefix,width)=>Array.from({length:width},(_,n)=>values[prefix+n]*2**n).reduce((a,b)=>a+b,0);
  const unpack=(prefix,width,value)=>Object.fromEntries(Array.from({length:width},(_,n)=>[prefix+n,(value>>n)&1]));
  function expectedCombinational(spec,values) {
    const id=spec.id,v=values;
    if(id==='half-adder'||id==='full-adder'){const sum=v.a+v.b+(v.cin||0);return {sum:sum&1,carry:sum>>1};}
    if(id.startsWith('adder')){const result=number(v,'a',spec.width)+number(v,'b',spec.width)+v.cin;return {...unpack('s',spec.width,result),carry:(result>>spec.width)&1};}
    if(id==='decoder2x4')return Object.fromEntries(Array.from({length:4},(_,n)=>['y'+n,Number(n===number(v,'a',2))]));
    if(id==='mux4')return {out:v['d'+number(v,'sel',2)]};
    if(id==='comparator2'){const a=number(v,'a',2),b=number(v,'b',2);return {gt:Number(a>b),eq:Number(a===b),lt:Number(a<b)};}
    if(id==='parity4'){const odd=v.d0^v.d1^v.d2^v.d3;return {odd,even:1-odd};}
    if(id==='demux4')return Object.fromEntries(Array.from({length:4},(_,n)=>['y'+n,Number(n===number(v,'sel',2))*v.din]));
    if(id==='alu2'){const a=number(v,'a',2),b=number(v,'b',2),op=number(v,'op',2),sum=a+b+v.cin,r=op===0?a&b:op===1?a|b:op===2?a^b:sum;return {...unpack('r',2,r),carry:op===3?(sum>>2)&1:0};}
    throw new Error('没有组合验证合同：'+id);
  }
  function sequence(spec) {
    const rows=[],id=spec.id;
    const push=(label,inputs,expected)=>rows.push({label,inputs,expected});
    if(id.startsWith('register')||id==='d-memory'){
      const width=spec.width,max=2**width-1,input=n=>id==='d-memory'?{d:n}:unpack('d',width,n),output=n=>id==='d-memory'?{q:n}:unpack('q',width,n);
      for(let n=0;n<=max;n++){push('写入 '+n,{...input(n),en:1,reset:0},output(n));push('保持 '+n,{...input(n^max),en:0,reset:0},output(n));}
      push('清零优先于写入',{...input(max),en:1,reset:1},output(0));push('禁止写入时仍可清零',{...input(max),en:0,reset:1},output(0));
      push('解除复位并写入',{...input(max),en:1,reset:0},output(max));
    }else if(id.startsWith('counter')||id==='divider2'){
      const width=spec.width||1,max=2**width-1,output=n=>id==='divider2'?{q:n}:unpack('q',width,n);
      let value=0;for(let n=0;n<2**width+2;n++){value=(value+1)&max;push('连续计数 '+(n+1),{en:1,reset:0},output(value));}
      push('关闭使能保持',{en:0,reset:0},output(value));push('再次保持',{en:0,reset:0},output(value));
      push('清零优先于计数',{en:1,reset:1},output(0));push('恢复计数',{en:1,reset:0},output(1));push('禁止计数时清零',{en:0,reset:1},output(0));
    }else if(id==='shift4'){
      let value=0;for(const data of [1,0,1,1,0,0,0,0]){value=((value<<1)|data)&15;push('移入 '+data,{din:data,en:1,reset:0},unpack('q',4,value));}
      push('暂停移位',{din:1,en:0,reset:0},unpack('q',4,value));push('重新移入 1',{din:1,en:1,reset:0},unpack('q',4,1));
      push('复位覆盖输入',{din:1,en:1,reset:1},unpack('q',4,0));
    }else if(id==='edge-pulse'){
      let current=0,previous=0;
      for(const inputs of [{din:0,en:1,reset:0},{din:1,en:1,reset:0},{din:1,en:1,reset:0},{din:0,en:1,reset:0},{din:1,en:1,reset:0},{din:0,en:0,reset:0},{din:1,en:1,reset:0},{din:1,en:1,reset:1},{din:1,en:1,reset:0},{din:1,en:1,reset:0}]){
        if(inputs.reset){current=0;previous=0;}else if(inputs.en){previous=current;current=inputs.din;}
        push('采样 DIN='+inputs.din+'，EN='+inputs.en+'，RESET='+inputs.reset,inputs,{pulse:inputs.en&&current&&!previous?1:0});
      }
    }
    return rows;
  }
  function inspectValues(runtime,expected) {
    const actual=Object.fromEntries(Object.keys(expected).map(id=>[id,lab().scalar(runtime.getPort('$.'+id))]));
    return {ok:Object.keys(expected).every(id=>actual[id]===expected[id]),detail:'期望 '+JSON.stringify(expected)+'；实际 '+JSON.stringify(actual)};
  }
  async function runRows(project,rows,initial) {
    const result=await lab().validate(project);if(!result.ok)return {ok:false,checks:result.errors.map(e=>({label:'结构检查',ok:false,detail:e.message||e.code}))};
    const runtime=new (lab().Runtime)(clone(project)),checks=[];
    if(initial)checks.push({label:'冷启动为零',...inspectValues(runtime,initial)});
    for(const row of rows){
      for(const [id,value]of Object.entries(row.inputs))runtime.setInput(id,value);
      runtime.advance(1n,{force:true});checks.push({label:row.label,...inspectValues(runtime,row.expected)});
    }
    return {ok:checks.every(c=>c.ok),checks};
  }
  async function verify(id,project) {
    try{
      const spec=specs.find(s=>s.id===id);if(!spec)throw new Error('未知芯片：'+id);
      project=project||((await build(id)).project);
      if(spec.sequential)return await runRows(project,sequence(spec),Object.fromEntries(spec.outputs.map(p=>[p.id,0])));
      const rows=[];for(let value=0;value<2**spec.inputs.length;value++){
        const inputs=Object.fromEntries(spec.inputs.map((p,n)=>[p.id,(value>>n)&1]));rows.push({label:'输入 '+JSON.stringify(inputs),inputs,expected:expectedCombinational(spec,inputs)});
      }
      return await runRows(project,rows);
    }catch(error){return {ok:false,checks:[{label:'无法完成验证',ok:false,detail:error.message||String(error)}]};}
  }
  async function verifyBoard(id,project) {
    try{
      project=project||((await buildBoard(id)).project);
      if(id==='counter-display')return await verify('counter4',project);
      if(id==='arithmetic-board')return await verify('adder4',project);
      if(id==='mini-alu')return await verify('alu2',project);
      const rows=[];
      if(id==='running-lights'){
        let position=0;for(let tick=0;tick<12;tick++){const en=tick!==3&&tick!==4,reset=tick===9;position=reset?0:en?(position+1)%4:position;rows.push({label:'流水灯第 '+(tick+1)+' 拍',inputs:{en:Number(en),reset:Number(reset)},expected:Object.fromEntries(Array.from({length:4},(_,n)=>['led'+n,Number(n===position)]))});}
      }else if(id==='dual-registers'){
        let a=0,b=0;for(const [data,enA,enB,reset]of [[3,1,0,0],[1,0,1,0],[2,1,0,0],[0,0,0,0],[3,1,1,0],[3,0,0,1],[1,0,1,0]]){
          if(reset){a=0;b=0;}else{if(enA)a=data;if(enB)b=data;}
          rows.push({label:'D='+data+'，EN_A='+enA+'，EN_B='+enB+'，RESET='+reset,inputs:{...unpack('d',2,data),en_a:enA,en_b:enB,reset},expected:{...unpack('a',2,a),...unpack('b',2,b)}});
        }
      }else if(id==='code-match'){
        for(let key=0;key<4;key++)for(let code=0;code<4;code++)rows.push({label:'输入 '+key+' / 目标 '+code,inputs:{...unpack('key',2,key),...unpack('code',2,code)},expected:{match:Number(key===code),different:Number(key!==code)}});
      }else throw new Error('未知应用板：'+id);
      return await runRows(project,rows);
    }catch(error){return {ok:false,checks:[{label:'无法完成验证',ok:false,detail:error.message||String(error)}]};}
  }
  return {VERSION:'0.2.0',list,boards,build,entry,buildBoard,verify,verifyBoard};
});
