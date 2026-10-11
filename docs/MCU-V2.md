# Core8/2 教学 MCU 与外设

版本：0.2.0；日期：2026-10-10。实现入口：[core8plus.js](../dist/core8plus.js)，独立于已发布的 `core8/1`。本文件定义新版的实际运行合同；冻结的 v0.1 规格继续适用于旧模型。固件记录的 `targetModel` 必须与所装核心一致，不能把 `IRET` 新字节码当成旧核心指令。

这是功能级数字模型：普通指令仍为虚拟 1 µs，PWM 是真实的数字高低电平；SPI/I²C 是具有开始、完成、应答和取消的事务，不模拟 MOSI/SCLK/SDA/SCL 电气边沿、上拉电阻、模拟电压或真实器件最高频率。Core8/2 不兼容 ARM/RISC-V。

## 核心及扩展 API

浏览器依次加载 `core8.js`、`core8plus.js`；新版导出 `window.Core8Plus`，Node 使用 `require('./dist/core8plus.js')`。公开对象为 `{CPU, assemble, SAMPLES, SPI_TIME, I2C_TIME, NAMES}`。

`CPU` 继承旧核心的 8 个通用寄存器、ROM 4 KiB、RAM 1 KiB、GPIO、UART 与 18 条指令，兼容 `nextTime/complete/sample/commit/flush/exportState/importState`。不改写旧核心实现。新增 `pwmOutput()` 返回实际 `0/1/Z`，供电无效或 PWM 禁用时为 Z。新增输出口约定为 `PWM_OUT`（digital，1 bit）、`SPI_OUT`（spi-txn/1）、`I2C_OUT`（i2c-txn/1）；它们与 GPIO 分离，没有隐藏引脚复用。

汇编器 `assemble(source)` 返回 `{ok,bytes,sourceMap,error,line}`，`SAMPLES` 是数组，每项 `{id,name,description,source}`。新增唯一指令 `IRET`，编码 `12 00 00 00`，仍为 4 字节、1 µs；任一保留字段非零产生 F_ENCODING。无活动中断时执行产生 F_ACCESS，PC/寄存器不部分提交。Core8/1 仍拒绝此指令。

CPU 扩展状态置于 `.plus`，导出快照后路径相同：

| 状态 | 字段 |
|---|---|
| timer | ctrl, period, flag, next, fires |
| pwm | ctrl, period, duty, activeDuty, level, cycle, next |
| spi | ctrl, data, mode, status, active |
| i2c | ctrl, address, register, data, status, active |
| irq | enabled, mask, pending, vector, active, cause, frame, entries |

`next/cycle/start/done` 在内核是 BigInt 微秒或 null，`fires/entries` 是 BigInt 计数；快照全部序列化成十进制字符串。所有扩展寄存器冷、暖复位均为 0；计数清零、在途事件取消。暖复位保留 RAM、冷复位清 RAM；基础 UART 历史策略沿用旧模型。

## 寄存器表

地址以十六进制表示，读写为 8 位，16 位数使用低地址低字节。表中未列地址一律 F_ACCESS，不因位于已预留外设区而默许访问。受限写入在指令采样阶段检查，失败没有部分副作用。

### 定时器

| 地址 | 名称 / 权限 | 行为 |
|---|---|---|
| 4200 | CTRL，RW | bit0 EN；bit1 周期模式；bit2 产生 timer IRQ；其他位必须 0。写入 EN=1 以本次 ST 退休时刻重新预约 `t + PERIOD`；EN=0 取消。 |
| 4201/4202 | PERIOD，RW | 16 位微秒，范围 1—65535 才可启用；启用期间禁止修改，先禁用再配置。 |
| 4203 | STATUS，RW1C | bit0 到期标记；写 1 清除、写 0 保持。不会隐式清 IRQ_PENDING。 |
| 4204/4205 | COUNT，RO | 当前周期已过的微秒，周期起点为 0；未运行时为 0。 |

到期时 STATUS 置 1、fires 加 1；如开启 timer IRQ，将 IRQ_PENDING.timer 置 1。周期模式预约下一次 `t + PERIOD`；单次模式自动清 EN。无论 CPU HALT/FAULT，已启用定时器仍运行。

### PWM

| 地址 | 名称 / 权限 | 行为 |
|---|---|---|
| 4300 | CTRL，RW | bit0 EN，其他位必须 0。首次启用立即开启一个周期；禁用取消边沿并使 PWM_OUT 为 Z。重复写已启用状态不重新起相位。 |
| 4301/4302 | PERIOD，RW | 16 位微秒；非零才可启用；启用时禁止修改。 |
| 4303/4304 | DUTY，RW | 16 位高电平时间，可运行时修改，下一周期起点锁存。 |
| 4305 | LEVEL，RO | 当前内部实际电平；禁用为 0，但引脚对外为 Z。 |

