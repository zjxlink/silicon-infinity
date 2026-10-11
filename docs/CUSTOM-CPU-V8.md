# 自定义 CPU16 /2：单层中断

版本 0.8。模型 `std.custom-cpu16/2`，数据式指令集 `silicon-lab.isa/2`。旧 `std.custom-cpu16/1` 与 `silicon-lab.isa/1` 完整保留，不做静默升级。

**本版最多保存一层中断现场，不支持嵌套。** 即使处理程序执行 EI，也不会中断当前处理程序。需要优先级与来源排队时，应接外部中断控制器。

## 可以实际改变什么

仍可定义 1—16 个通用寄存器、1—64 个指令、每条 1—8 个微操作，总微操作不超过 512。玩家决定助记符、8 位操作码、操作数格式和有限微操作序列；不是用预定动画替代执行。

新增 `irq_enable`、`irq_disable` 和 `iret` 微操作，分别设置全局中断使能、关闭使能、恢复现场返回。原有算术、间接访存、分支、子程序、栈和可观察中间步骤全部保留。

数据为 16 位无符号字，外部地址为 16 位字地址。程序最多 1024 条，每条 32 位；PC 表示指令索引，不是字节地址。没有内置数据 RAM，所有读写都经过可断开的真实外部总线。

## 参数、编码与汇编

参数保持 `{isa,source,busTimeout}`：ISA 与源码各不超过 60000 字符；`busTimeout` 为 1—65535 拍，默认 256。

ISA 根字段必须恰好为 `{schema,name,registerCount,instructions}`；schema 固定为 `silicon-lab.isa/2`。每条指令必须恰好为 `{mnemonic,opcode,form,steps}`。名称及操作码分别唯一；名称为 1—20 个大写字母、数字和下划线，以字母开头。

机器编码仍为 `opcode[31:24] | rd[23:20] | rs[19:16] | imm[15:0]`，未使用字段必须为 0。

| form | 汇编操作数 | 字段 |
|---|---|---|
| none | 无 | 操作数字段为 0 |
| r | Rn | rd |
| rr | Rn,Rm | rd、rs |
| ri | Rn,16 位无符号立即数 | rd、imm |
| target | 标签或指令索引 | imm，目标必须在程序中 |
| rt | Rn,标签或指令索引 | rd、imm |

助记符、寄存器名不分大小写，标签区分大小写；分号为行注释。数字支持十进制或 `0x` 十六进制，不接受负数。汇编结果提供真实机器字、标签索引和源码行映射。反汇编不保留标签和注释，再汇编可恢复原机器字。

## 微操作

源允许 0—65535 整数、`tmp`，以及当前格式具备的 `rd/rs/imm`。目标允许 `tmp` 或当前格式具备的 `rd/rs`。`rd/rs` 代表机器字指定的寄存器值，不是寄存器编号常量。

| op | 其他字段 | 效果 |
|---|---|---|
| nop | 无 | 一拍空操作 |
| set | dst, src | 写入源值低 16 位 |
| alu | kind, dst, a, b | add/sub/mul/and/or/xor/shl/shr；移位量低 4 位 |
| read | address, dst | 等待真实读应答后写目标 |
| write | address, data | 等待真实写应答 |
| push | src | 压入 64 词公共栈 |
| pop | dst | 检查并弹出公共栈 |
| jump | target, when；条件式另有 test | always/zero/nonzero；目标是指令索引 |
| call | target | 检查返回位置，压入 PC+1，再跳转 |
| ret | 无 | 检查并弹出返回位置 |
| halt | 无 | 停止 CPU，不由 IRQ 唤醒 |
| irq_enable | 无 | IE 置 true，仍需等完整指令边界 |
| irq_disable | 无 | IE 置 false |
| iret | 无 | 原子恢复单份中断现场并返回 |

`jump/call/ret/halt/iret` 必须是最后一个微操作。使能/禁止微操作可以放在指令中间，但绝不使一条尚未完成的指令被中断。

取指一拍，每个普通微操作一拍，每拍 1 虚拟微秒。访存可以等待多拍，成功后另留至少一拍 `req=0`，才继续下一个微操作。微操作逐拍提交：后续错误不会回滚已经完成的先前运算或外部写入。

