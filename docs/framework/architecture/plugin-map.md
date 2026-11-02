# 插件清单与依赖

核对基线：`ces/develop`，`f2b8d86`，2026-10-20。以下来自当前 `plugins/*/package.json` 与入口，不是计划清单。

## 当前插件

| 目录 | 包名 | 主要作用 | 客户端 |
| --- | --- | --- | --- |
| `database` | `@smp/console-database` | 连接池、迁移、Fernet 密文服务 | 无 |
| `install` | `@smp/console-install` | 初次配置数据库地址和加密密钥，设置安装标记 | 无，直接提供 HTML |
| `frame` | `@smp/console-frame` | 登录、安全、应用壳、菜单、通用设置与网站信息 | 有 |
| `session-persistence` | `@smp/console-session-persistence` | PostgreSQL 会话事件持久化 | 无 |
| `workspace-storage` | `@smp/console-workspace-storage` | workspace 域的 PostgreSQL KV 后端 | 无 |
| `workspace-groups` | `@smp/console-workspace-groups` | 工作区归属、切组、原生侧栏／选择器适配、可用范围登记 | 有 |
| `sessions` | `@smp/console-sessions` | 档案查询、恢复和删除归档会话 | 有 |
| `harness-settings` | `@smp/console-harness-settings` | 将 Harness 设置栏目嵌入平台设置 | 有 |
| `settings-models` | `@smp/console-settings-models` | Harness 模型配置页面和数据库镜像 | 有 |
| `plugin-inventory` | `@smp/console-plugin-inventory` | 只读展示全局 Loader 清单与预设归属 | 有 |
| `encryption-key` | `@smp/console-encryption-key` | 已登录用户读取／替换存储加密密钥 | 有 |
| `server-management` | `@smp/console-server-management` | 实例、密钥、SSH、软件计划、巡检与升级管理 | 有 |

`@smp/console-kit` 是共享包，导出 `Panel`、`Surface`、`consoleCss`；没有 Cordis `apply` 和补丁，不能作为插件加载。

## 宿主依赖与提供的服务

| 插件 | `inject` 依赖 | 主要服务／输出 |
| --- | --- | --- |
| database | 无 | `database`、`secrets` |
| install | `webServer`、`profileContext`、`connection` | 安装路由与 profile patch 更新 |
| frame | `connection`、`webServer`、`database` | `consoleSession`、应用路由 |
| session-persistence | `database` | `sessionPersistence` 的 PostgreSQL 实现 |
| workspace-storage | `database`、`storage` | `postgres` KV backend 及对应 backend 服务 |
| workspace-groups | `database`、`workspaceRegistry`、`webServer`、`consoleSession`、`sessionQuery` | `workspaceGroups` |
| sessions | `webServer`、`consoleSession`、`database`、`workspaceRegistry`、`sessions`、`agents` | 删除归档会话路由 |
| settings-models | `database`、`secrets`、`settings`、`llm`、`credentials` | 模型镜像同步 |
| encryption-key | `webServer`、`consoleSession`、`profileContext`、`secrets` | 数据密钥路由 |
| server-management | `webServer`、`database`、`secrets`、`consoleSession` | `serverManagement`、服务器相关路由与任务 |

harness-settings、plugin-inventory 的宿主 `apply` 为空；实际 UI 由客户端贡献。客户端 `inject` 是另一份契约，不能照搬宿主依赖。尤其 frame 客户端使用工作区组的反射服务；服务没加载时检查该插件的客户端状态。

## 必要的宿主组合补丁

| 补丁 | 作用 |
| --- | --- |
| session-persistence | 禁用 `session-persistence-jsonl`，避免重复注册同一服务并继续写 JSONL |
| workspace-storage | 将 `storage-domain` 的 workspace 域路由到 `postgres`，其余域仍使用 `json` |
| frame | 禁用 `ui-sidebar`，由 SMP 应用壳占据该侧栏登记位置 |

每个插件的 patch 位于其包根。profile 必须实际组合这些 patch；只在 npm workspace 中存在包，不代表运行进程已经加载。

`config` 在 patch 中是整段替换，不是深合并。覆盖 `storage-domain` 时必须保留其他域的默认 backend；覆盖业务插件配置时必须保留所需字段。

## 当前分支范围

本目录只覆盖当前 CES 分支。`base/dsh-0.2.1-alpha.5`、`platform/base` 与 CES 的提交和功能并不相同；本次先前只把侧栏悬浮修改同步到基线，不代表服务器管理全部能力也进入基线。

交接时使用实际 `git branch`／提交检查分支，不能把分支名称当作功能完整性的证据。后续没有明确删除指令时保留分支。

## 核对方法

从[插件目录](../../../plugins)查看每个 `package.json`、`cordis.patch.yml`、`src/index.ts`、`src/client.tsx`。新增／撤销服务时同时更新本表及[生命周期约定](../development/plugins.md)。
