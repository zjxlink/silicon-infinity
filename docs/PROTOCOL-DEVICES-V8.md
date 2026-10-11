# v0.8 异步协议适配器与可编辑设备

本模块增加 5 个模型。CPU16 的总线访问在短握手内结束；协议传输独立运行，CPU 可以访问 RAM、计算或等待中断。设备数据必须经实际协议导线传输，断线、复位、地址或权限错误不会成为成功结果。

实现：`game/protocol-devices-v8.js`。CommonJS 与浏览器全局 `ProtocolDevicesV8` 使用同一份代码。未修改旧 Core8、Build8、SPI 字节事务或数字 FSM 的定义。

## 模型与实际示例

| 模型 ID | 用途 | 协议端口 |
| --- | --- | --- |
| `std.mmio-uart16/1` | 独立发送与接收 FIFO | UART_TX / UART_RX，`uart-txn/1` |
| `std.mmio-spi16/1` | 16 位寄存器地址的 SPI 主端 | SPI_OUT，`spi-register/2` |
| `std.mmio-i2c16/1` | 7 位设备地址与 16 位寄存器地址 | I2C_OUT，`i2c-register/2` |
| `std.protocol-registers/2` | 可编辑传感/配置寄存器 | SPI_RX、I2C_RX；sense 数字输入 8 位 |
| `std.protocol-memory/2` | 可写、可只读、可非易失的字节存储 | SPI_RX、I2C_RX |

`build('uart' | 'spi' | 'i2c')` 返回合法 workspace，包含 CPU16、真实数字总线译码器、RAM、适配器与终端/从设备。源码保存在 `sources['architecture:cpu']`。UART 示例发送字节 86；SPI/I²C 示例写 90、读回，再经数字总线存到 RAM[0]。R7 在协议 BUSY 期间递增，显示 CPU 已收回总线。

`SAMPLES` 提供这三个示例的 ID、名称、说明。完整新版自定义 CPU 应用板由集成模块另行提供；此模块示例也保留既有 CPU16 的兼容性验证。

## CPU 总线与 MMIO

适配器输入 `req/we/address16/wdata16/reset`，输出 `rdata16/ready/error/irq/fault`。地址是译码后的字偏移。上电或复位后必须先看到一拍 req=0 才重新武装；req=1 锁定一次访问，ready 保持直到请求降低，不会反复发帧、读清或弹出 RX。等待响应时修改请求会报错，不执行第二次操作。

一次 CMD 写被受理后即可回应，串行耗时不延长这个总线事务。后续数字总线故障不会撤销已经合法受理的独立协议命令；取消需要禁用控制器、复位或断电。

| 字偏移 | 寄存器 | 语义 |
| --- | --- | --- |
| 0 | CTRL | EN=1；仅 UART 支持 RX_EN=2。关闭 EN 取消当前发送，关闭 RX_EN 清 FIFO 并使旧接收资格失效。 |
| 1 | STATUS | BUSY=1、DONE=2、ERROR=4、RX_READY=8。仅写 2 清 DONE；写其他位非法。 |
| 2 | TX | 0—255 待发字节，写入不会启动传输。 |
| 3 | RX | 读弹出一字节，FIFO 容量 16；空读返回总线错误。 |
| 4 | TARGET | 仅 I²C，7 位设备地址。 |
| 5 | ADDRESS | 仅 SPI/I²C，16 位设备寄存器/字节地址。 |
| 6 | CMD | 仅写；1=UART 发送或 SPI/I²C 写，2=SPI/I²C 读。 |
| 7 | ERROR | 错误位图，写 1 清除对应位。 |
| 8 | IRQ_MASK | 只接受 2、4、8：对应 DONE、ERROR、RX_READY。 |
| 9 | COUNT | 成功发送/事务完成数低 16 位，只读。UART 接收有独立观察计数。 |
| 10 | MODE | 仅 SPI，0—3。 |

未使用偏移、保留位、权限错误和越界数据返回 `ready=1,error=1`。禁用或 BUSY 时再次提交 CMD 也拒绝，并保留原事务。成功提交 CMD 清 DONE，但不清已有 ERROR；异步失败置 ERROR、不置 DONE。FIFO 溢出丢新保旧；若一次有副作用的从端读取已经完成，其读清行为不会因为主端 FIFO 满而倒退。

ERROR：DISABLED=1、BUSY=2、EMPTY=4、DISCONNECTED=8、NACK=16、ACCESS=32、ADDRESS=64、OVERFLOW=128、UNKNOWN=256、MODE=512、DEVICE_BUSY=1024。IRQ 是 `STATUS & IRQ_MASK` 的电平结果；仅确认 CPU 中断不会清设备状态。

## 协议时间与兼容性

- UART：兼容既有 `uart-txn/1`，9600 8N1，每字节精确 1042 µs，可接现有终端、旧 UART 或自身回环。
- 新 SPI：`spi-register/2`，请求 `{address,read,value,mode}`。模型为 1 MHz、8 位命令 + 16 位地址 + 8 位数据，共 32 µs。
- 新 I²C：`i2c-register/2`，请求 `{address,read,value,target}`。100 kHz；写含 36 个数据/ACK 时钟为 360 µs，读含 45 个为 450 µs；不额外叠加起止时间。

