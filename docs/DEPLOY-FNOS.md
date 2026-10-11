# 在飞牛 fnOS 部署

本项目以普通 Docker Compose 应用运行，不需要修改 NAS 系统、挂载 Docker 套接字或使用特权容器。以下步骤使用命令行，便于不同 fnOS 版本复现；Docker 应用里的项目导入入口和按钮名称请以设备实际界面为准。[飞牛官方帮助中心](https://help.fnnas.com/)可用于核对设备与 Docker 应用的安装状态。

## 1. 准备项目与访问地址

将完整源码包解压到 NAS 的独立项目文件夹。保留 `Dockerfile`、`compose.yaml`、`game/`、`server/`、`selfhost/` 和 `drizzle/` 的相对位置。构建上下文必须是这个项目根目录，不是只粘贴 Compose 的空目录。

确认 Docker Engine 和 Compose v2 可用：

```sh
docker version
docker compose version
```

在项目目录复制配置：

```sh
cp .env.example .env
```

编辑 `.env`，把示例 IP 换为自己的 NAS 地址：

```dotenv
PUBLIC_ORIGIN=http://192.168.1.20:8080
HTTP_PORT=8080
BIND_ADDRESS=0.0.0.0
```

`PUBLIC_ORIGIN` 是使用者在浏览器输入的完整源地址，只包含协议、主机和可选端口，不带 `/game/` 或其他路径。登录与写入操作会校验来源，因此不能部署后一直保留 `localhost`。如果端口冲突，同时修改 `HTTP_PORT` 和地址中的端口。

## 2. 选择数据保存位置

### 推荐：Docker 命名卷

直接使用 `compose.yaml`，Docker 自动创建持久化卷。容器重建不会清空它。这样可以避免 NAS 目录 ACL 与 UID 不一致造成的首次启动失败。

```sh
docker compose config
docker compose up -d --build
docker compose ps
```

### 可选：NAS 可见文件夹

如果希望 NAS 文件管理器直接看到服务端数据，在 NAS 的本地存储上新建专用文件夹。不要把数据库放在 SMB/NFS 网络挂载或多人同步目录。

本镜像使用 UID/GID `1000:1000`。以 NAS 管理员身份只对新建的专用数据目录授予该用户读写权限；保留其他家庭文件夹的既有权限。例如，在确认下面路径确实是新建专用目录后：

```sh
mkdir -p /absolute/path/to/silicon-infinity-data
chown 1000:1000 /absolute/path/to/silicon-infinity-data
chmod 700 /absolute/path/to/silicon-infinity-data
```

这些命令中的路径必须换为设备真实路径，不能直接照抄。不要对存储根目录执行递归权限修改。

在 `.env` 增加：

```dotenv
SILICON_HOST_DATA_DIR=/absolute/path/to/silicon-infinity-data
```

同时加载覆盖文件：

```sh
docker compose -f compose.yaml -f compose.fnos.yaml config
docker compose -f compose.yaml -f compose.fnos.yaml up -d --build
```

下文和运维文档的 `docker compose` 命令默认使用命名卷。如果选择文件夹方式，**所有后续命令都要追加同样的 `-f compose.yaml -f compose.fnos.yaml`**；也可在 `.env` 设置 `COMPOSE_FILE=compose.yaml:compose.fnos.yaml` 后统一使用短命令。切换这两种方式不会自动搬运旧数据库。

Docker 命名卷和绑定目录的区别见 [Docker 持久化卷说明](https://docs.docker.com/engine/storage/volumes/)与[绑定目录说明](https://docs.docker.com/engine/storage/bind-mounts/)。

## 3. 初始化与邀请成员

确认服务健康：

```sh
docker compose ps
docker compose logs --tail=100 app
docker compose exec app node selfhost/auth-cli.mjs setup-token
```

在浏览器打开 `.env` 中配置的地址并追加 `/account`（例如 `http://192.168.1.20:8080/account`），使用一次性令牌建立首个管理员。请使用独立于 NAS 管理员的密码。管理员随后在该账号管理页面生成邀请码，交给需要加入的成员。其他用户不能自行开放注册。游戏入口是同一地址下的 `/game/`。

不要把令牌放进 Compose、Git、公开截图或 Issue。初始化完成后的令牌处理由服务负责；若网页仍显示初始化，先核对访问的实例和数据卷是否正确。

进入游戏后先运行一个内置 MCU 示例，确认交互、手册、运行与保存均可使用；再用第二个本站账号验证共享库和协作房间。两个浏览器标签共用同一登录状态，可用另一个浏览器或独立浏览器配置文件测试两个账号。

## 4. 需要外网访问时

先在 LAN 完成使用与备份验收，再配置 HTTPS 反向代理。示例外部地址 `https://circuits.example.com` 仅为说明，请替换为自己的域名。

```dotenv
PUBLIC_ORIGIN=https://circuits.example.com
HTTP_PORT=8080
BIND_ADDRESS=0.0.0.0
```

反向代理把该域名的全部路径转发到 NAS 的 `http://NAS_IP:8080`，保留路径与原始 `Host`。不要把应用挂在 `/silicon/` 子路径，也不要只转发 `/game/` 而漏掉 `/api/`。服务依据明确配置的 `PUBLIC_ORIGIN` 处理安全 Cookie，不依靠任意客户端传来的转发头决定身份或 HTTPS 状态。

如果反向代理直接运行在 NAS 主机进程中，可将 `BIND_ADDRESS` 改为 `127.0.0.1`，仅让本机代理访问。若代理是另一个容器，容器里的 `127.0.0.1` 指向代理本身，需按其网络方式接入本应用，不能照抄主机回环地址。

修改配置后：

```sh
docker compose up -d
```

切换 HTTP 到 HTTPS 后重新登录。浏览器本地作品按来源隔离，切换域名前请在游戏内导出，切换后再导入。公网使用需配好证书、路由器、防火墙与更新机制；本项目不会自动向路由器开放端口。

## 5. 验收清单

- 服务健康，重启后无需重新初始化。
- 管理员、邀请注册、普通用户与退出登录行为正确。
- 普通成员不能使用管理员接口，也不能改写其他人的共享作品。
- 两个账号可以按权限共享芯片和加入同一房间。
- 重建容器后服务端内容仍在；浏览器工程可以导出后再导入。
- 在线备份成功；在独立测试数据卷中演练一次停服恢复。
- 如使用 HTTPS，实际域名下登录、刷新、写入和退出均正常。

项目提供标准 Docker 交付和自动检查；只有在具体 NAS 上完成上述流程后，才能称该设备部署验收通过。构建与运行记录不应被描述成已经在所有 fnOS 版本和架构实测。
