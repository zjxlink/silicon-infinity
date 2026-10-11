# 硬件元件与自组装 MCU

版本 0.3.0 · 2026-10-10

本版新增 24 个可独立使用的行为元件，以及由 13 个独立元件通过实际信号线组成的 Build8 教学 MCU。它没有隐藏的 Core8 实例：断开 ALU 写回线会让累加器收到未知值，改变程序 ROM 会改变取指与执行结果。

## 玩家入口

打开工作台右上的「硬件与组装」，选择四个硬件实验或四个 MCU 示例。新元件也会直接出现在左侧元件库，可在空白工程中逐个放置、接线和封装。

同一入口的「总线输入」「总线输出」可创建1—16位边界端口；输入初值必须适合位宽。这样从空白画布也能给 ALU 创建4位操作码、8/16位数据，不必依赖示例中的现成输入。

- **8 位计算器**：输入 A、B 和运算码，观察结果、零标志和进位。
- **键盘与显示**：字节输入经寄存器后显示。数字输入用现有输入面板修改，下一拍锁存。显示器展示实际字节和可打印 ASCII 字符。
- **存储读写实验**：地址 3、数据 42；开启写使能并推进一拍，RAM 才写入数据。
- **消息队列**：每拍根据 PUSH、POP 推入或弹出一个字节，显示数量、满、空和错误。
- **自组装计算器**：执行 `7 + 5`，把 12 写到 RAM[3] 与输出寄存器。
- **自组装计数器**：程序循环改变输出和 RAM[0]。
- **自组装键盘回显**：IN 从实际接线的字节输入读取，再写 RAM[1] 和输出。
- **自组装条件分支**：从 3 递减，到零后跳转并输出 99。

选中有参数的元件，可以「编辑参数与内容」。参数先严格校验；保存草稿不会修改正在运行的状态，「保存并应用」才会重新上电。ROM/RAM 支持十进制与 `0x` 十六进制初始数据，最多 256 项，缺少的地址填 0。

Build8 面板显示当前 PC、指令寄存器、累加器、输出、下一拍的阶段及 RAM。可以走一拍或走到下一条指令执行完成。选择程序 ROM 或点击「编辑 MCU 程序」可以编译并应用汇编。编译直接更新 ROM 元件参数，不播放预设动画。

## 元件合同

所有数据都是无符号数字信号，每位保留 0、1、X、Z；宽度严格匹配。状态元件使用同一全局 1 μs 时钟，先从共同稳定信号采样，再统一提交。供电采用工作台隐式供电域；失电输出 Z。暂停不推进状态或时间。

| 类型 | 模型 ID | 输入 → 输出 | 参数及行为 |
| --- | --- | --- | --- |
| 零比较 | `std.iszero8/1`、`std.iszero16/1` | IN → ZERO | 任一已知 1 即非零；全 0 才为零；其余 X |
| 运算单元 | `std.alu8/1`、`std.alu16/1` | A、B、OP[4] → OUT、ZERO、CARRY | OP 0—13，结果按位宽取模 |
| 寄存器 | `std.register8/1`、`std.register16/1` | D、EN、RESET → Q | `initial`；EN=1 时锁存，0 时保持；未知使能或复位使 Q 为 X |
| RAM | `std.ram8/1`、`std.ram16/1` | ADDRESS[8]、DATA、WRITE、RESET → OUT、FAULT | `contents`；256 字，异步读、同步写；未知写控制/地址/数据不污染存储并报错 |
| ROM | `std.rom8/1`、`std.rom16/1` | ADDRESS → OUT、FAULT | `contents`、`source`；256 字。ROM16 地址线为 16 位，超出 255 或未知地址输出 X 并置 FAULT |
| 四路选择 | `std.mux8/1`、`std.mux16/1` | A/B/C/D、SEL[2] → OUT | SEL=0/1/2/3；未知选择只保留四个输入共同已知的位 |
| FIFO | `std.fifo8/1`、`std.fifo16/1` | DATA、PUSH、POP、RESET → OUT、EMPTY、FULL、COUNT[9]、FAULT | `capacity` 1—256，默认16；同拍先弹出后推入；空读和满写报告粘滞错误 |
| 固定数值 | `std.constant8/1`、`std.constant16/1` | → OUT | `value`，范围与数据宽度一致 |
| 位拆分/合并 | `std.split8/1`、`std.merge8/1` | 总线 ↔ B0…B7 | B0 为最低位，保留每位 X/Z |
| 字节拆分/合并 | `std.split16/1`、`std.merge16/1` | 16 位总线 ↔ LO、HI | LO 为低8位，保留每位 X/Z |
| 显示器 | `std.display8/1` | IN[8] → OUT[8] | 透传实际数据；观察面板显示数值/ASCII |
| 程序计数器 | `std.pc16/1` | EN、LOAD、TARGET[16]、HALT、RESET → OUT[16]、HALTED | `initial`；LOAD 优先于加一；HALT 保持到复位；未知控制停止并报错 |
| 两拍控制器 | `std.fetch-execute/1` | HALT、RESET → FETCH、EXECUTE、HALTED | 初始取指；每拍切换；HALT 停止到复位 |
| Build8 译码器 | `std.build8-decoder/1` | INSTRUCTION[16]、EXECUTE、ZERO → 操作数与控制线 | 只组合译码，无内部 CPU；非法编码停止执行并报告 `E_BUILD8_ENCODING` |

