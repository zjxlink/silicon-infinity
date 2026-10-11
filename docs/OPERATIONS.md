# 运行与维护

以下命令在项目根目录执行，Compose 服务名为 `app`。使用 `compose.fnos.yaml` 的部署，应在每条命令中带上两个 `-f` 参数，或在 `.env` 设置 `COMPOSE_FILE=compose.yaml:compose.fnos.yaml`。

## 配置

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `PUBLIC_ORIGIN` | Compose 为 `http://localhost:8080` | 用户实际访问的源地址；含协议、主机及可选端口，不能带路径。直接 Node 运行未设置时按 HTTP Host 做同源检查；正式部署应明确设置 |
| `HTTP_PORT` | `8080` | Compose 对 NAS 主机发布的端口 |
| `BIND_ADDRESS` | `0.0.0.0` | Compose 发布端口的主机监听地址 |
| `SILICON_DATA_DIR` | 容器内 `/data`；本地 `./data` | 数据库、初始化令牌、数据库互斥锁、备份目录 |
| `HOST` / `PORT` | `0.0.0.0` / `8080` | Node 服务监听地址；容器中保持默认值 |
| `SILICON_HOST_DATA_DIR` | 无 | 可选 fnOS 覆盖文件的绝对主机数据目录 |

直接 `node selfhost/main.mjs` 或 `npm start` 时，配置由进程环境提供，不自动载入 `.env`。Compose 会读取项目目录的 `.env`。

## 状态与日志

```sh
docker compose ps
docker compose logs --tail=100 app
docker compose exec app node -e "fetch('http://127.0.0.1:8080/healthz').then(async r=>{console.log(r.status,await r.text());process.exit(r.ok?0:1)})"
```

健康检查只报告服务是否就绪，不返回用户资料、令牌或数据库内容。日志有限额滚动；排查问题时可导出必要片段，但提交前检查是否含路径、作品内容或私人信息。容器退出、权限错误、数据库迁移拒绝应处理原因，不能反复删除数据库重试。

## 备份

在服务运行期间创建一致性 SQLite 备份：

```sh
docker compose exec app node selfhost/storage-cli.mjs backup before-upgrade
```

命令会打印实际生成的文件路径。用该路径检查备份：

```sh
docker compose exec app node selfhost/storage-cli.mjs inspect /data/backups/ACTUAL_BACKUP_NAME.sqlite
```

备份使用 SQLite 在线备份机制，包含同一时刻的完整事务，不靠复制正在写入的 `silicon.db`。`inspect` 检查完整性及迁移记录，不打印账号或作品行。

将备份复制到 NAS 外的备份位置，例如：

```sh
mkdir -p backups
docker compose cp app:/data/backups/ACTUAL_BACKUP_NAME.sqlite ./backups/
```

替换 `ACTUAL_BACKUP_NAME.sqlite` 为实际文件名。备份目录是数据卷的一部分，**只留在同一硬盘不能防止硬盘损坏**。备份为明文 SQLite，包含账号密码哈希、会话及私有服务端内容；应限制访问，必要时由 NAS 备份工具加密。

本地工程修订、浏览器暂存、尚未发布的编辑和偏好保存在浏览器中，不包含在服务器备份里。玩家应在游戏中导出工程文件；迁移域名、协议、端口或浏览器前尤其需要导出。

## 停服恢复

恢复会将账号、共享内容和房间回到备份时刻。先保留当前数据，确认使用了正确的数据卷和备份，再运行：

```sh
docker compose stop app
docker compose run --rm --no-deps app node selfhost/storage-cli.mjs inspect /data/backups/ACTUAL_BACKUP_NAME.sqlite
docker compose run --rm --no-deps app node selfhost/storage-cli.mjs restore /data/backups/ACTUAL_BACKUP_NAME.sqlite --confirm
docker compose up -d
docker compose ps
```

恢复工具会验证备份，拒绝仍被服务占用的数据目录，先创建恢复前备份，再替换数据库。无效备份不会覆盖现有数据。首次演练应在独立测试卷进行，不要把生产数据当练习环境。

恢复也会恢复备份中的密码和会话，可能使备份之后已撤销的会话重新出现。涉及账号泄露或人员变动时，恢复后立即重置相关密码以撤销其会话。浏览器页面应重新加载并按需重新登录。

## 升级与回退

1. 阅读新版本变化与迁移要求，导出重要浏览器工程。
2. 在线创建并检查升级前备份，复制到另一存储位置。
3. 保留当前源码包或镜像标签，更新到明确的新版本。
4. 运行 `docker compose up -d --build`，检查健康状态、日志及一个 MCU 示例。
5. 用管理员与普通成员检查共享库和房间权限。

数据库迁移在启动时按版本顺序执行。已发布迁移的内容哈希发生变化或数据库来自较新版本时会拒绝启动。升级过程中发生错误时先读取日志和维护备份，不手改迁移记录。

回退程序版本不一定能读取已升级数据库。必要时停服、切回旧程序，再用该旧程序兼容的升级前备份恢复。恢复会丢弃备份之后的服务端修改，应先保留当前数据以便后续处理。不要通过删除数据卷实现“回退”。

## 账号恢复

