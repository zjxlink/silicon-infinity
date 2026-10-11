# 智能灯控制板场景与验收规格

版本：0.1.0　日期：2026-10-10　状态：评审稿

本文定义待实现行为与验收用例，不代表已有功能或测试结果。全部用例状态为“未执行”。引用同版本《01 元件接口规格》的 CMP 编号及《02 MCU 与外设规格》的 MCU/PER 编号；冲突须先修订合同，不能由测试人员自行解释。

## 1 目标 分期和发布闸门

玩家从一个开箱可运行的智能灯开始，观察输入、执行程序、GPIO 和串口的关系，随后修改、封装并复用自己的设计。目标是可解释、可编辑、可验证的数字系统；本版不模拟电压、电流或真实 MCU 的电气特性。

| 阶段 | 可交付范围 | 发布闸门 |
|---|---|---|
| Phase0 | 纯数字逻辑、四态信号、分层封装、设计保存 | 本阶段所有 Blocker 通过；Major 失败须记录具体影响及接受决定 |
| Phase1 | Core8 程序、GPIO、UART 与智能灯完整闭环 | Phase0 闸门持续满足；本阶段所有 Blocker 通过；Major 处理规则同上 |
| Phase2 | PWM、中断消抖、I²C 温度、SPI 显示 | 独立扩展合同；不作为 Phase1 发布条件 |

Blocker 表示阻断所属阶段发布；Major 表示重要问题。优先级与阶段名称不同，不使用“Phase0/Phase1”同时表示两者。每个关卡按行为验收，允许不同电路；自由沙盒不要求先通关才允许使用基础元件。

## 2 场景合同与可复现夹具

- **LAMP-001：运行闭环。** 同一供电域有效后，Core8 执行保存的参考程序：启动发送 ASCII `B`，持续闪灯，检测按键输入变化后发送 `P/R`。LED 的可见状态必须来自 GPIO1 的解析信号，不能由界面直接改灯。
- **LAMP-002：可修改。** 程序、接线和参数均可编辑；断线与错误配置必须影响观察结果。修改 WAIT 后，对应 GPIO 行为的仿真时刻随之改变。
- **LAMP-003：可观察。** 同步显示供电、暂停、PC、故障、GPIO0/1、LED 状态、UART 字节及仿真时间；浮空或未知不得显示为确定的 0。
- **LAMP-004：可复现。** 示例附程序、元件版本、依赖快照、事件脚本、预期轨迹和固定种子；相同初态与事件产生相同结果。
- **LAMP-005：可复用。** 封装、复制和共享保持接口语义；实例状态独立，旧工程不自动升级依赖。

### 2.1 元件与连接清单

| 元件/控制 | 连接与名称 | 本版语义 |
|---|---|---|
| PowerDomain `PWR1`，源实例 `VCC/GND` | `VCC.out → MCU.VCC`；`GND.out → MCU.GND` | VCC/GND分别引用std.vcc/1、std.gnd/1并绑定PWR1；两条power连接角色正确且同域，isPowered=true才供电 |
| Reset 控件 | `warm-reset` 命令，target默认all或指定实例路径 | Phase1 无 RESET 硬件引脚；图中显示为控制命令，不画虚假电气连线 |
| 按钮视图 `BTN1` | 显示别名`BTN1.OUT`，实际为顶层boundary输入`button`，连接MCU.GPIO0 | 不是未注册Button模型；按下驱动1，释放驱动Z，事件使用仿真时间 |
| Pull-down | `MCU.GPIO_PD.bit0=1` | 参考板显式显示内置弱下拉，释放时解析为 0；外部下拉教学夹具先关闭此位 |
| 指示灯视图 `LED1` | `MCU.GPIO1`连接顶层boundary输出`led`，显示别名`LED1.IN` | 不是未注册LED模型；1亮、0灭、X/Z显示未知标记，不产生驱动电流数值 |
| Core8实例 `MCU` | 注册模型core8/1，`GPIO0..7`为digital inout | DIR位为0时驱动Z，为1时驱动OUT；DIR=02配置GPIO1输出 |
| 终端实例 `TERM1` | io.terminal/1；`MCU.UART_TX → TERM1.RX`；`TERM1.TX → MCU.UART_RX` | 端口、队列、注入、代次及历史均按01第6.2节；uart-txn/1，9600、8N1，每字节只1042µs |