ALU 运算码：0 传 B、1 加、2 减、3 AND、4 OR、5 XOR、6 NOT A、7 左移、8 右移、9 传 A、10 乘法低位、11 相等、12 小于、13 大于。移位量为 B 的低 3 位或低 4 位。减法 CARRY=1 表示没有借位；加法、左移、乘法超出位宽置 CARRY。未知操作码、14/15、任一未知 A/B 均输出 X，不把未知值当成零。

RAM 在全局暖复位中保留数据；同步 RESET 引脚、冷启动和断电重启恢复 `contents`。寄存器、PC、控制器与 FIFO 在复位时恢复初态。FIFO 错误通过复位清除。显示器与边界字节输入是功能抽象，不模拟按键矩阵扫描、LED 电压或电流。

## Build8 数据通路

Build8 使用这些真实节点：`pc`、`program_rom`、`instruction_register`、`control`、`sequencer`、`accumulator`、`zero`、`alu`、`data_ram`、`bus`、`output`、`display`、`zero_byte`。

1. PC 输出接 ROM 地址，ROM 输出接指令寄存器 D。FETCH 控制指令寄存器 EN。
2. 指令寄存器 Q 接译码器；EXECUTE 允许译码器在执行拍发出写控制。
3. 累加器 Q 接 ALU.A；操作数接 ALU.B，译码控制选择实际运算。
4. ALU、RAM、键盘输入、常量分别接四路选择器；选择器输出接累加器 D。
5. 累加器同时连接 RAM.DATA 与输出寄存器 D。每次写入由译码器的 WRITE 控制线允许。
6. 零比较器从累加器反馈 JZ 条件。PC 的使能、跳转和停止均来自实际控制线。

全部模块同时采样旧态，因此计算器初态和前几拍为：

| 时刻 | 实际变化 |
| --- | --- |
| 0 μs | PC=0、IR=0、累加器=0、下一拍取指 |
| 1 μs | IR=0x0107，PC 仍为0、累加器仍为0 |
| 2 μs | 执行 LDI，累加器=7、PC=1 |
| 4 μs | 执行 ADDI，累加器=12、PC=2 |
| 6 μs | 执行 STORE，RAM[3]=12 |
| 8 μs | 执行 OUT，输出寄存器=12 |
| 10 μs | HALT 停止两拍控制器与 PC |

## Build8 指令

ROM 每个字为 16 位：高字节操作码、低字节操作数。PC 按字寻址。程序最多256条，8位累加器、256×8位 RAM。跳转地址与立即数为0—255，移位为0—7。标签只存在于汇编源码，编译后为实际地址。每条正常指令两拍，不声明真实商用芯片的周期性能。

