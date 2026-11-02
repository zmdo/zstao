# 文档复核记录

复核日期：2026-10-20。代码基线：`ces/develop` 的 `f2b8d86`；初版交接文档提交：`b1e3138`。后者只修改文档，因此本轮源码依据仍使用前者。以下更正不包含在初版提交中。

## 范围与结论

逐篇复核初版 `docs/framework` 的 20 篇文档及根 README，对照包清单、宿主／客户端入口、SQL、迁移和相关测试源码。发现下列 8 类表述或交接信息问题，已修正对应专题；本记录加入后框架目录共 21 篇文档。

本轮只改文档。源码中发现的边界和注释矛盾作为当前限制记录，没有据此修改应用行为，也未改变已确认的服务器详情八步计划。

## 更正与证据

### 1. 把服务器管理的分层写成了全仓现状

初版开发约定未限定作用范围，容易让接手者以为所有插件的 SQL 都在 persistence，且所有存储函数都不拥有事务。

证据：[sessions 的删除 SQL](../../../plugins/sessions/src/index.ts#L93)仍在宿主入口；[replaceModelProfiles](../../../plugins/settings-models/src/store.ts#L16)自行 BEGIN，并在第 50、53 行提交／回滚，[调用方](../../../plugins/settings-models/src/index.ts#L63)只取还连接。store 的“调用方持有事务”旧注释与函数体不一致。服务器分层约束的检查范围见[架构测试](../../../plugins/server-management/test/architecture.test.ts)。

已在[插件开发约定](../development/plugins.md)、[存储专题](../data/storage-and-migrations.md)和[会话与模型](../modules/sessions-and-models.md)区分已实现的服务器分层与其他插件实际结构，明确事务所有权以代码为准。

### 2. 巡检历史的隐藏规则不只影响周期巡检

初版只说明周期成功记录被汇总，遗漏了手动巡检和进行中记录的实际展示边界。

证据：[历史 SQL](../../../plugins/server-management/src/host/tasks/persistence/history-repository.ts#L13)按 purpose／action／prepare 过滤，非准备类 inspect 仅 failed／blocked 单条可见，没有手动／周期来源判断。[手动路由](../../../plugins/server-management/src/host/http/servers.ts#L59)与[队列快照](../../../plugins/server-management/src/host/execution/queue.ts#L32)使用同一 action；[完成路径](../../../plugins/server-management/src/host/execution/completion.ts#L24)也按相同条件写小时统计。[现有测试源码](../../../plugins/server-management/test/task-history.test.ts#L92)断言 queued 巡检隐藏，第 111 行断言隐藏记录仍可单独读取；本轮未运行该数据库测试。

小时报告还要求 UTC 小时已结束且成功数大于 0；纯失败小时只展示失败单条。自动检测另只隐藏 automatic=true 且 succeeded 的任务。小时报告的合成 ID 不是单任务 UUID，不能用它调用[单任务路由](../../../plugins/server-management/src/host/http/jobs.ts#L20)。

已同步[执行与升级](../modules/server-management/execution-and-upgrades.md)、[任务接口](../modules/server-management/http-api.md)、[状态页](status-and-roadmap.md)、[漂移对照](design-drift.md)及[排查流程](../operations/troubleshooting.md)，避免把预期的来源区分写成已实现。

### 3. 旧 workspace JSON 重导入的触发条件不够精确

初版“只清数据库记录可能重导入”的表述未区分内容行与 unit 元数据。

证据：[后端 open](../../../plugins/workspace-storage/src/backend.ts#L28)先取 unit 版本，仅 undefined 时导入；[storedVersion](../../../plugins/workspace-storage/src/backend.ts#L47)查询的是 `console_storage_unit`。仅清 record／global 而保留 unit 行，不会触发导入；unit 行消失并保留导入文件时才可能再次导入。版本不匹配走报错路径。

已修正[存储专题](../data/storage-and-migrations.md)、[会话与模型](../modules/sessions-and-models.md)及[重置说明](../operations/troubleshooting.md)。

### 4. 错误参数字段名称混淆

初版客户端国际化说明使用 code／parameters，容易与真实错误响应不匹配。

证据：[errorPayload](../../../plugins/server-management/src/shared/i18n.ts#L25)返回 `{ code, params, detail }`；同文件[状态原因翻译](../../../plugins/server-management/src/shared/i18n.ts#L51)才使用 `reason.parameters`。

已在[客户端与国际化](../development/client-ui.md)区分两个 DTO，接口地图继续使用真实的 params 字段。

### 5. 鉴权说明遗漏公开接口例外

初版“API 调用还会重新查账户”的说法范围过宽，未提醒各路由独立鉴权。

证据：[ConsoleSession.read](../../../plugins/frame/src/index.ts#L47)通过[accountFromCookie](../../../plugins/frame/src/account.ts#L45)重新查账户；但 [GET site](../../../plugins/frame/src/index.ts#L290)先公开返回，只有同路径 POST 在第 299 行检查会话。服务器管理则在自己的[guard](../../../plugins/server-management/src/host/http/routes.ts#L117)中校验，不能推广为宿主的全局前缀中间件。

已在[认证文档](../operations/auth-and-secrets.md)限定受保护入口的行为，列出 GET／POST site 的差异。

### 6. 升级相关列表的查询边界记录不完整

初版记录了建议和执行记录的分页，但遗漏计划列表的固定上限，也未解释检测结果先截断再筛选。

证据：[计划 SQL](../../../plugins/server-management/src/host/changes/persistence/repository.ts#L15)只取最近创建的 200 个 move／upgrade 计划；[页面](../../../plugins/server-management/src/client/upgrades/plans/UpgradePlans.tsx#L8)读取数组并直接 map 展示，没有分页。[检测 SQL](../../../plugins/server-management/src/host/upgrades/persistence/repository.ts#L49)先取最近检测的 200 条策略，[service](../../../plugins/server-management/src/host/upgrades/service.ts#L50)再筛选；这是每条策略的最近检查，不是完整历史。执行记录则使用[SQL LIMIT／OFFSET](../../../plugins/server-management/src/host/upgrades/persistence/repository.ts#L62)。

已在[接口地图](../modules/server-management/http-api.md)分开列出四种读取边界，并在[状态页](status-and-roadmap.md)记录当前限制。

### 7. 重置脚本的停机检查被描述得过强

初版称脚本先检查目标端口已停止，可能让接手者误认为脚本能识别 profile 的实际监听进程。

证据：[脚本第 10～14 行](../../../scripts/reset-workspace-history.mjs#L10)只向本机 `--port`（默认 9090）发 HTTP 请求；请求成功则拒绝，请求抛错则继续。它不从 profile 推断实际端口，也没有证明进程停止。[删除范围](../../../scripts/reset-workspace-history.mjs#L32)仅清 workspace 的 record／global，保留 unit 元数据。

已在[排查与重置说明](../operations/troubleshooting.md)写明真实检查方式和清理范围。本轮未运行重置脚本。

### 8. 同级目录用连写路径表达，可能被误读为嵌套目录

初版服务器索引用 `src/host/servers/groups/keys` 等写法合并列举目录，但实际 [servers](../../../plugins/server-management/src/host/servers)、[groups](../../../plugins/server-management/src/host/groups)、[keys](../../../plugins/server-management/src/host/keys)是同级目录；客户端的 keys、changes、upgrades 也是如此。

已在[模块目录表](../modules/server-management/README.md)逐个列出实际路径，避免按不存在的嵌套路径查找。

## 其余收紧与保留结论

- [公开注册服务](../../../plugins/server-management/src/host/definitions/service.ts#L20)自动将定义注册绑定到调用插件 effect；已在[注册说明](../modules/server-management/definitions-and-recipes.md)明确这一点，避免误读示例缺少手动 dispose 就一定泄漏。
- 根 README 的重启描述改为“不主动删除登记与容器”，并指向软件变更恢复流程；不笼统承诺进行中的远端变更不受影响。依据见[完成与恢复处理](../../../plugins/server-management/src/host/execution/worker.ts)及[远端监督器](../../../plugins/server-management/src/host/remote/supervisor.ts)。
- 插件清单、迁移链、工作区归属、当前内置类型和详情扩展待实施状态，经本轮静态核对未发现需要改写的结论；这不等于完成运行验收。

## 验证方式与限制

本轮检查 Markdown 本地链接、带行号的证据位置、索引可达性、代码块闭合和 `git diff --check`。应用源码、数据库、运行 profile 和远端服务器均未修改；未执行数据库／SSH／浏览器业务测试，不引用历史通过数量作为本轮测试结果。

后续代码变化时优先更新对应专题。本记录保留当时的证据和更正原因，不应单独成为更新后实现的权威来源。
