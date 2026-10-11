(function (root, factory) {
  const api = factory(root);
  root.LabLessons = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const SMART_LAMP_SOURCE = `LDI R0, 2          ; 0000: GPIO1输出，其余输入
ST R0, 0x4000      ; 0004
LDI R0, 3          ; 0008: 开启UART TX/RX
ST R0, 0x4103      ; 000C
LDI R0, 0x42       ; 0010: ASCII B
ST R0, 0x4100      ; 0014
LDI R6, 1          ; 0018: 按键掩码
LDI R7, 2          ; 001C: LED位
LDI R4, 0          ; 0020: 上次按键状态
loop:
LD R1, 0x4002      ; 0024
AND R1, R6         ; 0028
MOV R2, R1         ; 002C
XOR R2, R4         ; 0030
JZ R2, unchanged   ; 0034
JZ R1, released    ; 0038
LDI R0, 0x50       ; 003C: ASCII P
JMP send           ; 0040
released:
LDI R0, 0x52       ; 0044: ASCII R
send:
ST R0, 0x4100      ; 0048
MOV R4, R1         ; 004C
unchanged:
XOR R3, R7         ; 0050: R3冷启动为0
ST R3, 0x4001      ; 0054
WAIT 60000         ; 0058
JMP loop           ; 005C
`;

  const SMART_LAMP_HEX = '010002000c000040010003000c000341010042000c0000410106010001070200010400000b0102400501060002020100070204000e0250000e014400010050000d004800010052000c00004102040100070307000c030140100060ea0d002400';

  const LOOPBACK_SOURCE = `; 将 UART_TX 接到自己的 UART_RX。
; 只有实际收回 0x42，才允许点亮 GPIO1。
LDI R0, 2
ST R0, 0x4000
LDI R0, 3
ST R0, 0x4103
LDI R0, 0x42
ST R0, 0x4100
WAIT 1042
LD R1, 0x4101
LDI R2, 0x42
XOR R1, R2
JNZ R1, failed
LDI R0, 2
ST R0, 0x4001
HALT
failed:
HALT
`;

  const list = [
    {id:'first-wire',title:'第一根线',description:'补上缺失的连接，让两个开关共同点亮一盏灯。',goal:'只有 A 和 B 都是 1 时，指示灯才亮。',hints:['点击门的 OUT，再点击灯的输入端。','导线必须从输出接到输入；画面上相近不代表已经连接。','这是与门：00、01、10 输出 0，11 输出 1。'],templateId:'first-wire',category:'从 0 到 1'},
    {id:'or-alarm',title:'任一门开就报警',description:'观察两扇门怎样共同控制报警灯，也可以改成自己的实现。',goal:'只要 A、B 至少有一个是 1，报警灯就亮。',hints:['先试 A=0、B=1，观察报警灯。','与门需要两个都满足；或门只需要至少一个满足。','目标真值表是 00→0、01→1、10→1、11→1。'],templateId:'or-alarm',category:'从 0 到 1'},
    {id:'half-adder',title:'造一枚半加器',description:'把两个一位数相加，用两盏灯分别显示和与进位。',goal:'SUM 是低位，CARRY 是进位，两者共同表示 A+B。',hints:['先算 1+1：低位为 0，进位为 1。','异或门给出低位；与门给出同时为 1 的进位。','验证会检查全部四种输入，布局可以和模板不同。'],templateId:'half-adder',category:'自己造芯片'},
    {id:'full-adder',title:'把进位也算进去',description:'让上一级传来的进位参与相加，向更大的计算电路迈一步。',goal:'SUM + 2×CARRY = A+B+CIN，对八种输入都成立。',hints:['先把 A、B 相加，再把 CIN 加到低位。','最终进位来自前一次相加，或后一次产生的新进位。','用两个异或、两个与门和一个或门可以实现；其他正确设计也可以。'],templateId:'full-adder',category:'自己造芯片'},
    {id:'memory',title:'记住刚才的值',description:'试试写入、保持和清零：同一输入，不同历史会产生不同结果。',goal:'EN=1 时在下一微秒写入 D；EN=0 时保持；RESET=1 时清零。',hints:['暂停时输入会排队，点“推进 1 µs”后才生效。','先写入 1，再关闭 EN 并把 D 改为 0。','RESET 优先于 EN；两者都按全局时钟同步采样。'],templateId:'memory',category:'时间与记忆'},
    {id:'dual-memory',title:'相同芯片，各自记忆',description:'两份相同的电路共享时钟，但不共享记住的值。',goal:'分别控制 A、B 的写入使能，另一份记忆必须保持不变。',hints:['先让 EN_A=1、EN_B=0，再把 D 设为 1。','共享时钟不等于共享状态。','随后交换使能，验证 B 能改变而 A 不被覆盖。'],templateId:'dual-memory',category:'时间与记忆'},
    {id:'chip-package',title:'保存我的第一枚芯片',description:'把半加器封装，再作为一个真正的结构芯片放回画布。',goal:'使用一个封装芯片，并保持半加器全部四组结果正确。',hints:['先把当前半加器封装并保存到“我的芯片”，再选择“放入电路”；只留在库里还不算使用。','删除原来的 XOR 和 AND 两个门，保留 A、B、SUM、CARRY 四个边界；旧门与新芯片的输出不能并接，否则会驱动冲突。','把边界 A、B 接到新芯片的 a、b，再把芯片 sum、carry 接回 SUM、CARRY。四个引脚接好后，应用并重新启动，再验证。'],templateId:'chip-package',category:'保存与复用'},
    {id:'smart-lamp',title:'一块真正运行的控制板',description:'运行教学 Core8：程序点灯，按钮改变输入，串口传回消息。',goal:'上电发送 B，LED 自动闪烁，长按与释放分别收到一次 P 和 R。',hints:['VCC 和 GND 都要接对；LED 观察的是 GPIO1。','按钮释放为 Z，稳定的 0 来自明确的内置弱下拉。','程序约每 60 ms 查看一次按钮，短按可能错过；验证会保持按下 200 ms。'],templateId:'smart-lamp',category:'让程序进入电路'},
    {id:'faster-lamp',title:'改变灯的节奏',description:'在同一块板上修改程序，观察这次改变到底什么时候生效。',goal:'把 WAIT 60000 改为 30000，并应用固件，让第二次变化提前 30000 µs。',hints:['修改的是程序，不是指示灯动画速度。','源码修改后点击程序面板的「编译并应用程序」；旧固件不会在运行中悄悄改变。','目标是 t=16 µs 亮，t=30025 µs 灭；WAIT 的合法范围是 0—65535。'],templateId:'faster-lamp',category:'让程序进入电路'},
    {id:'uart-loopback',title:'把一个字节寄给自己',description:'串口先发送、再真正接收，只有收到正确数据才点亮灯。',goal:'通过 UART 回环收回 0x42 后点灯；断开回环时不能假装成功。',hints:['UART_TX 应连接 UART_RX，这是协议连接，不是普通数字线。','一个字节需要 1042 µs；接收端不会再等待第二个 1042 µs。','程序读取后比较数据再点灯；无条件点灯不能通过断线对照。'],templateId:'uart-loopback',category:'让程序进入电路'}
  ];

  const modules = [
    ...[
      ['std.not/1','非门','将 0 与 1 翻转。'],['std.and/1','与门','两个输入都是 1 才输出 1。'],
      ['std.or/1','或门','至少一个输入是 1 就输出 1。'],['std.xor/1','异或门','两个输入不同时输出 1。'],
      ['std.nand/1','与非门','与门结果取反。'],['std.nor/1','或非门','或门结果取反。'],
      ['std.xnor/1','同或门','两个输入相同时输出 1。'],['std.mux/1','二选一','SEL 选择让 A 或 B 通过。']
    ].map(([modelId,name,description])=>({modelId,name,description,category:'逻辑',phase:'Phase0',kind:'primitive',editable:false})),
    {modelId:'std.dff/1',name:'一位记忆',description:'全局时钟沿记下 D，可保持或同步清零。',category:'记忆',phase:'Phase0',kind:'primitive',editable:false},
    {modelId:'std.vcc/1',name:'电源正端',description:'提供绑定供电域的 VCC 连接。',category:'供电',phase:'Phase0',kind:'primitive',editable:false},
    {modelId:'std.gnd/1',name:'电源地端',description:'提供同一供电域的 GND 连接。',category:'供电',phase:'Phase0',kind:'primitive',editable:false},
    {modelId:'core8/1',name:'教学 Core8',description:'用程序控制 GPIO 与 UART；功能级模型，不伪造门级内部图。',category:'程序',phase:'Phase1',kind:'behavioral',editable:false},
    {modelId:'io.terminal/1',name:'串口终端',description:'显示实际收到的字节，并按队列发送输入。',category:'通信',phase:'Phase1',kind:'behavioral',editable:false}
  ];

  function lab() {
    if (root.CircuitLab) return root.CircuitLab;
    if (typeof require === 'function') return require('./circuit.js');
    throw new Error('电路内核尚未加载。');
  }
  function core() {
    if (root.Core8) return root.Core8;
    if (typeof require === 'function') return require('./core8.js');
    throw new Error('Core8 编译器尚未加载。');
  }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function modelFor(project, instance) {
    const ref = instance.definition;
    return project.definitions.find(d=>d.stableId===ref.stableId && d.revision===ref.revision && d.contentHash===ref.contentHash);
  }
  function known(value) {
    if (typeof value === 'number' || value === 'X' || value === 'Z') return value;
    if (!value || value.width !== 1) return 'X';
    const d=BigInt(value.driveMask),k=BigInt(value.knownMask),v=BigInt(value.value);
    return !(d&1n)?'Z':!(k&1n)?'X':Number(v&1n);
  }
  function read(runtime, id) { return known(runtime.getPort('$.'+id)); }
  function addCheck(checks,label,ok,detail) { checks.push({label,ok:!!ok,detail:String(detail)}); }
  function checkValue(checks,runtime,id,expected,label) {
    const actual=read(runtime,id);
    addCheck(checks,label,actual===expected,`期望 ${expected}，实际 ${actual}。`);
  }
  function assertInterface(project, inputs, outputs) {
    const issues=[];
    for (const [direction, ids] of [['inputs',inputs],['outputs',outputs]]) {
      for (const id of ids) {
        const port=project.circuit[direction].find(p=>p.id===id);
        if (!port || port.kind!=='digital' || port.width!==1) issues.push(`目标需要一位${direction==='inputs'?'输入':'输出'}端口「${id}」。`);
      }
    }
    return issues;
  }
  function terminalEntries(runtime) {
    const state=runtime.inspect(), rows=[];
    for (const terminal of Object.values(state.terminals||{})) {
      rows.push(...(terminal.history && terminal.history.entries || []));
    }
    return rows.filter(e=>e.kind==='byte');
  }
  async function fresh(project) { return new (lab().Runtime)(copy(project)); }
  async function setAndStep(runtime, values, delta=1n) {
    for (const [id,value] of Object.entries(values)) runtime.setInput(id,value);
    await runtime.advance(delta,{force:true});
  }

  async function build(templateId) {
    const lesson=list.find(item=>item.templateId===templateId);
    if (!lesson) throw new Error('未知实验：'+templateId);
    const L=lab(),project=await L.createProject(lesson.title);
    const view={positions:{},width:1200,height:760,initialPaused:true,title:lesson.title};
    const input=(id,name,value,x,y)=>{L.addInput(project,id,name,value,1);view.positions['boundary:'+id]={x,y};};
    const output=(id,name,x,y)=>{L.addOutput(project,id,name,1);view.positions['boundary:'+id]={x,y};};
    const node=(modelId,id,name,x,y,bindings)=>{const n=L.createInstance(project,modelId,id,name,bindings);view.positions[id]={x,y};return n;};
    const wire=(id,from,to,pull)=>L.addWire(project,id,from,to,pull);
    const I=id=>L.boundary(id),P=(id,port)=>L.ep(id,port);
    let source='';

    if (templateId==='first-wire' || templateId==='or-alarm') {
      input('a',templateId==='or-alarm'?'门 A':'开关 A',0,60,100);
      input('b',templateId==='or-alarm'?'门 B':'开关 B',0,60,340);
      node(templateId==='or-alarm'?'std.or/1':'std.and/1','rule',templateId==='or-alarm'?'任意一路通过':'两个都满足',390,210);
      output('y',templateId==='or-alarm'?'报警灯':'指示灯',760,220);
      wire('a_to_rule',I('a'),P('rule','a'));wire('b_to_rule',I('b'),P('rule','b'));
      if (templateId!=='first-wire') wire('rule_to_led',P('rule','out'),I('y'));
    } else if (templateId==='half-adder' || templateId==='chip-package') {
      input('a','A',0,60,100);input('b','B',0,60,370);
      node('std.xor/1','sum_gate','低位求和',390,100);node('std.and/1','carry_gate','计算进位',390,370);
      output('sum','SUM · 和',780,100);output('carry','CARRY · 进位',780,370);
      for (const gate of ['sum_gate','carry_gate']) {wire(gate+'_a',I('a'),P(gate,'a'));wire(gate+'_b',I('b'),P(gate,'b'));}
      wire('sum_out',P('sum_gate','out'),I('sum'));wire('carry_out',P('carry_gate','out'),I('carry'));
    } else if (templateId==='full-adder') {
      input('a','A',0,40,55);input('b','B',0,40,245);input('cin','CIN · 输入进位',0,40,480);
      node('std.xor/1','xor_ab','A 与 B 求和',280,60);node('std.and/1','and_ab','第一路进位',280,315);
      node('std.xor/1','xor_c','再加 CIN',530,60);node('std.and/1','and_c','第二路进位',530,315);
      node('std.or/1','carry_merge','合并进位',785,315);output('sum','SUM · 和',1030,60);output('carry','CARRY · 进位',1030,360);
      wire('a_x',I('a'),P('xor_ab','a'));wire('b_x',I('b'),P('xor_ab','b'));
      wire('a_c',I('a'),P('and_ab','a'));wire('b_c',I('b'),P('and_ab','b'));
      wire('ab_sum',P('xor_ab','out'),P('xor_c','a'));wire('cin_sum',I('cin'),P('xor_c','b'));
      wire('ab_carry',P('xor_ab','out'),P('and_c','a'));wire('cin_carry',I('cin'),P('and_c','b'));
      wire('first_carry',P('and_ab','out'),P('carry_merge','a'));wire('second_carry',P('and_c','out'),P('carry_merge','b'));
      wire('sum_out',P('xor_c','out'),I('sum'));wire('carry_out',P('carry_merge','out'),I('carry'));
      view.width=1350;
    } else if (templateId==='memory') {
      input('data','D · 想记住的值',0,50,55);input('enable','EN · 允许写入',1,50,250);input('reset','RESET · 清零',0,50,450);
      node('std.dff/1','memory','一位记忆',400,235);output('q','Q · 记住的值',780,240);
      wire('write_data',I('data'),P('memory','d'));wire('write_enable',I('enable'),P('memory','en'));wire('clear_memory',I('reset'),P('memory','reset'));wire('remembered',P('memory','q'),I('q'));
    } else if (templateId==='dual-memory') {
      input('data','D · 共同数据',1,35,40);input('enable_a','EN_A · 写入 A',1,35,225);input('enable_b','EN_B · 写入 B',0,35,405);input('reset','RESET · 清零',0,35,600);
      node('std.dff/1','memory_a','记忆 A',440,110);node('std.dff/1','memory_b','记忆 B',440,430);
      output('qa','A 记住的值',820,120);output('qb','B 记住的值',820,440);
      for (const suffix of ['a','b']) {wire('data_'+suffix,I('data'),P('memory_'+suffix,'d'));wire('en_'+suffix,I('enable_'+suffix),P('memory_'+suffix,'en'));wire('reset_'+suffix,I('reset'),P('memory_'+suffix,'reset'));wire('q_'+suffix,P('memory_'+suffix,'q'),I('q'+suffix));}
      view.height=870;
    } else {
      const loop=templateId==='uart-loopback';source=loop?LOOPBACK_SOURCE:SMART_LAMP_SOURCE;
      let hex=SMART_LAMP_HEX;
      if (loop) {
        const assembled=core().assemble(source);
        if (!assembled.ok) throw new Error(assembled.error||'回环示例编译失败。');
        hex=Array.from(assembled.bytes,b=>b.toString(16).padStart(2,'0')).join('');
      }
      await L.addFirmware(project,'program',hex);
      node('std.vcc/1','vcc','VCC · 电源正端',45,40);node('std.gnd/1','gnd','GND · 电源地端',45,230);
      node('core8/1','mcu','教学 Core8',415,170,{firmware:'program'});
      output('led','LED · GPIO1',940,70);
      wire('power_vcc',P('vcc','out'),P('mcu','VCC'));wire('power_gnd',P('gnd','out'),P('mcu','GND'));wire('led_wire',P('mcu','GPIO1'),I('led'));
      if (loop) wire('uart_loopback',P('mcu','UART_TX'),P('mcu','UART_RX'));
      else {
        input('button','按钮 · 按下 1 / 释放 Z','Z',45,480);
        node('io.terminal/1','terminal','串口终端',910,430);
        wire('button_wire',I('button'),P('mcu','GPIO0'));wire('uart_tx',P('mcu','UART_TX'),P('terminal','RX'));wire('uart_rx',P('terminal','TX'),P('mcu','UART_RX'));
      }
      view.width=1340;view.height=930;
    }
    return {project,view,source};
  }

  async function verify(lessonId, project) {
    const checks=[],lesson=list.find(item=>item.id===lessonId);
    if (!lesson) return {ok:false,checks:[{label:'选择实验',ok:false,detail:'未知实验。'}]};
    try {
      const validation=await lab().validate(project);
      if (!validation.ok) {
        const errors=validation.errors||validation.issues||[];
        return {ok:false,checks:errors.map(e=>({label:'工程检查',ok:false,detail:typeof e==='string'?e:e.message||e.code||'工程结构无效。'}))};
      }
      let inputs=[],outputs=[];
      if (['first-wire','or-alarm'].includes(lessonId)) {inputs=['a','b'];outputs=['y'];}
      else if (['half-adder','chip-package'].includes(lessonId)) {inputs=['a','b'];outputs=['sum','carry'];}
      else if (lessonId==='full-adder') {inputs=['a','b','cin'];outputs=['sum','carry'];}
      else if (lessonId==='memory') {inputs=['data','enable','reset'];outputs=['q'];}
      else if (lessonId==='dual-memory') {inputs=['data','enable_a','enable_b','reset'];outputs=['qa','qb'];}
      else {inputs=lessonId==='uart-loopback'?[]:['button'];outputs=['led'];}
      const interfaceIssues=assertInterface(project,inputs,outputs);
      if (interfaceIssues.length) return {ok:false,checks:interfaceIssues.map(detail=>({label:'目标接口',ok:false,detail}))};

      if (['first-wire','or-alarm','half-adder','full-adder','chip-package'].includes(lessonId)) {
        const runtime=await fresh(project),count=2**inputs.length;
        for (let row=0;row<count;row++) {
          const values={};inputs.forEach((id,index)=>values[id]=(row>>(inputs.length-index-1))&1);
          await setAndStep(runtime,values);
          const total=Object.values(values).reduce((a,b)=>a+b,0),label=inputs.map(id=>`${id.toUpperCase()}=${values[id]}`).join('，');
          if (lessonId==='first-wire') checkValue(checks,runtime,'y',values.a&values.b,label);
          else if (lessonId==='or-alarm') checkValue(checks,runtime,'y',values.a|values.b,label);
          else {
            const sum=read(runtime,'sum'),carry=read(runtime,'carry');
            addCheck(checks,label,sum===(total&1)&&carry===(total>1?1:0),`期望 SUM=${total&1}、CARRY=${total>1?1:0}；实际 SUM=${sum}、CARRY=${carry}。`);
          }
        }
        if (lessonId==='chip-package') {
          const compositeIds=new Set(project.circuit.instances.filter(instance=>{const definition=modelFor(project,instance);return definition&&definition.model.kind==='composite';}).map(instance=>instance.id));
          const wires=project.circuit.wires.filter(w=>w.from.kind==='instance'&&compositeIds.has(w.from.instance));
          let used=false;
          if(wires.length) {
            const disconnected=await fresh(project);
            for(const wire of wires)disconnected.setConnection(wire.id,false);
            for(const [a,b] of [[0,0],[0,1],[1,0],[1,1]]) {
              await setAndStep(disconnected,{a,b});
              if(read(disconnected,'sum')!==(a^b)||read(disconnected,'carry')!==(a&b))used=true;
            }
          }
          addCheck(checks,'在画布中使用自己的封装',used,used?'封装芯片正在参与实际输出；断开它会改变结果。':'请将封装接入实际求和电路；只保存在芯片库或放在空白处还不算使用。');
        }
      } else if (lessonId==='memory') {
        const runtime=await fresh(project);
        checkValue(checks,runtime,'q',0,'初始记忆为 0');
        for (const [label,values,expected] of [
          ['允许写入 1',{data:1,enable:1,reset:0},1],
          ['禁止写入时保持 1',{data:0,enable:0,reset:0},1],
          ['RESET 优先，清零',{data:1,enable:0,reset:1},0],
          ['重新允许写入 1',{data:1,enable:1,reset:0},1],
          ['下一时刻写入 0',{data:0,enable:1,reset:0},0]
        ]) {await setAndStep(runtime,values);checkValue(checks,runtime,'q',expected,label);}
      } else if (lessonId==='dual-memory') {
        const runtime=await fresh(project);
        for (const [label,values,a,b] of [
          ['只写 A',{data:1,enable_a:1,enable_b:0,reset:0},1,0],
          ['B 写入 0，A 保持',{data:0,enable_a:0,enable_b:1,reset:0},1,0],
          ['只把 B 改成 1',{data:1,enable_a:0,enable_b:1,reset:0},1,1],
          ['A 改成 0，B 保持',{data:0,enable_a:1,enable_b:0,reset:0},0,1],
          ['同时清零',{data:1,enable_a:1,enable_b:1,reset:1},0,0]
        ]) {
          await setAndStep(runtime,values);
          const qa=read(runtime,'qa'),qb=read(runtime,'qb');
          addCheck(checks,label,qa===a&&qb===b,`期望 A=${a}、B=${b}；实际 A=${qa}、B=${qb}。`);
        }
      } else if (lessonId==='smart-lamp') {
        const runtime=await fresh(project);runtime.setInput('button','Z');
        await runtime.advance(16n,{force:true});checkValue(checks,runtime,'led',1,'t=16 µs，程序真正点灯');
        await runtime.advance(1032n,{force:true});
        let received=terminalEntries(runtime).map(e=>e.byte);
        addCheck(checks,'t=1048 µs，终端收到启动字节 B',received.filter(b=>b===0x42).length===1,`实际已收到字节：${received.map(b=>b.toString(16).padStart(2,'0')).join(' ')||'无'}。`);
        await runtime.advance(58977n,{force:true});checkValue(checks,runtime,'led',0,'t=60025 µs，灯自动熄灭');
        await setAndStep(runtime,{button:1},200000n);
        received=terminalEntries(runtime).map(e=>e.byte);
        addCheck(checks,'长按 200 ms，只收到一次 P',received.filter(b=>b===0x50).length===1,`收到 P ${received.filter(b=>b===0x50).length} 次。`);
        await setAndStep(runtime,{button:'Z'},200000n);
        received=terminalEntries(runtime).map(e=>e.byte);
        addCheck(checks,'释放 200 ms，只收到一次 R',received.filter(b=>b===0x52).length===1,`收到 R ${received.filter(b=>b===0x52).length} 次。`);
      } else if (lessonId==='faster-lamp') {
        const runtime=await fresh(project);runtime.setInput('button','Z');
        await runtime.advance(16n,{force:true});checkValue(checks,runtime,'led',1,'首次仍在 t=16 µs 点灯');
        await runtime.advance(30008n,{force:true});checkValue(checks,runtime,'led',1,'t=30024 µs，仍然亮着');
        await runtime.advance(1n,{force:true});checkValue(checks,runtime,'led',0,'t=30025 µs，已经提前熄灭');
      } else if (lessonId==='uart-loopback') {
        const runtime=await fresh(project);
        await runtime.advance(1047n,{force:true});checkValue(checks,runtime,'led',0,'字节到达前不能提前成功');
        await runtime.advance(153n,{force:true});checkValue(checks,runtime,'led',1,'收回正确字节后点灯');
        const opposite=await fresh(project);
        const protocolWires=project.circuit.wires.filter(w=>{
          if(w.from.kind!=='instance')return false;
          const instance=project.circuit.instances.find(n=>n.id===w.from.instance);
          const definition=instance&&modelFor(project,instance);
          return definition&&definition.ports.some(p=>p.id===w.from.port&&p.kind==='protocol_transaction'&&p.protocol==='uart-txn/1');
        });
        for(const wire of protocolWires) opposite.setConnection(wire.id,false);
        await opposite.advance(1200n,{force:true});
        addCheck(checks,'断开协议线后不能假成功',protocolWires.length>0&&read(opposite,'led')===0,protocolWires.length?`对照副本中 LED=${read(opposite,'led')}；通过实际回环后才能点亮。`:'工程中没有可用于对照的协议连接。');
      }
      return {ok:checks.length>0&&checks.every(item=>item.ok),checks};
    } catch (error) {
      addCheck(checks,'验证未能完成',false,error&&error.message||String(error));
      return {ok:false,checks};
    }
  }

  return {list,modules,build,verify,SMART_LAMP_SOURCE,SMART_LAMP_HEX,LOOPBACK_SOURCE};
});