参考板的可序列化映射固定如下。PowerDomain是project.powerDomains中的域记录，不是元件实例；VCC、GND、MCU、TERM1才出现在circuit.instances。按钮与LED只使用已有boundary schema，不能把视图别名写成model.id或额外未声明字段。

| 对象 | 规范身份/字段 |
|---|---|
| 电源域 | `{id:"PWR1",initialPowered:false}`；测试t=0上电使用外部供电命令 |
| VCC实例 | id=VCC；definition引用stableId=std.vcc、revision=1及01给出的完整contentHash；parameters={}；bindings={power:"PWR1"} |
| GND实例 | id=GND；definition引用stableId=std.gnd、revision=1及01给出的完整contentHash；parameters={}；bindings={power:"PWR1"} |
| MCU实例 | id=MCU；definition为core8公共签名的锁定定义；parameters={}；bindings={power:"PWR1",clock:"global.1us",reset:"global.warm",firmware:"lamp"}；lamp为02参考程序生成的固件record id |
| TERM1实例 | id=TERM1；definition引用stableId=io.terminal、revision=1及01给出的完整contentHash；parameters={}；bindings={power:"PWR1",clock:"global.1us",reset:"global.warm"} |
| 按钮边界 | circuit.inputs含{id:"button",name:"BTN1.OUT",direction:"in",kind:"digital",width:1}；initialInputs.button为1位全Z；按下事件置V=K=D=0x1，释放置V=K=D=0x0 |
| LED边界 | circuit.outputs含{id:"led",name:"LED1.IN",direction:"out",kind:"digital",width:1}；只观察所连网络，不驱动 |

实际wire端点为：`VCC.out→MCU.VCC`、`GND.out→MCU.GND`、`boundary(button)→MCU.GPIO0`、`MCU.GPIO1→boundary(led)`、`MCU.UART_TX→TERM1.RX`、`TERM1.TX→MCU.UART_RX`。例如按钮wire的from为`{kind:"boundary",port:"button"}`，LED wire的to为`{kind:"boundary",port:"led"}`；其余端点均为`{kind:"instance",instance:上述实例ID,port:实际端口ID}`。它们分别使用稳定wire ID wVcc/wGnd/wButton/wLed/wTx/wRx，全部初始enabled=true、version="0"。各定义完整记录必须随示例包保存并列入locks；不允许仅凭型号名称在线查最新版。未供电的TERM1也不收发，但保留既有会话观察历史。

参考 MCU 为 8 个 8 位寄存器、4 KiB ROM、1 KiB RAM、4 字节定长指令，普通指令耗时 1 µs。UART 异步运行，CPU 不因发送一个字节自动等待 1042 µs。参考程序使用 02 文档中的完整编码和标签地址，不另造第二套指令语言；演示文本不能替代可执行程序夹具。参考程序采用约60ms轮询，不承诺捕获更短按键，也不承诺去抖。

测试夹具约定：`F-LOGIC` 为二输入 AND 与指示灯；`F-LAMP` 为上述参考板和 02 参考程序；`F-FLOAT` 为关闭 GPIO_PD.bit0 且无外部下拉的变体；`F-STATE` 为写入非零 RAM、寄存器并有 UART 在途字节的状态；`F-NEST` 为无循环引用的可调层数模块链。事件种子统一为 `20261010`。每次测试使用独立副本。

运行中的“断线/接回”专指已有 wire 的 `connection-enabled` 开关，每次切换都增加连接版本；启用状态和版本纳入快照。添加、删除或改接 wire，以及修改固件，属于候选设计编辑，须显式应用并冷启动后生效；不能用运行开关绕过结构验证。以下动态断线用例均使用前一种操作。

### 2.2 三步零基础关卡

