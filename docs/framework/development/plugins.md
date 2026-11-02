# 插件开发与生命周期

核对基线：`ces/develop`，`f2b8d86`，2026-10-20。更底层的编写规范见仓库 [dsh-plugin 技能](../../../.agents/skills/dsh-plugin/SKILL.md)及其引用；以下是接手项目时需要掌握的当前约定。

## 包和构建

- 插件位于 `plugins/<name>`，使用 ESM、`private: true` 和当前 dsh 引擎版本。
- 宿主入口 `src/index.ts`，有客户端时增加 `src/client.tsx`；公开入口指向构建后的 `lib/`。
- manifest 提供 `dsh.bundle.patch`、需要时的 `dsh.client.platform: web`、包内图标和中英文 `meta.title/meta.description`。
- 当前唯一插件构建器是 `scripts/build-plugin.mjs`：宿主 ESM／Node，浏览器 CJS／browser，CSS 作为文本；React、React DOM、JSX runtime 使用宿主实例。
- 浏览器构建通过 `window.__ModuleLoader__.load` 登记，模块 ID 等于包名。不能再打入另一份 React。
- `lib/` 是忽略的构建产物，不手改不提交。插件间使用正式包依赖和导出，不跨目录引用其他插件私有源码。

## 加载

`inject` 表示依赖服务就绪后再执行 `apply`，不是靠 YAML 中先后排列保证加载顺序。配置使用 schema 校验，必需字段缺失应明确失败。

host 与 client 有各自的 `apply`、服务和生命周期。宿主注册定义成功不等于浏览器组件已经加载；浏览器隐藏页面也不自动撤销宿主权限。

bundle patch 用 `insert` 增加条目，用已有 `id` 覆盖条目；表达式使用宿主支持的 `!!js` 方言。配置段整体替换，覆盖前确认原字段。包可被解析、构建完成、Loader active 和页面可见是不同检查项。

## 资源所有权

连接池、定时器、队列、SSH、事件监听、订阅、DOM style 和目录注册必须属于单次插件实例或组件。不可把可变状态放到模块级单例。

清理需要遵守：停止接受新工作 → 等待已接受工作及最后结果写入 → 释放依赖与连接。仅发送 abort／kill 而不等待停止，并不能证明清理完成。

Cordis 卸载时兄弟清理可能并发启动；仅有 `inject` 或持有服务引用不能保护清理期间的依赖。需要顺序时使用同一 generator effect，并 `yield` 清理句柄本身，避免将其另包一层而打乱等待关系。

服务器管理的定义注册／执行租约是这一规则的具体实现，见[定义与配方](../modules/server-management/definitions-and-recipes.md)。工作区组目前没有逐贡献者 `dispose` 句柄，不能把这套保证自动套到另一个服务上。

## 契约和边界

服务器管理已经实施以下分层，并由该插件的架构测试约束；这是新增业务可参考的结构，不是全仓所有插件已经统一完成的重构：

- 宿主 HTTP 只做协议适配和鉴权；业务规则放 service／workflow，SQL 放对应 `persistence/`。
- repository 接收调用方连接，不自行取得连接、提交或回滚调用方事务。
- `shared/contracts/` 描述插件协议，`shared/dto/` 描述网络数据，数据库 rows／inputs 位于宿主 persistence；不互相冒充。

其他插件保留各自结构。例如 sessions 的删除 SQL 仍在宿主入口，settings-models 的 `store.ts` 会自行开启、提交和回滚事务；workspace-storage 的后端也持有自己的事务。修改这些模块时先确认实际事务所有者，不能套用服务器 repository 的调用前提。参见[会话与模型](../modules/sessions-and-models.md)及[服务器架构测试](../../../plugins/server-management/test/architecture.test.ts)。

各插件共通的边界是：

- 网络、配置、数据库 JSON 和子进程输出需要校验；不要以页面已经限制为理由省略宿主校验。
- 稳定键承担身份，中文／英文名称承担展示；翻译变化不应改变执行授权或配方修订。
- 现有协议声明的字段不等于执行器均支持。服务器契约的自定义 OS、PowerShell 和动态新增软件依赖目前有明确拒绝路径。

## 新增能力时的顺序

先确认可复用的服务和槽，再定义最小公开契约、资源所有权、持久化和失败语义，然后接 UI。不要用 UI 组件直接复制凭据处理、队列或另一个插件的 SQL。

步骤 4 已提供 `publicTypes` 和 `registerServerExtensions()`；步骤 5 已声明 `server-management.detail.panel`、`server-management.settings.section` 两个 keyed 槽，并提供 `registerServerPanel()`／`registerSettingsSection()`、扩展目录和配置接口。尚无正式测试插件和通用配置草稿外壳。实施入口见[状态与计划](../handoff/status-and-roadmap.md)。

源码：[构建器](../../../scripts/build-plugin.mjs)、[服务器管理装配](../../../plugins/server-management/src/index.ts)、[数据库 generator effect](../../../plugins/database/src/index.ts)。
