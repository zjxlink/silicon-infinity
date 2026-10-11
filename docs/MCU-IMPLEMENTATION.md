# 教学 Core8 实现说明

实现依据：冻结规格 `02-mcu-behavior.md` v0.1.0。它是教学功能模型，不兼容 ARM/RISC-V，也不进行模拟电压、电流计算。

`dist/core8.js` 无依赖，浏览器导出 `window.Core8`，Node 导出同一 CommonJS 对象。包含全部18条指令、严格汇编器、4 KiB ROM、1 KiB RAM、GPIO、事务级 UART 和运行快照。不会执行固件中的 JavaScript。

## 调度接口

- `Core8.assemble(source)` 同步返回 `{ok,bytes,sourceMap,error,line}`。`bytes` 为未填充的 `Uint8Array`，哈希及项目固件记录由工程层负责。
- `new Core8.CPU(bytes,{id,powered:false,time:0n})` 创建独立实例。省略 powered 时不供电。
- `setPowered(enabled,time)` 控制冷启动/断电；`reset('cold'|'warm',time)` 复位。时间使用 BigInt，接口也接受精确安全整数或规范十进制字符串。
- `nextTime()` 返回实例下一个取指开始、指令退休或 TX 完成事件时刻；没有事件时返回 null。
- 每个全局时刻先处理外部控制与输入，再对所有实例执行 `complete(time,io)`；稳定数字网络后，先对所有 CPU `sample(time,gpioBits)`，再对全部意图 `commit(intent)`；最后对所有实例 `flush(time,io)`，再稳定和观察。
- `gpioBits` 是低位在索引0的8位数组，元素为0/1/X/Z；`gpioDrives()` 返回该CPU的强驱动视图，PD弱下拉由电路解析器处理。
- `flush` 在全部提交后预约下一次取指并启动新UART字节。因此对端同刻修改RX_EN不会因CPU实例遍历顺序不同而改变发送资格。
- `retire(time,gpioBits)` 是单CPU测试便利方法；多人/多实例共享调度应使用分开的 sample/commit。

WAIT退休后设置绝对唤醒时间，唤醒时只开始下一条指令，下一微秒才退休。暂停属于全局调度器：暂停期间不推进时间、不调用事件处理。HALT与FAULT只停止CPU，UART继续排空。

## UART路由

`io.startTx(byte,time,cpu)` 在发送开始捕获连接状态，返回JSON可序列化token；token不能包含BigInt。`io.completeTx(byte,token,time,cpu)` 在1042微秒后处理交付，返回true表示确实送达。即使没有路由或对端断线，CPU发送仍按时完成。

接收CPU的 `rxToken()` 返回接收代次或null；开始时记录，完成时调用 `receive(byte,time,token)`。旧代次、禁用接收、断电都拒绝旧字节。电路层还须验证连接版本，并负责终端队列和一次性传输时延；接收CPU不额外等待1042微秒。

## 快照与观察

`exportState()` 生成可JSON序列化的快照，全部BigInt转十进制字符串；`importState(snapshot)` 在同ID、同固件的CPU中验证后原子恢复。快照必须取自全部阶段完成之后。工程依赖哈希、全局时间、连线版本和外部队列由电路层的快照保存。

`history` 和 `trace` 各保留最近256项；`historyDropped` / `traceDropped` 标明已截断条数。历史不是UART FIFO，复位保留历史并添加标记。`fault`、`lastBus`、寄存器、PC、DIR/OUT/PD和两个FIFO可供调试界面观察。

## 验证

执行 `node tests/core8.test.cjs`。测试覆盖全部18条指令及错误编码、原子错误、ROM/RAM访问、WAIT边界、超安全整数时间、GPIO未知、UART容量与时序、冷暖复位、接收代次、共享快照采样和快照恢复。

规范智能灯的96字节程序实测首次LED变化在16微秒、第二次在60025微秒；启动B在1048微秒送达。按键经过程序读取后输出P/R，修改WAIT会改变输出时间。此测试不替代电路层的实际接线、供电域和端到端界面验收。