1. **观察一盏灯。** 打开 Phase0 预设，拨动两个输入并填写四行真值表；验收灯状态与 AND 的四种结果全部一致。界面高亮从输入到输出的路径。
2. **让电路成为自己的芯片。** 修改逻辑后运行测试，再选择模块封装并放入第二实例；验收外部行为等价，实例状态互不影响。提供可编辑预设，允许回看内部。
3. **让程序控制灯。** 打开 Phase1 参考板，上电观察 `B`，按下/释放观察 LED 与 `P/R`，再修改 WAIT；验收接线、程序及输出轨迹确实相关。故障反馈须定位到具体端口或指令，并提供观察提示。

## 3 Phase0 基础与封装验收

每行“步骤/输入”必须实际执行；“可观察预期/通过条件”为判定标准。任何未经执行的结果不得改为通过。

| ID / 对应需求 | 前置 | 步骤 / 输入 | 可观察预期 / 通过条件 | 优先级 | 阶段 | 状态 |
|---|---|---|---|---|---|---|
| T01 / CMP-004/005 | F-LOGIC | 依次输入 00、01、10、11 | 输出依次 0、0、0、1；灯与输出逐项一致 | Blocker | Phase0 | 未执行 |
| T02 / CMP-011/012；LAMP-005 | T01夹具 | 封装 AND 后重复四组输入 | 封装前后输出值和事件时间完全相同；可打开内部定位 | Blocker | Phase0 | 未执行 |
| T03 / CMP-002/009 | 两个std.dff/1实例，q初始0，共享clock=global.1us、reset=global.warm | 两实例d=1、reset=0；A.en=1、B.en=0，推进第一共同上升沿 | 同一旧态快照采样后A.q=1、B.q=0；两实例状态独立，不构造未定义的私有时钟 | Blocker | Phase0 | 未执行 |
| T04 / CMP-006 | 合法inout共享网 | 先仅一源驱动1，再让两源均驱动1 | 一源为1；两强源即X并报E_DRIVE_CONFLICT，不因同值放行 | Blocker | Phase0 | 未执行 |
| T05 / CMP-006 | 可撤除驱动与弱下拉的网 | 撤强驱动；接弱下拉；再撤下拉 | 依次观察Z、0、Z；最终接收逻辑解释未知，不能默认为0 | Blocker | Phase0 | 未执行 |
| T06 / CMP-003/022 | 正常工程副本 | 接out到out、8位到1位、UART到digital | 各次拒绝错误连接并定位端口；原有连接和工程不变 | Blocker | Phase0（数字）/Phase1（协议） | 未执行 |
| T07 / CMP-016/017 | 工程锁模块v1 | 发布v2改变逻辑，重开旧工程；再显式升级 | 未升级仍跑v1且轨迹相同；升级先呈现接口与行为变更 | Blocker | Phase0 | 未执行 |
| T08 / CMP-020 | 正常工程已打开 | 导入含脚本字段、__proto__键及缺失依赖的三份JSON | 严格验证拒绝；不执行文本、不修改对象原型、不替换旧工程 | Blocker | Phase0 | 未执行 |
| T09 / CMP-021 | 合法边界夹具，每次仅改变被测维度 | 分别导入节点1000/1001、线4000/4001、定义128/129、深度16/17 | 上限内合法例可载入，+1例拒绝；展开后节点/线也受1000/4000限制；根深度0；旧工程保留 | Blocker | Phase0 | 未执行 |
| T10 / CMP-010/011 | F-NEST | 导入自引用及A→B→A；再导入合法时序反馈 | 循环定义拒绝且给引用路径；合法寄存器反馈不被误拒 | Blocker | Phase0 | 未执行 |
| T11 / CMP-008/009；LAMP-004 | 固定初态及事件脚本 | 种子20261010重复运行两次，含同时间按键/时钟事件 | 时间、事件顺序、信号值及故障轨迹逐项一致 | Blocker | Phase0 | 未执行 |

## 4 Phase1 上电 程序和故障验收

