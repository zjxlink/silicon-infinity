(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./circuit.js'):root.CircuitLab,typeof module==='object'&&module.exports?require('./architecture-v5.js'):root.ArchitectureV5,typeof module==='object'&&module.exports?require('./custom-cpu-v8.js'):root.CustomCpuV8);if(typeof module==='object'&&module.exports)module.exports=api;else root.TerminalV8=api;})(typeof globalThis!=='undefined'?globalThis:this,function(C,A,U){
 'use strict';
 const CAPACITY=8,MAGIC=0x544d,clone=x=>JSON.parse(JSON.stringify(x));
 const ADDRESS=Object.freeze({ram:0,gpio:0x100,timer:0x110,dma:0x120,uart:0x130,spi:0x140,i2c:0x150});
 const META=Object.freeze({magic:0,count:1,last:2,errors:3,due:4,capacity:5,timerIRQ:6,uartIRQ:7,dmaIRQ:8,gpioIRQ:9,readback:10,ready:11,running:12,button:13,records:16,copied:64,head:96,tail:97,dropped:98,ring:128});
 const IDs=Object.freeze({cpu:'cpu',ram:'ram',gpio:'gpio',timer:'timer',dmaControl:'dma_control',dma:'dma',arbiter:'bus',irq:'irq',uart:'uart',spi:'spi',i2c:'i2c',sensor:'sensor',storage:'storage',terminal:'terminal'});
 const PORTS=Object.freeze({sense:'sense',button:'button',reset:'reset',display:'display',irqPending:'irq_pending',dmaCopied:'dma_copied'});
 const SAMPLES=[{id:'fixed',name:'CPU16 · 完整记录终端',description:'定时中断、真实传感读取、存储读回、DMA、显示和双向串口。'},{id:'custom',name:'自定义 CPU /2 · 同一记录终端',description:'可编辑 ISA 的核心接同一外部总线与外设；单层中断，不隐藏代执行。'}];
 function options(value={}){const out={period:5000,sense:25,writeBusyUs:100,...value};for(const k of Object.keys(out))if(!['period','sense','writeBusyUs'].includes(k))throw Error('未知终端选项 '+k);for(const[k,lo,hi]of[['period',1000,65535],['sense',0,255],['writeBusyUs',0,20000]])if(!Number.isInteger(out[k])||out[k]<lo||out[k]>hi)throw Error(k+' 超出 '+lo+'—'+hi);return out;}
 function source(core='fixed',value={}){
  if(!SAMPLES.some(s=>s.id===core))throw Error('未知终端核心');const o=options(value);
  let s=`; 独立外设、16位字地址。RAM[1] 是完成存储读回和 DMA 后的提交点。
DI
LDI R0, 0
STORE R0, 0
${Array.from({length:13},(_,i)=>'STORE R0, '+(i+1)).join('\n')}
STORE R0, 96
STORE R0, 97
STORE R0, 98
LDI R0, 8
STORE R0, 5
LDI R0, 1
STORE R0, 12
STORE R0, 0x102
STORE R0, 0x114
STORE R0, 0x140
STORE R0, 0x150
LDI R0, 72
STORE R0, 0x154
LDI R0, 1
STORE R0, 0x155
LDI R0, 3
STORE R0, 0x130
LDI R0, 8
STORE R0, 0x138
LDI R0, 16
STORE R0, 0x120
LDI R0, 64
STORE R0, 0x121
LDI R0, ${o.period}
STORE R0, 0x110
LDI R0, 0x544D
STORE R0, 0
LDI R0, 3
STORE R0, 0x112
EI
main: CALL commands
LOAD R0, 12
JZ R0, main
LOAD R3, 1
MOV R0, R3
SUBI R0, 8
JZ R0, main
DI
LOAD R0, 4
LDI R1, 0
STORE R1, 4
EI
JZ R0, main
STORE R1, 11
; I2C 读取在事务完成当拍采样实际 sense8。
LDI R0, 2047
STORE R0, 0x157
LDI R0, 2
STORE R0, 0x156
i2c_wait: LOAD R0, 0x151
LDI R1, 1
AND R0, R1
JNZ R0, i2c_wait
LOAD R0, 0x157
JNZ R0, failed
LOAD R2, 0x153
; 写入独立 SPI 非易失存储，再从同一地址真实读回。
STORE R3, 0x145
STORE R2, 0x142
LDI R0, 2047
STORE R0, 0x147
LDI R0, 1
STORE R0, 0x146
spi_write_wait: LOAD R0, 0x141
LDI R1, 1
AND R0, R1
JNZ R0, spi_write_wait
LOAD R0, 0x147
JNZ R0, failed
LDI R6, 64
spi_retry: LDI R0, 2047
STORE R0, 0x147
LDI R0, 2
STORE R0, 0x146
spi_read_wait: LOAD R0, 0x141
LDI R1, 1
AND R0, R1
JNZ R0, spi_read_wait
LOAD R0, 0x147
JZ R0, spi_read_ok
SUBI R0, 1024
JNZ R0, failed
; 写后忙不是成功；最多64次重试，耗尽后计错并等待下一轮。
SUBI R6, 1
JNZ R6, spi_retry
JMP failed
spi_read_ok: LOAD R4, 0x143
MOV R0, R4
XOR R0, R2
JNZ R0, failed
STORE R4, 10
MOV R4, R3
ADDI R4, 16
STORE R2, [R4]
; DMA 从已实际写入的 RAM 复制当前前缀。
MOV R4, R3
ADDI R4, 1
STORE R4, 0x122
LDI R0, 1
STORE R0, 0x123
dma_wait: LOAD R0, 0x124
LDI R1, 1
AND R0, R1
JNZ R0, dma_wait
LOAD R0, 0x124
LDI R1, 4
AND R0, R1
JNZ R0, failed
STORE R2, 0x100
STORE R2, 2
STORE R4, 1
LDI R0, 1
STORE R0, 11
; 原始采样字节发送；串口断线计错，不撤销已提交记录。
uart_idle: LOAD R0, 0x131
LDI R1, 1
AND R0, R1
JNZ R0, uart_idle
LDI R0, 2047
STORE R0, 0x137
STORE R2, 0x132
LDI R0, 1
STORE R0, 0x136
uart_wait: LOAD R0, 0x131
LDI R1, 1
AND R0, R1
JNZ R0, uart_wait
LOAD R0, 0x137
JNZ R0, failed
JMP main
failed: LOAD R0, 3
ADDI R0, 1
STORE R0, 3
JMP main
; SPSC命令队列：ISR只写head，主程序只写tail；8槽留1槽区分满/空。
commands: LOAD R4, 97
LOAD R5, 96
MOV R0, R4
XOR R0, R5
JZ R0, commands_done
MOV R5, R4
ADDI R5, 128
LOAD R0, [R5]
ADDI R4, 1
LDI R1, 7
AND R4, R1
STORE R4, 97
MOV R1, R0
SUBI R1, 80
JZ R1, command_pause
MOV R1, R0
SUBI R1, 82
JZ R1, command_resume
SUBI R0, 67
JZ R0, command_clear
JMP commands
command_pause: LDI R0, 0
STORE R0, 12
JMP commands
command_resume: LDI R0, 1
STORE R0, 12
JMP commands
command_clear: LDI R0, 0
STORE R0, 1
STORE R0, 2
STORE R0, 10
STORE R0, 11
JMP commands
commands_done: RET
timer_isr: LDI R0, 1
STORE R0, 0x113
STORE R0, 4
LOAD R0, 6
ADDI R0, 1
STORE R0, 6
IRET
gpio_isr: LDI R0, 1
STORE R0, 0x103
LOAD R0, 9
ADDI R0, 1
STORE R0, 9
LOAD R0, 0x101
STORE R0, 13
LDI R1, 1
AND R0, R1
JZ R0, gpio_return
LOAD R0, 12
XOR R0, R1
STORE R0, 12
gpio_return: IRET
uart_isr: LOAD R0, 7
ADDI R0, 1
STORE R0, 7
uart_drain: LOAD R0, 0x131
LDI R1, 8
AND R0, R1
JZ R0, uart_return
LOAD R2, 0x133
LOAD R3, 96
MOV R4, R3
ADDI R4, 1
LDI R1, 7
AND R4, R1
LOAD R5, 97
XOR R5, R4
JZ R5, uart_dropped
ADDI R3, 128
STORE R2, [R3]
STORE R4, 96
JMP uart_drain
uart_dropped: LOAD R0, 98
ADDI R0, 1
STORE R0, 98
JMP uart_drain
uart_return: IRET
dma_isr: LOAD R0, 8
ADDI R0, 1
STORE R0, 8
IRET`;
  if(core==='custom')s=s.replace(/\bMOV\b/g,'MOVE').replace(/\bLOAD (R\d+), \[(R\d+)\]/g,'LOAD $1, $2').replace(/\bSTORE (R\d+), \[(R\d+)\]/g,'STORE $1, $2').replace(/\bLOAD (R\d+), (0x[\dA-Fa-f]+|\d+)/g,'LDR $1, $2').replace(/\bSTORE (R\d+), (0x[\dA-Fa-f]+|\d+)/g,'STR $1, $2');
  return s;
 }
 async function build(core='fixed',value={}){
  const o=options(value),program=source(core,o),image=core==='custom'?U.assemble(U.DEFAULT_ISA,program):A.assemble(program);if(!image.ok)throw Error(image.error);
  const p=await C.createProject(SAMPLES.find(s=>s.id===core).name),view={positions:{}},E=C.ep,B=C.boundary;
  const wire=(a,b,id)=>C.addWire(p,id||'w'+p.circuit.wires.length,a,b);
  const input=(id,width,value,label=id)=>{C.addInput(p,id,label,value,width);return B(id);};
  const node=(model,id,params={},x=0,y=0)=>{const n=C.createInstance(p,model,id);Object.assign(n.parameters,params);view.positions[id]={x,y};return n;};
  const reset=input('reset',1,0,'全板复位'),sense=input('sense',8,o.sense,'传感器数值'),button=input('button',16,0,'按键输入 bit0');
  const cpu=node(core==='custom'?U.CPU:'std.cpu16/1','cpu',core==='custom'?{source:program}:{source:program},230,100);
  node('std.bus-arbiter16/1','bus',{},600,160);node('std.bus-ram16/1','ram',{depth:256},1260,30);node('std.dma16/1','dma',{maxWords:8},250,540);node('std.irq4/1','irq',{},600,730);
  node('std.bus-gpio16/1','gpio',{},1650,250);node('std.bus-timer16/1','timer',{initialPeriod:o.period},1650,580);node('std.bus-dma-control16/1','dma_control',{},1650,910);
  node('std.mmio-uart16/1','uart',{},2050,260);node('std.mmio-spi16/1','spi',{},2050,610);node('std.mmio-i2c16/1','i2c',{},2050,960);
  node('std.protocol-registers/2','sensor',{},2450,960);node('std.protocol-memory/2','storage',{depth:256,writeBusyUs:o.writeBusyUs},2450,610);node('io.terminal/1','terminal',{},2450,260);
  function connect(master,slave,mp='',sp=''){for(const name of['req','we','address','wdata'])wire(E(master,mp+name),E(slave,sp+name),master+'_'+mp+name+'_to_'+slave+'_'+sp+name);for(const name of['rdata','ready','error'])wire(E(slave,sp+name),E(master,mp+name),slave+'_'+sp+name+'_to_'+master+'_'+mp+name);}
  function dec(id,base0,size0,base1,size1,x,y){node('std.bus-decoder16/1',id,{base0,size0,base1,size1},x,y);}
  connect('cpu','bus','','m0_');connect('dma','bus','','m1_');
  dec('decoder',0,256,256,96,950,180);connect('bus','decoder','s_');connect('decoder','ram','s0_');
  dec('devices',0,48,48,48,1220,440);connect('decoder','devices','s1_');
  dec('local_devices',0,16,16,32,1390,640);connect('devices','local_devices','s0_');connect('local_devices','gpio','s0_');
  dec('timer_dma',0,16,16,16,1400,950);connect('local_devices','timer_dma','s1_');connect('timer_dma','timer','s0_');connect('timer_dma','dma_control','s1_');
  dec('serial_devices',0,16,16,32,1780,1150);connect('devices','serial_devices','s1_');connect('serial_devices','uart','s0_');
  dec('spi_i2c',0,16,16,16,1900,1430);connect('serial_devices','spi_i2c','s1_');connect('spi_i2c','spi','s0_');connect('spi_i2c','i2c','s1_');
  for(const id of ['cpu','bus','ram','dma','irq','gpio','timer','dma_control','uart','spi','i2c','sensor','storage'])wire(reset,E(id,'reset'));
  wire(sense,E('sensor','sense'),'sense_to_sensor');wire(button,E('gpio','input'),'button_to_gpio');
  for(const name of['source','destination','count','trigger'])wire(E('dma_control',name),E('dma',name));wire(E('dma','done'),E('dma_control','done'));wire(E('dma','fault'),E('dma_control','dma_error'));wire(E('dma','completed'),E('dma_control','completed'));
  for(const[id,i]of[['timer',0],['gpio',1],['uart',2],['dma',3]])wire(E(id,'irq'),E('irq','irq'+i));wire(input('irq_enable',4,15,'中断使能'),E('irq','enable'));wire(E('irq','irq'),E('cpu','irq'));wire(E('cpu','irq_ack'),E('irq','ack'));
  const vectors=['timer_isr','gpio_isr','uart_isr','dma_isr'].map(label=>image.labels[label]);
  if(core==='fixed'){vectors.forEach((v,i)=>cpu.parameters['vector'+i]=v);wire(E('irq','irq_id'),E('cpu','irq_id'));wire(E('cpu','irq_ack_id'),E('irq','ack_id'));}
  else{node('std.mux16/1','vector_mux',{},920,870);vectors.forEach((v,i)=>wire(input('vector'+i,16,v,'IRQ'+i+' 程序入口'),E('vector_mux','abcd'[i])));wire(E('irq','irq_id'),E('vector_mux','sel'));wire(E('vector_mux','out'),E('cpu','vector'));wire(E('irq','irq_id'),E('irq','ack_id'));}
  wire(E('i2c','I2C_OUT'),E('sensor','I2C_RX'),'i2c_sensor');wire(E('spi','SPI_OUT'),E('storage','SPI_RX'),'spi_storage');wire(E('uart','UART_TX'),E('terminal','RX'),'uart_tx');wire(E('terminal','TX'),E('uart','UART_RX'),'uart_rx');
  for(const[id,width,from]of[['display',16,E('gpio','out')],['irq_pending',4,E('irq','pending')],['dma_copied',16,E('dma','completed')]]){C.addOutput(p,id,id,width);wire(from,B(id));}
  p.circuit.inputs.forEach((v,i)=>view.positions['boundary:'+v.id]={x:10,y:60+i*130});p.circuit.outputs.forEach((v,i)=>view.positions['boundary:'+v.id]={x:2800,y:80+i*180});
  return{project:await C.importProject(p),view,sources:{[(core==='custom'?'customarch2:':'architecture:')+'cpu']:program},source:program,lesson:null};
 }
 function inspect(runtime,scope=''){
  const s=runtime.inspect(),prefix=scope?scope+'/':'',get=id=>s.instances[prefix+id],ram=get('ram')?.hardware?.memory,cpu=get('cpu');
  const roles={ram:'std.bus-ram16/1',gpio:'std.bus-gpio16/1',timer:'std.bus-timer16/1',dma_control:'std.bus-dma-control16/1',dma:'std.dma16/1',uart:'std.mmio-uart16/1',spi:'std.mmio-spi16/1',i2c:'std.mmio-i2c16/1',sensor:'std.protocol-registers/2',storage:'std.protocol-memory/2',terminal:'io.terminal/1'};
  const controls=[['sense',8],['button',16],['reset',1]].every(([id,width])=>{const port=runtime.compiled.ports.get((scope||'$')+':'+id);return port?.kind==='digital'&&port.direction==='in'&&port.width===width;});
  // Check the observation/control contract, never the particular firmware or configurable ISA.
  const compatible=Array.isArray(ram)&&ram.length===256&&['std.cpu16/1','std.custom-cpu16/2'].includes(cpu?.modelId)&&Object.entries(roles).every(([id,model])=>get(id)?.modelId===model)&&controls;
  // PC 0..2 precede the first explicit header invalidation, including a warm restart.
  const initialized=compatible&&cpu.hardware.pc>=3&&ram[0]===MAGIC&&ram[5]===8&&Number.isInteger(ram[1])&&ram[1]>=0&&ram[1]<=8&&[0,1].includes(ram[12])&&ram.slice(16,16+ram[1]).every(v=>Number.isInteger(v)&&v>=0&&v<=255)&&ram.slice(64,64+ram[1]).every(v=>Number.isInteger(v)&&v>=0&&v<=255);
  const h=id=>clone(get(id)?.hardware||null),num=v=>{const bits=C.bits(v);return bits.some(b=>b==='X'||b==='Z')?null:bits.reduce((n,b,i)=>n+(b===1?2**i:0),0);};
  return{compatible,initialized,time:s.time,core:cpu?.modelId==='std.custom-cpu16/2'?'custom':'fixed',capacity:8,count:initialized?ram[1]:0,last:initialized?ram[2]:null,errors:initialized?ram[3]:0,due:initialized?ram[4]:0,ready:initialized&&ram[11]===1,running:initialized&&ram[12]===1,full:initialized&&ram[1]===8,records:initialized?ram.slice(16,16+ram[1]):[],copied:initialized?ram.slice(64,64+ram[1]):[],readback:initialized?ram[10]:null,interrupts:{timer:initialized?ram[6]:0,uart:initialized?ram[7]:0,dma:initialized?ram[8]:0,gpio:initialized?ram[9]:0},commandQueue:{head:initialized?ram[96]:0,tail:initialized?ram[97]:0,dropped:initialized?ram[98]:0},cpu:clone(cpu?.hardware||null),peripherals:Object.fromEntries(['gpio','timer','dma_control','dma','uart','spi','i2c','sensor','storage'].map(id=>[id,h(id)])),terminal:clone(s.terminals[prefix+'terminal']||null),display:get('gpio')?.modelId===roles.gpio?num(runtime.getPort(C.ep(prefix+'gpio','out'))):null};
 }
 function setSense(rt,value,input='sense'){if(!Number.isInteger(value)||value<0||value>255)throw Error('传感数值必须0—255');return rt.setInput(input,value);}
 function setButton(rt,value,input='button'){if(![0,1].includes(value))throw Error('按键必须0或1');return rt.setInput(input,value);}
 function sendCommand(rt,command,terminal='terminal'){if(!['P','R','C'].includes(command))throw Error('命令须为P、R或C');return rt.injectTerminal(terminal,command.charCodeAt(0));}
 return{CAPACITY,MAGIC,ADDRESS,META,IDs,PORTS,SAMPLES,source,build,inspect,setSense,setButton,sendCommand};
});