每个周期起点锁存 `activeDuty = min(DUTY, PERIOD)`；前 activeDuty 微秒为高，其余为低。0 为整周期低，达到或超过 PERIOD 为整周期高。16 位 DUTY 的两次字节写若跨过周期起点，可能锁存中间值，这是明确的教学寄存器行为；需要原子改变时先禁用。面板显示本周期占空比应使用 `activeDuty / period`，不能拿尚未锁存的新值冒充已发生的输出。

### SPI 主机

| 地址 | 名称 / 权限 | 行为 |
|---|---|---|
| 4500 | CTRL，RW | bit0 EN、bit1 事务完成 IRQ，其他位必须 0；关闭 EN 取消尚未完成的字节。 |
| 4501 | DATA，RW | 写入在 EN=1 且空闲时提交一个字节；读取最近一次成功返回值，读无副作用。 |
| 4502 | STATUS，RO/RW1C | BUSY=1、DONE=2、ERROR=4；可写 2/4 清标记，写 BUSY 位无效并 F_ACCESS。 |
| 4503 | MODE，RW | 0—3；在途时禁止改模式。 |

每字节固定 8 µs，在 ST DATA 退休时锁定 `{byte,mode}`；提交清除上次状态并置 BUSY。到期再实际调用外部从设备，成功返回 0—255 更新 DATA；失败保留旧 DATA，置 ERROR。完成置 DONE、清 BUSY，按 CTRL 决定置 SPI 中断待处理位。每次仅一个在途事务；忙时重写 DATA 产生 F_ACCESS，旧事务仍按计划完成。

配套 `std.spi-register/1` 合同为 mode 0、16 个字节寄存器。第一字节 `0x00 | reg` 选择写，`0x80 | reg` 选择读，reg 为 0—15，bits4—6 必须为 0。第二字节写数据并回传，或读取选中寄存器（忽略 dummy），完成后清游标。每字节各 8 µs。这是固定两字节帧的教学协议，没有伪造 CS 引脚；单独复位 MCU 不回滚已经完成的从端操作，恢复未完成两字节帧时可对整板执行暖复位，清除从端游标。

### I²C 主机

| 地址 | 名称 / 权限 | 行为 |
|---|---|---|
| 4400 | CTRL，RW | bit0 EN、bit1 完成 IRQ；其他位必须 0；关闭 EN 取消未完成事务。 |
| 4401 | ADDR，RW | 7 位从地址；0—127，在途时禁止修改。 |
| 4402 | REG，RW | 从设备寄存器号，在途时禁止修改。 |
| 4403 | DATA，RW | 写入下次事务数据或读上次成功结果；在途时禁止写，读无副作用。 |
| 4404 | CMD，WO | 写 1=读寄存器，写 2=写寄存器；只有 EN=1 且空闲才允许。 |
| 4405 | STATUS，RO/RW1C | BUSY=1、DONE=2、NACK=4、ERROR=8；2/4/8 可写 1 清除。 |

一次寄存器事务固定 100 µs，开始时锁定 `{address,register,read,value}`。只有完成且连接 token 仍有效才读写外部器件。地址不应答、断线或器件拒绝为 NACK；其他无效响应为 ERROR。失败保留旧 DATA，成功更新 DATA；都置 DONE、清 BUSY，并可产生 I²C IRQ。读取程序必须检查 STATUS，不能将保留的旧值误称为本次成功测量。

配套 `std.i2c-temperature/1` 地址为 0x48，reg0 只读温度（默认 25，0—125 整数）、reg1 只读 ID 0xA1、reg2 为 scratch 可读写寄存器。错地址、错误寄存器及写只读寄存器返回 NACK，不改变状态。温度由独立环境事件改变，不能由 CPU 驱动动画来假装测得；从端冷、暖复位恢复约定初始状态。

### 中断控制器

| 地址 | 名称 / 权限 | 行为 |
|---|---|---|
| 4600 | ENABLE，RW | bit0 全局使能；使能前 VECTOR 必须在 0000—0FFC 且 4 字节对齐。 |
| 4601 | MASK，RW | timer=1、SPI=2、I²C=4；其他位必须 0。 |
| 4602 | PENDING，RW1C | 同上三个位；同源重复事件合并为一个待处理位。 |
| 4603/4604 | VECTOR，RW | 公共 ISR 入口；全局已使能或 ISR 活动时禁止修改。 |
| 4605 | ACTIVE，RO | 0/1，是否正在 ISR 中。 |
| 4606 | CAUSE，RO | 最近进入 ISR 的来源掩码 1/2/4，复位为 0。 |

在所有 CPU 同刻提交之后的 flush 阶段，仅当没有尚未退休的指令、未在 ISR、全局使能且存在未屏蔽待处理位，保存返回 PC 并跳转 VECTOR。按 timer→SPI→I²C 固定优先级选一个来源，入口自动清该 PENDING 位。无嵌套，ISR 期间到来的事件保持 pending；IRET 返回后可以立即处理下一来源。

