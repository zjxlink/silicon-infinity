# 完整控制板封装与外设路由

版本 0.2.0 · 2026-10-10。实现：[circuit.js](../dist/circuit.js)。本文说明已实现的接口和实际验证范围；冻结的 v0.1 元件、MCU 规格没有被改写。

## 交付范围

完整控制板可以把内部 MCU、固件、电源正端和地端、多个供电域、UART 终端以及数字电路一起封装。模块可以重复放置、继续嵌套、保存为工程、从 JSON 导入，并恢复进行到一半的仿真。各实例拥有独立 CPU、RAM、外设寄存器、终端队列和供电状态。

纯数字 `encapsulate` 入口继续兼容。新的 `packageModule` 同时支持纯数字和完整控制板；完整板不能只拿一个 composite definition 就声称依赖齐全，必须携带模块包中的固件、依赖定义和供电域。

此外注册了 `core8/2`、`std.spi-register/1` 和 `std.i2c-temperature/1`。Core8/2 的 CPU、定时器、PWM、中断与寄存器合同见 [MCU-V2.md](MCU-V2.md)；本文件负责它们如何通过真实工程连线相互作用。旧 `core8/1` 的指令和寄存器行为保持不变。

## 兼容性和加载顺序

浏览器依次加载 `core8.js`、`core8plus.js`、`circuit.js`，导出全局 `CircuitLab`；Node 可直接 `require('../dist/circuit.js')`，内核按实例模型选择 CPU 模块。

`CircuitLab.VERSION` 为 `0.2.0`。已有工程仍使用 `chip-game.project/0.1.0` 与 `profile: 'p0-p1'`，原有模型和依赖锁不自动升级。扩展能力由锁定的模型 ID 区分。空工程仍含原来的 13 个定义；第一次创建新模型时 `createInstance` 自动加入其注册定义及锁。`core8/2` 的标准身份为 stableId `core8`、revision `2`，因此能与 revision `1` 共存。

新版本读取旧工程和兼容的旧运行快照；旧软件遇到新注册模型应拒绝，不应代换成旧 CPU。设计导入创建冷启动状态。运行快照另行保存和恢复，二者没有混用。

## 封装 API

```js
const pkg = await CircuitLab.packageModule(
  project, '智能灯控制板', 'user.smart-lamp',
  { revision: 1, sourceMap: { program: assemblySource } }
);
const placed = await CircuitLab.placeModule(
  hostProject, pkg, 'lampA', '灯板 A', { exposePorts: true }
);
```

`packageModule(project, name, stableId?, options?)` 先完整校验工程，返回普通数据对象，不修改源工程。`stableId` 默认 `user.board`；revision 默认为 1，必须为正安全整数。`sourceMap` 可省略，键是工程固件 ID，值是供编辑器使用的源码文本。执行始终以经过 hash 校验的固件字节为准，源码映射不参与 CPU 执行。

包 schema 为 `chip-game.module-package/0.2.0`，字段如下：

| 字段 | 内容 |
|---|---|
| name | 包显示名 |
| definition | 顶层不可变 composite 定义，含完整边界与内部电路 |
| definitions | 顶层使用的传递依赖；**不包含顶层 definition** |
| firmware | 实际被使用的固件记录，含 targetModel 和内容 hash |
| powerDomains | 原工程供电域与 initialPowered |
| initialInputs | 原工程数字输入的初始四态值 |
| sourceMap | 可选源码按固件 ID 对照；无源码时为空对象 |
| contentHash | 对除自身外整个包的规范 JSON 计算 SHA-256 |

`importModulePackage(objectOrJSON)` 验证数据格式、包 hash、每个定义 hash、完整依赖闭包、固件目标、供电域、资源预算和电路行为合同，失败抛 `CircuitError`。不存在“先放入半个包、再补依赖”的中间成功状态。

`placeModule(project, pkg, id, label?, options?)` 在独立候选工程中完成移植，最终整体校验成功后才更新调用者工程。失败时调用者工程保持原样。此操作不直接修改已有 Runtime；界面应把候选设计应用为一次冷启动。

返回值：

