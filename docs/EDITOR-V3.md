# 编辑器升级与扩展接口

版本 0.3.0，2026-10-10。实现位于 `game/app.js`、`game/style.css`、`game/index.html`；这些文件不包含服务端、CPU 模型或云端权限实现。

## 可以直接使用的操作

| 操作 | 方式与结果 |
|---|---|
| 单选、多选 | 点击元件或导线；Shift 点击增减选择。已选多项时直接拖其中一个标题保留整组选择。 |
| 框选 | 鼠标从画布空白处拖出矩形，选中与矩形相交的元件；Shift 框选追加。触屏先打开工具栏「框选」，关闭后恢复画布滚动。 |
| 组拖动 | 拖动任一选中元件的标题，组内相对位置不变。移动量吸附到 10 个画布单位，画布边缘约束对整组应用。 |
| 复制、粘贴 | 工具栏按钮或 Ctrl/⌘ C、V。元件间的内部连线自动随元件复制，通往未选元件的连线不复制。 |
| 复制一组 | Ctrl/⌘ D，或观察面板「复制一组」。单选时也可复制一枚元件。 |
| 剪切、批量删除 | Ctrl/⌘ X 先完成有效复制再删除；Delete/Backspace 删除选中元件和所有关联导线。单独选中的导线也能批量删除。 |
| 全选 | Ctrl/⌘ A 或「全选」，包含当前顶层的全部元件和导线。 |
| 撤销、重做 | Ctrl/⌘ Z、Ctrl/⌘ Shift Z、Ctrl/⌘ Y，或底部按钮。最多保留 60 个编辑记录。 |
| 自动布局 | 按连线方向分层、排列同层元件；反馈环中的节点分列。按节点实际尺寸留出空隙。 |
| 理线 | 在曲线和直角折线之间切换，保留真实拓扑。自动布局默认使用直角折线。 |
| 端口说明 | 端口悬停提示；选择元件后展开「端口说明」，查看方向、位宽、类型、四态、协议耗时和冲突含义。 |

文本框保持浏览器原生编辑快捷键，不会在编辑汇编或名称时把 Ctrl A/C/V、Backspace 当成电路操作。弹窗打开时也不会从后台删除元件。Esc 取消尚未完成的接线或框选。

移动、布局、理线属于视图记录，撤销这些操作不会替换 Runtime、改变 RAM 或推进时间。编辑操作会暂停运行。复制、删除、接线等结构变化保留原有「候选设计 → 应用并冷启动」流程；不能把尚未应用的外观当成当前电路的运行结果。

## 复制的完整性

复制先在独立工程副本中保留选中边界、元件和内部连线，再用已经实现的模块包接口计算实际依赖闭包。固件和可编辑源码随包保存。直接 MCU 的固件先按实例拆分，防止两个直接实例的源码草稿通过同一个固件 ID 互相覆盖。

粘贴利用 `packageModule/placeModule` 已验证的依赖、固件和电源域移植逻辑，然后移除临时外壳，把所选元件展开到当前顶层。层级模块本身仍保持模块形态，内部结构定义、域及固件按本次放置重新分配，原工程的锁和旧实例不改写。目标候选工程完整校验成功之后才更新当前编辑器；失败不会粘贴一半。

边界输入初值、元件参数、内部 wire.pull、固件目标模型和源码映射保留。已有基础定义可安全共用其不可变身份，运行状态按实例隔离。新粘贴的组保持原相对位置，并在必要时避开已有元件，随后调整画布视野。

剪贴板目前保存在当前页面内，可跨本页面的新建、打开和返回工程操作使用；刷新页面或换浏览器标签不会带走剪贴板。跨设备、跨标签和长期保存使用工程或芯片包导出。复制的是设计及初值，不是正在运行的 RAM/寄存器状态；运行状态仍使用专用快照保存。

不复制只有导线、没有端点元件的片段；此时明确提示选择元件。单独复制 MCU 不会自动补回未选中的 VCC/GND 或外部连线，粘贴后需按实际引脚接线。原有元件/定义/展开层级资源预算仍适用。

自动布局与直角理线是可撤销的画布整理功能，不是电气布线或 PCB 自动布线器。复杂反馈和跳层连线仍可能相交，用户可以继续手动调整元件。

## 稳定扩展桥

`window.LabAPI` 在启动前同步创建。扩展脚本应在 app.js 后加载，检查 `api.state.project`，或等待 `lab:ready`/`lab:workspace`。它不替代 CircuitLab 的格式和运行校验。

