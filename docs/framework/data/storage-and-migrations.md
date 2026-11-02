# 存储、表结构与迁移

核对基线：`ces/develop`，`f2b8d86`，2026-10-20。数据库连接池和迁移执行属于 database 插件，业务读写归对应插件。

## 数据按职责存放

| 数据 | 当前存储 | 权威来源／说明 |
| --- | --- | --- |
| 账户、TOTP | 既有 `accounts` | frame 查询；仓库没有创建该表的迁移 |
| 旧钱包密文 | 既有 `wallets` | 修改登录密码时会查询并重加密；不是已交付的钱包管理插件 |
| 标题、图标、默认页、侧栏初始状态 | `console_site` | frame |
| 主菜单布局 | `console_menu`、`console_menu_group` | frame；与工作区组和服务器组均不同 |
| 会话头与事件 | `console_session`、`console_session_event` | PostgreSQL `sessionPersistence` |
| 工作区注册、归档／置顶等 workspace 域数据 | `console_storage_unit/record/global` | 宿主 storage 协议，经 `postgres` backend 保存 |
| 工作区目录归属、成员、焦点 | `workspace_group_directories/members/focus` | workspace-groups |
| 工作区组定义与插件可用范围 | 当前 `workspaceGroups` 实例内存 | 启动时由插件重新注册；不是独立数据库组定义表 |
| 模型配置镜像 | `console_model_profiles` | Harness 设置为权威，数据库跟随同步 |
| 服务器业务 | `server_*`、`servers`、`ssh_keys` | 见[服务器数据专题](../modules/server-management/data-and-query.md) |
| 数据库 URL、Fernet key、frame session secret | 实际 profile 配置 | 不复制进业务表或交接文档 |

workspace 域路由到 PostgreSQL 不代表全部 Harness storage 域都已迁入数据库。模型设置本身、其他域和 profile 等仍遵循宿主配置。

## 迁移执行方式

`plugins/database/src/migrate.ts` 按完整文件名的字典序执行 `migrations/*.sql`。`console_schema_migrations.id` 保存完整文件名，每个文件一个事务，SQL 与记账一起提交；失败回滚该文件并使数据库插件启动失败。

目录同时存在 `0010_server_management.sql` 和 `0010_workspace_groups.sql`，它们是两个不同迁移，不能根据数字前缀合并、重命名或假设已执行。runner 以文件名判断，不校验历史 SQL 内容摘要；修改已经执行的旧文件不会自动重跑。

当前 runner 没有全局迁移锁，不能从“单文件事务”推断多个独立应用进程可以同时安全迁移。部署时应明确唯一迁移执行者，避免并发启动争用记账。

## 演进主线

| 文件／阶段 | 结果 |
| --- | --- |
| `0001_baseline.sql` | 只有 `select 1`，承接既有 SMP 库，不是完整建库 |
| `0002`～`0009` | 模型镜像、网站／菜单、会话日志、KV 存储、默认页和侧栏偏好 |
| 两个 `0010` | 服务器旧初版与工作区组初版，分别执行 |
| `0011_workspace_group_navigation.sql` | 重建工作区组成员／焦点，增加目录预约及归属；旧表有数据时会被删除 |
| `0012_server_types.sql` | 服务器用户／系统分组来源、类型与定义缓存 |
| `0013_server_observations.sql` | 拆开服务器配置、runtime、软件观察和容器扫描；拒绝带旧服务器／任务／容器数据直接重建 |
| `0014_server_execution.sql` | 建计划、目标、任务、步骤，删除空的旧 `ops_jobs`；旧任务非空则拒绝 |
| `0015_server_inspection_reports.sql` | 小时巡检汇总及已有结果回填 |
| `0016_server_version_policies.sql` | 软件策略、升级建议、预检和执行关联约束 |

这是一条包含阶段重建的开发迁移链，不是针对所有旧业务库的无损升级保证。旧文档“无需迁移／可以清空”是特定时点的开发条件，不能作为以后随时删除当前数据的许可。

## 会话与工作区后端

会话持久化实现 `create/open/stat/list/flush` 和写句柄，`WriterQueue` 顺序提交活跃事件；卸载等待句柄关闭和落盘。workspace-storage 提供 KV unit，检查版本、声明的表和 global 区域。

打开 unit 时，后端先查询 `console_storage_unit` 的版本行；仅在该行不存在时，才尝试从 `importRoot/<unit>.json` 导入。版本行存在但不匹配时会报错，不重新导入。仅清空 `console_storage_record/global` 而保留 unit 行，不会因记录为空而读取旧 JSON；删除 unit 元数据或重建空库且保留导入源时，才可能再次导入旧工作区。

数据库事实、宿主 registry 的内存投影和客户端快照是不同层。工作区组预约目录和调用 registry 不能共享同一事务，因此使用 `pending/ready` 与启动／读取时恢复，而不是声称两边天然原子提交。

## 新增 SQL 的边界

迁移 SQL 仍由 database 插件发布；服务器管理的业务 SQL 已归各业务 `persistence/*repository.ts`。其他插件目前仍有入口 SQL、`store.ts` 和后端内事务，不能把服务器管理的分层当作全仓既有结构，见[开发约定](../development/plugins.md)。数据库 rows 可含 `Date` 和 bigint 字符串，网络 DTO 使用明确的序列化形态。

不要把当前观察、偏好、用户确认和执行日志合并成一个 JSON 大字段。新 API 若需要聚合，先说明事实来自哪张表、定义来自哪个提供者，再确定读取与分页位置。

## 当前缺口

从空库新装时，迁移可创建本仓库新增的表，但不会创建 `accounts`／`wallets`。frame 登录初始化依赖前者，修改密码依赖后者；接手部署必须确认已有基线或单独补齐正式建库方案。本次只记录，不生成未核实的旧表 DDL。

源码：[迁移 runner](../../../plugins/database/src/migrate.ts)、[迁移目录](../../../plugins/database/migrations)、[账户](../../../plugins/frame/src/account.ts)、[密码与旧钱包逻辑](../../../plugins/frame/src/security.ts)、[KV 后端](../../../plugins/workspace-storage/src/backend.ts)。