入口只保存 PC，不保存 R0—R7；处理程序必须自行约定哪些寄存器归 ISR 使用。WAIT 被中断时取消剩余等待，IRET 从 WAIT 后的指令继续。HALT/FAULT 不被中断自动唤醒，外设仍照常完成。ISR 入口本身不另加隐藏时钟周期，首条 ISR 指令在入口后 1 µs 退休；IRET 自身耗时 1 µs。

## 调度、协议路由与快照

沿用事件顺序：外部电源/复位/输入/接线事件 → 到期外设完成 → 稳定数字网络 → 所有 CPU 从共同快照采样 → 提交 → 派生事件及下一条取指 → 稳定与观察。外部 reset 在同刻完成之前取消事件；程序中的 ST 禁用指令在同刻完成之后执行，不能撤销已交付字节。

Runtime 必须把 `CPU.nextTime()` 纳入调度，并在完成阶段调用 `cpu.complete(time, io)`，不能只依据 `uart.active` 决定是否调用。Core8/2 的完成内部固定处理 UART、timer、PWM、SPI、I²C。CPU 暂停由 Runtime 冻结整个虚拟时间和队列，不用墙钟超时或 requestAnimationFrame 决定协议是否完成。

除旧 UART 回调，`io` 增加：

```js
startProtocol(protocol, request, time, cpu) => serializableToken
completeProtocol(protocol, request, token, time, cpu)
  => { ok: true, value: 0..255 }
  // 或 { ok: false, error: 'NACK' | 'DISCONNECTED' | 'MODE' | ... }
```

`protocol` 为 `spi-txn/1` 或 `i2c-txn/1`，time 为 BigInt。start 只锁定路由，不能提前写从端寄存器；token 包含连接版本及设备代次。complete 在到期时验证仍是同一有效连接与已供电接收端，再产生从端副作用。断线再接回不能恢复旧 token。CPU 禁用、复位或断电直接取消 active，不调用旧 complete。协议失败仍需返回，不能无限挂起或无条件成功。

快照 schema 为 `core8.snapshot/2`；旧、新核心拒绝互相恢复。状态包括 timer 截止时刻、PWM 相位与已锁占空、IRQ 返回地址和所有在途协议 token。导入先验证全部扩展及基础状态，再原子应用；畸形时刻、寄存器、活动状态或固件不匹配均拒绝。恢复已开始的事务不再次调用 start，也不会提前完成。观察历史沿用最多 256 条及丢弃计数。

## 可运行教学样例及验证

完整源码随 `Core8Plus.SAMPLES` 提供，可直接送入新版汇编器，不需要手写模拟效果：

| id | 接线与实际结果 |
|---|---|
| pwm-breath | PWM_OUT→LED；255 µs 周期，程序每约 5 ms 上下改变占空，从实际边沿观察亮灭/占空。 |
| timer-irq | GPIO 输出到指示灯/观察器；定时器 1000 µs 触发真实 ISR，R2、RAM[0] 和 GPIO 显示计数。第一个入口 t=1014，IRET 于 t=1018 返回。 |
| spi-register | SPI_OUT→寄存器芯片 RX，UART_TX→终端；四个字节先写 reg1=90 再读回，R1、RAM[0]、GPIO 为 90，UART 输出 Z。 |
| i2c-temperature | I2C_OUT→温度芯片 RX，UART_TX→终端；读回温度进入 R1、RAM[0]、GPIO 并发原始 UART 字节；R2 保存事务状态。 |

后三个样例使用 GPIO0—7 输出，不要再把按钮强驱动连接到这些引脚。I²C 样例为了让初学者检查寄存器，保留了读失败时旧 DATA 的可见性；NACK 后不能把 RAM 显示的旧值当成新测量。UART 的温度字节可能不可打印，终端应同时显示数值。

已实际执行 [core8plus.test.cjs](../tests/core8plus.test.cjs)：**26 组通过**。覆盖旧核心拒绝新指令、旧程序时序、全部四个样例、真实中断返回、十周期 25% PWM、占空锁存、双向呼吸变化、SPI 寄存器读写/错误、I²C 数据变化/NACK、忙写原子故障、禁用与复位取消、同刻优先级、HALT/FAULT、BigInt 时间、活动事务及 IRQ 快照、畸形快照拒绝。

这些 CPU 单元测试使用明确的可控制从设备夹具来验证主机合同，不代替 CircuitLab 对实际模型注册、网络路由、从端状态、面板和整板封装的集成验收。那些结果应在相应运行测试和浏览器记录中另行报告。当前中断源没有 GPIO 边沿/消抖功能，不宣称已实现按键中断；SPI 波形模式电气验证、多主 I²C 仲裁也不在此事务模型范围内。
