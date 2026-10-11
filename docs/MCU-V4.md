# Build8/2：由可见模块构成的教学 MCU

版本 0.4.0，2026-10-10。

这一版把自组装 Build8 扩为可接外设的教学 MCU。程序由画布中的程序计数器、程序 ROM、指令寄存器、译码器、累加器、ALU、RAM、地址译码和数据选择器共同执行；没有 Core8 实例，也没有在后台另外解释同一段指令的隐藏处理器。

## 玩家入口

在工作台点击 **硬件与组装**，找到 **完整模块 MCU · 外设与中断**，可打开五个已接好的实验：

| 实验 | 程序实际完成的行为 |
| --- | --- |
| 模块 MCU · 按键与串口 | GPIO0 读取按键，GPIO1 控制 LED；独立 UART 控制器上电发送 B |
| 模块 MCU · 定时中断计数 | 定时器每 200 μs 请求中断，处理程序更新 RAM 和显示，再返回主循环 |
| 模块 MCU · PWM 呼吸 | 程序循环改变占空比，PWM 控制器产生实际数字波形 |
| 模块 MCU · SPI 寄存器 | 四次字节事务分别选择、写入、选择读、读回寄存器 1，结果为 90 |
| 模块 MCU · I²C 温度采集 | 循环读取外部温度芯片，默认 25；传感器环境值改变后读回值随之改变 |

右侧 **自组装 MCU · 实时状态** 显示 PC、指令字、累加器、输出、RAM、GPIO、定时计数、PWM、IRQ 和协议控制器状态。**下一拍** 推进 1 μs；**下一条指令** 推进到下一次执行提交，必要时包含中断入口拍。**编辑 MCU 程序** 修改真实 ROM，编译并应用后冷启动。选择 ROM 也能直接编辑数字内容；此操作会清除过期的汇编源码记录。

每个新控制器都可以从元件库单独放入电路。完整板可以封装、导出、导入并放置多次。模块内的 ROM 内容、源码、连线和从设备随包保存；每个实例拥有独立运行状态。大型板可缩放和平移逐根检查接线，手机通过“观察”打开同一状态面板。

## 数据路径与新模型

Build8/1 的已有模型和 16 条指令保持原样。Build8/2 新增 12 个有独立版本身份的模型，基础板共 26 个可见元件：

| 模型 ID | 作用 |
| --- | --- |
| `std.build8-decoder/2` | 19 条指令的组合译码，产生读写、ALU、PC 和中断控制信号 |
| `std.fetch-execute/2` | 分开取指、执行，允许在取指前插入中断入口拍 |
| `std.pc-route16/2` | 在普通跳转、中断向量、保存的返回地址之间选择 |
| `std.address-decoder8/2` | 按 8 位地址选 RAM 或一个 MMIO 外设 |
| `std.bus-read8/2` | 把被选中的读数据接回累加器选择器 |
| `std.gpio8/2` | 8 个真实双向数字端口、方向、下拉、稳定采样消抖和边沿标志 |
| `std.timer16/2` | 16 位定时周期、周期/单次模式、到期标志和请求线 |
| `std.pwm8/2` | 8 位周期与占空比，独立 `PWM_OUT` 数字输出 |
| `std.uart8/2` | 16 字节 TX/RX 队列与异步 UART 事务 |
| `std.spi8/2` | SPI 主机字节事务与完成/错误状态 |
| `std.i2c8/2` | I²C 主机完整寄存器事务与完成/错误状态 |
| `std.irq8/2` | 请求锁存、优先级、入口地址以及一层 PC/A 返回帧 |

寄存器、ALU、RAM、ROM、显示、常量等继续使用原有 `HardwareV3` 元件。地址、写数据、读数据、使能和请求线都通过正常电路线连接。断开 ROM 到 IR、ALU 写回、地址译码、MMIO 写使能或读回线，会真实改变结果或产生未知值；不会补出预设结果。

从零搭建时先完成 Build8 的 PC→ROM→IR→译码、累加器→ALU→写回、RAM/输出寄存器三条路径；再将 `address/read_mem/write_ram` 接地址译码。每个外设的 `address/data/read/write/reset` 分别接地址总线、累加器、自己的片选读/写和复位。外设 `out` 接八路读选择器，选择器输出接累加器原先的 RAM 输入。最后接 IRQ 请求、保存帧到 PC/累加器的返回路径，以及独立协议端口。没有使用的请求线必须明确接 0。

## 指令和时间

每条指令占一个 16 位 ROM 字：高字节为 opcode，低字节为参数；PC 以“指令字”为单位加 1，程序最多 256 条。PC 实体为 16 位，跳转和中断向量参数为 0—255；越出有效 ROM 数据范围时原 ROM 元件规则产生未知值。