| ID / 对应需求 | 前置 | 步骤 / 输入 | 可观察预期 / 通过条件 | 优先级 | 阶段 | 状态 |
|---|---|---|---|---|---|---|
| T12 / MCU-009；CMP-007；LAMP-001 | F-LAMP断电、按钮释放 | t=0启用PWR1，观察初始化及参考程序 | RAM/寄存器初值0且ROM不变；t=6入TX；t=1048收B；LED在t=16亮、t=60025灭，与GPIO1一致 | Blocker | Phase1 | 未执行 |
| T13 / PER-001/002/003；LAMP-001 | 参考程序已初始化 | 按下BTN1保持200ms，再释放保持200ms | GPIO0依次1/0；终端按次序各收一次P/R；LED继续由程序翻转，端口波形与显示一致 | Blocker | Phase1 | 未执行 |
| T14 / MCU-007；LAMP-002 | 同初态双副本 | 将WAIT60000改30000，期间按钮保持释放 | 两例首次LED均t=16亮；第二变化分别t=60025/30025；对应下一指令提前30000 µs | Major | Phase1 | 未执行 |
| T15 / CMP-006；LAMP-003 | 正常点灯，已有GPIO1→LED1.IN wire | 将该wire的connection-enabled设false，继续程序 | MCU继续执行，LED输入Z且显示未知；灯不能继续假装跟随GPIO1 | Blocker | Phase1 | 未执行 |
| T16 / PER-009 | UART字节正在发送，TX→终端RX wire已存在 | 发送起点+500 µs将wire enabled设false，+501 µs设true | 每次切换版本递增；该字节终端仍不收；MCU发送到1042 µs正常结束，CPU不被阻塞 | Blocker | Phase1 | 未执行 |
| T17 / CMP-007；MCU-009 | 参考板断电 | 尝试运行；另测VCC/GND接反或跨域 | 无有效供电不退休指令、不发送新字节；GPIO不驱动；接反/跨域错误可定位 | Blocker | Phase1 | 未执行 |
| T18 / PER-003；MCU-006 | F-FLOAT，目标寄存器预置A5 | 释放按钮后执行LD读取GPIO_IN | 整次读取F_UNKNOWN；寄存器仍A5、指令不部分提交；明确指出GPIO0未知 | Blocker | Phase1 | 未执行 |
| T19 / PER-001/004 | GPIO0仍接BTN1 | 把DIR.bit0改1并按下按钮，分别OUT0/1 | 两种均X并E_DRIVE_CONFLICT；不得把同值强驱动当安全连接 | Blocker | Phase1 | 未执行 |
| T20 / PER-003；CMP-006 | F-FLOAT，预先建好外部弱下拉wire且enabled=false | 开启该wire，释放/按下；再关闭该wire并释放 | 前两次GPIO0为0/1且整字可读；最后为Z，读取按T18故障；不编辑运行中拓扑 | Major | Phase1 | 未执行 |
| T21 / MCU-003/013/014 | 合法参考工程 | 汇编R8、未知助记符、跳转末尾空标签；另执行opcodeFF或非零保留字段 | 汇编各例拒绝且旧ROM不变；非法编码执行产生F_ENCODING，PC和目标寄存器保持，不能当NOP | Blocker | Phase1 | 未执行 |
| T22 / PER-006/007/008 | 已启用UART，使用无轮询干扰的测试程序 | 首个字节完成前写16字节再写第17字节，运行至发送完成；空RX执行读 | 含在途字节最多16；第17字节丢弃并置TX_OVERFLOW，ST仍正常退休且不fault；字节间隔1042 µs；空读F_RX_EMPTY | Blocker | Phase1 | 未执行 |

## 5 生命周期 保存和内容发布验收

