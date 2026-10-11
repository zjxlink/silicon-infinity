# 元件与芯片接口规格

版本：0.1.0  
日期：2026-10-10  
状态：评审稿。本文规定待实现、待验证的要求，不表示现有程序已经符合。  
关联文档：02 教学 MCU 规格、03 智能灯验收规格。本文约定公共接口，02 补充 MCU 指令、总线副作用与外设细节。

## 1 范围与模型

**CMP-001 范围。** Phase0 提供数字逻辑、同步时序、分层封装、工程保存与检查；Phase1 提供教学 MCU 与可运行的外围应用示例；Phase2 深化外设协议、开漏总线和更多设备。RV32I、联网协作、公共芯片库保留扩展接口，不属于本版交付承诺。全部是功能级数字仿真，不计算晶体管、电流、压降、真实工艺或模拟电路。

**CMP-002 定义与实例。** 定义描述接口与实现，实例引用确定版本并持有自己的状态。支持 `primitive` 基础模型、`composite` 结构电路、`behavioral` 功能模型，三者遵守相同端口契约。多个实例可共享不可变定义和 ROM 内容，不得共享寄存器、RAM、FIFO、计时器或其他可变状态。状态键必须包含完整实例路径。

**CMP-003 端口。** 每个端口具有稳定 `id`、显示 `name`、`direction` 和 `kind`。方向为 `in/out/inout`；类型为 `digital/power/protocol_transaction`。数字端口位宽为 1–32，连接不得隐式截断、扩展或重排；转换必须使用显式模块。端口改名不能改变 `id`。`inout` 在内部必须区分接收视图和驱动视图，不能把自身驱动误判为组合反馈。引擎白名单模型的签名、依赖和复位契约必须与其注册版本一致，导入数据不得通过改写 contract 伪造模型行为或掩盖环路。

## 2 数字信号与驱动

**CMP-004 四态编码。** 数字值为 `{width,value,knownMask,driveMask}`。后三项使用带 `0x` 前缀的小写十六进制字符串，恰好 `ceil(width/4)` 位，高于位宽的补齐位必须为 0。令 V、K、D 为对应无符号整数，必须满足 `V ⊆ K ⊆ D`；这里的“子集”指置 1 位集合。每位编码如下：

| 状态 | D | K | V | 意义 |
|---|---:|---:|---:|---|
| 0 | 1 | 1 | 0 | 有效低电平 |
| 1 | 1 | 1 | 1 | 有效高电平 |
| X | 1 | 0 | 0 | 驱动或解析结果未知 |
| Z | 0 | 0 | 0 | 未驱动、释放 |

例如八位全 Z 为 `{"width":8,"value":"0x00","knownMask":"0x00","driveMask":"0x00"}`；八位全 X 的 `driveMask` 为 `0xff`。实现不得通过 JavaScript 有符号 32 位运算导致第 31 位损坏；使用无符号运算或 BigInt，并在序列化时保持上述形式。

**CMP-005 逻辑传播。** 数字接收端把没有弱默认值的 Z 解释为 X。逻辑计算按位进行；`0 AND X=0`、`1 OR X=1`、`NOT X=X`、`X XOR 0=X`。MUX 选择未知但两个候选位相同且已知时可输出该已知位，否则为 X。算术、比较和查表若含未知相关输入位，本版可以保守地产生未知结果，但必须公开该规则，不得自动当作 0。MCU 对未知地址、控制值、整字输入的故障规则由 02 规定。

**CMP-006 网络解析。** 一个数字网络可有多个接收端。两个固定推挽 `out` 落在同一网络属于静态错误；允许 `inout` 与外部 `out` 相连。按每一位统计有效推挽驱动，即该位 D=1 的驱动器：零个时网络保持 Z；一个时取其四态值；多于一个时产生 `E_DRIVE_CONFLICT`，该位为 X，即使驱动值相同也冲突。`inout` 输入模式必须输出 Z。显式 `pull_down` 仅在没有有效驱动时把对应位解析为 0，不计入有效驱动器数量。没有 `pull_down` 不得默认低电平。普通 GPIO 的多驱动冲突规则不得冒充 I²C 开漏线与规则。

## 3 供电 时间与状态

**CMP-007 供电。** 电源域运行态具有布尔 `isPowered`。未供电数字输出统一为 Z，所属模块不采样、不执行、不推进内部计时。普通门默认 `contract.power="implicit"`，由实例直接绑定工作台域；MCU 使用 `explicit`，`VCC/GND` 为 `power` 输入端口，`role` 分别为 `vcc/gnd`，必须连接到同一域中角色匹配的供电输出。两脚接对且该域已上电才算有效供电；角色接反、跨域连接必须报错。`power` 端口不得连接数字或协议端口，不表示模拟电压值。一个电源 out 可以扇出至多个匹配的电源 in；每个电源 in 只能连接一个源。断电再上电走冷启动，不等同于暂停。