| opcode | 指令 | 行为 |
| --- | --- | --- |
| 00 | NOP | 不改数据，PC 加 1 |
| 01 | LDI n | 累加器 A ← n；也接受标签地址 |
| 02—06 | ADDI / SUBI / ANDI / ORI / XORI n | 通过独立 ALU 运算，结果按 8 位截断 |
| 07 / 08 | LOAD / STORE address | 读取/写入地址译码后的 RAM 或 MMIO |
| 09 / 0A | JMP / JZ label | 无条件跳转；或 A 为 0 时跳转 |
| 0B / 0C | OUT / IN | A 写入独立输出寄存器；或读取真实键盘输入总线 |
| 0D | HALT | 停止取指与执行；外设继续运行，直到暂停或断电 |
| 0E / 0F | SHL / SHR n | 逻辑移位 0—7 位 |
| 10 / 11 | EI / DI | 开启/关闭 IRQ 入口 |
| 12 | IRET | 恢复保存的 PC 和 A，退出当前 IRQ |

无参数指令的低字节必须为 0。非法 opcode、保留参数或没有有效返回帧的 IRET 会使译码报错并停止执行。汇编器严格解析标签和数字，不执行 JavaScript。

每拍为虚拟 1 μs：取指拍锁存 ROM，执行拍由全部状态元件读取同一个稳定快照，再统一提交。普通指令需要两拍。可服务中断在下一次取指前插入一个入口拍，保存当时的 PC 和 A，随后正常取指执行处理程序。单层返回帧不允许嵌套中断；处理期间的新请求继续锁存。HALT 不被中断自动唤醒。

外部输入、复位、断电、断线等排队事件先执行；然后按事务序号完成到期协议事务，再组合稳定、采样/提交和观察。同刻断线或暖复位先于事务完成，因此旧事务不能重新交付。时间以 BigInt 微秒推进，保存为十进制字符串，与屏幕刷新率无关。暂停冻结虚拟时间与所有外设。

## 地址表

MMIO 地址是教学用 8 位地址空间，不与 Core8 地址表混用。下表未列出的保留读位置返回 0；不支持的写位置设置 `E_MMIO_ACCESS`。GPIO C8—CF 的读同样报错。错误保留在元件观察状态中，复位清除。

| 区域 | 地址与行为 |
| --- | --- |
| 数据 RAM | 00—BF，192 字节可寻址 RAM；实体 RAM 仍为 256 字节，C0—FF 经此 CPU 总线不再访问 RAM |
| GPIO | C0 DIR，C1 OUT，C2 原始 IN，C3 PD，C4 边沿中断掩码，C5 flags 写 1 清除，C6 消抖稳定拍数，C7 消抖后 IN |
| Timer | D0 CTRL：bit0 开启、bit1 周期、bit2 IRQ；D1/D2 周期低/高字节；D3 到期标志写 1 清除；D4/D5 计数；D6 累计到期次数低字节；D7 保留 |
| PWM | D8 开启 bit0；D9 周期 0—255；DA duty；DB phase；DC 实际输出 level；DD—DF 保留 |
| UART | E0 CTRL：TX=1、RX=2、RX IRQ=4；E1 写 TX；E2 读 RX 并弹出；E3 STATUS；E4 ERROR 写 1 清除；E5/E6 TX/RX 队列长度；E7 保留 |
| SPI | E8 开启；E9 数据；EA mode 0—3；EB 写 1 开始；EC STATUS 写 1 清除完成/错误位；ED IRQ 开启；EE—EF 保留 |
| I²C | F0 开启；F1 从地址；F2 寄存器；F3 数据；F4 写 1 读、写 2 写；F5 STATUS；F6 IRQ 开启；F7 保留 |
| IRQ | F8 开启；F9 掩码；FA pending 写 1 清除；FB 向量；FC active 只读；FD cause 只读；FE 入口累计数低字节；FF 自身错误状态 |

GPIO 的 DIR=0 输出 Z，DIR=1 驱动 OUT 位。PD 冷/暖复位值为 FF，表示明确的教学内部弱下拉。IN 读取实际网络解析结果；任一未知位使读值为 X 并报告 `E_UNKNOWN_GPIO`。有效推挽驱动超过一个，即使值相同，也报告冲突。示例把按键接 GPIO0、LED 接 GPIO1；不要把按键端改为输出。消抖值为 0/1 时一次采样即可更新；较大值要求连续相同采样，变化只锁存输入位的双边沿请求。

Timer 周期为 0 时不计数。写 CTRL 或周期会清计数。到期使 flag=1；周期模式从 0 继续，单次模式关闭 enable。清除 flag 后，中断程序还应清 IRQ pending。PWM 的 period=0 关闭波形，duty 大于 period 等效常高；写开启/周期/duty 都把相位重新置 0。CPU 停止后这两个外设仍按拍工作。

IRQ 请求位按 GPIO=1、Timer=2、UART=4、SPI=8、I²C=16 排列，同刻多个有效请求取最低位。pending 不受 mask 阻止锁存。进入 IRQ 后源设备的标志不会自动清除；处理程序应先处理并清源标志，再写 FA 清 pending，然后 IRET。寄存器 F8 与 EI/DI 控制同一个 enable。

## 协议端口、队列与取消

