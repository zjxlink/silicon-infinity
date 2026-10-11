# 可编程系统外设

GPIO16、Timer16 和 DMA 配置器都使用 16 位字地址总线。主机先保持 REQ=0 一拍，再锁定 REQ/WE/ADDRESS/WDATA，等待 READY；ERROR 仅在 READY 时有效。受理同一请求一次，应答保持期间禁止改请求。应答采样那一拍地址断开也会立即报错，CPU 不能读取旧成功结果。

| 型号 | 字偏移与定义 |
|---|---|
| `std.bus-gpio16/1` | 0 OUTPUT RW；1 INPUT RO（实际 16 位数字输入，X/Z 错误）；2 IRQ_ENABLE bit0；3 STATUS bit0 输入变化，W1C。 |
| `std.bus-timer16/1` | 0 PERIOD 1—65535 微秒，写入清 COUNT；1 COUNT 小于 PERIOD；2 CONTROL bit0 启用、bit1 周期；3 STATUS bit0 到期 W1C；4 IRQ_ENABLE bit0。单次到期撤启用。 |
| `std.bus-dma-control16/1` | 0 SOURCE、1 DESTINATION、2 COUNT；3 COMMAND 写1输出一拍 trigger；4 STATUS RO bit0忙、bit1完成、bit2错误；5 COMPLETED 实际外置 DMA 完成字数。 |

GPIO 首个已知输入建立基线，后续已知值变化置状态；状态清除和新变化同拍发生时，新事件优先。定时器到期与清除同拍也以新到期为准。暂停仿真冻结计时；暂停应用采集不冻结定时器。

DMA 配置器只是控制外置 DMA 的独立芯片，不能直接修改 RAM。忙时配置写入拒绝，完成与故障从实际 DMA 输入取得。未知完成反馈不会被当成成功。开始后等待至少两拍，避免误收上一次完成电平。

三个模型冷复位、暖复位与 reset=1 均清控制状态，恢复参数默认值；reset=X/Z 屏蔽输出并记录故障。故障保留到复位，合法后续请求仍可以重新受理。完整状态包含在快照里，非法或超范围状态拒绝导入。完整端口提示和寄存器表也收录在芯片手册中。