**CMP-008 时间。** 虚拟时间单位固定为整数微秒；序列化使用无前导零的非负十进制字符串，例如 `"0"`、`"1200"`。语义上不设 32/64 位整数上限，必须使用精确整数表示；若发布 profile 因资源或显示能力限制可处理范围，必须预先声明并在超出前显式报错，不得回绕、取近似值或把显示截断当作仿真截断。事件由 `(time,phase,sequence)` 确定顺序；同一时间和阶段按单调递增的 sequence 排序，sequence 也以非负十进制字符串保存。仿真时间不得依赖渲染帧数或墙上时钟。默认 `simtick` 前进 1 微秒；MCU 指令单步执行至目标 CPU 完成一条指令，期间其他模块仍按同一虚拟时间推进，两种单步不可混为同一含义。

**CMP-009 调度。** 每个时间戳按以下顺序处理，观察发生在全部提交之后：

1. 按 sequence 处理本时间戳的外部断电、暖复位、已记录的连接开关事件及输入记录。终端注入等用户输入不得绕过队列。连接开关只改变现有导线的运行态 enabled，不改变工程拓扑。
2. 处理该时刻到期的内部事务，例如 UART 完成事件；先检查前一步是否已取消该事务。故同时间戳复位/断电优先于 UART 完成，无论后者此前何时预约。
3. 计算组合逻辑直至稳定，形成所有采样者共享的快照。对于无组合环的网络，按拓扑顺序求值；不得靠任意次数截断假装稳定。
4. 所有到期 CPU 和同步元件读取同一稳定快照，生成更新意图；随后统一提交状态和总线副作用。普通触发器不得读取同一阶段另一触发器刚提交的新值。
5. 排定未来内部事件，再次求解组合逻辑，发布输出、波形与故障。

MCU 在第四步内采用 02 指定的确定子顺序：CPU 状态、总线写入/读取副作用及外设状态提交。模块必须统一归并自身更新意图，禁止两个提交器互相覆盖状态。Phase1 指令 start 只锁定取指并预约 `t+1` 的 retire；寄存器、输入和总线值在 retire 的采样阶段读取。因而同时间戳输入先于 LD 采样，而复位可以撤销待提交指令。以上结果不能由界面回调时机决定。刚在第一步冷启动或暖复位的实例不得在本时间戳执行复位前已预约的时序工作；首次新的有效时钟采样发生在下一整数微秒。

Phase0/Phase1 内建时钟绑定值只有 `global.1us`，表示每个正整数微秒的上升沿，t=0 仅初始化；内建暖复位绑定值只有 `global.warm`，表示由全局控制面分发的暖复位命令，并不表示每次都复位全部实例。它们由引擎提供，不要求工程声明 clocks/resets 数组，不接受任意名称。普通同步原语每沿采样一次；CPU 也使用同一虚拟时间，具体取指与 retire 规则遵守 02。

现有每根导线都有运行态 `{enabled:boolean,version:非负十进制字符串}`，初始为 true 与 `"0"`；每次实际开/关切换使 version 精确加一，同态重复设置不增加。连接以完整导线路径定位，断线/接回通过阶段一事件执行；未被修改的工程仍保留该导线。沿线事务捕获预约时连接版本，完成时若版本不符或已禁用必须取消接收端交付，不能因随后接回就恢复旧交付；UART 发送端仍按 02 的时序完成并释放发送槽位。新增、删除或改接导线属于候选设计编辑，只能按 CMP-018 显式应用。

**CMP-010 环路。** 模块定义直接或间接引用自身必须拒绝。纯组合依赖环必须拒绝并定位环路；跨触发器、寄存器等状态边界的反馈允许。检查以信号依赖为准，不能仅因图形连线围成一圈就报错。行为模型必须声明组合依赖和状态边界。

**CMP-011 封装。** 封装必须保存明确的输入、输出及双向边界，每个外部引脚映射到唯一内部边界。composite 的 ports 必须与 circuit.inputs/outputs/inouts 的 ID、方向、kind 和位宽或协议逐项一致，以相同 ID 直接映射，不另设可歧义的映射表。不得遗漏边界、隐式合并位宽或产生悬空引用。编译器可展开结构，但必须保留实例路径、原始元件与端口映射。多个同款封装内的状态仍满足 CMP-002。

**CMP-012 行为模型。** 功能模型必须公开端口、参数、时序、复位、供电、未知值、错误及副作用契约。没有公开结构的功能芯片不得伪装成可编辑门级结构。替换实现要明确标为“功能兼容”或“周期一致”；功能兼容不保证相同完成周期。兼容性由另行定义的验证记录支持，不得仅凭若干样例宣称严格等价。