| ID / 对应需求 | 前置 | 步骤 / 输入 | 可观察预期 / 通过条件 | 优先级 | 阶段 | 状态 |
|---|---|---|---|---|---|---|
| T23 / CMP-015；MCU-011 | F-STATE，在途UART已过500 µs | 暂停，墙钟等2秒，恢复后推进542 µs | 暂停期间仿真时间、CPU、灯、UART均冻结；恢复后剩余542 µs才交付且仅一次 | Blocker | Phase1 | 未执行 |
| T24 / CMP-014；MCU-010；PER-010 | F-STATE | 发warm-reset | RAM保留；CPU/外设复位；在途UART取消；既有日志保留并插reset标记，取消字节不晚到 | Blocker | Phase1 | 未执行 |
| T25 / CMP-013；MCU-009 | F-STATE | 断电再上电，在第一指令前检查 | RAM/寄存器全0、外设初态；ROM程序仍在；旧在途事件不得重新交付 | Blocker | Phase1 | 未执行 |
| T26 / CMP-018 | 运行后RAM非零 | 保存“设计”，另开环境载入 | 元件/接线/程序/固定依赖恢复；不冒充继续旧PC/RAM；按冷初始化合同启动 | Blocker | Phase1 | 未执行 |
| T27 / CMP-019 | F-STATE，在途500 µs；至少一wire曾切换enabled | 保存“仿真快照”，另开环境恢复；与未中断对照比较 | PC/RAM/FIFO/剩余542 µs/事件顺序及wire enabled/version恢复；后续轨迹相同，无重发漏发 | Blocker | Phase1 | 未执行 |
| T28 / MCU-012；LAMP-005 | 同一封装MCU的A/B实例，各有独立已知状态 | 仅A写RAM、改OUT、发送字节，再warm-reset target=A | A清CPU/外设但保留RAM；B与未操作A的对照轨迹一致，正常继续且不被复位；日志带实例来源 | Blocker | Phase1 | 未执行 |
| T29 / CMP-012；LAMP-004/005 | 完整参考板及事件脚本 | 封装控制板后重放，并以同种子再重放一次 | 外部LED和UART轨迹与封装前逐事件一致；调试可定位内部MCU | Major | Phase1 | 未执行 |
| T30 / CMP-016/018/020/024；LAMP-004 | 待入库示例包 | 在空内容库环境仅用包内依赖打开、上电、运行附带测试；检查供电/终端定义及按钮/LED端点 | std.vcc/1、std.gnd/1、core8/1、io.terminal/1均有合法注册签名与固定依赖；按钮/LED映射boundary而非未知模型；无缺失依赖；可编辑并可复现 | Blocker | Phase1 | 未执行 |
| T31 / MCU-003/005/013；CMP-020 | 正常工程副本 | 汇编1025条指令、跳转0002、重复/未定义标签；导入ROM4097字节 | 各例明确拒绝并保留旧程序；错误给行号或ROM字段路径，不截断“修复” | Blocker | Phase1 | 未执行 |
| T32 / CMP-009；MCU-010；PER-009/010 | F-LAMP，首字节完成预约t=1048 | 独立两次运行：t=1048暖复位；t=1048将TX wire enabled设false | 复位先取消旧字节，终端仅有复位标记；断线例TX内部完成但终端不收B；不得先交付再撤回 | Blocker | Phase1 | 未执行 |
| T33 / CMP-009；PER-003 | F-LAMP，首LD在t=10退休 | t=10按下BTN1，在该指令后观察R1 | 输入先应用，LD读取退休时刻的GPIO0=1，R1.bit0=1；不能使用t=9取指时输入 | Blocker | Phase1 | 未执行 |
| T34 / MCU-006/008/011；PER-010 | 已入队字节；两副本分别执行HALT和非法指令进入FAULT | 暂停墙钟2秒再恢复；推进全局仿真至字节到期 | 暂停时全部冻结；CPU维持HALT/FAULT且单步不可用；继续推进时UART按原到期时间完成，恢复不重启CPU | Major | Phase1 | 未执行 |
| T35 / MCU-001/003/004/005/007/008 | 每个向量独立冷初始化，按下表装入状态和有效ROM | 执行V01—V18全部向量及其子向量 | 寄存器、PC、RAM、时间逐字段符合向量；18条指令都有正向行为断言，边界错误不部分提交 | Blocker | Phase1 | 未执行 |
| T36 / MCU-005/006 | 在合法ROM内放置测试指令 | JZ非零、JNZ零时仍编码目标0002；分别从0FFC执行HALT/NOP | 两个未采用分支仍F_TARGET且PC不变；末槽HALT退休后PC1000、停止；末槽NOP后下次取指F_FETCH | Blocker | Phase1 | 未执行 |
| T37 / MCU-002/006/014 | RAM2000=A5；已知ROM字节；独立副本 | LD/ST RAM，LD ROM；再ST ROM、写GPIO_IN、读TXDATA、访问4004及4200/4300/4400/4500/4600 | 合法读写逐字节正确；其余逐例F_ACCESS，故障PC/目标/外设不变；保留外设不能静默成功 | Blocker | Phase1 | 未执行 |
| T38 / MCU-007 | ROM从0依次WAIT n、NOP | n取0、65535；n=65536提交汇编；最大等待中暂停再恢复 | WAIT均t1退休；下一NOP分别t2/t65537退休；暂停不消耗等待；65536拒绝且旧ROM不变 | Blocker | Phase1 | 未执行 |
| T39 / PER-005/006/007/010 | RX已存00…0F，ERR初始0，另预置TX/RX各一在途字节 | 接收10；读STATUS两次；按T22制造TX_OVERFLOW后对ERR写1；分别关闭TX_EN/RX_EN再开启 | RX丢新10且旧16字节保留；STATUS不弹出；ERR由3写1后为2；禁用清对应FIFO、取消在途，ERR不清且不晚到 | Blocker | Phase1 | 未执行 |
| T40 / CMP-009/024；PER-006/007/008/010 | 四独立副本：TX满且有到期字节；RX满且有到期字节；有效RX到期；发往TERM1的TX到期且有下一排队字节 | 分别在同刻安排TXDATA的ST、RXDATA的LD、ST CTRL清RX_EN、ST CTRL清TX_EN退休 | TX先释放一槽后ST补到16无溢出；满RX先丢新置溢出后LD弹最旧余15；禁RX例先交付入队再被阶段四ST清空；禁TX例TERM1先收到本字节，ST随后取消后续字节，不能回滚已收到记录；对比阶段一外部reset仍按T32优先取消 | Blocker | Phase1 | 未执行 |
| T41 / CMP-003/004/018 | 位宽32，V=80000000、K=c0000000、D=f0000000，均带0x前缀 | 保存设计并载入；另将V改ffffffff而K/D不变 | 三mask字符串逐字保持；bit31=1、bit30=0、bit29/28=X、bit27…0=Z；非法V⊄K拒绝，不能变有符号负数 | Blocker | Phase0 | 未执行 |
| T42 / CMP-010 | 两NOT门与一个DFF反馈变体 | 构建NOT A→B→A；另构建含std.dff/1的反馈 | 纯组合环在激活前拒绝并给环路径；含状态边界的合法反馈可激活，不能依赖无限迭代侥幸稳定 | Blocker | Phase0 | 未执行 |
| T43 / CMP-016/020；MCU-013 | 有效锁定定义和core8/1固件 | 改定义内容而保留旧hash；另改ROM一字节但保留固件hash | 两次身份校验失败，拒绝导入并定位字段；旧工程及运行态不变；不能自动重算hash冒充原版本 | Blocker | Phase0（定义）/Phase1（固件） | 未执行 |
| T44 / CMP-019/020 | 有运行中工程与有效快照 | 分别替换快照engineVersion为未声明兼容值、工程hash或依赖锁为不匹配值 | 每例明确拒绝恢复；当前PC/RAM/队列/时间不变；不能部分恢复或降级成冷启动 | Blocker | Phase1 | 未执行 |

