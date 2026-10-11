(function(root,factory){const api=typeof module==='object'&&module.exports?factory(require('./circuit.js'),require('./core8plus.js')):factory(root.CircuitLab,root.Core8Plus);if(typeof module==='object'&&module.exports)module.exports=api;else root.V2Examples=api;})(typeof window!=='undefined'?window:null,function(C,CPU){
 'use strict';
 const list=CPU.SAMPLES.map(x=>({id:x.id,name:x.name,description:x.description}));
 async function build(id){const sample=CPU.SAMPLES.find(x=>x.id===id);if(!sample)throw new Error('未知外设示例。');const p=await C.createProject(sample.name),a=CPU.assemble(sample.source);if(!a.ok)throw new Error(String(a.error));await C.addFirmware(p,'program_mcu',a.bytes,'core8/2');C.createInstance(p,'core8/2','mcu','增强教学 MCU',{firmware:'program_mcu'});C.createInstance(p,'std.vcc/1','vcc','电源正端');C.createInstance(p,'std.gnd/1','gnd','电源地端');C.createInstance(p,'io.terminal/1','terminal','程序串口输出');C.addWire(p,'power',C.ep('vcc','out'),C.ep('mcu','VCC'));C.addWire(p,'ground',C.ep('gnd','out'),C.ep('mcu','GND'));C.addWire(p,'uart',C.ep('mcu','UART_TX'),C.ep('terminal','RX'));
  const view={positions:{vcc:{x:45,y:50},gnd:{x:45,y:230},mcu:{x:390,y:100},terminal:{x:920,y:640}}};
  if(id==='pwm-breath'){C.addOutput(p,'pwm','PWM 数字输出');C.addWire(p,'pwm_signal',C.ep('mcu','PWM_OUT'),C.boundary('pwm'));view.positions['boundary:pwm']={x:920,y:100};}
  else{for(let i=0;i<8;i++){C.addOutput(p,'bit'+i,'数值 bit'+i);C.addWire(p,'gpio'+i,C.ep('mcu','GPIO'+i),C.boundary('bit'+i));view.positions['boundary:bit'+i]={x:850+(i%4)*190,y:45+Math.floor(i/4)*170};}}
  if(id==='spi-register'){C.createInstance(p,'std.spi-register/1','peripheral','SPI · 16 字节寄存器');C.addWire(p,'spi_bus',C.ep('mcu','SPI_OUT'),C.ep('peripheral','RX'));view.positions.peripheral={x:900,y:450};}
  if(id==='i2c-temperature'){C.createInstance(p,'std.i2c-temperature/1','peripheral','I²C · 温度传感器');C.addWire(p,'i2c_bus',C.ep('mcu','I2C_OUT'),C.ep('peripheral','RX'));view.positions.peripheral={x:900,y:450};}
  return {project:await C.importProject(p),view,source:sample.source,sources:{program_mcu:sample.source}};
 }
 async function verify(id,project){const p=project||((await build(id)).project),r=new C.Runtime(await C.importProject(p)),checks=[];const check=(label,ok,detail)=>checks.push({label,ok,detail});r.advance(20000n,{force:true});let cpu=r.inspect().instances.mcu;
  if(id==='pwm-breath'){const levels=new Set();for(let i=0;i<520;i++){r.advance(1n,{force:true});levels.add(C.scalar(r.getPort(C.boundary('pwm'))));}check('PWM 输出实际翻转',levels.has(0)&&levels.has(1),'观察 520 μs 内的数字端口，不以显示动画代替波形。');check('程序改变了占空时间',cpu.plus.pwm.activeDuty>0&&cpu.plus.pwm.activeDuty<cpu.plus.pwm.period,'本周期占空时间 '+cpu.plus.pwm.activeDuty+' / '+cpu.plus.pwm.period+' μs。');}
  if(id==='timer-irq'){check('定时器触发实际中断',BigInt(cpu.plus.irq.entries)>=10n,'中断进入次数 '+cpu.plus.irq.entries);check('ISR 更新 RAM 计数',cpu.ram[0]>=10,'RAM[0] = '+cpu.ram[0]);}
  if(id==='spi-register'){check('通过实际 SPI 连线写入并回读',cpu.ram[0]===90,'RAM[0] = '+cpu.ram[0]+'，期望 90。');}
  if(id==='i2c-temperature'){check('初次读到温度 25 ℃',cpu.ram[0]===25,'RAM[0] = '+cpu.ram[0]);r.setSensorTemperature('peripheral',65);r.advance(22000n,{force:true});cpu=r.inspect().instances.mcu;check('环境改变经 I²C 到达 MCU',cpu.ram[0]===65,'温度改为 65 ℃ 后 RAM[0] = '+cpu.ram[0]);}
  return {ok:checks.length>0&&checks.every(x=>x.ok),checks};
 }
 return {list,build,verify};
});