**CMP-013 冷启动。** 新仿真或重新供电时，清除该供电域易失状态与未完成事务，RAM 初始化为 0；CPU、外设、普通时序模块归定义的复位值。保留 ROM、固件内容和设计初始输入。全局新仿真时间从 0 开始；仿真运行中的域重新供电不使全局时间倒退。跨域事件须校验接收域当前供电代次，丢弃已失效的旧代次事件并提供可诊断记录。

**CMP-014 暖复位。** 暖复位是控制面命令 `{type:"warm-reset",target:"all"或完整实例路径}`，target 省略时为 all；target=all 作用于全部实例，否则仅作用于指定实例及其子实例。所选范围内 CPU、外设和普通时序模块恢复复位值，清除该范围相关未完成事务，RAM 内容保留，ROM/固件保留，全局时间不回退；范围外实例继续运行，不能被连带清空。目标路径不存在时拒绝该命令。GPIO 方向、输出锁存值、FIFO、计时器等具体复位值由对应模型契约给出；Phase1 MCU 值由 02 统一。此命令不是电气引脚，Phase1 不暴露语义未定义的异步 RESET 引脚。

**CMP-015 暂停。** 暂停冻结虚拟时间、模块状态、待执行事件和其顺序；继续运行从原状态恢复。暂停期间用户编辑输入只能添加待处理事件，不能直接改变已观察的电路状态。已完成观察的时间戳不接受追溯修改，新输入默认安排在下一微秒。单步是执行一次明确的受控推进，完成后仍保持暂停。暂停与断电、复位必须为不同操作。

## 4 版本 保存与安全

**CMP-016 不可变版本。** 定义身份为 `stableId + revision + contentHash`；revision 为 1 至 9007199254740991 的安全整数，发布后的同一三元组内容不可变化。contentHash 为 `sha256:` 加 64 位小写十六进制，按以下确定算法生成：

1. 删除定义自身 contentHash 字段，其余规范字段全部保留；不填充未写出的可选默认字段，不含编辑器临时状态。
2. 所有对象键必须为非空可打印 ASCII 字符串，递归按 ASCII 码值升序排列；数组保序。schema 随后继续限定合法字段名。
3. 所有 JSON number 只允许绝对值不超过 9007199254740991 的整数，拒绝负零；编码为普通十进制整数，不使用指数、小数点或正号。有小数需要的参数必须由模型声明为 decimal string，不接受隐式数值转换。
4. 字符串拒绝孤立 UTF-16 surrogate，不做 Unicode 归一化。双引号和反斜杠分别编码为 `\"`、`\\`；U+0008/0009/000A/000C/000D 分别用 `\b/\t/\n/\f/\r`；其余 U+0000–001F 用小写 `\u00xx`；斜线不转义，其他字符以实际 Unicode 字符写出。不得选用等价但不同的 escape 形式。
5. true/false/null 用 JSON 小写字面值；逗号和冒号周围不留空白，文本不含 BOM 或末尾换行；将结果编码为 UTF-8，计算 SHA-256。

输入文件可以含 JSON 空白或等价 escape，但校验内容哈希时必须以上述规范化结果为准；不能对原文件文本直接哈希。固件哈希使用原始字节，见 CMP-018。

**CMP-017 升级。** 实例锁定完整三元组，不自动跟随“最新版”。升级必须显式执行，并给出端口、参数和行为差异。端口不匹配时拒绝提交，旧工程不变。修改预设芯片生成个人定义/新版本，不覆盖预设。未来共享库只分发同样的不可变定义，不以来源可信替代导入检查。

**CMP-018 工程。** 工程文件保存设计、参数、初始输入、固件与锁定依赖；不得混入正在变化的 RAM、寄存器或事件队列。加载工程只能建立设计及可开始的新仿真，不能悄悄恢复旧运行状态。

设计和固件的新增、删除、重连或替换，在暂停态经完整检查后进入候选版本，不直接改变旧设计对应的运行态或已装入 ROM。只有显式“应用并重新启动”才原子提交整个候选工程，并以新工程冷启动新仿真；校验失败拒绝整个候选，旧工程/运行态/ROM 不变。输入控件事件与现有线 connection-enabled 运行开关不属于拓扑编辑，按 CMP-009 执行。

Phase1 固件 record 只允许字段 `id/targetModel/format/data/contentHash`：id 符合下文 ID 规则，targetModel 固定为 `core8/1`，format 固定为 `hex`；data 为不带 `0x` 的小写十六进制字符串，非空，字符数为 8 的倍数，范围 8–8192，即 4–4096 原始字节且镜像为完整 4 字节指令的倍数。contentHash 为 `sha256:` 加原始镜像字节的 SHA-256，不是对十六进制文本或装入 ROM 后补齐数据求哈希。装入 ROM 时剩余空间补 0。每个 Core8 实例必须以 `bindings.firmware` 引用一个兼容 record id；其他 Phase0 模型不得声明此绑定。固件内容可共享，各 MCU 的运行态仍独立。汇编语义、源映射与程序容量说明见 02。

