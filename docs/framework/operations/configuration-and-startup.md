# 运行配置与启动

核对基线：`ces/develop`，`f2b8d86`，2026-10-20。本页描述启动所需的组成，不把本地忽略目录当成可分发的部署包。

## 运行前置条件

1. 可运行本仓库 TypeScript 测试与 dsh `0.2.1-alpha.5` 的 Node 环境。
2. 仓库 npm workspace 依赖已安装，实际 dsh CLI／profile 另行可用。
3. 可连接的 PostgreSQL 和既有 SMP 基线。特别核对 `accounts`、`wallets`，见[存储缺口](../data/storage-and-migrations.md)。
4. 实际 profile 能解析各 `@smp/console-*` 包、组合相应 bundle patch，且插件已经构建。
5. profile 内提供数据库 URL、Fernet key、frame session secret，以及空账户表时的初始密码。

根 package 只有 `build/test` 脚本，没有 `npm start`、完整 profile 初始化器或固定部署编排。`tmp/` 和 `node_modules/` 被忽略；仅 clone 仓库不会得到本机运行环境。

## 构建与启动形式

在仓库根目录安装和构建：

```sh
npm ci
npm run build
```

以下是已具备正确 web profile 后的启动形式，路径需要指向实际环境：

```sh
DSH_HOME=/absolute/path/to/dsh-home dsh web --no-open --host 127.0.0.1 --port 9090
```

此前本地实例使用忽略目录里的 dsh CLI 和 home。上面不承诺 `dsh` 已在 PATH，也不自动创建 profile。`9090` 是本地 CES 的约定端口，由启动参数决定，不是业务插件强制监听值。交接时核对当前占用、使用的 CLI 版本和 profile，而不是照抄旧 PID。

profile 在 `$DSH_HOME/profiles/<name>` 中，插件配置通常位于其 `cordis.patch.yml`；home 级 patch 也可能参与组合。只查看文件名和加载状态不足以证明最终配置来自哪一层。

## 配置所有者

| 插件 | 字段 | 当前要求／默认 |
| --- | --- | --- |
| database | `databaseUrl` | 必填，经 URL 归一化后建立池，启动连接超时 5 秒 |
| database | `encryptionKey` | 必填，Fernet 格式校验 |
| frame | `sessionSecret` | 必填，用于签名控制台会话 |
| frame | `initialUsername` | 默认 `admin`，仅创建初始账户时使用 |
| frame | `initialPassword` | 已有账户时可不用于初始化；账户表为空时未提供会使 frame 失败 |
| workspace-storage | `importRoot` | 必填，bundle patch 指向宿主 storages 目录 |
| server-management | `inspectIntervalSeconds` | 默认 30 秒；调度器每 5 秒检查到期情况，实际触发受在线状态／未完成任务影响 |
| server-management | `metricsIntervalSeconds` | 默认 1 秒；仅对当前支持且已核验的主机采样 |
| server-management | `sshReadyTimeoutSeconds` | 默认 30 秒，范围 1～300 秒 |
| server-management | `updateCheckIntervalSeconds` | 默认 3600 秒，范围 60～604800 秒 |

`initialUsername` 有默认值不意味着密码自动为 `changeme`。该字符串用于识别默认密码警告；是否用它初始化由实际配置决定。

## 初次安装页

install 插件不依赖数据库服务，依赖 `webServer/profileContext/connection`。未完成安装时接管首页授权入口，导向 `/install`。

用户先测试数据库连接，再提交数据库字段和加密密钥。提交写 profile patch、写 `install-complete` 标记、释放入口门禁，并通过宿主已有 app-boot 实例重载数据库条目。重载失败时恢复原 patch、移除标记并重新保持安装门禁。

标记已存在时安装页不再提供，插件还会确保安装条目禁用；已有有效凭据且数据库可达也可完成标记。这是安装门禁与配置写入流程，不负责补齐仓库没有的旧账户表。

## 修改与重启

- 宿主代码／依赖／patch 改动需要重新构建并确认 profile 重新加载；仅 Git checkout 不会把已运行进程变成新代码。
- 客户端源码需要构建，页面还可能持有旧 bundle。刷新前先确认地址、端口和进程对应的 checkout。
- 服务器任务重启后按数据库和远端日志恢复，不能一概改成失败；详细语义见[执行专题](../modules/server-management/execution-and-upgrades.md)。
- 不把普通重启等同于清空历史；测试数据重置脚本是另一项有明确范围的操作。

源码：[database Config](../../../plugins/database/src/index.ts)、[frame Config](../../../plugins/frame/src/index.ts)、[server-management Config](../../../plugins/server-management/src/index.ts)、[安装流程](../../../plugins/install/src/index.ts)、[profile 文件处理](../../../plugins/install/src/files.ts)。
