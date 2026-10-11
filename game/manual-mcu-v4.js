(function(root,factory){'use strict';var data=factory();if(typeof module==='object'&&module.exports)module.exports=data;if(root)root.McuManualV4=data;})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  // Standalone reference data. It deliberately does not import or change a simulator.
  const section=(id,title,paragraphs,table,code,codeTitle)=>({id,title,paragraphs,...(table?{table}:{}),...(code?{code,codeTitle:codeTitle||'可编译示例'}:{})});
  const table=(headers,rows)=>({headers,rows});
  const registers=rows=>table(['地址','寄存器','权限','复位值','位与读写行为'],rows);
  const entries=[],portHints={};
  const notation=section('notation','先看懂寄存器表',[
    '所有 0x 开头的数都是十六进制；bit0 是最低位。RW 表示可读写，RO 只读，WO 只写，RW1C 表示读当前标志、写 1 清对应位、写 0 保持。示例中的分号后是注释。',
    '这里的微秒是游戏的虚拟时间。暂停会冻结整个电路和在途事务；HALT 只停程序，已开启的外设仍运行。数字高低电平、未知 X 和不驱动 Z 有实际接线含义；功能电源不计算电压、电流或功耗。',
    '这些都是游戏的教学指令集，不兼容 ARM、RISC-V 或商用 MCU。Core8 与 Build8 的指令、地址和状态位不同，请按当前型号查表。'
  ]);
  const coreArchitecture=section('architecture','Core8 的寄存器与存储',[
    'R0—R7 是八个可任意使用的 8 位寄存器，数值范围 0—255。加减与左移只保留低 8 位；没有隐藏的进位标志、比较标志或有符号运算。JZ/JNZ 直接检查指定寄存器。',
    'PC 是 16 位字节地址，每条指令占 4 字节，正常执行后 PC 加 4。SP 是保留的 16 位观察字段，复位为 0；本指令集没有栈、CALL、RET 或访问 SP 的指令。',
    '上电和冷启动：PC、SP、R0—R7、RAM、外设控制清零，GPIO 下拉 PD=0xFF；ROM 保留。暖复位也清寄存器与外设，但保留 RAM。复位会取消在途事务和 FIFO；观察历史保留复位标记。断电后输出不再驱动，再上电执行冷启动。',
    '程序 ROM 共 4096 字节；固件至少一条、最多 1024 条指令，末尾补零，相当于 NOP。执行越出 0x0FFC 后无法取完整指令，会停止于 F_FETCH。'
  ],table(['地址范围','内容','允许的操作'],[
    ['0x0000—0x0FFF','4 KiB ROM','LD 可读单个字节，ST 禁止；PC 必须四字节对齐'],
    ['0x2000—0x23FF','1 KiB RAM','LD/ST 读写单字节'],
    ['0x4000—0x400F','GPIO 区','只允许下表列出的四个地址'],
    ['0x4100—0x411F','UART 区','只允许下表列出的七个地址'],
    ['其他地址','未映射或型号扩展区','Core8/1 一律 F_ACCESS；Core8/2 只增加其扩展表列出的地址']
  ]));
  const coreInstructions=[
    ['00','NOP','无','不改数据，PC 加 4','00 00 00 00'],
    ['01','LDI Rd,n','Rd=R0—R7；n=0—255','Rd ← n','01 d n 00'],
    ['02','MOV Rd,Rs','两个寄存器','Rd ← Rs','02 d s 00'],
    ['03','ADD Rd,Rs','两个寄存器','Rd ← (Rd+Rs) mod 256','03 d s 00'],
    ['04','SUB Rd,Rs','两个寄存器','Rd ← (Rd−Rs) mod 256','04 d s 00'],
    ['05','AND Rd,Rs','两个寄存器','按位与，结果写 Rd','05 d s 00'],
    ['06','OR Rd,Rs','两个寄存器','按位或，结果写 Rd','06 d s 00'],
    ['07','XOR Rd,Rs','两个寄存器','按位异或，结果写 Rd','07 d s 00'],
    ['08','NOT Rd','一个寄存器','Rd 的八个位取反','08 d 00 00'],
    ['09','SHL Rd,n','n=0—7','逻辑左移 n 位，低位补 0，截成 8 位','09 d n 00'],
    ['0A','SHR Rd,n','n=0—7','逻辑右移 n 位，高位补 0','0A d n 00'],
    ['0B','LD Rd,address','16 位数字地址','读一个 ROM/RAM/外设字节到 Rd','0B d lo hi'],
    ['0C','ST Rs,address','16 位数字地址','把 Rs 写到 RAM/外设','0C s lo hi'],
    ['0D','JMP target','数字地址或标签','无条件跳转','0D 00 lo hi'],
    ['0E','JZ Rn,target','寄存器、数字地址或标签','Rn=0 时跳转，否则 PC 加 4','0E n lo hi'],
    ['0F','JNZ Rn,target','寄存器、数字地址或标签','Rn≠0 时跳转，否则 PC 加 4','0F n lo hi'],
    ['10','WAIT n','n=0—65535','先执行本指令，再等待 n 微秒才开始下一条','10 00 lo hi'],
    ['11','HALT','无','PC 加 4，停止取指；外设继续','11 00 00 00']
  ];
  const coreISA=section('instructions','完整指令与编码',[
    '指令和寄存器名称不区分大小写。数字接受十进制或 0x 十六进制，不接受负数或表达式。参数用逗号隔开。标签写成 loop:，JMP/JZ/JNZ 可引用标签；LDI、LD、ST、WAIT 不接受标签。ADD 等运算的第二个参数必须是寄存器，不接受立即数。',
    '下表编码均为四个字节；d/s/n 在寄存器字段中是编号 0—7，lo/hi 是 16 位数的低/高字节。未用字段必须为零。跳转目标必须在 0x0000—0x0FFC 且四字节对齐，即使条件不满足，也会检查目标合法性。',
    '普通指令耗时 1 微秒：开始取指，1 微秒后采样寄存器与已稳定引脚并提交。WAIT 在自己的这 1 微秒之后再等 n 微秒；WAIT 0 不额外等待。若 WAIT 在 t 时执行完成，下一条在 t+n 开始、t+n+1 执行完成。'
  ],table(['操作码','汇编','操作数','效果','四字节编码'],coreInstructions));
  const coreGPIO=section('gpio','GPIO：方向、输出、输入、内部下拉',[
    '四个寄存器的 bit0—bit7 分别对应 GPIO0—GPIO7。DIR=0 时引脚不主动驱动，DIR=1 时驱动 OUT 对应位。PD 是明确的内部弱下拉，复位全开；外部有效信号优先于弱下拉。',
    'IN 总是读取八个实际引脚，包括输出脚。任意一位为 X 或 Z 都使整次 LD 产生 F_UNKNOWN，目标寄存器保持原值，诊断指出未知引脚。多个有效推挽驱动即使写相同值也产生 X。接按键的引脚应保持输入。'
  ],registers([
    ['0x4000','DIR','RW','0x00','每位 0=输入/不驱动，1=输出；写入立即改变方向'],
    ['0x4001','OUT','RW','0x00','输出锁存值；读的是锁存值，只有 DIR=1 的位驱动引脚'],
    ['0x4002','IN','RO','由接线决定；默认下拉时 0x00','读取实际八位网络，无弹出或清标志副作用；禁止写'],
    ['0x4003','PD','RW','0xFF','每位 1=启用弱下拉，0=关闭；没有其他驱动且关闭下拉时会悬空'],
    ['0x4004—0x400F','未实现','不可访问','—','读写均 F_ACCESS']
  ]));
  const coreUART=section('uart','UART：发送、接收、状态和错误',[
    'UART_TX 接终端 RX；终端 TX 接 UART_RX。它们是 uart-txn/1 事务端口，不能接普通数字线。固定 9600、8N1，每个字节耗时 1042 微秒；写 TX 不会立即在终端显示。',
    'TX 与 RX 各容纳 16 字节，TX 长度包含正在发送的字节。满 TX 丢弃新字节并置 TX_OVERFLOW，程序继续；RX 满丢弃新输入并置 RX_OVERFLOW。读空 RX 是 F_RX_EMPTY，程序停止。',
    '关闭 TX 清发送队列并取消在途字节；关闭 RX 清接收队列并使旧在途接收失效。重新开启不能找回取消的事务。关闭功能不会自动清 ERROR。断开终端时发送仍可完成，但没有接收消息；断线再接回也不能补交旧字节。'
  ],registers([
    ['0x4100','TX','WO','无队列','写一个 0—255 字节入队；TX_EN 必须为 1；读或禁用时写均 F_ACCESS'],
    ['0x4101','RX','RO','空','RX_EN=1 且非空才可读；成功读返回队首并弹出一次；RX_EN=0 为 F_ACCESS，空为 F_RX_EMPTY'],
    ['0x4102','STATUS','RO','0x02','bit0 TX_FULL；bit1 TX_EMPTY（无排队或在途）；bit2 RX_READY；bit3 有错误；bit4—7=0'],
    ['0x4103','CTRL','RW','0x00','bit0 TX_EN；bit1 RX_EN；bit2—7 必须写 0，否则 F_ACCESS'],
    ['0x4104','ERROR','RW1C','0x00','bit0 TX_OVERFLOW；bit1 RX_OVERFLOW；写 1 清对应位；bit2—7 必须为 0'],
    ['0x4105','TX_COUNT','RO','0','0—16，含正在发送的字节'],
    ['0x4106','RX_COUNT','RO','0','0—16，待读字节数'],
    ['0x4107—0x411F','未实现','不可访问','—','读写均 F_ACCESS']
  ]));
  const coreErrors=section('errors','故障与执行顺序',[
    'F_ENCODING：操作码、寄存器编号或保留字节非法；F_TARGET：跳转目标非法；F_FETCH：PC 无法取完整指令；F_ACCESS：地址、权限或控制位非法；F_UNKNOWN：GPIO 输入未知；F_RX_EMPTY：读了空接收队列。发生故障的指令不会写寄存器、弹 RX、写总线或推进 PC。',
    'FAULT 和 HALT 都停止 CPU，已经启动的 UART 和 Core8/2 外设仍继续；修正程序或接线后复位再开始。暖复位保留 RAM，重新编译并应用程序则从冷启动开始。',
    '同一虚拟时刻先处理外部输入、断电和复位，再完成到期协议事务，再读取稳定的数字网络并执行指令。因此外部复位能取消同刻完成的字节；程序中同刻写“禁用”发生在完成之后，不能撤销已经交付的字节。'
  ]);
  const coreExample=section('example','从 LED 和一个串口字符开始',[
    '连接 VCC/GND 到同一已开启电源域，GPIO1 接 LED，UART_TX 接终端 RX。GPIO0 保持输入，可以接按键。程序只驱动 GPIO1，并先发送 ASCII 字符 B。',
    'WAIT 的单位是虚拟微秒；每次循环除等待外还有指令时间，因此两次 LED 写入之间为 10004 微秒。终端必须在字节开始前接好。'
  ],null,'LDI R0,2\nST R0,0x4000\nLDI R0,1\nST R0,0x4103\nLDI R0,66\nST R0,0x4100\nLDI R1,2\nLDI R2,2\nloop: ST R1,0x4001\nWAIT 10000\nXOR R1,R2\nJMP loop','Core8/1 与 Core8/2：GPIO1 闪烁并发送 B');
  entries.push({id:'core8-1',title:'Core8/1 · 基础 MCU 使用手册',category:'MCU 手册',summary:'八个通用寄存器、18 条指令、GPIO 与 UART；按地址读写外设。',appliesTo:['core8/1'],sections:[notation,coreArchitecture,coreISA,coreGPIO,coreUART,coreErrors,coreExample]});

  const coreTimer=section('timer','Core8/2 定时器',[
    'PERIOD 是 16 位微秒数，低地址放低字节；先禁用、写两个字节，再启用。周期为 0 禁止启用。每次写 CTRL 且 EN=1，都会从本次写完成时刻重新计时。',
    '到期置 FLAG=1；周期模式继续下一个周期，单次模式清 EN。IRQ 开启时到期产生一次请求，不依赖之后是否清 FLAG；清 FLAG 不会清 IRQ_PENDING。CPU 等待、HALT 或 FAULT 时定时器仍运行。'
  ],registers([
    ['0x4200','CTRL','RW','0','bit0 EN；bit1 PERIODIC；bit2 IRQ_EN；bit3—7 必须为 0'],
    ['0x4201','PERIOD_LO','RW','0','周期低 8 位；EN=1 时写入 F_ACCESS'],
    ['0x4202','PERIOD_HI','RW','0','周期高 8 位；EN=1 时写入 F_ACCESS'],
    ['0x4203','FLAG','RW1C','0','bit0 到期；写 1 清，其他位禁止置 1'],
    ['0x4204','COUNT_LO','RO','0','本周期已过去的微秒数低字节；未运行为 0'],
    ['0x4205','COUNT_HI','RO','0','同一计数的高字节；分两次 LD 可能跨越计数更新'],
    ['0x4206—0x420F','未实现','不可访问','—','读写 F_ACCESS']
  ]));
  const corePWM=section('pwm','Core8/2 PWM',[
    'PWM_OUT 是独立数字输出，不占用 GPIO。开启后每个周期开始锁存 activeDuty=min(DUTY,PERIOD)，前 activeDuty 微秒高，其余低。DUTY=0 全低，DUTY≥PERIOD 全高。',
    '运行中改 DUTY 在下一个周期才生效；低、高字节不是一次原子写入，跨周期写可能锁存中间值，需要时先禁用。重复写 EN=1 不重启相位；禁用立即取消后续边沿，内部 LEVEL=0、外部引脚为 Z。'
  ],registers([
    ['0x4300','CTRL','RW','0','bit0 EN；其余必须为 0；PERIOD 非零才能启用'],
    ['0x4301','PERIOD_LO','RW','0','16 位周期低字节，单位微秒；启用时禁止改'],
    ['0x4302','PERIOD_HI','RW','0','周期高字节；启用时禁止改'],
    ['0x4303','DUTY_LO','RW','0','16 位高电平时长低字节，允许运行中写'],
    ['0x4304','DUTY_HI','RW','0','高电平时长高字节，允许运行中写'],
    ['0x4305','LEVEL','RO','0','当前内部数字电平 0/1，不是模拟亮度'],
    ['0x4306—0x430F','未实现','不可访问','—','读写 F_ACCESS']
  ]), 'LDI R0,100\nST R0,0x4301\nLDI R0,25\nST R0,0x4303\nLDI R0,1\nST R0,0x4300\nHALT','Core8/2：PWM_OUT 产生 100 微秒周期、25% 占空比');
  const coreSPI=section('spi','Core8/2 SPI 主机',[
    'SPI_OUT 接 SPI 寄存器芯片 RX。写 DATA 就开始一个字节事务，完成前禁止再写 DATA 或 MODE。请求开始锁定数据和模式，8 微秒后访问接线上的从设备；成功才更新读回 DATA，失败保留旧值。',
    '当前 SPI 寄存器芯片只接受 mode0：先发 0x00|reg 选择写，或 0x80|reg 选择读，reg=0—15；再发数据或读 dummy。选择字节的 bit4—6 必须为 0。第二字节完成后清选择状态。一次读/写共两个 8 微秒字节，不存在隐藏 CS 引脚。',
    'MODE 的 0—3 对应传统 SPI 模式编号，当前只是传给从设备的事务参数，不产生时钟边沿。模式不匹配、断线或无效应答置 ERROR；DONE 同样置位，因此读程序还要检查 ERROR。'
  ],registers([
    ['0x4500','CTRL','RW','0','bit0 EN、bit1 完成 IRQ；其他位必须 0；EN=0 取消在途事务、清 BUSY，保留已存在 DONE/ERROR'],
    ['0x4501','DATA','RW','0','读最近成功返回值；写在 EN=1 且空闲时立即开始字节事务；不会先把发送值写成读回值'],
    ['0x4502','STATUS','RO / RW1C','0','bit0 BUSY，bit1 DONE，bit2 ERROR；只准写 0x02/0x04 或其组合清标志；启动新事务时状态变 1'],
    ['0x4503','MODE','RW','0','值 0—3；忙时写或越界均 F_ACCESS'],
    ['0x4504—0x450F','未实现','不可访问','—','读写 F_ACCESS']
  ]),'LDI R0,1\nST R0,0x4500\nST R0,0x4501\nWAIT 8\nLDI R0,90\nST R0,0x4501\nWAIT 8\nLDI R0,129\nST R0,0x4501\nWAIT 8\nLDI R0,0\nST R0,0x4501\nWAIT 8\nLD R1,0x4502\nLDI R2,4\nAND R1,R2\nJNZ R1,failed\nLD R3,0x4501\nST R3,0x2000\nfailed: HALT','Core8/2：把 SPI reg1 写为 90，再读入 RAM[0]');
  const coreI2C=section('i2c','Core8/2 I²C 主机',[
    'I2C_OUT 接温度芯片 RX。一次完整寄存器事务耗时 100 微秒；开始时锁定地址、寄存器号、读写方向和数据。成功返回更新 DATA，失败保留旧 DATA；先看 STATUS 再使用结果。',
    '温度芯片地址 0x48：寄存器 0 是只读温度，初始 25，可由环境调到 0—125；寄存器 1 是只读 ID=0xA1；寄存器 2 是读写 scratch，初始 0。错地址、错误寄存器或写只读寄存器均 NACK。温度在事务完成时读取。',
    '这里只模拟事务的等待、应答和读写，不产生 SDA/SCL 边沿，也不包含多主仲裁。断线再连接、端点复位或失电不会让原事务重新有效。'
  ],registers([
    ['0x4400','CTRL','RW','0','bit0 EN、bit1 完成 IRQ；其他位必须 0；禁用取消在途事务、清 BUSY，保留已有其他标志'],
    ['0x4401','ADDR','RW','0','7 位地址 0—127；忙时或越界写入 F_ACCESS'],
    ['0x4402','REG','RW','0','8 位从设备寄存器号；忙时不可改'],
    ['0x4403','DATA','RW','0','下次写事务数据 / 最近成功读回值；忙时不可写，读无副作用'],
    ['0x4404','CMD','WO','无事务','写 1=读，2=写；必须启用且空闲；其他值或读取 F_ACCESS'],
    ['0x4405','STATUS','RO / RW1C','0','bit0 BUSY，bit1 DONE，bit2 NACK，bit3 ERROR；允许写 0x02/04/08 的组合清标志；启动时变 1'],
    ['0x4406—0x440F','未实现','不可访问','—','读写 F_ACCESS']
  ]),'LDI R0,1\nST R0,0x4400\nLDI R0,72\nST R0,0x4401\nLDI R0,1\nST R0,0x4404\nWAIT 100\nLD R1,0x4405\nLDI R2,12\nAND R1,R2\nJNZ R1,failed\nLD R3,0x4403\nST R3,0x2000\nfailed: HALT','Core8/2：成功读取温度才写 RAM[0]');
  const coreIRQ=section('interrupts','Core8/2 中断入口与返回',[
    '三个来源按低位优先：timer=1、SPI=2、I²C=4。没有 GPIO 或 UART 中断。外设自己的 IRQ_EN 允许时，事件先置 PENDING，不受全局 ENABLE/MASK 阻止；ENABLE=1、MASK 允许且不在 ISR 时，CPU 在指令边界进入同一个 VECTOR。入口自动清选中 PENDING 位，CAUSE 保留最后来源。',
    '只保存返回 PC，不保存 R0—R7；为 ISR 预留专用寄存器或用 RAM 自行保存。中断不嵌套。IRET 编码为 12 00 00 00，耗时 1 微秒；不在 ISR 时执行为 F_ACCESS。Core8/2 没有 EI、DI 指令，使用 ST 写 ENABLE。',
    'WAIT 可被中断，剩余等待取消，返回后从 WAIT 后一条继续。HALT/FAULT 不会被 IRQ 唤醒。进入不另加一个隐藏指令周期，ISR 首条指令在入口后 1 微秒完成。',
    '下面把 ISR 放在字节地址 0x40：前面准确有 16 条指令。Core8 的 LDI 不接受标签，移动 ISR 后须同步修改 VECTOR；跳转标签则由编译器自动计算。'
  ],registers([
    ['0x4600','ENABLE','RW','0','只允许 0/1；写 1 前 VECTOR 必须在 0—0x0FFC 并四字节对齐'],
    ['0x4601','MASK','RW','0','bit0 timer、bit1 SPI、bit2 I²C，1=允许进入；其余位必须 0'],
    ['0x4602','PENDING','RW1C','0','同三个来源位；重复事件合并；入口自动清选中位；清外设标志不会代清这里'],
    ['0x4603','VECTOR_LO','RW','0','公共中断入口字节地址低位；ENABLE=1 或 ACTIVE=1 时禁止改'],
    ['0x4604','VECTOR_HI','RW','0','入口地址高位；条件同上'],
    ['0x4605','ACTIVE','RO','0','0/1，是否在 ISR'],
    ['0x4606','CAUSE','RO','0','最后一次进入的来源值 1、2 或 4；IRET 不清该观察值'],
    ['0x4607—0x460F','未实现','不可访问','—','读写 F_ACCESS']
  ]),'LDI R0,64\nST R0,0x4603\nLDI R7,1\nST R7,0x4601\nST R7,0x4600\nLDI R0,100\nST R0,0x4201\nLDI R0,7\nST R0,0x4200\nidle: WAIT 1000\nJMP idle\nNOP\nNOP\nNOP\nNOP\nNOP\nisr: ADD R2,R7\nST R2,0x2000\nST R7,0x4203\nIRET','Core8/2：每 100 微秒中断一次，用 R2/R7 计数');
  const core2ISA={...coreISA,table:table(coreISA.table.headers,[...coreInstructions,['12','IRET','无','从活动 ISR 恢复返回 PC，不恢复 R0—R7；没有活动帧时 F_ACCESS','12 00 00 00']])};
  entries.push({id:'core8-2',title:'Core8/2 · 定时器、PWM 与协议 MCU',category:'MCU 手册',summary:'保留 Core8/1 编程方式，增加 timer/PWM、三个中断源、SPI 与 I²C。',appliesTo:['core8/2'],sections:[notation,coreArchitecture,core2ISA,coreGPIO,coreUART,coreTimer,corePWM,coreSPI,coreI2C,coreIRQ,coreErrors,coreExample]});

  const buildRows=[
    ['00','NOP','无','不改数据，PC 加 1'],['01','LDI n','n=0—255','A ← n；Build8/2 还允许标签地址'],
    ['02','ADDI n','n=0—255','A ← (A+n) mod 256'],['03','SUBI n','n=0—255','A ← (A−n) mod 256'],
    ['04','ANDI n','n=0—255','A 按位与 n'],['05','ORI n','n=0—255','A 按位或 n'],['06','XORI n','n=0—255','A 按位异或 n'],
    ['07','LOAD address','address=0—255','读 RAM；Build8/2 的 0xC0—0xFF 改读外设'],['08','STORE address','address=0—255','把 A 写 RAM 或 Build8/2 外设'],
    ['09','JMP target','0—255 或标签','PC ← target'],['0A','JZ target','0—255 或标签','当前 A=0 时跳转，否则 PC 加 1'],
    ['0B','OUT','无','A 写入独立输出寄存器，不改变 GPIO OUT 寄存器'],['0C','IN','无','A ← 顶层 key 八位输入，不是读取 GPIO IN'],
    ['0D','HALT','无','停止取指/执行；PC 保留在 HALT 所在地址'],['0E','SHL n','n=0—7','A 左移 n 位并截成 8 位'],['0F','SHR n','n=0—7','A 逻辑右移 n 位']
  ];
  const aluRows=[['0','B 直通','0'],['1','A+B','超出位宽为 1'],['2','A−B','A≥B 为 1，表示没有借位'],['3','A AND B','0'],['4','A OR B','0'],['5','A XOR B','0'],['6','NOT A','0'],['7','A 左移 (B mod 位宽)','超出位宽为 1'],['8','A 逻辑右移 (B mod 位宽)','0'],['9','A 直通','0'],['10','A×B','超出位宽为 1'],['11','A=B → 1，否则 0','0'],['12','无符号 A<B → 1，否则 0','0'],['13','无符号 A>B → 1，否则 0','0'],['14/15 或未知','OUT/ZERO/CARRY 为 X','X']];
  const aluSection=section('alu-codes','指令操作码与 ALU 选择码不同',[
    'ROM 高字节是指令 opcode；ALU.OP 是译码器产生的 4 位运算选择码，不能直接相连。例如 ADDI 的指令 opcode=2，译码后 ALU.OP=1；SHL 的 opcode=14，ALU.OP=7。',
    'Build8 标准板只使用部分 ALU 功能，但 ALU 元件单独放置时可使用下表全部功能。8 位和 16 位 ALU 各按自身位宽截断结果；ZERO=1 表示截断后的结果为零。Build8 的 JZ 读取累加器的独立零检测器，不读取 ALU.CARRY。'
  ],table(['ALU.OP 十进制','OUT 运算','CARRY'],aluRows));
  const buildArchitecture=section('architecture','可见模块中的 PC、IR、A 和存储',[
    '没有 R0—R7。A 是一个独立 8 位累加寄存器；IR 是 16 位指令寄存器；PC 是 16 位程序计数器。输出寄存器保存最后一次 OUT 的结果；零检测器持续检查 A。它们都能在画布上找到并重新接线。',
    '程序 ROM 有 256 个 16 位字，每个字是一条指令：高 8 位 opcode、低 8 位参数。PC 按字加 1，不按字节加 4。ROM 未填写的 0—255 地址读为 0，即 NOP；PC≥256 才输出 X 并使后续译码失败。',
    '标准板每个虚拟微秒一拍，先取指到 IR，再执行并提交 A/RAM/PC 等。通常一条指令两拍。所有时序元件在同一拍读取旧值，再一起更新，因此改线可以真正改变数据路径。',
    '冷启动时 PC、IR、A、输出和控制相位恢复初值；RAM 从其参数 contents 初始化，标准板未填位置为 0。暖复位保留 RAM，其他模块恢复初态；ROM 程序保留。顶层 reset 输入为 1 是同步硬件复位，每拍保持复位，会把 RAM 恢复 contents；它不同于“暖复位”按钮。'
  ]);
  const buildSyntax=section('instructions','Build8 指令与写法',[
    '大小写不敏感；每行一条指令，分号后为注释，数字用十进制或 0x 十六进制。每条至多一个参数，不使用逗号、不使用寄存器名、不接受负数或表达式。JMP/JZ 可用标签，Build8/2 的 LDI 也可用标签；Build8/1 的 LDI 只接受数字。',
    '机器字 = (opcode << 8) | 参数。无参数指令的低字节必须为 0；SHL/SHR 参数必须 0—7。未知指令、未知 IR、非法保留字段在执行拍使 fault/stop 为 1，标准板停止取指和 PC。'
  ],table(['指令 opcode 十六进制','汇编','参数','行为'],buildRows));
  const build1Example=section('example','第一段自组装程序',[
    '在“硬件与组装”打开自组装计算示例。程序通过独立 ALU 算 7+5，保存到 RAM[3]，再写输出寄存器。逐拍查看 ROM→IR、ALU→A 和 A→输出三段路径。'
  ],null,'LDI 7\nADDI 5\nSTORE 3\nOUT\nHALT','Build8/1 与 Build8/2：计算 12 并保存');
  entries.push({id:'build8-1',title:'Build8/1 · 从模块搭出处理器',category:'MCU 手册',summary:'单累加器、16 条指令、两拍执行；全部计算与存储通过可见连线完成。',appliesTo:['std.build8-decoder/1'],sections:[notation,buildArchitecture,buildSyntax,aluSection,section('memory','Build8/1 数据地址与输入输出',[
    'LOAD/STORE 的 0x00—0xFF 全部访问独立 256 字节 RAM，没有内存映射 GPIO、定时器或协议控制器。程序 ROM 与数据 RAM 分开，LOAD 不能读指令 ROM。',
    'IN 读顶层 key 总线；OUT 写独立输出寄存器，再送显示器和顶层 value。程序输出不会自动配置其他芯片。需要内存映射外设、中断和协议时，使用 Build8/2。',
    'RAM 写地址或数据未知时报告硬件错误并保留原数据。A 可因断开的读总线锁存 X；控制器不会替你补值。模块故障标志通常保持到复位。'
  ]),build1Example]});

  const busCommon=section('bus','独立外设的共同接线和时序',[
    'ADDRESS 是 8 位地址、DATA 是 8 位写数据、OUT 是 8 位读数据。READ/WRITE 是选中本模块的单比特使能，不是全板未经译码的读写信号。RESET=1 在下一拍把模块复位，未用控制输入也必须有明确的 0。',
    'OUT 组合地显示当前地址对应的值，即使 READ=0；READ 的作用是触发读副作用，例如 UART 弹出队首。写入和读副作用在每个虚拟微秒的提交拍发生；保持 WRITE=1 多拍会重复写入。',
    '独立模块按地址低位选寄存器，自己不检查高地址是否属于本模块；标准地址译码器负责片选。GPIO 用低四位，其他外设用低三位。因此单独使用模块时也要正确连接片选。',
    '不合法写入会锁存 E_MMIO_ACCESS；地址/读写控制未知产生 E_UNKNOWN_BUS。FAULT 引脚用于观察，默认没有连成全机停止线；不能把出现错误后的旧值当成一次成功读取。控制寄存器的保留高位按下表屏蔽，并非 Core8 那样统一停机。'
  ],table(['共同端口','方向/位宽','接线作用'],[
    ['address','输入 8 位','接指令译码 ADDRESS'],['data','输入 8 位','接 A 的 Q'],['read','输入 1 位','接本设备专属 *_r'],['write','输入 1 位','接本设备专属 *_w'],['reset','输入 1 位','同步复位，高有效'],['out','输出 8 位','接八路读选择器的对应设备输入'],['irq','输出 1 位','外设请求；支持的来源接 IRQ 控制器，PWM 此脚固定 0'],['fault','输出 1 位','1 表示模块锁存故障，复位清除']
  ]));
  const buildGPIO=section('gpio','Build8/2 GPIO 与消抖',[
    '每一位对应一个 GPIO 引脚。方向和下拉规则与 Core8 相同，但额外有边沿标志与稳定采样。只对 DIR=0 且 MASK=1 的位记录消抖后输入的双边沿。',
    'DEBOUNCE=0/1 表示一次相同采样即可更新，较大值表示要连续这么多拍相同。FILTERED 初始为 0；若上电输入已高，稳定采样后也会形成上升变化。原始输入含未知位时本拍不更新整组消抖状态。',
    '读 RAW_IN 时任一未知位使整字为 X 并锁存 E_UNKNOWN_GPIO；读 FILTERED_IN 可得到上一次稳定值，不代表当前线路一定正常。IRQ 在 FLAGS&MASK 非零时一直为高。'
  ],registers([
    ['0xC0','DIR','RW','0x00','bit0—7：0 输入、1 输出'],['0xC1','OUT','RW','0x00','八位输出锁存值，只有 DIR=1 的位驱动'],['0xC2','RAW_IN','RO','取决于接线，默认下拉为 0','实际八个引脚；未知时 X+E_UNKNOWN_GPIO；写入非法'],['0xC3','PD','RW','0xFF','每位 1=内部弱下拉'],['0xC4','EDGE_MASK','RW','0x00','每位 1=检测该输入的双边沿，并允许其 FLAGS 拉高 IRQ'],['0xC5','FLAGS','RW1C','0x00','每位 1=该位发生稳定输入变化；写 1 清该位'],['0xC6','DEBOUNCE','RW','0','0—255 拍；0/1 均为一次采样'],['0xC7','FILTERED_IN','RO','0x00','最近稳定采样值；读取不清 FLAGS'],['0xC8—0xCF','未实现','不可访问','—','读为 X、写非法；读写会锁存 E_MMIO_ACCESS']
  ]));
  const buildTimer=section('timer','Build8/2 定时器',[
    '每一拍先按原设置计数，再处理本拍寄存器写入。启用且 PERIOD>0 时 COUNT 加 1；到期清 COUNT、置 FLAG 并累计 FIRES。周期模式继续计数；单次模式清 EN。',
    '与 Core8/2 不同，允许运行中改周期；写 CTRL、PERIOD_LO 或 PERIOD_HI 都把 COUNT 清零。PERIOD=0 时不计数，也不会产生周期。IRQ 为 IRQ_EN 与 FLAG 的逻辑与，保持高直到清 FLAG 或禁用 IRQ。'
  ],registers([
    ['0xD0','CTRL','RW','0','bit0 EN，bit1 周期，bit2 IRQ_EN；bit3—7 忽略；每次写重置 COUNT'],['0xD1','PERIOD_LO','RW','0','16 位周期低字节，单位拍/微秒；每次写重置 COUNT'],['0xD2','PERIOD_HI','RW','0','周期高字节；每次写重置 COUNT'],['0xD3','FLAG','RW1C','0','bit0 到期标志；高位忽略；不清 IRQ 控制器的 pending'],['0xD4','COUNT_LO','RO','0','当前计数低字节'],['0xD5','COUNT_HI','RO','0','当前计数高字节；两次读不锁存整对'],['0xD6','FIRES_LO','RO','0','累计到期次数低 8 位，超过 255 回卷显示'],['0xD7','保留','RO','0','读 0，写入锁存 E_MMIO_ACCESS']
  ]));
  const buildPWM=section('pwm','Build8/2 PWM',[
    '8 位 PERIOD 和 DUTY，以一微秒一拍运行。enabled 且 PERIOD>0 时 phase 每拍递增并按 PERIOD 回卷；phase<min(DUTY,PERIOD) 时为高。DUTY=0 全低，DUTY≥PERIOD 全高，PERIOD=0 关闭波形。',
    '写 CTRL、PERIOD、DUTY 立即将 PHASE 重置为 0，并立即重新计算 LEVEL；这里没有 Core8/2 的“下一周期锁存”行为。禁用时输出数字 0，只有失电才不驱动。无中断。不要写 RO/保留地址：会锁存错误且也重置相位。'
  ],registers([
    ['0xD8','CTRL','RW','0','bit0 EN，其余忽略；写入重置相位'],['0xD9','PERIOD','RW','0','周期 0—255 拍；写入重置相位'],['0xDA','DUTY','RW','0','高电平拍数 0—255；写入重置相位'],['0xDB','PHASE','RO','0','本周期相位'],['0xDC','LEVEL','RO','0','实际数字电平 0/1'],['0xDD—0xDF','保留','RO','0','读 0，写入 E_MMIO_ACCESS']
  ]),'LDI 100\nSTORE 0xD9\nLDI 25\nSTORE 0xDA\nLDI 1\nSTORE 0xD8\nHALT','Build8/2：独立 PWM 继续产生 25% 波形');
  const buildUART=section('uart','Build8/2 独立 UART',[
    'UART_TX→终端 RX，终端 TX→UART_RX；固定 9600、8N1，每字节 1042 微秒。TX/RX 容量各 16，TX 包含在途字节；读 RX 在采样时拿队首、提交时弹出。',
    '空 RX 返回 X，置 ERROR bit1 并锁存 E_UART_EMPTY；RX 满丢新字节并置 bit1。TX 满丢新字节、置 bit0；TX 没启用时写入丢弃并置 bit2。错误不自动让取指控制器停机。',
    '关闭 TX 清队列并取消在途；关闭 RX 清队列，旧在途接收不能混入重新开启后的 RX。CTRL 不清错误。清 ERROR 也不会清已锁存的 FAULT，FAULT 需复位。RX_IRQ_EN=1 且 RX 非空时 IRQ 保持高；读空队列前应先检查 STATUS bit0。'
  ],registers([
    ['0xE0','CTRL','RW','0','bit0 TX_EN、bit1 RX_EN、bit2 RX_IRQ_EN；高位忽略'],['0xE1','TX','写数据 / 读 0','0','写入发送队列；读取没有副作用并返回 0'],['0xE2','RX','RO','空，读为 X','非空读取弹出一字节；不检查 RX_EN，但关闭 RX 已清空队列'],['0xE3','STATUS','RO','0x02','bit0 RX_READY，bit1 TX_SPACE，bit2 TX_BUSY，bit3 有错误；高位 0；与 Core8 STATUS 排列不同'],['0xE4','ERROR','RW1C','0','bit0 TX 满、bit1 RX 满或读空、bit2 禁用 TX 时写；写 1 清，其他位无影响'],['0xE5','TX_COUNT','RO','0','0—16，包含在途字节'],['0xE6','RX_COUNT','RO','0','0—16'],['0xE7','保留','RO','0','读 0，写入 E_MMIO_ACCESS']
  ]),'LDI 1\nSTORE 0xE0\nLDI 66\nSTORE 0xE1\nHALT','Build8/2：停止 CPU 后等待终端收到 B');
  const buildSPI=section('spi','Build8/2 独立 SPI 主机',[
    '与 Core8/2 不同，写 DATA 只是准备数据，写 CMD=1 才开始事务。每字节 8 微秒，SPI_OUT 接 mode0 寄存器芯片 RX。首字节选择读/写 reg0—15，第二字节读或写数据，格式同本手册的 SPI 器件说明。',
    '开始后请求内容已锁定；可以改 DATA/MODE 为下一次准备，不会改当前事务。完成成功才写回 DATA；失败保留当时 DATA。忙时再次开始、禁用时开始或非法命令置 ERROR，不替换原事务。有效开始清旧状态为 BUSY=1。',
    '完成设 DONE=1，失败再设 ERROR=1；成功完成状态为 2、失败为 6，会替换忙期间的状态标记。IRQ_EN=1 且 DONE/ERROR 非零时请求保持高，写 STATUS 清标志。当前从设备仅支持 mode0；没有独立 CS 引脚或逐边沿时序。'
  ],registers([
    ['0xE8','CTRL','RW','0','bit0 EN，高位忽略；写 EN=0 取消在途并把 STATUS 清 0'],['0xE9','DATA','RW','0','发送暂存/读回值；写入本身不发送'],['0xEA','MODE','RW','0','只保留 bit0—1，模式 0—3；当前从设备只支持 0'],['0xEB','CMD','写命令 / 读 0','0','写 1 启动一个字节；其他值、未启用或忙时置 ERROR'],['0xEC','STATUS','RO / RW1C','0','bit0 BUSY、bit1 DONE、bit2 ERROR；写 bit1/2 清对应标志，其他写入位忽略'],['0xED','IRQ_EN','RW','0','bit0 允许完成/错误请求，高位忽略'],['0xEE—0xEF','保留','RO','0','读 0，写入 E_MMIO_ACCESS']
  ]));
  const buildI2C=section('i2c','Build8/2 独立 I²C 主机',[
    'I2C_OUT 接温度芯片 RX，每个寄存器读/写 100 微秒。地址 0x48 的 reg0 是温度（初始 25），reg1 是 ID=0xA1，reg2 是读写 scratch（初始 0）。前两个只读；错址、错寄存器、写只读或断线都会失败。',
    'ADDR 寄存器保存完整 8 位；当前从设备只应答 0x48，没有其他地址或多主仲裁。请求开始锁定地址、寄存器、方向和写值；之后修改暂存寄存器不改在途请求。',
    'STATUS 的 ERROR 合并 NACK/断线/其他失败，不像 Core8/2 另有 NACK 位。失败保留 DATA，程序必须检查 ERROR 后再使用；忙时重复命令置错误且保留在途请求，后续完成会以结果状态 2/6 替换。'
  ],registers([
    ['0xF0','CTRL','RW','0','bit0 EN，高位忽略；写 0 取消在途并清 STATUS'],['0xF1','ADDR','RW','0x48','完整 8 位从地址，读写均允许；通常配置 0x48'],['0xF2','REG','RW','0','8 位从设备寄存器号'],['0xF3','DATA','RW','0','下次写值 / 成功事务的返回值；失败不自动清零'],['0xF4','CMD','写命令 / 读 0','0','写 1 读、写 2 写；其他值、未启用或忙时置 ERROR'],['0xF5','STATUS','RO / RW1C','0','bit0 BUSY、bit1 DONE、bit2 ERROR；写 bit1/2 清，其他位忽略'],['0xF6','IRQ_EN','RW','0','bit0 允许 DONE/ERROR 请求；高位忽略'],['0xF7','保留','RO','0','读 0，写入 E_MMIO_ACCESS']
  ]),'LDI 1\nSTORE 0xF0\nLDI 72\nSTORE 0xF1\nLDI 0\nSTORE 0xF2\nLDI 1\nSTORE 0xF4\nwait: LOAD 0xF5\nANDI 1\nJZ done\nJMP wait\ndone: LOAD 0xF5\nANDI 4\nJZ success\nHALT\nsuccess: LOAD 0xF3\nSTORE 2\nOUT\nHALT','Build8/2：确认成功后显示温度并保存 RAM[2]');
  const buildIRQ=section('interrupts','Build8/2 中断入口、返回与清除请求',[
    '请求位 GPIO=1、Timer=2、UART=4、SPI=8、I²C=16。每拍把各请求线锁存到 PENDING，不受 MASK 或 ENABLE 阻止；多个请求按最低位优先。高电平请求会每拍重新锁存，因此必须先处理并清外设来源，再清 PENDING。',
    '仅在取指前 READY=1、全局允许且没有活动 ISR 时进入。入口用单独一拍保存 PC 和 A，并把 PC 送到 VECTOR，不取旧地址的指令。IRET 经过正常取指/执行两拍，同时从保存帧恢复 PC 与 A。不支持中断嵌套。',
    'EI/DI 无参数，操作同一 ENABLE；IRET 无参数，不在 ISR 时会译码为非法并停止标准板。HALT 后 READY=0，中断不能唤醒，但外设继续计数/传输。',
    '寄存器 VECTOR 为指令字地址 0—255，可在运行时写，改变之后的中断入口。只有 PC/A 自动保存；RAM、输出寄存器和外设结果不会回滚。'
  ],registers([
    ['0xF8','ENABLE','RW','0','bit0 全局允许；高位忽略；EI 写 1、DI 写 0'],['0xF9','MASK','RW','0','bit0 GPIO、bit1 Timer、bit2 UART、bit3 SPI、bit4 I²C；高位忽略'],['0xFA','PENDING','RW1C','0','同五个来源位；入口自动清选中位，但高请求线下一拍可再次置位'],['0xFB','VECTOR','RW','0','8 位 ISR 入口指令字地址，无四字节对齐限制'],['0xFC','ACTIVE','RO','0','是否在 ISR，0/1'],['0xFD','CAUSE','RO','0','最近进入的单一来源位值 1/2/4/8/16；返回后保留'],['0xFE','ENTRIES_LO','RO','0','累计进入次数低 8 位'],['0xFF','FAULT','RO','0','IRQ 模块自身故障为 1；复位清除']
  ]),'LDI handler\nSTORE 0xFB\nLDI 2\nSTORE 0xF9\nLDI 200\nSTORE 0xD1\nLDI 7\nSTORE 0xD0\nEI\nloop: JMP loop\nhandler: LOAD 0\nADDI 1\nSTORE 0\nOUT\nLDI 1\nSTORE 0xD3\nLDI 2\nSTORE 0xFA\nIRET','Build8/2：每 200 微秒请求一次中断并显示计数');
  const buildMap=section('map','Build8/2 数据地址总表',[
    '程序仍在独立 256 字 ROM 中。LOAD/STORE 先经过可见地址译码器：0x00—0xBF 访问 RAM，0xC0—0xFF 访问下列外设。RAM 元件本身仍有 256 字节，但高 64 字节在这块标准板上被外设地址覆盖。',
    'IN/OUT 保留旧含义：读 key、写输出显示。要读 GPIO 按键用 LOAD 0xC2，要点 GPIO LED 用 STORE 0xC1，并先配置方向。'
  ],table(['地址','设备','读选择编号'],[['0x00—0xBF','RAM','0'],['0xC0—0xCF','GPIO','1'],['0xD0—0xD7','Timer','2'],['0xD8—0xDF','PWM','3'],['0xE0—0xE7','UART','4'],['0xE8—0xEF','SPI','5'],['0xF0—0xF7','I²C','6'],['0xF8—0xFF','IRQ','7']]));
  const buildExtra=section('extra-instructions','Build8/2 新增三条指令',[
    '保留上面全部 16 条旧指令和编码，新增下表三条；它们的低字节必须为 0。Build8/1 不接受这三条。Build8/2 的 LDI 标签可用于设置 VECTOR。'
  ],table(['opcode','指令','作用'],[['10','EI','允许全局中断'],['11','DI','禁止全局进入，但不清 pending'],['12','IRET','从活动中断帧恢复 PC 与 A；没有帧时非法']]));
  entries.push({id:'build8-2',title:'Build8/2 · 完整模块 MCU 使用手册',category:'MCU 手册',summary:'19 条指令、独立内存映射总线、GPIO/timer/PWM/IRQ 与真实协议控制器。',appliesTo:[],sections:[notation,buildArchitecture,buildSyntax,buildExtra,aluSection,buildMap,busCommon,buildGPIO,buildTimer,buildPWM,buildUART,buildSPI,buildI2C,buildIRQ,build1Example]});

  const digital=(id,direction,width,meaning)=>[id,direction+' '+width+' 位',meaning];
  const commonPorts=[digital('address','输入',8,'本模块寄存器地址，接地址总线'),digital('data','输入',8,'本次写入字节，通常接累加器 A'),digital('read','输入',1,'本模块读使能，高电平每拍产生一次读副作用'),digital('write','输入',1,'本模块写使能，高电平每拍写一次'),digital('reset','输入',1,'同步复位，高有效'),digital('out','输出',8,'地址选出的读数据，送读总线'),digital('irq','输出',1,'持续外设请求，无请求为 0'),digital('fault','输出',1,'锁存错误指示，复位清除')];
  const decoderPorts=[digital('instruction','输入',16,'IR 指令字；高字节 opcode、低字节参数'),digital('execute','输入',1,'只有为 1 时产生执行控制'),digital('zero','输入',1,'累加器 A 是否为零，供 JZ 使用'),digital('irq_active','输入',1,'IRQ 控制器 ACTIVE；IRET 必须为 1'),digital('immediate','输出',8,'低字节参数，接 ALU.B'),digital('address','输出',8,'低字节地址，接 RAM/外设地址总线'),digital('target','输出',16,'低字节参数零扩展，普通跳转目标'),digital('alu','输出',4,'ALU 功能选择码，和指令 opcode 不同'),digital('select','输出',2,'写回选择：0 ALU、1 内存、2 key、3 返回 A'),digital('load_a','输出',1,'使能累加器装入'),digital('read_mem','输出',1,'LOAD 的读使能，送地址译码'),digital('write_ram','输出',1,'STORE 的总写使能，送地址译码；名称不表示只写 RAM'),digital('write_out','输出',1,'OUT 指令使能独立输出寄存器'),digital('pc_enable','输出',1,'正常执行时允许 PC 更新，HALT/非法时为 0'),digital('pc_load','输出',1,'JMP 或成立的 JZ，普通跳转装入'),digital('stop','输出',1,'HALT/非法执行时停止 PC 和时序器'),digital('fault','输出',1,'仅非法执行为 1；HALT 本身不是错误'),digital('ei','输出',1,'EI 指令脉冲'),digital('di','输出',1,'DI 指令脉冲'),digital('iret','输出',1,'有效 IRET 指令脉冲')];
  const moduleDefinitions=[
    {model:'std.address-decoder8/2',title:'地址译码器',description:'按地址选 RAM 或一个外设，把总读写信号变成单设备片选。',ports:[digital('address','输入',8,'0—255 数据地址'),digital('read','输入',1,'CPU LOAD 总读使能'),digital('write','输入',1,'CPU STORE 总写使能'),digital('select','输出',3,'0 RAM、1 GPIO、2 Timer、3 PWM、4 UART、5 SPI、6 I²C、7 IRQ'),...['ram','gpio','timer','pwm','uart','spi','i2c','irq'].flatMap(b=>[digital(b+'_r','输出',1,'仅选中 '+b+' 时转发 READ，否则 0'),digital(b+'_w','输出',1,'仅选中 '+b+' 时转发 WRITE，否则 0')]),digital('fault','输出',1,'地址或 READ/WRITE 未知时为 1，片选输出为 X')],sections:[buildMap],details:'纯组合元件，无内部寄存器。允许 READ/WRITE 同为 1，会同时转发；通常应一次只做读或写。'},
    {model:'std.bus-read8/2',title:'八路读总线选择器',description:'把地址译码选中的设备读数据接回写回总线。',ports:[digital('select','输入',3,'设备选择编号 0—7'),...['ram','gpio','timer','pwm','uart','spi','i2c','irq'].map(b=>digital(b,'输入',8,b+' 的 OUT')),digital('out','输出',8,'直接转发选中输入；SELECT 未知则整字 X')],sections:[buildMap],details:'纯组合选择，没有缓存，不会主动读取或弹出设备 FIFO；读副作用由设备 READ 线控制。未选中的设备输入可以未知，不影响选中结果。'},
    {model:'std.build8-decoder/2',title:'Build8/2 指令译码器',description:'把 19 条指令转换成控制线；它不替 ALU、寄存器或存储器执行操作。',ports:decoderPorts,sections:[buildSyntax,buildExtra,aluSection],details:'纯组合元件；FETCH 阶段通常只给出参数/选择信息，EXECUTE=1 才有效写入。IRET 不在活动中断、JZ 零条件未知、IR 未知或编码非法时产生 STOP/FAULT。'},
    {model:'std.fetch-execute/2',title:'可中断取指/执行时序器',description:'在取指、执行之间切换，并给中断入口留出一拍。',ports:[digital('halt','输入',1,'高时锁存停止'),digital('reset','输入',1,'高时复位到 phase=0，halted=false'),digital('take','输入',1,'本拍进入 IRQ；不切换相位且抑制 FETCH'),digital('ready','输出',1,'未停止且 phase=0，可进入中断'),digital('fetch','输出',1,'未停止、phase=0、TAKE=0，允许 ROM→IR'),digital('execute','输出',1,'未停止且 phase=1，允许译码执行'),digital('halted','输出',1,'已锁存停止')],sections:[],details:'每拍先检查 RESET，再 HALT，再 TAKE。正常相位在 0/1 间翻转；TAKE=1 时相位保持。HALT 锁存后须复位，不能靠把 HALT 拉低自动恢复；控制输入未知也会停并报告错误。'},
    {model:'std.pc-route16/2',title:'PC 跳转/中断返回选择器',description:'选择普通 PC 更新、中断向量或保存的返回地址。',ports:[digital('base_en','输入',1,'译码器 PC_ENABLE'),digital('base_load','输入',1,'译码器 PC_LOAD'),digital('base_target','输入',16,'普通跳转目标'),digital('take','输入',1,'中断进入'),digital('iret','输入',1,'中断返回'),digital('vector','输入',16,'中断入口'),digital('saved','输入',16,'保存的返回 PC'),digital('en','输出',1,'TAKE 或 IRET 或 BASE_EN'),digital('load','输出',1,'TAKE 或 IRET 或 BASE_LOAD'),digital('target','输出',16,'优先 TAKE→VECTOR，其次 IRET→SAVED，否则 BASE_TARGET')],sections:[],details:'纯组合元件，没有自己的 PC。输出 EN/LOAD/TARGET 接独立 PC；四个控制输入任一未知时输出 X。'},
    {model:'std.gpio8/2',title:'独立 GPIO 与消抖',description:'可单独使用的八位双向数字端口。',ports:[...commonPorts,...Array.from({length:8},(_,i)=>digital('GPIO'+i,'双向',1,'DIR bit'+i+' 控制方向；PD bit'+i+' 控制内部弱下拉'))],sections:[buildGPIO],details:'内部状态含 DIR/OUT/PD/MASK/FLAGS、原始上次值、八个稳定采样计数与消抖后值；各实例独立。复位除 PD=FF 外清零。'},
    {model:'std.timer16/2',title:'独立 16 位定时器',description:'周期/单次计数，到期可拉高 IRQ。',ports:commonPorts,sections:[buildTimer],details:'内部 CTRL/PERIOD/COUNT/FLAG/FIRES 复位均清零；不依赖 CPU 是否取指。'},
    {model:'std.pwm8/2',title:'独立 8 位 PWM',description:'按周期和占空拍数直接输出数字波形。',ports:[...commonPorts,digital('PWM_OUT','输出',1,'实际数字波形；禁用为 0，失电为 Z')],sections:[buildPWM],details:'内部 CTRL/PERIOD/DUTY/PHASE/LEVEL 复位清零；公共 IRQ 脚恒为 0，没有 PWM 中断。'},
    {model:'std.uart8/2',title:'独立 UART 控制器',description:'含两个 FIFO，可与终端双向传输真实字节。',ports:[...commonPorts,['UART_TX','事务输出 uart-txn/1','接终端 RX 或另一 MCU 的 UART_RX'],['UART_RX','事务输入 uart-txn/1','接终端 TX 或另一 MCU 的 UART_TX']],sections:[buildUART],details:'FIFO/控制/错误/计数复位清空，在途事务取消。接收开启状态与连接在发送开始时形成资格，之后断线、禁用接收或复位会使该事务失效。'},
    {model:'std.spi8/2',title:'独立 SPI 主控制器',description:'从 DATA 准备字节，再由 CMD 发起事务。',ports:[...commonPorts,['SPI_OUT','事务输出 spi-txn/1','接 std.spi-register/1.RX，单端点请求与应答']],sections:[buildSPI],details:'CTRL/DATA/MODE/STATUS/IRQ_EN 复位为 0，在途请求清除。寄存器设备对已经完成的第一字节保留读写选择；需要放弃半帧时也复位从设备。'},
    {model:'std.i2c8/2',title:'独立 I²C 主控制器',description:'一次完成一个地址、寄存器和数据的读/写事务。',ports:[...commonPorts,['I2C_OUT','事务输出 i2c-txn/1','接 std.i2c-temperature/1.RX']],sections:[buildI2C],details:'ADDR 复位为 0x48，其他数值清零，在途请求取消；从器件通过当前连线应答，不能脱离设备得到温度。'},
    {model:'std.irq8/2',title:'中断入口与返回帧',description:'收集五条请求线，保存 PC/A 并控制入口和返回。',ports:[...commonPorts,digital('pc','输入',16,'进入时要保存的下一条指令字地址'),digital('acc','输入',8,'进入时要保存的 A'),digital('ready','输入',1,'时序器位于取指前、可以接受中断'),digital('ei','输入',1,'置全局 ENABLE'),digital('di','输入',1,'清全局 ENABLE'),digital('iret','输入',1,'清活动状态与返回帧，同时外部 PC/A 读取旧帧恢复'),...['gpio','timer','uart','spi','i2c'].map((b,i)=>digital(b+'_irq','输入',1,'来源 bit'+i+'；未使用时明确接 0')),digital('take','输出',1,'READY 且允许的请求存在且无活动帧'),digital('active','输出',1,'当前在 ISR'),digital('vector','输出',16,'8 位向量零扩展'),digital('saved_pc','输出',16,'已保存的 PC，无帧为 0'),digital('saved_acc','输出',8,'已保存的 A，无帧为 0')],sections:[buildIRQ],details:'复位清全部数值与帧。直接驱动 IRET 而没有帧会锁存 E_IRQ_RETURN；未知请求线、未知 PC/A 不能形成有效入口。公共 IRQ 输出固定 0，不用于再次级联。'}
  ];
  for(const m of moduleDefinitions){
    const id=m.model.replace('std.','').replace('/','-');
    entries.push({id,title:m.title+' · 模块手册',category:'自组装 MCU 模块',summary:m.description,appliesTo:[m.model],sections:[section('module','这个模块做什么',[m.details,'本模块与其他模块通过普通连线工作；断开的输入不会自动补值。使用功能供电域，上电才驱动输出。']),section('ports','端口逐项说明',[],table(['端口 ID','类型','作用'],m.ports)),...(m.model.match(/std\.(gpio|timer|pwm|uart|spi|i2c|irq)/)?[busCommon]:[]),...m.sections]});
    portHints[m.model]=Object.fromEntries(m.ports.map(row=>[row[0],row[1]+'；'+row[2]]));
  }
  for(const model of ['core8/1','core8/2']){
    const h={VCC:'功能电源正端；需与 GND 接同一已开启电源域',GND:'功能电源地端；需与 VCC 同域，不是数字 0 输入',UART_TX:'uart-txn/1 发送端；接终端 RX，每字节 1042 微秒',UART_RX:'uart-txn/1 接收端；接终端 TX，先在 CTRL 中打开 RX_EN'};
    for(let i=0;i<8;i++)h['GPIO'+i]='数字双向 1 位；DIR bit'+i+'=1 时驱动 OUT，否则 Z；PD bit'+i+'=1 启用内部弱下拉';
    if(model==='core8/2')Object.assign(h,{PWM_OUT:'独立数字 PWM 输出；禁用为 Z，PERIOD/DUTY 位于 0x4301—0x4304',SPI_OUT:'spi-txn/1 字节事务输出；接 SPI 寄存器芯片 RX，8 微秒/字节',I2C_OUT:'i2c-txn/1 寄存器事务输出；接温度芯片 RX，100 微秒/事务'});
    portHints[model]=h;
  }
  portHints['std.build8-decoder/1']=Object.fromEntries(decoderPorts.filter(row=>!['irq_active','read_mem','ei','di','iret'].includes(row[0])).map(row=>[row[0],row[1]+'；'+(row[0]==='select'?'写回选择：0 ALU、1 RAM、2 key；3 未使用':row[0]==='write_ram'?'STORE 指令使能 RAM 写入':row[2])]));
  entries.find(e=>e.id==='build8-1').sections.push(section('decoder-ports','Build8/1 译码器的全部控制线',['这是组合译码器，没有内部寄存器。它只输出接线控制，不代替 ALU、PC 或 RAM 工作；与 Build8/2 的译码器相比没有中断控制和独立 READ_MEM。'],table(['端口 ID','作用'],Object.entries(portHints['std.build8-decoder/1']))));
  return {entries,portHints};
});
