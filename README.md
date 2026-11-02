# CES

Cyber Evolving System（赛博演进系统）。

CES 做在 Smart Management Platform（SMP）基座上。基座是 DeepSeek Harness（`dsh`）里的一组 Cordis 插件，提供登录、侧栏、平台设置、数据库、加密密钥、会话和工作区存储。CES 的业务栏目作为插件装到基座上，不另起进程，也不再经过单独的网站后台。

这是单用户系统，只有一个平台账户；管理操作与人工审批都由该用户完成，不设置账号角色或权限组。工作区组和服务器分组用于组织业务资源。

本地 CES 实例约定使用 `9090`（`http://127.0.0.1:9090/`），实际监听地址和端口由 dsh 启动参数决定。

`dsh` 重启不会主动删除数据库登记或远端容器。进行中的软件变更需按数据库与远端操作日志核对和恢复，见[执行与恢复](docs/framework/modules/server-management/execution-and-upgrades.md)。

## 基座提供

| 插件 | 作用 |
| --- | --- |
| `@smp/console-database` | 连接池、密文、迁移 |
| `@smp/console-session-persistence` | 把会话写入 PostgreSQL |
| `@smp/console-workspace-storage` | 把工作区登记写入数据库 |
| `@smp/console-workspace-groups` | 工作区组、目录归属、切组与原生侧栏／工作区选择器适配 |
| `@smp/console-install` | 第一次启动时写入数据库地址和加密密钥 |
| `@smp/console-frame` | 侧栏、登录、网站、菜单、安全 |
| `@smp/console-encryption-key` | 查看和更换加密密钥 |
| `@smp/console-sessions` | 档案：查找、恢复、删除会话 |
| `@smp/console-harness-settings` | Harness 设置 |
| `@smp/console-settings-models` | 模型 |
| `@smp/console-plugin-inventory` | 插件清单 |

当前架构、插件、存储、运行方式、模块状态和后续任务从 [框架与业务交接文档](docs/framework/README.md) 进入。`docs/design` 保留历史需求和方案，使用前核对实现状态；[漂移对照](docs/framework/handoff/design-drift.md)列出了主要差异。

[CES 自演进服务器与基础设施方案](docs/design/ces-self-evolution-infrastructure/README.md)确定采用 OneDev `16.9.7` 和三台服务器布局：正式服务器承担开发，构建测试与生产发布分别由独立服务器执行。该方案待实施。

CES 当前还包含 `@smp/console-server-management`，负责服务器实例、密钥、软件计划和升级管理。独立容器插件与详情面板扩展仍处于已确认、待实施阶段，见 [服务器管理交接](docs/framework/modules/server-management/handoff.md)。

## 留在外面的

- PostgreSQL。
- 交易所和模型的 HTTP 接口。模型仍走 `dsh` 自己的接口。
- 登记过的服务器上的容器。CES 不把 Docker 引擎写进本仓库。