## 默认 34 条指令

旧 16 条起始指令保留原操作码：NOP、LIT、MOVE、ADD、XOR、MIX、DEC、LOAD、STORE、JUMP、JZERO、CALL、RETURN、PUSH、POP、STOP。MIX 仍为两步“乘后加 1”。

| 新增指令 | 操作码 | 形式 / 效果 |
|---|---|---|
| SUB / AND / OR / MUL | 0x07 / 0x08 / 0x09 / 0x0E | Rn,Rm；写回 Rn |
| ADDI / SUBI / SHL / SHR | 0x0A / 0x0B / 0x0C / 0x0D | Rn,立即数；写回 Rn |
| LDI | 0x0F | LIT 的兼容别名，Rn,立即数 |
| LDR / STR | 0x12 / 0x13 | Rn,直接字地址；实际外部读 / 写 |
| JNZ | 0x22 | Rn,目标；非零跳转 |
| JMP / JZ | 0x23 / 0x24 | JUMP / JZERO 的别名 |
| RET | 0x34 | RETURN 的别名 |
| EI / DI / IRET | 0x40 / 0x41 / 0x42 | 分别解释新增的三个微操作 |

**LOAD/STORE 的第二操作数仍是地址寄存器；LDR/STR 才接直接地址。** 不用同一助记符隐式猜测两种格式。游戏内的完整指令表直接从实际默认 ISA 生成，包括每条微操作字段。

## 端口与中断控制

原端口全部保留：输出 `req/we/address/wdata`；输入 `rdata/ready/error/reset`；观察 `pc/ir/micro/sp/r0..r15/halted/fault`。

| 新端口 | 方向 / 位宽 | 含义 |
|---|---|---|
| irq | 输入 / 1 | 外部请求，需保持或由外部控制器锁存 |
| vector | 输入 / 16 | 本次处理程序的指令索引，在接受时采样 |
| irq_ack | 输出 / 1 | 成功进入的一拍确认 |
| ie | 输出 / 1 | 全局使能观察；不代表允许嵌套 |
| in_irq | 输出 / 1 | 当前有一份中断返回现场 |

复位后 `ie=false`。进入条件为：处于 `phase='fetch'`、IE 为 true、没有返回现场、已重新武装、IRQ 为 1、向量已知且合法。这个边界发生在上一条指令全部微操作都完成以后。

总线等待及完成间隔中不检查中断向量；总线失败先成为故障，不会提前确认 IRQ。普通取指越界也先故障，不用中断掩盖已经非法的继续执行地址。

成功入口消耗一拍而不退休普通指令：保存下一 PC、上次 IR、TMP、全部通用寄存器、完整公共栈及旧 IE；将 PC 设为向量，IE 清 false，IR/TMP 清 0，处理程序的公共栈从空开始。普通寄存器最初仍可读取被打断时的值。

返回现场独立于公共栈，因此主程序栈恰好满 64 词时仍能进入中断；处理程序有独立的 64 词栈额度。IRET 恢复主程序整份栈，处理程序临时寄存器/栈修改会被保存值替代。需要永久保留的结果必须写外部 RAM 或设备。

成功后 `irq_ack=1` 只保持一拍。CPU 必须观察到 `irq=0` 至少一拍才允许下一次请求。IRQ 一直高不会重复进入；处理程序内出现并保持的新请求可在 IRET 后接受，但不会嵌套。短脉冲可能错过，因此多来源作品应使用真实外部 pending 控制器。

与 `std.irq4/1` 连接时，其 `irq_id` 是 2 位来源编号，不能直接接 16 位 `vector`。使用实际多路选择器和 4 个向量常量译码，`irq→irq`、`irq_ack→ack`、当前 `irq_id→ack_id`。优先级和 pending 由外部控制器管理，本 CPU 不暗藏第二个中断控制器。

## 最小可执行例子

外部 RAM 与七根总线信号真实相连；reset=0、irq=0、vector=3。先运行到主循环，然后将 IRQ 拉高：

```asm
LIT R0,1
EI
main: JUMP main
handler: LIT R0,42
LIT R1,0
STORE R0,R1
IRET
```