正常情况下在网站内修改密码与管理成员。忘记管理员密码时，NAS 管理员可使用离线工具；支持 `list`、`reset-password 用户名`、`disable 用户名`、`enable 用户名`。停止服务后使用与站点相同的数据卷，密码通过标准输入传入，避免留在命令历史和进程参数中。

```sh
docker compose stop app
docker compose run --rm --no-deps app node selfhost/auth-cli.mjs list
```

在 NAS 的 **Bash** 终端使用隐藏输入，再把密码传给工具；将 `ADMIN_USERNAME` 换为 `list` 中的实际用户名：

```bash
read -r -s -p 'New password: ' SILICON_NEW_PASSWORD
printf '\n'
printf '%s' "$SILICON_NEW_PASSWORD" | docker compose run --rm --no-deps -T app node selfhost/auth-cli.mjs reset-password ADMIN_USERNAME
unset SILICON_NEW_PASSWORD
docker compose up -d
```

输入密码需 10—128 个字符；不要把示例占位用户名照抄为真实用户名。修改密码后该账号旧会话被撤销。离线工具要求数据库未被服务占用，与恢复工具共用锁检查。如果当前终端不是 Bash，可先运行 `bash`；不要为了省步骤把真实密码写进命令行。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| NAS 上能打开页面，但登录或保存被拒绝 | 核对 `PUBLIC_ORIGIN` 与浏览器实际协议、主机、端口完全一致；重建服务后重新登录 |
| `/data` 权限错误 | 确认实际卷挂载；绑定目录需 UID/GID 1000 可写。不要改成特权容器或给全部 NAS 文件放开权限 |
| 重建后又要求初始化 | 通常是 Compose 项目名、数据卷或绑定路径改变；找回原卷，不要创建第二套账号替代丢失的数据 |
| 更换网址后本地作品不见了 | 浏览器存储按来源隔离；回到原网址导出，再到新网址导入 |
| 数据目录被锁定 | 先确认没有其他实例、恢复或账号工具在使用该卷；停服后重试。系统会在进程退出或崩溃时自动释放互斥锁 |
| 看到 `/data/server-lock.sqlite` 文件 | 这是共享数据目录的互斥锁数据库，文件保留是正常行为。不要手动删除或替换它，尤其不能在任何服务或维护工具运行时操作 |
| 外部 HTTPS 能看页面但登录不断失效 | 核对 `PUBLIC_ORIGIN=https://…`、证书、代理转发路径和浏览器 Cookie；不要混用同一站点的 HTTP 地址 |
| 下载 Node 基础镜像失败 | 检查 NAS 到 Docker Hub 的网络/DNS；可在可访问网络的同架构设备构建并传入镜像，不能改用来历不明的镜像 |

`docker compose down` 停止并移除容器但保留命名卷；**`docker compose down -v` 会删除命名卷及数据**，不要把它当作常规重启命令。

## 发布前检查

- 确认许可证、项目命名与第三方资源的授权，提交 `LICENSE`。
- 清除真实账号、数据库、令牌、私人部署地址、内部凭据及本机绝对路径。
- 完成引擎、自托管和浏览器检查，构建 Docker，并演练重启、备份、恢复、升级与两账号隔离。
- 对实际目标 NAS 验收；注明尚未实测的 fnOS 版本和 CPU 架构。
- 启用 GitHub 私密漏洞报告与分支保护；明确维护者和支持范围。
- 检查版本号与发布说明后再推送版本标签。GHCR 工作流只发布当前仓库的镜像，不自动创建源码仓库或放开其访问权限。
- 保存构建日志、验收记录和可回退镜像；定期检查基础镜像与依赖更新。

容器发布工作流配置了 amd64/arm64 构建、SBOM 与 provenance。实际产物以 GitHub Actions 的成功运行和仓库 Packages 页面为准，不能仅凭配置文件宣称已发布或完成供应链审计。

## 创建自己的 GitHub 仓库

先在 GitHub 创建自己名下的空仓库，再把本项目作为仓库根目录上传。保留隐藏文件 `.github/`、`.dockerignore`、`.gitignore` 和 `.env.example`；不要上传运行数据目录、实际 `.env` 或构建缓存。尚未初始化 Git 的源码包可以在项目目录执行：

```sh
git init -b main
git add .
git status
```

检查待提交列表，确认不含私人数据后提交。把下面的 `YOUR_REPOSITORY_URL` 换成刚创建仓库的实际 Git URL：

```sh
git commit -m "Prepare self-hosted circuit laboratory"
git remote add origin YOUR_REPOSITORY_URL
git push -u origin main
```

普通分支推送运行检查，不发布 GHCR 镜像。首次检查通过、NAS 验收完成并审阅版本说明后，再发布明确的版本标签：

```sh
git tag v0.9.0-selfhost.1
git push origin v0.9.0-selfhost.1
```

标签必须与 `package.json` 中的版本完全匹配。该操作触发 `publish-container.yml`，在检查通过后向**你当前仓库**的 GHCR 发布版本镜像。请在 GitHub 的 Actions 和 Packages 页面确认结果，并按自己的发布计划设置仓库与包的可见范围。本源码包不会替你创建仓库或推送标签。