| 字段 | 用途 |
|---|---|
| instance, definition | 实际放置的实例与顶层定义 |
| controlDomain | 新模块整体供电开关域，初始开启 |
| domainMap | 原包域 ID → 该次放置的独立域 ID |
| firmwareMap | 原固件 ID → 该次放置的独立固件 ID |
| sourceMap | 已重映射到新固件 ID 的源码，可并入编辑器草稿 |
| boundaryMap | 原数字边界 ID → 自动建立的工程边界 ID |
| definitionMap | 原 stableId@revision → 放置后锁定身份 |

默认 `exposePorts: true` 为数字端口建立工程输入/输出及导线，保留输入初值。`false` 仅放置模块，调用方自行连线。协议端口保留在模块接口上，不自动生成顶层控制器；使用 `ep(moduleId, portId)` 接到另一元件。例如主控 SPI 输出可以连接独立封装存储芯片的协议输入，UART 输出可以连接外部终端。

供电使用布尔域。完整板内已有 VCC/GND 和电源域一并移植；每个原域保持各自初值，额外的整体开关不取代内部域。原包中一个关闭的无关电源域不会把其他已供电部分错误关掉。本版 UI 面向自带供电的完整板；公共电源口没有额外的外部域协商接口。

## 依赖、版本和实例隔离

工程 v0.1 把固件和供电域 ID 写在实例 bindings 中。为了不改变旧 schema，移植时为每次放置重命名域、固件和结构定义，并逐层重算内容 hash。相同的基础元件定义可以共用；含绑定的 composite 定义按放置实例分开。运行状态仍按展开路径隔离，绝不存入共享定义。

不要直接修改已被工程锁定的 definition。产生新版可重新调用 `packageModule(..., {revision: 2})`。如果只修改一个独立包的顶层显示名或 revision，先重算 `definition.contentHash = hashDefinition(definition)`，再重算 `pkg.contentHash = hashPackage(pkg)`，最后重新导入校验。改变依赖定义时还要更新所有引用它的身份以及上层 hash；重新从编辑后的工程封装更可靠。放置新版不会改写已放置旧版的固件、锁或运行行为。

包装不会绕开原资源上限：128 个定义、1000 个编写/展开节点、4000 条编写/展开导线、16 层定义深度，以及每次推进 200 万事件预算。重复放置产生的私有结构定义也计入预算。超限是显式错误，不截断电路。

## 新模型及运行接口

| 模型 | 新增端口或状态 |
|---|---|
| core8/2 | 保留旧 GPIO、VCC/GND、UART；新增 PWM_OUT（digital out，1 bit）、SPI_OUT（spi-txn/1 out）、I2C_OUT（i2c-txn/1 out） |
| std.spi-register/1 | RX（spi-txn/1 in）；16 个 8 位寄存器与待续命令游标 |
| std.i2c-temperature/1 | RX（i2c-txn/1 in）；温度、只读身份和一个可写 scratch 字节 |

SPI/I²C 是功能级事务连线。不同协议、数字端口与协议端口、多个驱动或广播接收会在设计校验时拒绝。连接存在不等于事务成功：运行时还检查供电、启用状态、协议参数以及开始时锁定的整条路径版本。

```js
await CircuitLab.addFirmware(project, 'program', bytes, 'core8/2');
CircuitLab.createInstance(project, 'core8/2', 'mcu', '控制器', {
  firmware: 'program'
});
runtime.setSensorTemperature('board/sensor', 42); // 下一虚拟微秒生效
runtime.setConnection('board/i2cWire', false);   // 保留拓扑，递增连接版本
runtime.reset('warm', 'board');                 // 递归复位此实例子树
```

`setSensorTemperature(path, temperature, time?)` 是独立环境事件，允许 0—125 的整数。温度在事务完成时采样；同刻环境事件先于完成处理。SPI/I²C 芯片采用绑定域隐式供电，冷/暖复位和断电恢复初始状态；温度恢复 25，scratch 和 SPI 寄存器清零。

`inspect().instances[path]` 提供 `modelId`、`label`、已解析 `bindings`，以及 CPU 或设备状态。CPU 扩展状态位于 `.plus`，设备状态位于 `.device`；两者也保留在 `.state` 中。`.bindings.firmware` 指向真正执行的固件 ID，便于观察嵌套 CPU。终端记录仍为 `inspect().terminals[path].history.entries`，收到字节含 `kind:'byte'`、十进制微秒 `time`、`sourceInstance` 和 `byte`。协议成功或失败记录在 Runtime history，含协议、来源、接收端、结果和时间。