**CMP-019 快照。** 仿真快照另存，至少包含快照 schema、engineVersion、工程内容哈希、所有定义锁、虚拟时间、事件 sequence、全部实例状态、供电域状态/代次、当前输入、connections、待执行事件队列和暂停状态。connections 是完整导线路径到 `{enabled,version}` 的映射，必须覆盖每根已展开导线，版本用非负十进制字符串保存；事件中的连接版本也必须保留。运行状态中的位向量和时间仍采用 CMP-004/008 格式。恢复必须验证引擎兼容声明及完整锁定依赖；无法兼容时明确拒绝，不部分恢复或静默冷启动。未应用的候选设计不能混入当前仿真快照。

**CMP-020 导入。** 导入先在隔离对象中完成 JSON/schema、类型、身份哈希、引用、位宽、循环、资源与固件检查，再建立候选工程；按 CMP-018 显式应用时才原子替换当前工程并冷启动。失败保留当前工程与运行态。拒绝未知模型 ID、未声明字段、非法枚举、原型污染字段、可执行脚本及超范围数值。任何对象键为 `__proto__/prototype/constructor` 均拒绝。用户定义只允许结构数据、受限声明式数据或引擎白名单行为模型；不得导入任意 JavaScript、动态求值或自动执行网络脚本。重复 JSON 对象键即使值相同也拒绝，不能让通用 JSON 解析器先静默覆盖；必须在 schema 检查前保留并检查键唯一性。

所有 stableId、实例/导线/边界端口/参数/电源域/固件 id 遵守 `^[A-Za-z_][A-Za-z0-9_.-]{0,95}$`；显示 name/label 可用中文且不作为引用。模型 id 为白名单精确字符串，例如 `std.not/1`、`core8/1`，不可由用户拼接后动态加载。每个电路的实例、导线分别具有独立的唯一 ID 命名空间，输入/输出/inout 边界合并后 ID 唯一；每个定义的 ports 合并后 ID 唯一，parameters 内 ID 唯一；工程电源域及固件各自 ID 唯一。库内不得重复 `(stableId,revision)`，locks 中每个该二元组恰有一个 hash，实例引用必须与之完全一致。所有定义，包括尚未实例化的定义，都必须有对应 lock。未声明字段按当前 schema 拒绝，而不是忽略；本版不设任意扩展字段容器。

**CMP-021 限制。** 本版发布 profile 的上限为：1000 个 authored 元件实例、4000 根 authored 导线、128 个芯片定义、16 层定义实例嵌套。前三项按根电路及全部定义合计计算，不因未被使用而免计。编译展开后的有效原始/功能模型实例也不得超过 1000 个；展开后的导线不得超过 4000 根。根电路深度为 0，进入第一层定义实例为 1。上限等于可接受，上限加一明确拒绝；不得截断或只加载一部分。发布版本可声明更低资源 profile，导入前必须展示其实际限制，不得暗改语义。

**CMP-022 错误。** 错误必须包含稳定 code、中文 message、阶段和可得的 instancePath/port/net；静态错误禁止激活新设计，运行时错误按模型契约进入 fault 或停止有关事务，并保留可观察诊断。

| code | 条件 |
|---|---|
| E_SCHEMA / E_UNSUPPORTED_MODEL | schema、字段或模型不受支持 |
| E_SIGNAL_ENCODING / E_WIDTH_MISMATCH | 掩码非法或位宽不匹配 |
| E_DANGLING_REF / E_PORT_KIND | 缺失引用、端口类型不兼容 |
| E_MULTIPLE_DRIVERS / E_DRIVE_CONFLICT | 固定 out 静态冲突 / 运行时有效驱动冲突 |
| E_UNKNOWN_INPUT | 模型要求已知值时接收到未知值 |
| E_COMBINATIONAL_CYCLE / E_MODULE_CYCLE | 组合循环 / 模块循环引用 |
| E_POWER_ROLE / E_POWER_DOMAIN | 电源角色错误 / 域错误 |
| E_HASH_MISMATCH / E_DEPENDENCY_VERSION | 内容不符 / 锁定依赖不满足 |
| E_RESOURCE_LIMIT / E_TIME_RANGE | 资源超限 / 时间非法或溢出 |
| E_UNSAFE_IMPORT / E_SNAPSHOT_INCOMPATIBLE | 不安全导入 / 快照无法兼容 |

**CMP-023 定位。** 每个可观察信号、实例状态、总线事务与错误应能返回确定的实例路径。预设芯片与个人芯片采用同一定位机制。复杂模型只展示它实际提供的内部状态，不生成虚构门级结构。