| 操作码 | 汇编 | 行为 |
| --- | --- | --- |
| 00 | NOP | 仅 PC 加一 |
| 01 | LDI n | A=n |
| 02—06 | ADDI/SUBI/ANDI/ORI/XORI n | ALU 对 A 与 n 运算，写回 A |
| 07 | LOAD 地址 | RAM[地址] 经总线选择器写 A |
| 08 | STORE 地址 | A 写 RAM[地址] |
| 09 | JMP 标签/地址 | PC 装入目标 |
| 0A | JZ 标签/地址 | A=0 时跳转，否则 PC 加一 |
| 0B | OUT | A 写输出寄存器 |
| 0C | IN | 接线的键盘字节总线写 A |
| 0D | HALT | 停止控制器与 PC，直到复位 |
| 0E/0F | SHL/SHR n | A 逻辑移位后写回 |

NOP、OUT、IN、HALT 的低字节必须为0。未知或非法编码不能当 NOP 继续。超过 ROM 有效地址范围会得到 X，并在译码时停止。

```asm
LDI 7
ADDI 5
STORE 3
OUT
HALT
```

这是独立的教学 Build8 指令，不兼容 Core8、ARM 或 RISC-V。自组装 MCU 当前提供并行字节输入/输出与存储，不带 Core8/2 的 UART、PWM、SPI、I²C 和中断。原 Core8/2 外设仍可在其原示例中使用；本版没有把这些功能声称为 Build8 的已连接外设。

## 保存、封装与 API

`game/hardware-v3.js` 在 `circuit.js` 前加载，`builder-mcu.js` 在其后，`hardware-ui-v3.js` 在 `app.js` 后。逻辑模块同时支持浏览器全局与 CommonJS；无 eval、DOM 执行代码或 Node 宿主依赖。所有 require 使用可静态解析的字面量。

- `HardwareV3.list`、`models`：元件列表与固定签名。
- `HardwareV3.defaultParameters(id)`：返回独立参数对象。
- `HardwareV3.buildBoard(id)`：异步返回 `{project, view, source, sources}`。
- `CircuitLab.createInstance(...)`：自动填写新元件默认参数；运行状态仍由 `CircuitLab.Runtime` 管理。
- `BuilderMCU.assemble(source)`：返回 `{ok, words, sourceMap, error, line}`。
- `BuilderMCU.build(sampleIdOrSource)`：返回13元件接线工程。
- `BuilderMCU.applyProgram(project, source, romId)`：返回校验后的新工程，不修改原对象。
- `BuilderMCU.inspect(runtime, scope)`：从实际模块读取 PC、IR、累加器、输出、阶段、RAM；支持封装实例路径。
- `BuilderMCU.verify(project, source, expected, ticks=64)`：独立运行候选工程，必须明确提供 `output`、`pc`、`accumulator`、`halted` 或 `ram` 的预期。缺少预期、ROM 与源码不一致、输出不符或运行诊断均不能通过。

ROM 参数中的 `source` 保存可编辑程序，`contents` 才决定仿真。原始 ROM 数据修改会清除过期源码，避免将旧文字伪装成已装入程序。纯芯片或整板封装都会保存参数与版本依赖；两枚实例的 PC、寄存器、RAM、FIFO 和控制状态独立。快照保存阶段、存储和在途输入事件；无效快照先全部拒绝，不能部分更新运行状态。

每个存储元件限制256项；FIFO容量最多256；项目仍执行1000展开节点、4000连线、128定义、16层嵌套及已有事件预算。旧标准元件的签名和哈希未修改，工程格式仍为 `chip-game.project/0.1.0`，运行时版本为0.3.0。

## 实测证据

- `tests/hardware-v3.test.cjs`：13组通过，覆盖24模型、所有ALU操作、读写时序、未知信号、FIFO、参数和快照拒绝、实验封装。
- `tests/builder-mcu.test.cjs`：13组通过，覆盖所有指令、真实两拍取指、程序修改、断线负向、暖冷复位、快照、双实例隔离与独立验证。
- `tests/browser/hardware-v3.cjs`：10项通过，全新离线上下文从空白工程创建16位输入/输出并真实接线，实操参数/ROM/程序、编译失败原子性、芯片包导出后另一离线上下文导入运行、源码保留、手机入口与观察。证据：`qa/v0.3/browser/hardware-v3-results.json`。
- 本次扩展后的旧9套核心测试全部通过，191项；日志：`qa/v0.3/core-v3.txt`。

这些是实际执行与浏览器操作结果，不是通过检查文档内容得到的结论。v0.3 其他部分的验收由对应模块记录。