处理程序在实际 RAM 字地址 0 写入 42，IRET 后主程序的 R0 恢复为 1，公共栈恢复为空。观察到确认后把 IRQ 拉低，才可再次发请求。

随附第二个例子把 EI/IRET 改为 `ALLOW/BACK`，操作码为 `0x70/0x72`。同样要靠真实 `irq_enable/iret` 微操作完成，不接受旧助记符 EI 作为这个新定义的中断指令。

## 故障、复位与快照

| 故障 | 触发 |
|---|---|
| F_IRQ_UNKNOWN | 可接受新中断的完整边界上 IRQ 为 X/Z |
| F_IRQ_VECTOR_UNKNOWN | 请求有效，但向量有未知位 |
| F_IRQ_VECTOR | 向量超出当前程序镜像 |
| F_IRET | 没有返回现场却执行 IRET |
| F_IRQ_RETURN | 已存在的返回内容非法；快照导入会预先拒绝此类内容 |
| F_STACK_OVERFLOW / F_STACK_UNDERFLOW / F_RETURN | 公共栈边界或子程序返回无效 |
| F_PC / F_ENCODING | 程序位置、机器编码或微操作位置非法 |
| F_BUS_UNKNOWN / F_BUS_ERROR / F_BUS_TIMEOUT | 握手未知、设备拒绝或等待超限 |
| F_RESET_UNKNOWN | 复位输入未知 |

屏蔽中、处理程序内、尚未重新武装时不检查向量。IRQ 已知为 0 时也不读取向量。未知值从不自动变成 0；只在真正需要采样的条件下决定故障。

复位高优先于同拍 IRQ，清 CPU 寄存器、栈、使能、返回现场、计数和未完成请求，保留生效 ISA 与程序。暖复位是否保留数据由外部 RAM 决定。未知 reset 立即屏蔽请求和确认，下拍产生故障。故障不撤回外部设备以前已提交的写入。

快照保存原 CPU 执行状态，以及 `ie/irqFrame/irqBlocked/irqAck/irqCount`。导入检查字段、数值范围、阶段、实际机器字、在途访问、帧容量与返回目标；单拍确认只能对应成功入口。暂停和恢复不会制造额外 IRQ 边沿。

## 集成 API 与可信边界

浏览器全局 `CustomCpuV8` / CommonJS 模块。加载顺序为 `custom-architecture-v6.js` → `custom-cpu-v8.js` → `circuit.js`。模块复用旧汇编/操作数校验器生成编码，但提供自己的执行状态机；没有调用 Core8 或其他 CPU 替它执行。

Provider 方法：`models/list/supported/defaultParameters/validateParameters/fresh/reset/output/sample/validateState`。编辑方法：`validateISA/assemble/disassemble/decode/encode`、`DEFAULT_ISA`、返回副本的 `defaultProfile()`。其他导出为 `SAMPLES/build/manuals`。完整端口提示和指令表由模型、默认 ISA 同源生成。

`build('custom-irq'|'custom-irq-renamed')` 返回标准工作区，包含真实 CPU、RAM、IRQ/向量/复位输入与观察输出。有效源码保存在实例参数，草稿 key 为 `customarch2:custom_cpu`。封装复制的实例各自保存程序、栈与返回现场。

这是有限的功能级教学 CPU，不承诺真实 ARM/RISC-V、物理电气中断延迟、嵌套优先级或无限资源。所有表格是数据，不能执行任意 JavaScript；解析与编译缓存最多 48 项。

## 已执行验证

`tests/custom-cpu-v8.test.cjs` 的 25 项测试通过：真实中断确认/返回、持续高电平防重复、未知向量与 IRQ、完整八微操作边界、总线等待及失败优先、禁止嵌套、64词主栈与独立处理栈、复位取消、在途中断快照、非法帧拒绝、封装双实例及原始/优化求解器一致。

同时运行旧自定义架构 21 项、固定 CPU16 19 项、系统总线/DMA 36 项，共 101 项通过。新旧自定义 CPU 还逐拍比较无中断程序的全部原有状态和实际 RAM，确认新增模型不替换或改变旧模型。