**CMP-024 协议端口。** `protocol_transaction` 具有声明的协议与版本、方向和载荷 schema；只能连接到兼容协议接收端。事务通过虚拟时间队列投递，顺序、容量、完成条件、溢出行为必须公开，禁止未定义的静默丢包。Phase1 `UART_TX/UART_RX` 使用 `uart-txn/1`，分别为 out/in，与终端 RX/TX 配对；它们不是单线数字 UART 波形。载荷只允许 `{"byte":n}`，n 为 0–255 整数，不允许额外字段。每个 out 最多连接一个 in，每个 in 最多接收一个 out；协议口扇出至多个终端在 Phase1 拒绝。允许终端与 MCU、两个 MCU，以及同一 MCU TX→自身 RX 回环；一笔完整字节事务只有 02 规定的一次 1042 微秒传输时间，接收端不得重复计时。SPI/I²C 位级与开漏解析属于 Phase2。

## 5 字段与默认值

以下是本版规范数据模型；任何“必填”字段均不得由导入器猜测补齐。默认只用于明确标为可选的字段。

| 对象/字段 | 类型 | 必填 | 默认或限制 |
|---|---|---|---|
| project.schema/profile/name | string | 是 | schema 为 chip-game.project/0.1.0，profile 为 p0-p1 |
| project.definitions/locks/firmware | array | 是 | 可为空；锁包含所有引用定义的完整身份 |
| project.powerDomains | array | 是 | 域含 id:string、initialPowered:boolean |
| project.circuit | object | 是 | inputs/outputs/inouts/instances/wires 均为数组 |
| project.initialInputs | object | 是 | 顶层数字输入 ID 到规范位向量；全部输入须声明 |
| definition.stableId/revision/contentHash/name | string/integer/string/string | 是 | revision 为正安全整数；定义名与端口名非执行内容 |
| definition.ports/parameters/model/contract | array/array/object/object | 是 | parameters 可为空；model.kind 为三种实现之一 |
| model.id / model.circuit | string / object | 条件 | primitive/behavioral 必须有白名单 id；composite 必须有 circuit，二者互斥 |
| port.id/name/direction/kind | string | 是 | ID 在定义内唯一；direction 为 in/out/inout |
| port.width / port.role / port.protocol | integer / string / string | 条件 | 分别只适用于 digital / power / protocol_transaction |
| contract.timing/dependencies/reset | enum/array/object或null | 是 | timing=combinational或stateful；dependency 为 from/to 端口 ID；reset 的合法形式见下文 |
| contract.power | enum | 否 | implicit；explicit 模型必须声明供电输入引脚 |
| instance.id/definition/parameters/bindings | string/object/object/object | 是 | definition 为完整身份；parameters 可为空 |
| instance.label | string | 否 | 定义 name；不影响身份 |
| bindings.power | string | 是 | 指向存在的电源域 |
| bindings.clock/reset | string | 条件 | stateful 模型必填，分别只能为 global.1us/global.warm；组合门不得声明 |
| bindings.firmware | string | 条件 | 仅 core8/1 必填，引用工程 firmware record id |
| wire.id/from/to | string/object/object | 是 | endpoint 见示例；from/to 为存储方向，网络连接本身按端口语义检查 |
| wire.pull | enum | 否 | 无；Phase0/Phase1 唯一支持 pull_down，作用于该线所在整网的每一位 |

第 6 节所有模型的 parameters 都是空数组，实例 parameters 必须为空对象。后续模型的参数 schema 必须随白名单版本精确定义 ID、类型、范围及默认值；本版不接受尚未声明的自定义参数类型。结构边界中 input 对内为源，output 对内为接收端，inout 同时有接收/驱动视图。坐标、视口等编辑器信息可另存到声明过的 view schema，不属于本文功能模型。

contract.reset 只允许以下三种互斥形式：

| 模型情况 | 合法 reset 值 | 解释 |
|---|---|---|
| combinational | null | 无内部可复位状态 |
| stateful primitive/behavioral | `{"kind":"model","model":"注册模型ID","preserveOnWarm":[]}` | model 必须等于 model.id；允许保留的区域由注册模型固定，不能自行增加 |
| stateful composite | `{"kind":"children"}` | 对全部子实例递归调用相同种类复位，取消其过期预约，不持有额外隐藏状态 |

上述对象不得有其他键。std.dff/1 的 preserveOnWarm 只能为空数组，复位值 q=0；core8/1 只能为 `["ram"]`，其他复位值使用 02 的固定表；io.terminal/1 只能为 `["history"]`，其观察历史保留和通信状态清除规则见第 6.2 节。具体状态字段及值受模型注册版本约束，导入者不能自行写一份 reset.values 覆写它们。

## 6 Phase0 与 Phase1 内建模型白名单

