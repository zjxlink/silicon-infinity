# 本地 Worker 内存诊断与验证

> 历史版本记录：本文对应原游戏及原托管环境，不是本自托管候选版的 Docker、账号系统或 fnOS 验收。文中的旧 QA 路径、托管发布回执和访问范围仅适用于当时的版本；当前部署与维护请看 [运维说明](OPERATIONS.md)。

版本：v0.4；检查日期：2026-10-10（本地时区）。以下记录本地生产构建预览，不代表线上服务或八个真实账号的验收。

## 结论与边界

当前安装的 Wrangler 调试代理存在可以独立复现的无上限消息保留：运行时调试通道开启、开发者工具没有连接时，代理把收到的调试消息一直保存在数组中。日志等级 `warn` 不会关闭这个通道；`--inspector-port 0` 仍然开启调试，只是选择随机端口。

新增的 [本地预览启动器](../scripts/worker-preview-v4.cjs) 使用 Wrangler 已导出的 `unstable_startWorker` 接口，把 `dev.inspector` 明确设为 `false`。它读取构建生成的完整配置，保留真实 Worker、静态资源和本地 D1，不替换产品处理逻辑。启动器检查 `inspectorUrl` 必须为空；实际两个 workerd 子进程也没有 `--inspector-addr` 参数。

这解决了一个确定存在的本地调试缓存问题，不足以单独证明原先全部内存增长都由该问题造成。关闭后同一预览进程累计完成 **36,033 次真实 HTTP 请求**，31,500 份观察快照全部一致、没有请求失败。进程内存仍会增长和回落，预热后峰值仍提高，**本次没有证明内存已形成稳定平台**。完整 30 分钟验证另见 [长测结果](../qa/v0.4/soak-30min.json) 和 [长测内存记录](../qa/v0.4/soak-memory.json)；只有 `complete: true` 且结果无错误才能算对应测试完成。

## 环境与原始故障

| 项目 | 本次版本或配置 |
| --- | --- |
| Node.js | 24.13.0，Windows |
| Wrangler | 4.92.0 |
| Miniflare | 4.20260515.0 |
| workerd | 1.20260515.1 |
| Vinext | 1.0.0-beta.5 |
| 构建入口 | `dist/server/wrangler.json`，其 `main` 和资源配置保持不变 |
| 快速对照 | `127.0.0.1:5175`，隔离 D1：`.wrangler/qa-memory-off-v4` |
| 原始长测 | Core8/2 I²C 温度电路；一次推进和七个观察请求；包括重复投递、租约恢复、撤销与重新邀请 |

原始测试在 1,357,098 ms（约 22.6 分钟）、10,804 次 API 请求时中止，1342 次推进，9387 次观察读取，44 次幂等重试；报告记录 `fetch failed`，当时进程输出为 workerd V8 内存耗尽。它是失败记录，不能计作 30 分钟通过。证据保存在 [原始长测结果](../qa/v0.4/soak-first-attempt.json)。

启动配置、版本、进程命令行和文件哈希见 [预览进程记录](../qa/v0.4/inspector-disabled-preview.json)。没有修改 `node_modules`、生成的构建文件、游戏代码或服务端认证，也没有提高 V8 内存上限。

## 源码依据

下表引用仓库当前安装依赖的实际源码，行号只对应上表版本。升级依赖后需重新核对，尤其 `unstable_startWorker` 是明确标记为不稳定的公开接口。

| 文件与位置 | 已核对的行为 |
| --- | --- |
| `node_modules/wrangler/wrangler-dist/InspectorProxyWorker.js:78,177–205` | `runtimeMessageBuffer` 是数组；每条运行时消息都入队；没有 DevTools 时立即返回，不排空，也没有容量或超时限制 |
| 同文件 `:301` | 建立运行时连接后发送 `Network.enable`，不以 DevTools 已连接为前提 |
| `node_modules/wrangler/wrangler-dist/cli.d.ts:705` | `dev.inspector` 的公开参数允许对象或 `false` |
| `node_modules/wrangler/wrangler-dist/cli.js:310456,311584,313102` | 显式 `false` 关闭检查代理，并向运行时传递 `inspect: false`、未定义的检查端口 |
| `node_modules/miniflare/dist/src/index.js:89143` | 以端口是否为 `undefined` 判断是否开启；数值 `0` 仍属于开启 |
| `app/api/[...path]/route.ts` | API 直接进入 `handleRequest`，显式 `force-dynamic`；不是每次做游戏页面的 React 渲染 |
| `node_modules/vinext/dist/server/app-route-module-loader.js:111–154` | 使用路由级 `__loaded` / `__loading` 去重加载；该固定 API 路由没有按房间 ID 生成新模块标识 |
| `node_modules/vinext/dist/server/app-route-handler-policy.js:32–39` | `force-dynamic` 排除路由响应缓存读写 |
| `node_modules/wrangler/wrangler-dist/ProxyWorker.js:88` | 普通成功请求在处理开始时从等待队列移除；未发现成功请求长期堆积在该队列的证据 |

这些排查缩小了范围，但不等于证明全部框架、原生分配和跨进程对象都不存在问题。游戏房间持久状态、调试代理缓存、Node 堆、workerd V8 堆和进程私有内存是不同对象，不能混称为“游戏内存”。

## 调试消息缓存对照

[复现脚本](../qa/v0.4/inspector-buffer-ab.cjs) 直接加载已安装的 `InspectorProxyWorker` 类，没有复制或修改其缓存实现。仅把日志发送接口替换为空操作，隔离消息缓存本身；输入为 10,000 条合成 `Network.dataReceived` 消息，每条含 8192 字节数据。使用 `--expose-gc` 仅为了在这个独立 Node 单元复现中量化保留量，不用于生产预览或业务负载。

