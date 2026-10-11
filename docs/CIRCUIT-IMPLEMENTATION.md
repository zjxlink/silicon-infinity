# CircuitLab 首版内核实现记录

版本：0.1.0。本文记录真实实现、公开 API、已执行测试及范围差异；不是对冻结规格的全部验收通过声明。

## 文件与运行方式

- `dist/circuit.js`：无外部依赖的浏览器 `CircuitLab` 全局对象 / CommonJS 导出。
- `dist/core8.js`：由独立模块提供的 Core8，浏览器需在 circuit.js 前载入。只有工程包含 MCU 时 Runtime 才需要它。
- `tests/circuit.test.cjs`：29 组电路内核测试。
- `tests/integration.test.cjs`：独立代理编写的22组实际板级集成测试。

本轮执行 `node --test work/silicon-infinity/tests/circuit.test.cjs work/silicon-infinity/tests/core8.test.cjs work/silicon-infinity/tests/integration.test.cjs work/silicon-infinity/tests/lessons.test.cjs`，29组电路、28组Core8、22组集成、9组教学关卡测试全部通过。测试覆盖真实数据与运行行为，不包括浏览器布局或交互验收。冻结规格中的全部断言仍需独立追踪，不能以测试组数替代覆盖率。

## 数据与校验

工程使用 `chip-game.project/0.1.0` 与 `p0-p1` profile，保存 canonical definitions/locks/firmware/powerDomains/circuit/initialInputs。模型注册表恰有13项：9个逻辑/DFF模型、VCC、GND、Core8、串口终端。模型签名、依赖、供电及复位合同不可被导入数据伪造。

数字信号支持1—32位，value/knownMask/driveMask以规范十六进制字符串保存，运算使用BigInt。驱动冲突按位解析；多个强驱动即使同值也产生X。Z不会自动当0，弱下拉必须明确存在。输出网络可观察Z，逻辑接收时把Z解释为X。

导入在副本上验证，失败不改变原工程或运行态。JSON解析器在通用对象构造覆盖前拒绝重复键和原型污染字段。未知字段、模型、非法参数、身份hash、固件hash、依赖锁、端口类型/方向/位宽、组合环、模块循环和资源上限都受检查。定义hash按冻结规范计算；独立Node crypto交叉验证及冻结NOT例的原hash验证已通过。未实例化的composite也进行结构、组合环、状态边界及依赖声明检查。

公开限制 `CircuitLab.LIMITS`：authored和展开有效原语分别最多1000个，导线4000条，定义128个，定义深度16层；另外最多100000个展开结构容器，避免空结构定义的指数级展开耗尽内存。单次advance最多处理200万个预约时刻，超过明确报错，时间不近似或回绕；调用方可分批推进。这是操作资源保护，不是虚拟时间位宽限制。

## 主要 API

```js
const p = await CircuitLab.createProject('我的电路');
CircuitLab.addInput(p, 'a', '输入', 0, 1);
CircuitLab.addOutput(p, 'y', '输出', 1);
CircuitLab.createInstance(p, 'std.not/1', 'inv', '非门');
CircuitLab.addWire(p, 'in', CircuitLab.boundary('a'), CircuitLab.ep('inv','in'));
CircuitLab.addWire(p, 'out', CircuitLab.ep('inv','out'), CircuitLab.boundary('y'));
const candidate = await CircuitLab.importProject(p); // throws CircuitError on failure
const runtime = new CircuitLab.Runtime(candidate);    // cold start, t=0, already settled
runtime.setInput('a', 1);                             // queued at t+1
runtime.advance(1n);
console.log(runtime.getPort(CircuitLab.boundary('y')));
```

- `createProject(name)`：异步返回含13个标准定义和锁的空工程；main域初始上电。
- `createInstance(p, modelIdOrStableId, id, label?, bindings?)`：加入并返回实例；自动填写标准clock/reset，MCU的firmware必须由调用方提供。
- `addInput(p,id,name?,value=0,width=1)`、`addOutput(p,id,name?,width=1)`、`addWire(p,id,from,to,pull?)`：编辑候选数据。
- `addFirmware(p,id,hexOrBytes)`：异步加入原始字节hash的`core8/1`固件record。
- `validate(p)`：异步返回`{ok,errors}`；`importProject(jsonOrObject)`：异步返回通过完整校验的独立候选副本或抛错。
- `signal(value,width=1)`：把整数、X、Z或canonical vector变成向量；`bits(v)`低位在前；`scalar(v)`返回第0位。
- `canonicalStringify`、`hashBytes`、`hashDefinition`、`identity`：同步数据/身份辅助函数。
- `catalog` / `definitionsCatalog`：注册模型签名；`standardDefinition(modelId)`产生对应完整定义。