| 接口 | 合同 |
|---|---|
| `state` / `getState()` | 当前编辑器状态对象，含 project、applied、rt、view、sources、selected、selection、dirty、running、panel、library。 |
| `bundle()` / `getWorkspace()` | 返回可导出的设计工作台副本，格式仍为 silicon-lab.workspace/1。 |
| `getRuntime()` | 当前 Runtime；切换工程后扩展需要重新读取，不能长期缓存旧引用。 |
| `loadWorkspace(data, {snapshot?})` | 校验并打开工程；可恢复匹配快照，清除旧 undo/redo 和选择，当前暂停。 |
| `pushUndo(kind='design')` | 编辑前记录；kind=view 仅用于位置/理线。 |
| `changed()` | 把当前候选设计标为待应用，刷新并安排本地保存。 |
| `applyProject()` | 异步校验并应用当前候选；成功冷启动返回 true，失败保留旧 Runtime 并返回 false。 |
| `stop()` / `pause()` / `isRunning()` | 暂停整个本地仿真，或查询运行状态。 |
| `runtimeControl(fn)` | 拒绝尚未应用的设计；调用 fn 排入运行事件并显示待执行状态。 |
| `modal(title, html, buttons='')` | 显示已有对话框；扩展自行转义不可信内容。 |
| `notify(message, bad=false)` | 显示状态提示。 |
| `renderAll()` / `render()` | 重新绘制整个工作台。 |
| `renderInspector()` / `getInspectorRoot()` | 刷新观察区，或取得桌面/移动端当前观察区容器。 |
| `updateSignals()` | 从当前 Runtime 更新实际观察值；不推进时间。 |
| `action(name)` | 执行已有界面动作。选择动作不会绕过候选设计校验。 |
| `importFile(file)` | 使用已有原子导入流程读取工作台、快照或芯片包。 |
| `registerParts(rows)` | 按模型 ID 去重添加元件库行；行格式 `[id,名称,副标题,图标,分类,颜色]`。 |
| `registerPartFactory(id, fn)` | 可选自定义添加器，异步 `fn(project,{id,label,bindings})`；普通元件直接使用 CircuitLab.createInstance。 |
| `selectedCPU()` / `selectedTerminal()` | 当前被观察的 CPU 或终端，包含嵌套路径。 |
| `definition(n,p?)` / `model(n)` / `allNodes()` | 工程定义与画布节点辅助查询。 |
| `escape(text)` / `download(name,data)` | HTML 文本转义与 JSON 下载。 |

`selected` 保留旧版主选择对象 `{type:'node'|'wire',id}` 或 null；`selection` 为完整选择数组。边界画布 ID 为 `boundary:<portId>`。扩展可调用 `selectItems(items, primary?)` 更新选择；需要展现观察结果时再调用 renderInspector。

`view` 增加 `wireStyle: 'curve'|'orthogonal'`；旧工作台缺少该字段时默认曲线。已有 positions 保存格式兼容。

## 调试驱动与事件

`setSimulationDriver(driver|null)` 安装一个实现以下三个同步方法的对象：

```js
{
  advance(delta, options),
  stepTick(),
  stepInstruction(instancePath)
}
```

运行定时器、单步、推进 1 ms 和 100 ms 全部经过该对象。未安装时直接调用当前 Runtime。驱动应通过 `api.getRuntime()` 获取实际内核，不应递归调用桥的 `advance()`。它可在精确断点处调用 stop()；界面读取实际推进后的时间，不假定请求的全部时间都已经运行。

在 document 派发、允许冒泡的 CustomEvent：

- `lab:ready`：启动成功，detail.state 已有工程。
- `lab:workspace`：完整打开或重新应用工程后，detail.reason 为 load/apply，detail.state 为当前状态。
- `lab:render`：观察区或全工作台绘制结束，detail.part 为 inspector/all。
- `lab:tick`：实际观察值更新后，detail 含 state、runtime 和十进制字符串 time；绘制也可能触发，因此相同 time 并不代表又执行了一微秒。

扩展渲染应按自身标记去重，不能在每次 render 事件中无条件调用 renderAll 形成递归。在线跟随权限由在线模块负责；本桥本身不声称提供服务器授权。

脚本顺序为 Core8/Core8Plus → hardware-v3 → circuit → builder-mcu/内容库 → app → hardware-ui-v3 → debugger-v3 → challenges-v3 → online-v3。调试和挑战导航按钮使用 `data-action="open-debugger"` 和 `open-challenges`，由各自扩展处理。

## 实际浏览器验证

已在本机 headless Chrome 对真实 DOM、鼠标、键盘和按钮执行 [editor-v3.cjs](../tests/browser/editor-v3.cjs)，**10 个场景通过，0 个 pageerror**：

1. 桥接口和工作台/渲染/观察事件。
2. Shift 多选、整组拖动、视图撤销/重做，以及 Runtime 快照不变。
3. 空白框选、Shift 减选和选择框收起。
4. 复制内部连线，分别改变原输入和新输入验证实际逻辑独立。
5. 批量删除及完整撤销/重做。
6. 自动布局、直角理线，以及电路和时间不变。
7. 完整 MCU 板跨工程粘贴两份，检查固件/电源独立，实际接收两份 UART B，查看端口说明并保存重载。
8. 层级 MCU 模块复制，检查内部定义隔离和两份真实 UART 记录。
9. 运行、推进、普通单步和 MCU 指令单步都调用安装的驱动。
10. 390×844 视口可访问编辑控件并复制粘贴，无文档横向溢出。

同时回归运行 workbench.cjs **12/12**、refinements.cjs **6/6**、v2-expansion.cjs **14/14**，全部通过。截图和机器可读结果保存在 `qa/v0.3/browser/editor-v3-*.png`、`editor-v3.json`。移动端检查使用窄视口的真实 Chrome 页面，没有声称覆盖所有实体触屏设备或操作系统剪贴板行为。