### 5.1 Core8 完整指令向量

本表是 T35 的子向量，全部待执行；不能因为列出期望就记为通过。除专门说明外，每个向量从 PC=0000、t=0 开始，测试指令在 t=1 退休，下一PC=0004；所有数字除时间外按十六进制表达。表内指令是测试记法，写入实际汇编源码时十六进制立即数和地址必须加 0x 前缀。同一格多组输入必须分别执行，未列出的寄存器保持原值。用于检查运行时非法编码的夹具由测试工具直接构造，不能绕过玩家侧导入验证。

| 向量 / opcode / 指令 | 初态或输入 | 可观察预期 / 通过条件 | 状态 |
|---|---|---|---|
| V01 / 00 / NOP | R0=A5 | R0仍A5、PC=0004、t=1 | 未执行 |
| V02 / 01 / LDI R0,FF | R0=00 | R0=FF | 未执行 |
| V03 / 02 / MOV R0,R1 | R0=00、R1=A5 | R0=A5，R1不变 | 未执行 |
| V04 / 03 / ADD | R0=FF、R1=01，执行ADD R0,R1；另R0=80执行ADD R0,R0 | 两例R0均00；自加读取同一旧值，不逐次覆盖操作数 | 未执行 |
| V05 / 04 / SUB R0,R1 | R0=00、R1=01 | R0=FF，无溢出fault | 未执行 |
| V06 / 05 / AND R0,R1 | R0=AA、R1=0F | R0=0A | 未执行 |
| V07 / 06 / OR R0,R1 | R0=A0、R1=0F | R0=AF | 未执行 |
| V08 / 07 / XOR R0,R1 | R0=AA、R1=FF | R0=55 | 未执行 |
| V09 / 08 / NOT R0 | R0=00 | R0=FF | 未执行 |
| V10 / 09 / SHL R0,n | 分别(81,0)、(01,7)、(81,8) | 依次81、80、F_ENCODING；错误例PC和R0不变 | 未执行 |
| V11 / 0A / SHR R0,n | 分别(81,0)、(80,7)、(80,8) | 依次81、01、F_ENCODING；右移补0且错误例不提交 | 未执行 |
| V12 / 0B / LD R0,2000 | RAM[2000]=A5 | R0=A5，RAM不变 | 未执行 |
| V13 / 0C / ST R0,2000 | R0=A5、RAM[2000]=00 | RAM[2000]=A5，R0不变 | 未执行 |
| V14 / 0D / JMP 0008 | ROM目标合法 | PC=0008 | 未执行 |
| V15 / 0E / JZ R0,0008 | R0分别00、01 | PC分别0008、0004 | 未执行 |
| V16 / 0F / JNZ R0,0008 | R0分别01、00 | PC分别0008、0004 | 未执行 |
| V17 / 10 / WAIT n | n分别0、65535（此格按十进制） | WAIT在t1退休；下一指令分别t2、t65537退休，外设照常运行 | 未执行 |
| V18 / 11 / HALT | 无其他CPU指令在途 | PC=0004后不再取指；UART继续规则另按T34验证 | 未执行 |