### 6.1 Phase0 一位逻辑模型

所有端口均为一位 digital，方向由输入/输出列确定，除 DFF 外都是 combinational；门的复位为 null。model.id 必须精确匹配本表，不接受缩写。边界开关、输出指示器、LED 可以是输入事件与信号观察的视图，不要求额外功能模型；视图不能自行改写运行状态。

| model.id | 输入端口 | 输出端口 | 规则 |
|---|---|---|---|
| std.not/1 | in | out | 逐位非 |
| std.and/1 | a,b | out | 与 |
| std.or/1 | a,b | out | 或 |
| std.xor/1 | a,b | out | 异或 |
| std.nand/1 | a,b | out | 与后取非 |
| std.nor/1 | a,b | out | 或后取非 |
| std.xnor/1 | a,b | out | 异或后取非 |
| std.mux/1 | a,b,sel | out | sel=0选a，sel=1选b；未知选择遵守CMP-005 |
| std.dff/1 | d,en,reset | q | stateful，全局上升沿同步采样 |

std.dff/1 冷启动与暖复位 q=0；contract.dependencies 为空数组，其输出由旧状态产生。在有效上升沿：reset=1 则 q'=0；reset=X 则 q'=X；reset=0 且 en=0 保持 q；reset=0 且 en=1 则 q'=d；reset=0 且 en=X 则 q'=X。输入Z按CMP-005先解释为X。reset优先于en；所有实例从同一快照采样并同时提交。因此共用时钟、d=1、reset=0、A.en=1/B.en=0 时，一沿后 A.q=1、B.q=0。全局暖复位命令与引脚 reset 是不同来源：前者是阶段一命令，后者是同步采样输入。

### 6.2 供电源 MCU 与终端

这些也是显式注册的模型，不能依赖界面名称绕过 schema。表内模型均有 `parameters:[]`，实例均为 `parameters:{}`；dependencies 为空数组。电源输出只携带域和角色，不提供数字电平或真实电压。

| 阶段 / model.id | kind / timing / power | 精确端口 | reset | 必填 bindings |
|---|---|---|---|---|
| Phase0 · std.vcc/1 | primitive / combinational / implicit | out：out、power、role=vcc | null | power=存在的域ID；无clock/reset/firmware |
| Phase0 · std.gnd/1 | primitive / combinational / implicit | out：out、power、role=gnd | null | power=存在的域ID；无clock/reset/firmware |
| Phase1 · core8/1 | behavioral / stateful / explicit | GPIO0…GPIO7：各1位digital inout；VCC/GND：power in，role分别vcc/gnd；UART_TX/UART_RX：protocol_transaction out/in，protocol均uart-txn/1 | `{"kind":"model","model":"core8/1","preserveOnWarm":["ram"]}` | power；clock=global.1us；reset=global.warm；firmware=兼容record ID |
| Phase1 · io.terminal/1 | behavioral / stateful / implicit | TX：protocol_transaction out；RX：protocol_transaction in；protocol均uart-txn/1 | `{"kind":"model","model":"io.terminal/1","preserveOnWarm":["history"]}` | power；clock=global.1us；reset=global.warm；禁止firmware |

`std.vcc/1` 和 `std.gnd/1` 没有可变内部状态，不因暖复位更改域状态；其 out 在解析供电连接时提供 bindings.power 指定的域身份及固定 role，有效供电由该域 isPowered 决定。域断电时保持连接身份但不使接收器上电；不能把 GND 解释为一根 digital 0 线。二者可扇出，同一接收 power in 仍只有一个源。

Core8 的指令、内部状态、GPIO、供电复位、FIFO 与1042微秒串口规则由02定义；其UART输出由内部状态和事件产生，不构成GPIO或UART输入到输出的即时组合依赖。以上白名单行构成其公共签名，不能仅有型号名而省略端口或绑定。

终端的详细公共契约如下，属于 CMP-009/013/014/019/024 的具体模型规则：