上述 SPI/I²C 为明确的寄存器事务抽象，不生成 SCK/MOSI/SDA 的边沿或开漏电气波形，不提供多主争用、片选扇出、时钟伸展或块传输。新 SPI/I²C 协议不能静默接到旧 `spi-txn/1` / `i2c-txn/1` 端口。

全部预约使用 BigInt 微秒及十进制字符串保存。外部断线/复位先于同刻完成；有效完成先于该拍 CPU 和硬件采样。因而在同拍通过 MMIO 关闭 RX，已完成的字节先入队、随后 FIFO 清空；这与外部 reset 输入在完成前阻止接收有区别。

连接 token 锁定路径和每条线的版本，同时锁定接收实例 generation 与 provider epoch。断开再接回仍使旧帧失效。失电、暖复位、reset 高/未知和 UART 禁用接收都不会让旧数据后来补发。

## 可编辑设备合同

寄存器设备只有 `deviceJSON` 参数，最多 60000 字符，结构如下：

```json
{
  "identity": "温度与配置设备",
  "i2cAddress": 72,
  "spiMode": 0,
  "writeBusyUs": 0,
  "registers": [
    {"address": 0, "name": "ID", "access": "ro", "reset": 161},
    {"address": 1, "name": "TEMP", "access": "ro", "reset": 0, "source": "sense"},
    {"address": 2, "name": "CONFIG", "access": "rw", "reset": 0,
     "fields": [{"name": "ENABLE", "lsb": 0, "width": 1}]}
  ]
}
```

地址唯一、范围 0—65535；1—256 个寄存器，每个 8 位。访问类型支持 rw、ro、w1c、rc。`source:"sense"` 仅用于只读寄存器，读取在协议完成当拍采样真实 8 位输入；X/Z 报 UNKNOWN，保留数据。位字段给位区间命名，继承整个寄存器权限；不支持暗含的独立位副作用，重叠与越界会拒绝。

identity 是描述，不会隐式占用地址。需要数值身份时显式增加只读 ID 寄存器。写成功后以 `writeBusyUs` 设置忙期；忙期内的新访问报 DEVICE_BUSY。操作只在有效协议完成时发生；read-clear 返回旧值后清零，write-one-clear 只清写入为 1 的位。

存储参数：identity（≤80 字）、i2cAddress（0—127）、spiMode（0—3）、depth（1—4096）、readOnly/nonvolatile（0/1）、writeBusyUs（0—65535）、contents（每项 0—255，长度≤depth）。写后忙表示数据已经提交之后的忙期，不是另一个悬而未决的写操作。

暖复位保留已写 memory。nonvolatile=1 时冷复位和断电/上电也保留；nonvolatile=0 的冷复位和电源转换恢复 contents。新实例始终从 contents 开始，设计变更应用会创建新运行实例。保存当前已写数据需要完整现场/快照，单独导出设计不会伪装成运行数据备份。任何复位都取消在途与设备忙，不复活旧请求。

## 集成 API

标准 provider 方法：`models/list/supported/defaultParameters/validateParameters/fresh/reset/output/sample/validateState`。

附加路由钩子：

```text
flush(id, params, state, time, io)
complete(id, params, state, time, io)
rxEligible(id, params, state) -> boolean
rxToken(id, params, state) -> {epoch: decimalString}
receive(id, params, state, byte, providerToken, time, io) -> boolean
completeTransaction(id, params, state, protocol, request, providerToken, time, io)
  -> {ok, value, error?}
powerTransition(id, params, previousState, powered, signalApi) -> state
```

`io` 提供既有 startTx/completeTx/startProtocol/completeProtocol，以及 `read(name)`、`api` 供同拍数字输入检查。协议副作用只能在根调度器已核验完整路由后调用完成钩子。`active={request,start,done,token}`，根负责快照时间与路由合法性，本模块严格检查内部 state、锁定请求、FIFO、历史、容量和数字范围。

`contract` 为机器可读的参数、MMIO、错误和时间合同；`describe` 返回当前参数合同。`manuals={entries,portHints}` 覆盖 5 模型及全部端口；`manualFor(id,params)` 使用实际寄存器参数生成动态条目，与编辑器使用同一 validator。程序示例和 build 共用 `exampleSource`，不会维护两份相互漂移的代码。

## 实际验收

运行 `node --test tests/protocol-devices-v8.test.cjs`：**32 项通过，0 失败**。

覆盖真实 Runtime 的三链路、CPU BUSY 期间计算、一次受理、锁定地址、错误访问、IRQ、读清/W1C、FIFO 溢出、自回环、旧 UART 接新 RX、精确完成拍断线/reset、接收禁用代次、传感 X/Z、写忙与只读、双运行实例隔离、非易失电源循环、暂停、三种在途快照恢复、恶意快照拒绝，以及超出 Number 安全整数的精确微秒向量。示例实测 RAM[0]=90，UART 收到 86。

这里的 32 项是协议内核验收，不包含独立 UI 操作、生产网站部署或真实第二账号协作验收；这些由本轮集成交付另行记录。