## 6 Phase2 扩展测试占位

以下是后续验收目标，须先有独立接口及时序合同，再定量执行；不据此声称当前支持，更不阻断 Phase1。

未来 RV32I 必须使用不同 coreKind 和字节码合同，禁止把 Core8 ROM 当 RV32I 程序执行。此项仅作 MCU-015 架构范围审查，不宣称 Phase1 已提供该核心。

| ID / 对应需求 | 前置 | 步骤 / 输入 | 可观察预期 / 通过条件 | 优先级 | 阶段 | 状态 |
|---|---|---|---|---|---|---|
| X01 / 待定PWM合同 | PWM扩展获批 | 频率1kHz，分别25%/75%，采集10周期 | 每周期1000 µs，高电平分别250/750 µs；不得以电流数值冒充灯亮度 | Major | Phase2 | 未执行 |
| X02 / 待定中断/消抖合同 | 消抖窗口10ms | 输入0/1抖动持续5ms后稳定按下20ms | 仅一次有效按下事件，延迟遵循获批窗口规则，不丢后续合法事件 | Major | Phase2 | 未执行 |
| X03 / 待定I²C合同 | 温度器件扩展获批 | 正确地址读取25℃；另用错误地址 | 正确返回合同编码；错误地址有明确NACK；须独立定义开漏解析 | Major | Phase2 | 未执行 |
| X04 / 待定SPI合同 | 显示器扩展获批 | 写已知图案，再使用错误模式 | 正确模式显示逐像素匹配；错误模式可检测，不无条件显示预期图案 | Major | Phase2 | 未执行 |