Runtime实例提供：

- `setInput(id,value,time?)`、`setPower(domain,bool,time?)`、`setConnection(wirePath,bool,time?)`、`injectTerminal(path,byte,time?)`均排队；省略time即当前时间+1µs，不直接改已观察状态。
- `reset('warm'|'cold', target='all', time?)`排入指定实例子树或全部实例复位。暖复位保留MCU RAM；重新载入工程必须新建Runtime，不能把reset当快照恢复。
- `advance(deltaBigInt,{force:false})`同步按事件推进；暂停时不推进，`force:true`是受控单步/验证的明确覆盖。
- `pause()` / `resume()`、`stepTick()`、`stepInstruction(mcuPath)`。后两者完成后保持暂停；指令单步期间其他实例仍共享同一时间轴。
- `getPort(canonicalEndpoint)`返回真实解析值；通常也可用`instance.port`、`$.boundaryId`或边界ID。合法ID可含点号，因此出现别名歧义时须用canonical endpoint；内部以不允许出现在ID中的冒号分隔，避免串名冲突。
- `inspect()`返回`{time,paused,ports,instances,terminals,connections,domains,issues,history}`。time为十进制字符串，MCU实例展开其exportState，同时可从`.state`读取；终端为`history.entries`与`truncatedCount`。ports为兼容UI包含点号别名和冒号精确键，遍历显示时应按定义端口去重。
- `snapshot()`返回运行快照；`Runtime.fromSnapshot(project,snapshot)`同步校验并恢复，失败抛`E_SNAPSHOT_INCOMPATIBLE`，不会部分替换调用方现有运行态。

## 调度与通信

同时间戳依次处理外部事件、内部UART完成、组合稳定、所有CPU/DFF共享快照采样、统一提交、后续预约、再次稳定和观察。按定义端口的实际组合依赖进行拓扑求解，不用任意迭代次数伪造稳定。DFF共用global.1us，MCU按nextTime跳跃，因此等待60000µs不会执行60000次空CPU循环。

UART按实际工程连线查找接收器，只允许兼容的一对一协议端口。开始事务记录发送/接收代次、RX资格及沿途wire版本；1042µs后重新核对。断线再接回也不能恢复旧交付。一个完整事务只有一次1042µs延时，MCU互连及自身回环均不会重复加时。发送方完成不等于终端收到。终端输入经外部事件队列进入16字节发送队列，暂停不发送，未上电拒绝，满队列报告错误。

现有wire enabled开关不删除工程拓扑，每次实际改变递增version。切断VCC/GND实际停止MCU，接回按冷启动恢复。新增、删除或改接线以及修改固件应由UI建立候选、验证后显式替换为新Runtime。快照保存wire enabled/version、队列、CPU及终端在途事务与剩余时刻，恢复不额外生成通信事件。

## 首版范围差异

1. `encapsulate(project,name,stableId?)`目前提供纯数字电路封装，包含DFF及其独立状态，返回不可变身份的composite定义。其依赖定义与锁需要随工程/库一起保存。MCU固件、显式供电或协议端口的整板自动打包会明确拒绝，整板可保存、导入、复用为工程模板；没有假装完成完整MCU芯片库封装。
2. 冻结03中的T29要求完整参考MCU板封装前后轨迹一致，优先级为Major，不是Blocker。本轮纯逻辑封装测试不能替代T29；T29仍未满足。一般composite展开机制能够运行合法手工描述的MCU层级，但首版UI/封装API尚未提供固件与供电依赖的完整封装交付合同。
3. 没有PWM、中断、消抖、I²C、SPI、真实电压电流、制造约束、RV32I或多人协作；这些属于独立后续版本。
4. 只声明本轮已运行的测试组通过，不宣称冻结规格所有Phase0/Phase1用例均已验证。浏览器可用性、不同规模性能以及更广泛随机/恶意快照输入仍需按后续版本持续验证。