| 条件 | 缓存消息数 | 相对基线的 Node 堆保留 |
| --- | ---: | ---: |
| 未连接 DevTools，送入第一批 | 10,000 | 83,623,624 字节 |
| 同一对象接上消费端并排空 | 0 | 31,760 字节 |
| 持续连接，再送入同样第二批 | 0 | 38,952 字节 |

两个批次共 20,000 条消息都被消费端收到；缓存长度断言通过。结果和所加载源码的 SHA-256 保存在 [缓存对照数据](../qa/v0.4/inspector-buffer-ab.json)。这证明该类的消息保留机制，并不表示真实 D1 消息都是 8 KiB，也不是生产 Worker 活跃堆的测量。

## 真实 HTTP 负载

[负载脚本](../qa/v0.4/inspector-disabled-load.cjs) 通过本地完整生产 Worker 路由和实际持久化 D1 请求。八个身份是回环地址上的隔离 QA 身份，不是八个真实账号。每轮一个控制者推进真实 Core8/2 I²C 电路 1000 μs，再让其余七个身份并行读取房间；每份快照和版本号都与权威操作返回值深比较。每轮还检查操作日志最多 100 条、事件队列最多 256 条。

没有墙钟限速，也没有浏览器动画参与判定。三批使用同一个预览进程和持久化目录，每批创建独立测试房间，各完成 1500 轮、12,011 次请求和全部 10,500 份一致的观察快照；每个房间虚拟时间达到 1,500,000 μs。每批都独立超过原先失败时的 10,804 次请求。

| 批次 | 请求数 | 用时 | p95 | 两 workerd 私有内存结束值 |
| --- | ---: | ---: | ---: | ---: |
| [第一批](../qa/v0.4/inspector-disabled-load.json) | 12,011 | 191,419 ms | 117.87 ms | 940,294,144 字节 |
| [第二批](../qa/v0.4/inspector-disabled-load-repeat.json) | 12,011 | 185,391 ms | 113.85 ms | 1,041,080,320 字节 |
| [第三批](../qa/v0.4/inspector-disabled-load-third.json) | 12,011 | 186,402 ms | 113.06 ms | 1,151,270,912 字节 |

汇总见 [机器结果](../qa/v0.4/inspector-disabled-summary.json)。全部批次完成后，已停止本测试独占的 5175 预览及其两个子进程，没有停止独立进行的 5174 长测。

内存每 100 轮从 Windows 进程表采集，记录启动器 Node 与两个 workerd 的 `PrivatePageCount` 和工作集。第一批两 workerd 的私有内存之和从 97,370,112 字节上升到 940,294,144 字节，期间有明显回落。第二批采样范围为 796,860,416—1,047,719,936 字节，第三批为 932,990,976—1,151,270,912 字节；启动器 Node 约 147—149 MB。后续两批增幅比第一批小，但峰值仍在提高，不能只凭回落认定内存已经稳定。

这是整个进程的私有提交量，不是经过垃圾回收后的 V8 活跃对象量，不能按它直接计算每次请求泄漏多少字节。重复批次不重启进程，也不主动触发运行时 GC；以完整结果文件的采样点判断波动，避免只挑低点。

## 复现步骤

先使用项目现有构建流程生成 `dist/server/wrangler.json`。以下命令在仓库根目录执行。隔离状态放在已经被 `.gitignore` 忽略的 `.wrangler/` 下，不提交 D1 数据库或测试身份。

```powershell
node --expose-gc qa/v0.4/inspector-buffer-ab.cjs

node node_modules/wrangler/bin/wrangler.js d1 execute DB --local --persist-to .wrangler/qa-memory-off-v4 --config dist/server/wrangler.json --file drizzle/0000_whole_doctor_octopus.sql

node scripts/worker-preview-v4.cjs --port 5175 --persist-to .wrangler/qa-memory-off-v4
```

预览保持运行。检查就绪记录 `inspectorUrl` 为 `null`，取其中实际 `pid`，在另一终端运行负载；不要沿用报告中的历史 PID。

```powershell
$env:WORKER_URL = 'http://127.0.0.1:5175'
$env:PREVIEW_PID = '<刚启动的预览 Node PID>'
node qa/v0.4/inspector-disabled-load.cjs

$env:MEMORY_RESULT_NAME = 'inspector-disabled-load-repeat'
node qa/v0.4/inspector-disabled-load.cjs

$env:MEMORY_RESULT_NAME = 'inspector-disabled-load-third'
node qa/v0.4/inspector-disabled-load.cjs
```

脚本默认每批 1500 轮，要求总请求数超过 10,804；失败会写入 `errors`、保留 `complete: false` 并返回非零退出码。重复批次写不同结果文件，避免覆盖基线。测试完后在预览终端按 Ctrl+C，由启动器关闭其子进程；不要删除正在使用的 D1 文件。

需要单步调试时，可显式加入 `--inspector`。此模式仅用于调试对照，不用于上述无检查通道的长测。`--log-level warn`、端口 `0` 或仅关闭终端输出都不等价于关闭检查通道。

## 后续判断标准

完整长测需要同时满足业务观察一致、幂等与权限场景正确、没有进程消失或请求失败；内存应结合各进程全程曲线观察，不能用一次峰值或一次 GC 回落代替结论。当前加速测试超越原失败请求数，但不替代 30 分钟墙钟验证，也不替代真实多账号网站访问、线上资源限制或更多并发房间的测试。