## 7 证据 内容库与后续共享

测试报告须记录规格/引擎/程序/依赖版本、夹具散列、种子、输入事件、仿真时间轨迹、实际与预期差异、执行人及日期。截图只能辅助说明，不能代替字节、事件或信号断言。Phase1 的数字时序以整数微秒比较，不能靠肉眼判断灯“差不多在闪”。

内容入库必须可直接上电、可编辑、附测试并携带固定依赖快照。复杂实例默认以模块展示，但允许逐层查看内部；教学提示与沙盒使用相同仿真模型。更新依赖需要显式选择及重新验收，旧项目不随内容库升级悄然改变。

联机协作为后期合同：一个共享运行会话只有一个权威仿真状态，各客户端提交操作并展示同一事件结果；版本、依赖及程序必须一致，不能每个客户端自行跑出不同世界。这里不定义网络实现，也不把多人联机列入前两阶段交付。

## 8 需求追溯矩阵

以下映射表示验收入口，不代表全断言覆盖或执行通过。T/V/X 指本文用例及子向量；ACC-CMP 指 01 的待执行验收索引；“范围审查”属于文档审查。全部状态仍为未执行，后续实施需给每个子向量建立独立结果记录。

| 元件需求 | 验收入口 | 元件需求 | 验收入口 |
|---|---|---|---|
| CMP-001 | 第1/6节范围审查 | CMP-013 | T12、T25 |
| CMP-002 | T03、T28；ACC-CMP-01 | CMP-014 | T24；ACC-CMP-06 |
| CMP-003 | T06、T41；ACC-CMP-02 | CMP-015 | T23、T34；ACC-CMP-10 |
| CMP-004 | T01、T41；ACC-CMP-02 | CMP-016 | T07、T30、T43 |
| CMP-005 | T01；ACC-CMP-03 | CMP-017 | T07；ACC-CMP-11 |
| CMP-006 | T04、T05、T19、T20 | CMP-018 | T26、T30、T41 |
| CMP-007 | T12、T17 | CMP-019 | T27、T44 |
| CMP-008 | T11、T23、T38；ACC-CMP-07 | CMP-020 | T08、T31、T43、T44 |
| CMP-009 | T03、T11、T32、T33、T40 | CMP-021 | T09；ACC-CMP-14 |
| CMP-010 | T10、T42 | CMP-022 | T06、T18、T43；ACC-CMP-13 |
| CMP-011 | T02、T03、T10 | CMP-023 | T18、T29；ACC-CMP-15 |
| CMP-012 | T02、T29；ACC-CMP-09 | CMP-024 | T06、T16、T22、T40 |

| MCU需求 | 验收入口 | 外设需求 | 验收入口 |
|---|---|---|---|
| MCU-001 | 第2.1节范围审查；T35 | PER-001 | T13、T19 |
| MCU-002 | T37；V12/13 | PER-002 | T13、T19；V13 |
| MCU-003 | T21、T31、T35；V01—18 | PER-003 | T18、T20、T33 |
| MCU-004 | T35；V04—11 | PER-004 | T04、T19 |
| MCU-005 | T31、T36；V14—16 | PER-005 | T06、T22、T39 |
| MCU-006 | T18、T21、T34、T36、T37 | PER-006 | T22、T39、T40 |
| MCU-007 | T14、T38；V17 | PER-007 | T22、T39、T40 |
| MCU-008 | T34、T36；V18 | PER-008 | T12、T16、T22、T23、T40 |
| MCU-009 | T12、T17、T25 | PER-009 | T16、T32 |
| MCU-010 | T24、T32 | PER-010 | T24、T25、T34、T39 |
| MCU-011 | T23、T34、T38 | — | — |
| MCU-012 | T28 | — | — |
| MCU-013 | T21、T31、T43 | — | — |
| MCU-014 | T21、T37；第6节范围审查 | — | — |
| MCU-015 | 第6节未来核心身份范围审查 | — | — |