UART 使用 `UART_TX` / `UART_RX`，类型 `uart-txn/1`，分别与终端 RX/TX 接线。固定 9600、8N1，以事务模拟每字节 1042 μs；E1 写入后不会立刻显示到终端。TX 队列容量 16 包含正在发送的字节。满队列丢弃新字节并置 ERROR bit0；空 RX 读取产生 X、ERROR bit1 和 `E_UART_EMPTY`；RX 满也置 bit1 并丢弃新字节；TX 未开时写 TX 置 bit2。STATUS 是 RX 非空=1、TX 有空位=2、TX 正忙=4、存在错误=8。RX LOAD 在同拍采样原队首，提交时弹出。关闭 TX 取消队列与在途事务；关闭 RX 清接收队列并增加接收代次，旧在途输入不能在重新开启后混入。

SPI 使用 `SPI_OUT`→`std.spi-register/1.RX`，类型 `spi-txn/1`。每字节 8 μs，mode 由请求携带；当前配套从设备仅支持 mode0，其他模式返回错误。首字节 `0x00 | register` 选择写、`0x80 | register` 选择读，register 为 0—15；第二字节写数据或读 dummy。只有真实连线上的事务完成，才改变从设备状态。

I²C 使用 `I2C_OUT`→`std.i2c-temperature/1.RX`，类型 `i2c-txn/1`。每次完整寄存器读/写耗时 100 μs。器件地址 0x48，寄存器 0 为温度（默认25，可调整0—125）、1 为只读 ID A1、2 为可读写 scratch。地址或寄存器不匹配、写只读寄存器返回 NACK。温度在事务完成时从真实设备状态读取。

SPI/I²C STATUS 的 busy=1、done=2、error=4。正常完成为2，失败完成为6；失败不覆盖旧数据。忙时重复启动置 error，不取代正在执行的请求。关闭控制器取消在途事务。复位、失电、断线后重接都会使旧事务失效；接收端不会凭重接恢复已取消的副作用。串口日志和总线观察记录来自实际交付/完成路径。

这些协议端口属于功能级事务抽象，不表示逐边沿 SCLK/SDA/SCL 波形，也不计算上拉电阻、电容、模拟电压、电流或时序裕量。GPIO/PWM 是真实数字网络；供电使用工作台的功能供电域。Build8/2 是教学 ISA，不兼容 ARM、RISC-V 或现成商用 MCU 的固件。

## 文件/API 与持久化

浏览器脚本顺序为 `hardware-v3.js`、`mcu-v4.js`、`circuit.js`、`builder-mcu.js`；UI 扩展仍为 `hardware-ui-v3.js`。`mcu-v4.js` 同时提供 CommonJS 导出，可供服务端使用同一个模拟实现。

- `McuV4.assemble(source)` 返回 `{ok, words, sourceMap, error}`。
- `await McuV4.build(sampleIdOrSource)` 返回 `{project, view, source, sources, lesson}`，源码键为 `build8v2:program_rom`。
- `await McuV4.applyProgram(project, source, romId)` 校验候选再返回新工程，不改原对象。
- `McuV4.inspect(runtime, scope)` 保留原 Build8 的 `pc/instruction/accumulator/output/phase/halted/ram` 字段，并增加 `peripherals`。
- `HardwareUIV3.openProgram('program_rom')` 打开与当前译码版本对应的程序编辑器。
- 独立元件的契约、状态和运行接口使用 `models/list/fresh/output/sample/complete/flush/validateState`，全部按实例隔离。

暖复位保留数据 RAM，清 PC/寄存器/外设和协议在途状态；冷启动清 RAM，保留 ROM 程序。工程导入与快照恢复先在候选对象中校验。快照包含 IRQ 帧、消抖计数、PWM 相位、FIFO、协议完成时刻与路由版本；不接受不一致 busy、越界控制位、非法请求载荷、过期完成时间或伪造路由。Runtime 版本为0.4.0，显式保留0.1/0.2/0.3快照版本入口；旧模型定义签名未变。

## 已执行验证与边界

`tests/mcu-v4.test.cjs` 的 **23 项**测试通过，覆盖实际取指/执行、地址译码、GPIO未知/冲突/消抖、IRQ保存返回、PWM停机后运行、UART延迟与FIFO、SPI/I²C外部器件、NACK、断线/重接、复位/失电取消、在途与IRQ快照、程序修改、整板双实例隔离。相关旧电路、Build8、硬件、Core8/2、封装与集成套件回归无失败。

`tests/browser/mcu-v4.cjs` 的 **9 项**浏览器场景通过，覆盖元件入口、真实温度变化、19指令编辑与原子拒绝、IRQ观察、SPI断线负例、UART延迟、整板导出、新浏览器上下文双实例导入运行、手机观察与无横向溢出。旧 `hardware-v3.cjs` 的10项操作回归通过。证据位于 `test-results/browser/mcu-v4-results.json` 及同名前缀截图；这些是实际浏览器操作与内核结果，不是文档断言。

当前取舍：单累加器、192字节CPU数据空间、256字程序、单层中断；教学内部下拉；协议事务级仿真。逐拍模块仿真优先展示因果关系，大电路应使用少量拍数推进；虚拟微秒不代表模拟器能够按真实硬件速度运行。这些取舍不影响玩家拆开模块、改线、改程序、封装复用和验证失败路径。