- **供电与时钟。** 终端由 implicit 域供电，不另有 VCC/GND 引脚；供电时 RX 始终允许接收，没有 RX_EN 寄存器。global.1us 表示统一时间基准，终端是按事件推进的状态机，没有每微秒自动产生字节的行为。
- **注入与发送。** 控制面输入记录为 `{type:"terminal-inject",target:实例路径,byte:0..255}`，由公共信封附加 time 和 sequence，按阶段一入队。暂停时只增加外部事件记录。TX队列容量16，包含正在发送的队首；满时拒绝本次注入并报告E_RESOURCE_LIMIT，保留原队列；未供电时拒绝本次注入并报告E_POWER_DOMAIN。终端不自行重试。队列从空变非空且已供电时立即开始首字节，以当前虚拟时间加1042微秒预约完成；后续字节逐个串行，上一字节完成后开始下一字节，不额外增加一个采样周期。
- **交付资格。** 每次开始记录发送实例代次、接收端点和代次、接收资格及连接版本。终端接收资格为已供电且当前接收代次有效；MCU还必须RX_EN=1。完成阶段按PER-009重新核对，只有全部有效才交付。断线、接收端复位或断电只取消交付，仍有效的发送端照常完成并移出队首；发送端自己复位/断电则取消其旧完成事件。接收端不再附加1042微秒。
- **接收与显示。** 终端没有供程序读取的RXFIFO，成功交付立即产生一条接收历史 `{kind:"byte",time,sourceInstance,byte}`；只能记录实际交付，不能把对方TX完成当作收到。可打印ASCII作文本显示，其他字节显示十六进制转义；控制字节不得执行终端指令。
- **初态与复位。** 新会话TX队列为空、activeTx=null、实例代次为`"0"`、history.entries为空、history.truncatedCount=`"0"`。终端被暖复位或断电时清空待发及在途通信状态、使旧代次失效；重新上电从空队列开始。既有会话的history是观察记录，不是通信FIFO，暖复位、断电和冷启动均保留并追加带time/sourceInstance/reason的marker。仅复位MCU不能清除终端队列或history；该MCU的复位可作为独立控制面标记显示，不能伪造UART接收字节。尚未到时的外部terminal-inject记录不属于已接受的TX队列，仍按其预约时刻和当时供电状态处理；新工程的新仿真不继承旧事件队列。
- **同刻顺序。** 外部复位/断电和连接开关在阶段一，可使同刻阶段二完成取消或无法交付；CPU在阶段四以ST禁用UART_CTRL则晚于该时刻有效完成，所以先交付/入队，再由ST清空相应FIFO并取消后续通信。终端不得回滚已经发生的阶段二接收记录。复位标记是控制事件，不是延迟发送的字节。
- **历史上限与快照。** history.entries最多1024条，含byte和marker；超出移除最旧项并递增十进制字符串truncatedCount，界面明确显示截断，不影响通信队列。完整快照必须保存终端TX队列、activeTx的字节/起止时刻/发送代次/接收资格与代次/连接版本、实例代次和完整有界history；外部尚未投递的注入记录在公共事件队列中保存。恢复不额外发送、接收或生成marker。

终端activeTx为空时为null；非空时同时引用TX队首，不能把同一字节计作两个容量槽。开始新发送或取消事件必须按既定顺序修改队首，旧代次完成回调不能弹出新队列。对端不支持广播、多源合并或未知字节；端点和载荷检查遵守CMP-024。

以下JSON数组是上述两个电源源和终端的**完整定义记录**，不是工程文件；工程把使用的记录放进definitions，并在locks和实例definition中引用同一三元组。参数、名称、端口顺序及contract都属于计算哈希的内容。

```json
[
  {
    "stableId":"std.vcc","revision":1,"name":"电源正端",
    "ports":[{"id":"out","name":"VCC","direction":"out","kind":"power","role":"vcc"}],
    "parameters":[],"model":{"kind":"primitive","id":"std.vcc/1"},
    "contract":{"timing":"combinational","dependencies":[],"reset":null,"power":"implicit"},
    "contentHash":"sha256:fab80807312cbbed80c9e8e17105bc5f6fe4e0264df7aa34578ef1e37ab6094a"
  },
  {
    "stableId":"std.gnd","revision":1,"name":"电源地端",
    "ports":[{"id":"out","name":"GND","direction":"out","kind":"power","role":"gnd"}],
    "parameters":[],"model":{"kind":"primitive","id":"std.gnd/1"},
    "contract":{"timing":"combinational","dependencies":[],"reset":null,"power":"implicit"},
    "contentHash":"sha256:c4e55ef0b133da45f343f9b95c207bccade46254b97516d0e7b8c14c81457ca4"
  },
  {
    "stableId":"io.terminal","revision":1,"name":"串口终端",
    "ports":[
      {"id":"TX","name":"TX","direction":"out","kind":"protocol_transaction","protocol":"uart-txn/1"},
      {"id":"RX","name":"RX","direction":"in","kind":"protocol_transaction","protocol":"uart-txn/1"}
    ],
    "parameters":[],"model":{"kind":"behavioral","id":"io.terminal/1"},
    "contract":{"timing":"stateful","dependencies":[],"reset":{"kind":"model","model":"io.terminal/1","preserveOnWarm":["history"]},"power":"implicit"},
    "contentHash":"sha256:3fe34bb93ff98bb3c273b16f7bec3830e8acbaa07601d9fdd8db828161079c2a"
  }
]
```

## 7 完整极简 NOT 工程示例

此例具有一个顶层输入、一个输出、一个绑定工作台电源域的门、两根显式端口连线及确定的定义锁。它是规格示例，不是已通过现有实现的导入测试。示例定义哈希按 CMP-016 的规范内容计算。

