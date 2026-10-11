# 浏览器流程复现

v0.3 实际运行 90 个独立业务场景，均通过；另对交付 ZIP 重复执行硬件 10 场景，不重计。完整证据见 qa/v0.3/verification-summary.json。测试使用独立上下文，不读取日常浏览器数据。

完整测试需要 Node 22.13+、Playwright 及 Chrome/Chromium；已有浏览器可设置 CHROME_PATH，模块安装于外部运行环境时设置 NODE_PATH。

静态预览：node scripts/preview.cjs（4173）。运行 workbench、refinements、chip-upgrades、fault-diagnostics、v2-expansion、editor-v3、debugger-v3 脚本；文件均位于 tests/browser/，扩展名 .cjs。

hardware-v3 默认 file:// 禁网；RELEASE_ROOT 指向解压包 dist 目录。设置 LAB_URL 后可改为本地 HTTP 回归。offline-distribution 使用 SILICON_RELEASE_DIR 指向 ZIP 解压根目录；offline-v2 使用 RELEASE_ROOT 指向解压根目录或 dist。

在线 QA：node scripts/cloud-preview.cjs（4174，隔离 SQLite，身份头仅用于本机测试）。online-v3 默认此地址，ONLINE_URL 可指向已迁移的本地正式 Worker。cloud-library-v3 复现分页与改名后新修订。勿对无可信身份入口的公开服务器注入用户头；生产身份必须来自 Sites 认证层。

本轮 online-v3 的 11 个场景也在正式构建 Worker + 实际本地 D1（5174）上通过。node tests/worker-v3.cjs 另验证 6 个 API/数据库流程。生产站点真实登录及第二个账号未操作，不能把本地隔离身份称为生产账号验收。

结果写 test-results/browser/，发布证据保留在 qa/v0.3。已验证 Chrome 桌面和 390px 窄屏；不宣称所有浏览器或触屏设备均已验证。
## v0.4 复现补充

完整核心回归：node scripts/test.cjs（22 套、415 项，含手册语义与示例验证）。性能测量：node tests/performance-v4.cjs，输出 qa/v0.4/performance.json。

新增浏览器：mcu-v4、workspaces-v4、learning-v4、reconnect-v4、room-lifecycle-v4。前三套使用 game/file 或本机静态预览；后两套用4174隔离云端测试服务。各脚本支持的环境参数见其开头。

芯片手册：node scripts/build-manual-v4.cjs 生成同源独立HTML；node tests/browser/manuals-v4.cjs 在禁网浏览器中验证12个使用场景，包括阅读不改现场、MCU型号选择、地址搜索和窄屏。

跨浏览器：compatibility-v4.cjs，需 Playwright 对应 Firefox/WebKit 二进制；PLAYWRIGHT_BROWSERS_PATH 可指定安装目录。Chrome/Edge使用脚本列出的已安装Windows路径。GAME_URL默认4173。结果区分Windows WebKit与真实Safari设备。

长测：先完成正式构建和本地D1迁移，再用 node scripts/worker-preview-v4.cjs 在5174启动最终Worker，最后运行 node tests/soak-v4.cjs。启动器关闭本地调试消息缓存；普通CLI的 --inspector-port 0 并不代表关闭。默认实际运行1800000毫秒，八个仅本机隔离身份；SOAK_MS可缩短排错，但短测不算30分钟验收。禁止向生产站点伪造身份头。最终Worker检查为 node tests/worker-v4.cjs。详细诊断见 docs/LOCAL-WORKER-VALIDATION-V4.md；完成后运行 node scripts/verify-release-v4.cjs 汇总证据并核对构建指纹。

新版离线交付检查：RELEASE_ROOT 指向实际解压后的 v0.4 根目录，运行 offline-v4.cjs。此脚本禁网并验证新增玩法、完整现场恢复和在线功能提示。所有测量和通过记录见 qa/v0.4，实际发布以该目录deployment.json为准。