## SPI、I²C 和调度合同

SPI 芯片只支持 mode 0。第一字节 `0x00|reg` 选写、`0x80|reg` 选读，reg 为 0—15，bits4—6 必须为 0；第二字节写入数据并返回该值，或忽略 dummy 读回寄存器。每字节独立耗时 8 µs，完成后才修改从端，第二字节完成清游标。错误 mode 或命令产生明确错误。已经成功完成的第一字节不会因仅复位 MCU 而回滚；需要清整个两字节帧时复位整板或从芯片。

I²C 芯片地址 0x48：reg0 为只读温度；reg1 为只读 ID 0xA1；reg2 为 scratch 字节读写。每个寄存器事务耗时 100 µs。错地址、错寄存器或写只读值返回 NACK，状态保持。没有将 UI 温度文本直接当作 CPU 读回值的快捷路径。

一次时间戳的顺序为：外部输入/供电/复位/连接事件 → 到期 UART/定时器/PWM/SPI/I²C 事件 → 稳定数字网络 → 所有 CPU/DFF 共同采样 → 全部提交 → 后续取指和事务启动 → 稳定与观察。所有 CPU 的完成阶段都会调用，不能只在 UART 有事务时调度 Core8/2。CPU 内部完成顺序沿用 MCU-V2 合同。

事务开始锁定来源、接收端、接收代次和路径中每条线的版本。断线再接回也使旧事务失效。从端复位或失电使旧资格失效；主机禁用、复位或断电取消自身在途事务。旧事务不能在后来无条件写入从端。暂停冻结全部虚拟时间，HALT/FAULT 只停止指令，已经运行的外设仍继续。

## 保存、快照与验收

Runtime 快照仍使用 `chip-game.snapshot/0.1.0`，engineVersion 为 0.2.0；其中 Core8/2 的嵌套 CPU 快照使用 `core8.snapshot/2`。快照保存电源域、运行连线开关/版本、CPU/外设、SPI 待续命令、温度事件、在途事务、定时器/PWM 相位和终端历史。`Runtime.fromSnapshot(project, objectOrJSON)` 校验匹配的工程 hash 与锁后恢复；无匹配工程不能猜测绑定。

设备快照检查寄存器范围、游标、温度和规范计数。活动路由校验来源、协议端口、连续导线路径、合法历史版本、接收代次及事件序号。合法但已因断线失效的 token 仍可恢复，并在原完成时刻得到失败；不会通过恢复重新获取投递资格。损坏快照抛 `E_SNAPSHOT_INCOMPATIBLE`，不影响现有 Runtime。

实际运行 [packaging-v2.test.cjs](../tests/packaging-v2.test.cjs)，**23 组通过**。测试包括：

- T29 智能灯完整板封装前后，在 t=16/1048/60025/200011/400100 µs 比较 GPIO、CPU 寄存器/PC 和真实 UART B/P/R。
- 双板独立输入、RAM、供电、针对性复位；多电源初值；二层封装、JSON 导入、在途 UART 快照；新旧固件时序独立；篡改包原子拒绝。
- SPI 实际完成时刻 15/26/37/48 µs、存储 90 并回读；断线重连、同刻复位、失电、mode 错误和主机禁用不产生未完成写入。
- I²C 100 µs 完成、独立温度事件、scratch 写入、NACK 和同刻取消；PWM 接线波形、HALT 后运行、暂停冻结；定时中断真实执行并改变 RAM/GPIO。
- 扩展外设在途快照、PWM 相位、IRQ 现场、嵌套双测温板；分别封装的主控和从芯片经公共协议端口通信；伪造路由与设备状态快照拒绝。

这些是运行内核及工程接口测试，不代替浏览器按钮、移动端布局、发布地址的验收，也不表示 v0.1 规格的所有测试已经通过。完整板 T29 的原 v0.1 限制已由新模块包路径补齐；旧纯数字封装入口保持原职责。

本版不模拟真实电压、电流、晶体管、SPI 时钟边沿、I²C 开漏/上拉/多主仲裁。环境温度是显式离散输入；定时器中断已实现，GPIO 中断及按键消抖未加入。模块供电、事务耗时和错误必须按本文理解，不能宣称对应真实制造器件的电气合规。
