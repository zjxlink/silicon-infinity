(function(root,factory){const node=typeof module==='object'&&module.exports;const api=node?factory(require('./circuit.js'),require('./core8plus.js'),()=>require('./mcu-v4.js')):factory(root.CircuitLab,root.Core8Plus,()=>root.McuV4);if(node)module.exports=api;else{root.LabApplications=api;api.attach(root.LabAPI);document.addEventListener('lab:ready',()=>api.attach(root.LabAPI));}})(typeof window==='undefined'?globalThis:window,function(C,CPU,getMcu){
  'use strict';
  const clone=x=>JSON.parse(JSON.stringify(x)),esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const list=[
    {id:'clock',name:'电子钟',category:'定时与中断',description:'定时器每 10 ms 进入中断，程序累计 100 次得到 1 秒，按 24 小时计时。',goal:'秒数真实增加；按住暂停输入时保持，放开继续。',inputs:['hold：1 暂停计时，0 继续'],observations:['RAM[0/1/2]：秒 / 分 / 时','GPIO1—6：秒数的二进制显示'],hints:['“仿真 +1 秒”推进虚拟时间；不是电脑上的一秒。','中断程序累计 100 次 10 ms，再更新显示。','想改成快钟，可在程序中把 LDI R0,100 改为 10。'],negativeWire:'hold_input'},
    {id:'thermostat',name:'温控器',category:'传感与控制',description:'I²C 读取温度，达到 32 ℃ 开风扇，低于 29 ℃ 关风扇，中间保持原状态。',goal:'25 ℃ 关闭，35 ℃ 开启，30 ℃ 保持开启，26 ℃ 关闭；禁用优先关风扇。',inputs:['enable：1 自动控制，0 关闭风扇','温度环境：0—125 ℃'],observations:['fan：风扇数字开关','RAM[0] 温度；RAM[1] 风扇状态；RAM[3] 错误标记'],hints:['先把温度改为 35 ℃，推进 20 ms。','再改为 30 ℃：保持开启是滞回，避免开关反复跳变。','程序的 32 与 29 是开启阈值与关闭边界。'],negativeWire:'i2c_bus'},
    {id:'data-logger',name:'数据采集器',category:'I²C → SPI → UART',description:'温度通过 I²C 到达 MCU，写入 SPI 的 16 格循环缓冲，再真实回读并从串口送出。',goal:'环境值 21、67、42 均经真实 I²C/SPI 事务到达缓冲和串口；关闭采集后停止增加。',inputs:['enable：采集开关','温度环境：0—125 ℃'],observations:['RAM[0] 最新温度；RAM[1] SPI 回读；RAM[2] 样本数（8 位回绕）','SPI 芯片 16 格缓存与终端接收到的字节'],hints:['改变环境温度后推进 20 ms。','数据线断开不会产生有效样本；错误标记位于 RAM[3]。','R6 是 SPI 的环形写入位置，AND 15 使它回到 0。'],negativeWire:'spi_bus'},
    {id:'serial-console',name:'串口控制台',category:'交互命令',description:'从终端发送 1 开灯、0 关灯、? 查询；未知命令返回 !。所有字符均通过串口实际传输。',goal:'1→灯亮并回复 1；?→回复当前状态；0→灯灭并回复 0；x→回复 !。',inputs:['终端发送框：1、0、? 或其他字符'],observations:['led：GPIO1 实际输出','RAM[0] 最近命令；RAM[1] 灯状态；RAM[2] 命令数','终端收到的回复字节'],hints:['字符需要 1042 μs 单向传输；请求和回复合计超过 2 ms。','发送 1?0x，再推进 20 ms，查看回复。','程序比较的是 ASCII：1=49、0=48、?=63。'],negativeWire:'uart_rx'},
    {id:'small-computer',name:'小型计算机',category:'可拆开的自组装 MCU',description:'程序存储器、指令寄存器、算术单元、RAM 与外设通过可见总线连接。键盘数值加 1 后写入 RAM 并显示。',goal:'输入 7、250、0、255 时，分别显示 8、251、1、0；RAM[3] 同步保存结果。',inputs:['key：8 位键盘输入，0—255','reset：清零控制'],observations:['value：真实输出寄存器','PC、指令、累加器、RAM[3] 与取指 / 执行相位'],hints:['推进 100 μs 足够执行一轮输入、运算、存储和输出。','打开程序，把 ADDI 1 改成 ADDI 5，观察真实结果变化。','每根总线都有用途：断开程序 ROM 到指令寄存器，机器无法继续正常执行。'],negativeWire:'rom_to_ir'}
  ];
  function meta(id){const m=list.find(x=>x.id===id);if(!m)throw Error('未知应用实例：'+id);return m;}
  const IO_INIT='LDI R0,254\nST R0,0x4000\nLDI R0,255\nST R0,0x4003\nLDI R0,1\nST R0,0x4103';
  const I2C_INIT='LDI R0,1\nST R0,0x4400\nLDI R0,72\nST R0,0x4401\nLDI R0,0\nST R0,0x4402';
  const I2C_READ='LDI R0,14\nST R0,0x4405\nLDI R0,1\nST R0,0x4404\nWAIT 100\nLD R0,0x4405\nLDI R1,12\nAND R0,R1\nJNZ R0,error\nLD R3,0x4403\nST R3,0x2000';
  function clockSource(){let source=IO_INIT+'\nLDI R0,128\nST R0,0x4603\nLDI R0,1\nST R0,0x4601\nST R0,0x4600\nLDI R0,16\nST R0,0x4201\nLDI R0,39\nST R0,0x4202\nLDI R0,7\nST R0,0x4200\nidle: WAIT 60000\nJMP idle';while(CPU.assemble(source).bytes.length<128)source+='\nNOP';return source+`\nisr: LD R0,0x4002
LDI R1,1
AND R0,R1
JNZ R0,done
ADD R2,R1
LDI R0,100
MOV R6,R2
XOR R6,R0
JNZ R6,done
LDI R2,0
ADD R3,R1
LDI R0,60
MOV R6,R3
XOR R6,R0
JNZ R6,display
LDI R3,0
ADD R4,R1
MOV R6,R4
XOR R6,R0
JNZ R6,display
LDI R4,0
ADD R5,R1
LDI R0,24
MOV R6,R5
XOR R6,R0
JNZ R6,display
LDI R5,0
display: ST R3,0x2000
ST R4,0x2001
ST R5,0x2002
MOV R0,R3
SHL R0,1
ST R0,0x4001
ST R3,0x4100
done: IRET`;}
  const thermostatSource=IO_INIT+'\n'+I2C_INIT+`\nloop: LD R0,0x4002
LDI R1,1
AND R0,R1
JZ R0,off
`+I2C_READ+`\nLDI R0,0
ST R0,0x2003
MOV R0,R3
LDI R1,32
SUB R0,R1
LDI R1,128
AND R0,R1
JZ R0,on
MOV R0,R3
LDI R1,29
SUB R0,R1
LDI R1,128
AND R0,R1
JNZ R0,off
JMP report
on: LDI R4,1
JMP report
off: LDI R4,0
report: ST R4,0x2001
MOV R0,R4
SHL R0,1
ST R0,0x4001
ST R3,0x4100
WAIT 10000
JMP loop
error: LDI R0,1
ST R0,0x2003
LDI R4,0
JMP report`;
  const loggerSource=IO_INIT+'\n'+I2C_INIT+`\nLDI R0,1
ST R0,0x4500
loop: LD R0,0x4002
LDI R1,1
AND R0,R1
JZ R0,wait
`+I2C_READ+`\nLDI R0,6
ST R0,0x4502
ST R6,0x4501
WAIT 8
ST R3,0x4501
WAIT 8
MOV R0,R6
LDI R1,128
OR R0,R1
ST R0,0x4501
WAIT 8
LDI R0,0
ST R0,0x4501
WAIT 8
LD R0,0x4502
LDI R1,4
AND R0,R1
JNZ R0,error
LD R4,0x4501
ST R4,0x2001
ST R4,0x4100
MOV R0,R4
SHL R0,1
ST R0,0x4001
LDI R1,1
ADD R5,R1
ST R5,0x2002
ADD R6,R1
LDI R1,15
AND R6,R1
LDI R0,0
ST R0,0x2003
wait: WAIT 5000
JMP loop
error: LDI R0,1
ST R0,0x2003
JMP wait`;
  const consoleSource=`LDI R0,255
ST R0,0x4000
LDI R0,3
ST R0,0x4103
loop: LD R0,0x4102
LDI R1,4
AND R0,R1
JZ R0,idle
LD R0,0x4101
ST R0,0x2000
LDI R1,1
ADD R4,R1
ST R4,0x2002
MOV R1,R0
LDI R2,49
XOR R1,R2
JZ R1,on
MOV R1,R0
LDI R2,48
XOR R1,R2
JZ R1,off
MOV R1,R0
LDI R2,63
XOR R1,R2
JZ R1,reply
LDI R0,33
ST R0,0x4100
JMP loop
on: LDI R3,1
JMP reply
off: LDI R3,0
reply: ST R3,0x2001
MOV R0,R3
SHL R0,1
ST R0,0x4001
MOV R0,R3
LDI R1,48
ADD R0,R1
ST R0,0x4100
JMP loop
idle: WAIT 30
JMP loop`;
  const smallSource='loop: IN\nADDI 1\nSTORE 3\nOUT\nJMP loop';
  function program(id){return id==='clock'?clockSource():id==='thermostat'?thermostatSource:id==='data-logger'?loggerSource:id==='serial-console'?consoleSource:smallSource;}
  async function build(id){const m=meta(id),source=program(id);if(id==='small-computer'){const M=getMcu();if(!M?.build)throw Error('自组装 MCU 尚未载入，请稍后重试。');const b=await M.build(source);b.project.name=m.name;return {...b,application:id};}
    const p=await C.createProject(m.name),a=CPU.assemble(source);if(!a.ok)throw Error(a.error);await C.addFirmware(p,'program_mcu',a.bytes,'core8/2');C.createInstance(p,'core8/2','mcu','程序与外设',{firmware:'program_mcu'});C.createInstance(p,'std.vcc/1','vcc','供电');C.createInstance(p,'std.gnd/1','gnd','地');C.createInstance(p,'io.terminal/1','terminal','串口终端');C.addWire(p,'power',C.ep('vcc','out'),C.ep('mcu','VCC'));C.addWire(p,'ground',C.ep('gnd','out'),C.ep('mcu','GND'));C.addWire(p,'uart_tx',C.ep('mcu','UART_TX'),C.ep('terminal','RX'));
    const view={positions:{vcc:{x:30,y:45},gnd:{x:30,y:205},mcu:{x:365,y:110},terminal:{x:780,y:450}},suggestedStepUs:id==='clock'?100000:1000};
    if(id==='serial-console')C.addWire(p,'uart_rx',C.ep('terminal','TX'),C.ep('mcu','UART_RX'));
    else{const input=id==='clock'?'hold':'enable';C.addInput(p,input,input==='hold'?'暂停计时':'采集 / 控制使能',input==='hold'?0:1);C.addWire(p,input+'_input',C.boundary(input),C.ep('mcu','GPIO0'));view.positions['boundary:'+input]={x:30,y:365};}
    if(id==='clock'||id==='data-logger'){for(let n=0;n<(id==='clock'?6:7);n++){C.addOutput(p,'bit'+n,'数值 · bit '+n);C.addWire(p,'output_'+n,C.ep('mcu','GPIO'+(n+1)),C.boundary('bit'+n));view.positions['boundary:bit'+n]={x:770+(n%3)*180,y:25+Math.floor(n/3)*140};}}
    else{const port=id==='thermostat'?'fan':'led';C.addOutput(p,port,id==='thermostat'?'风扇开关':'控制灯');C.addWire(p,'output',C.ep('mcu','GPIO1'),C.boundary(port));view.positions['boundary:'+port]={x:790,y:60};}
    if(['thermostat','data-logger'].includes(id)){C.createInstance(p,'std.i2c-temperature/1','sensor','环境温度');C.addWire(p,'i2c_bus',C.ep('mcu','I2C_OUT'),C.ep('sensor','RX'));view.positions.sensor={x:1040,y:490};}
    if(id==='data-logger'){C.createInstance(p,'std.spi-register/1','buffer','16 格采集缓冲');C.addWire(p,'spi_bus',C.ep('mcu','SPI_OUT'),C.ep('buffer','RX'));view.positions.buffer={x:790,y:650};}
    return{project:await C.importProject(p),view,source,sources:{program_mcu:source},application:id};
  }
  function number(v){return v&&C.bits(v).every(b=>b===0||b===1)?Number(BigInt(v.value)):null;}
  function publicBits(r,n){let value=0;for(let i=0;i<n;i++){const b=C.scalar(r.getPort(C.boundary('bit'+i)));if(b!==0&&b!==1)return null;value|=b<<i;}return value;}
  function transactions(r,protocol){return r.inspect().history.filter(x=>x.kind==='protocol'&&x.protocol===protocol&&x.ok);}
  function terminalBytes(r){return(r.inspect().terminals.terminal?.history.entries||[]).filter(e=>e.kind==='byte').map(e=>e.byte);}
  function inspect(id,r){meta(id);const s=r.inspect();if(id==='small-computer'){const m=getMcu().inspect(r);return{time:s.time,pc:m.pc,accumulator:m.accumulator,output:m.output,ram:m.ram?.[3],phase:m.phase,halted:m.halted};}const m=s.instances.mcu,ram=m?.ram||[];return {time:s.time,clock:[ram[2]||0,ram[1]||0,ram[0]||0].map(n=>String(n).padStart(2,'0')).join(':'),temperature:ram[0]??0,value:ram[1]??0,count:ram[2]??0,error:ram[3]??0,status:m?.status,output:id==='clock'?publicBits(r,6):id==='data-logger'?publicBits(r,7):C.scalar(r.getPort(C.boundary(id==='thermostat'?'fan':'led'))),uart:terminalBytes(r),transactions:s.history.filter(e=>e.kind==='protocol').length};}
  async function verify(id,project){const checks=[],check=(label,ok,detail='')=>checks.push({label,ok:!!ok,detail});try{meta(id);const p=await C.importProject(clone(project)),r=new C.Runtime(p),run=us=>r.advance(BigInt(us),{force:true}),ram=()=>r.inspect().instances.mcu?.ram||[];
      if(id==='clock'){run(1020000);check('一秒来自定时器中断',ram()[0]===1&&publicBits(r,6)===1,'独立副本运行 1.02 s，秒 / 显示 = '+ram()[0]+' / '+publicBits(r,6));r.setInput('hold',1);run(1000000);check('暂停计时输入有效',ram()[0]===1,'按住 1 s 后秒数 = '+ram()[0]);r.setInput('hold',0);run(1010000);check('放开后恢复计时',ram()[0]===2&&publicBits(r,6)===2,'放开后秒数 = '+ram()[0]);check('实际中断发生',BigInt(r.inspect().instances.mcu?.plus?.irq?.entries||0)>=200n);}
      if(id==='thermostat'){for(const[temp,expected]of[[25,0],[35,1],[30,1],[26,0]]){r.setSensorTemperature('sensor',temp);run(22000);check(temp+' ℃ → 风扇 '+expected,ram()[0]===temp&&C.scalar(r.getPort(C.boundary('fan')))===expected,'传感值 '+ram()[0]+'，风扇 '+C.scalar(r.getPort(C.boundary('fan'))));}r.setInput('enable',0);r.setSensorTemperature('sensor',80);run(22000);check('禁用时风扇关闭',C.scalar(r.getPort(C.boundary('fan')))===0);check('实际 I²C 读取成功',transactions(r,'i2c-txn/1').length>=4);}
      if(id==='data-logger'){for(const temp of[21,67,42]){r.setSensorTemperature('sensor',temp);run(22000);check('采集 / 回读 / 显示 '+temp,ram()[0]===temp&&ram()[1]===temp&&publicBits(r,7)===temp&&terminalBytes(r).includes(temp),'RAM 温度 '+ram()[0]+'，回读 '+ram()[1]);}r.setInput('enable',0);run(7000);const n=ram()[2];run(22000);check('关闭采集后计数保持',ram()[2]===n&&n>0);check('真实 I²C 与 SPI 事务',transactions(r,'i2c-txn/1').length>=3&&transactions(r,'spi-txn/1').length>=12);}
      if(id==='serial-console'){run(100);for(const[text,reply,led]of[['1',49,1],['?',49,1],['0',48,0],['x',33,0]]){const old=terminalBytes(r).length;r.injectTerminal('terminal',text.charCodeAt(0));run(5000);check('命令 '+text+' → '+String.fromCharCode(reply),terminalBytes(r).length===old+1&&terminalBytes(r).at(-1)===reply&&C.scalar(r.getPort(C.boundary('led')))===led,'收到 '+terminalBytes(r).slice(old).join(',')+'；灯 '+C.scalar(r.getPort(C.boundary('led'))));}check('实际收到四条命令',ram()[2]===4);}
      if(id==='small-computer'){for(const[value,expected]of[[7,8],[250,251],[0,1],[255,0]]){r.setInput('key',value);run(120);const m=getMcu().inspect(r);check(value+' + 1 = '+expected,number(r.getPort(C.boundary('value')))===expected&&m.ram?.[3]===expected,'实际输出 '+number(r.getPort(C.boundary('value')))+'，RAM[3] '+m.ram?.[3]);}}
      const faults=r.inspect().issues.filter(e=>/FAULT|CONFLICT|UNKNOWN/.test(e.code||''));check('没有信号冲突或运行故障',faults.length===0,faults.map(e=>e.message).slice(0,3).join('；'));return{ok:checks.length>0&&checks.every(x=>x.ok),checks};
    }catch(e){checks.push({label:'工程及应用接口',ok:false,detail:e.message});return{ok:false,checks};}}
  let api=null,attached=false,active=null,loading=false,last=null;
  function assertLocal(){if(typeof window!=='undefined'&&window.OnlineLab?.room)throw Error('请先退出共享房间，再操作本地应用实例。');}
  function menu(){if(!api)return;api.modal('系统应用 · 能运行，也能改造','<div id="applications-v4-menu"><p>五套真实电路与程序。打开会替换当前工作台；先保存要保留的作品。验证使用独立副本。</p><div class="v4-card-grid">'+list.map(m=>'<article class="v4-card"><small>'+esc(m.category)+'</small><h3>'+esc(m.name)+'</h3><p>'+esc(m.description)+'</p><button data-v4-app-load="'+m.id+'">打开 '+esc(m.name)+'</button></article>').join('')+'</div></div>');}
  function dashboard(){if(!api||!active)return;const m=meta(active);api.modal(m.name+' · 操作台','<div id="application-v4-panel"><p>'+esc(m.description)+'</p><div id="application-v4-live" aria-live="polite"></div><div class="v4-controls"><button data-v4-app="run">运行 / 暂停</button><button data-v4-app="advance">'+(active==='clock'?'仿真 +1 秒':active==='small-computer'?'仿真 +100 μs':'仿真 +20 ms')+'</button><button data-v4-app="program">修改程序</button><button data-v4-app="verify">验证目标</button><button data-v4-app="menu">其他应用</button></div>'+(['thermostat','data-logger'].includes(active)?'<label>环境温度（℃） <input id="v4-temperature" type="number" min="0" max="125" value="25"><button data-v4-app="temperature">设定温度</button></label>':'')+(active==='serial-console'?'<label>发送字符 <input id="v4-console-text" maxlength="16" value="1?0x"><button data-v4-app="send">串口发送</button></label>':'')+'<h3>操作与观察</h3><ul>'+m.inputs.concat(m.observations).map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul><p>目标：'+esc(m.goal)+'</p><details><summary>操作提示</summary><ol>'+m.hints.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ol></details><div id="application-v4-checks">'+(last?.id===active?last.result.checks.map(x=>'<p class="v4-check '+(x.ok?'ok':'fail')+'">'+(x.ok?'✓ ':'○ ')+esc(x.label)+' '+esc(x.detail)+'</p>').join(''):'')+'</div><p class="scope-note">数值来自当前电路。改变输入 / 环境后需推进时间。连线或程序草稿需“应用并重新启动”。关闭此面板可在画布操作输入；从“系统应用”返回操作台。</p></div>');refresh();}
  function refresh(){const target=typeof document!=='undefined'&&document.getElementById('application-v4-live');if(!target||!active||!api?.getRuntime())return;try{const s=inspect(active,api.getRuntime());target.textContent=active==='clock'?'时钟 '+s.clock+' · 仿真 '+s.time+' μs':active==='small-computer'?'PC '+s.pc+' · 累加器 '+s.accumulator+' · 输出 '+s.output+' · RAM[3] '+s.ram:'输出 '+s.output+' · '+(active==='serial-console'?'接收 '+s.uart.map(x=>x>=32&&x<=126?String.fromCharCode(x):'['+x+']').join(''):'温度 '+s.temperature+' / 回读或状态 '+s.value+' / 样本 '+s.count+' / 错误 '+s.error)+' · '+s.time+' μs';}catch(e){target.textContent='等待与此应用匹配的工作台：'+e.message;}}
  async function load(id){assertLocal();const b=await build(id);assertLocal();loading=true;try{await api.loadWorkspace(b);active=id;last=null;}finally{loading=false;}dashboard();}
  function attach(bridge){if(!bridge)return;api=bridge;if(attached||typeof document==='undefined')return;attached=true;
    document.addEventListener('lab:workspace',e=>{if(e.detail?.reason==='load'&&!loading)active=null;});document.addEventListener('lab:tick',refresh);
    document.addEventListener('click',async e=>{const el=e.target.closest('[data-action="open-applications"],[data-v4-app-load],[data-v4-app]');if(!el)return;try{
      if(el.dataset.action){active?dashboard():menu();return;}if(el.dataset.v4AppLoad){await load(el.dataset.v4AppLoad);return;}
      const action=el.dataset.v4App;if(action==='menu'){menu();return;}
      if(action==='verify'){el.disabled=true;const id=active,result=await verify(id,clone(api.state.project));if(active===id){last={id,result};dashboard();}return;}
      assertLocal();
      if(action==='run'){await api.action('run');refresh();}
      else if(action==='advance'){if(api.state.dirty)throw Error('请先应用设计，再推进当前电路。');api.stop();const before=BigInt(api.getRuntime().inspect().time),delta=BigInt(active==='clock'?1000000:active==='small-computer'?100:20000);api.advance(delta,{force:true});api.updateSignals();refresh();const advanced=BigInt(api.getRuntime().inspect().time)-before;if(advanced<delta)api.notify('已推进 '+advanced+' μs；调试断点或采样预算提前停止。');}
      else if(action==='temperature'){const v=Number(document.getElementById('v4-temperature').value);if(!Number.isInteger(v)||v<0||v>125)throw Error('请输入 0—125 的整数温度。');api.runtimeControl(()=>api.getRuntime().setSensorTemperature('sensor',v));}
      else if(action==='send'){const value=document.getElementById('v4-console-text').value;if(!value.length||value.length>16||Array.from(value).some(c=>c.charCodeAt(0)>127))throw Error('一次请输入 1—16 个 ASCII 字符。');api.runtimeControl(()=>{for(const c of value)api.getRuntime().injectTerminal('terminal',c.charCodeAt(0));});}
      else if(action==='program'){api.closeModal();api.state.selected={type:'node',id:active==='small-computer'?'program_rom':'mcu'};api.renderInspector();if(active==='small-computer'){if(!window.HardwareUIV3?.openProgram)throw Error('自组装程序编辑器尚未载入。');window.HardwareUIV3.openProgram('program_rom');}else await api.action('program');}
    }catch(err){api.notify(err.message,true);}});
  }
  return{list,build,verify,inspect,program,attach,openPanel:menu,openDashboard:dashboard,load,get active(){return active;}};
});