```json
{
  "schema": "chip-game.project/0.1.0",
  "profile": "p0-p1",
  "name": "非门演示",
  "definitions": [{
    "stableId": "std.not",
    "revision": 1,
    "contentHash": "sha256:715d12568dbc47784e176e585ba7dfbc50f48e919e0f29da8c20e5d514f636f2",
    "name": "非门",
    "ports": [
      {"id":"in","name":"IN","direction":"in","kind":"digital","width":1},
      {"id":"out","name":"OUT","direction":"out","kind":"digital","width":1}
    ],
    "parameters": [],
    "model": {"kind":"primitive","id":"std.not/1"},
    "contract": {
      "timing":"combinational",
      "dependencies":[{"from":"in","to":"out"}],
      "reset":null
    }
  }],
  "locks": [{
    "stableId":"std.not",
    "revision":1,
    "contentHash":"sha256:715d12568dbc47784e176e585ba7dfbc50f48e919e0f29da8c20e5d514f636f2"
  }],
  "firmware": [],
  "powerDomains": [{"id":"main","initialPowered":true}],
  "initialInputs": {
    "a":{"width":1,"value":"0x0","knownMask":"0x1","driveMask":"0x1"}
  },
  "circuit": {
    "inputs":[{"id":"a","name":"A","direction":"in","kind":"digital","width":1}],
    "outputs":[{"id":"y","name":"Y","direction":"out","kind":"digital","width":1}],
    "inouts":[],
    "instances":[{
      "id":"g1",
      "definition":{
        "stableId":"std.not",
        "revision":1,
        "contentHash":"sha256:715d12568dbc47784e176e585ba7dfbc50f48e919e0f29da8c20e5d514f636f2"
      },
      "parameters":{},
      "bindings":{"power":"main"}
    }],
    "wires":[
      {"id":"w1","from":{"kind":"boundary","port":"a"},"to":{"kind":"instance","instance":"g1","port":"in"}},
      {"id":"w2","from":{"kind":"instance","instance":"g1","port":"out"},"to":{"kind":"boundary","port":"y"}}
    ]
  }
}
```

预期语义：启动后 A=0 则 Y=1；将 A=1 排入下一微秒的输入事件后，该时刻观察到 Y=0；关闭 main 电源域后门输出为 Z，输出接收逻辑观察为 X。此处只列预期，没有执行结果。

## 8 验收索引

下列均为待执行规范测试，详细步骤由 03 编排；不代表已有通过记录。

| 测试索引 | 需求 | 预期检查 |
|---|---|---|
| ACC-CMP-01 | CMP-002/011 | 两个同款嵌套计数器状态互不影响；打开内部能定位各自实例 |
| ACC-CMP-02 | CMP-003/004 | 1、8、32 位往返保存；第31位保持；非法mask/位宽拒绝 |
| ACC-CMP-03 | CMP-005 | 0 AND X、1 OR X 和未知MUX候选的结果符合规则 |
| ACC-CMP-04 | CMP-006 | 固定out/out拒绝；GPIO输入接按钮有效；改输出后同值驱动也冲突为X |
| ACC-CMP-05 | CMP-006 | 无驱动网为Z、接收为X；显式pull_down才得到0 |
| ACC-CMP-06 | CMP-007/013/014 | 供电接反/跨域报错；断电Z；冷启动RAM0，暖复位保留RAM |
| ACC-CMP-07 | CMP-008/009 | 不同渲染速率产生同一事件序列；两个触发器读取同一旧态 |
| ACC-CMP-08 | CMP-010 | 拒绝纯组合环、定义自引用及间接引用环；允许时序反馈 |
| ACC-CMP-09 | CMP-012 | 功能模型如实显示可编辑边界；不能宣称未验证周期等价 |
| ACC-CMP-10 | CMP-015 | 暂停后时间/状态不变；输入只入队；单步一次后保持暂停 |
| ACC-CMP-11 | CMP-016/017 | 已锁实例不自动升级；不兼容升级失败后原工程完全保留 |
| ACC-CMP-12 | CMP-018/019 | 工程加载是新仿真；快照恢复时间、队列、输入及实例状态一致 |
| ACC-CMP-13 | CMP-020/022 | 拒绝脚本/污染字段/未知模型/假哈希/悬空引用；旧工程和运行态不变 |
| ACC-CMP-14 | CMP-021 | 1000/4000/128/16边界接受，各自加一拒绝；展开上限另测 |
| ACC-CMP-15 | CMP-023/024 | 错误定位到实例端口；UART事务依队列顺序且不能接digital |

评审时仍须由产品负责人确认各发布 profile 的性能目标；这不会改变本版信号、时间、复位和身份规则。
