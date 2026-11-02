# 发现、证据和改进建议

基线为 `610497f`。本轮没有修复以下事项。优先级表示后续处理顺序，不追溯否定已经完成的实机验收：

- **高**：扩展生命周期或配置一致性缺口，推广相关能力前处理。
- **中**：应进入下一轮修复／工程收尾。
- **低**：整理、可维护性和交接改进。

“隔离复现”指执行生产函数，使用内存数据库替身和 SSH 替身；不等于已在实机制造过同一故障。具体输出见 [verification.md](verification.md)。

## F1：巡检结果没有固定到同一次注册及提交时的配置修订

**优先级：高。证据：源码 + 两个隔离复现。**

### 同键重载窗口

[registry.ts](../../../plugins/server-management/src/host/extensions/registry.ts) 第 19～24 行保存 identity，但 `inspection()` 第 89～95 行只按 key 取当前记录，撤回第 210～213 行也不等待在途巡检。

[inspect.ts](../../../plugins/server-management/src/host/extensions/inspect.ts) 第 30 行获取处理器，第 50 行执行旧脚本，第 58 行重新按 key 获取处理器，第 68 行调用此时的 validator；提交时第 100～101 行又取一次当前 commit 回调。

隔离复现采用只贡献巡检、适用于内置空置类型的插件：旧脚本运行期间撤回旧注册、以相同 owner/key 注册新处理器。结果为：

```text
status = succeeded
result = { generation: "new", raw: "result-from-old-script" }
observationsWritten = 1
newCommitCalled = true
```

旧脚本输出被新版 validator／commit 当作新版结果处理。类型的 lease 不能普遍解决这一问题：只贡献扩展、复用现有类型的插件没有相应的类型提供者 lease。这里不声称容器插件每次重载都会触发该窗口。

### 配置检查与提交之间的窗口

同一文件第 61～66 行检查配置 revision，但真正写观察和插件明细在第 87～104 行的另一个事务中，没有在该事务里锁定／再次核对配置 revision。

第二个复现让两次配置读取都返回 revision 1，获取提交事务连接前模拟另一保存将 revision 改为 2。仍得到成功观察，并调用 commit。普通配置保存[settings.ts](../../../plugins/server-management/src/host/extensions/settings.ts) 第 14～18 行直接执行条件写，也不会与这里的服务器锁形成相同的配置锁协议。

**影响**：热重载或并发修改采集配置时，旧上下文生成的结果可能作为当前成功数据保存。现有任务 fence 校验的是任务所有权，不是插件注册身份或配置版本。

**建议**：

1. 巡检开始取得不可混用的注册句柄／generation、脚本修订及配置修订；整个处理过程使用同一处理器快照。
2. 在写入事务中复核注册仍有效，并对配置采用锁定行或等价的原子条件检查；无配置行时也应定义可一致竞争的规则。
3. 回收后的旧结果明确标为失效／失败；不要重新按同名 key 选择新的 commit。
4. 增加“卸载并立即重载”“最后检查后保存配置”“提交前撤回”的确定性测试。

## F2：执行型配置计划未绑定定义版本，应用时也不重验保存的值

**优先级：中。证据：静态调用链 + 服务函数隔离复现。**

[settings-plan.ts](../../../plugins/server-management/src/host/extensions/settings-plan.ts) 第 21～27 行的摘要绑定 serverId、owner、section、value、配置 revision；第 42～66 行应用时检查计划状态、有效期、摘要和配置 revision，然后直接保存 `plan.value`。

[HTTP 适配器](../../../plugins/server-management/src/host/http/servers.ts) 第 79～103 行会检查当前扩展存在、仍适用、仍标记 affectsExecution，这些检查有效。但当前 validator 只在创建计划时的第 96 行调用，应用旧计划时不会重新验证计划中的值。计划也没有插件语义修订字段。

**触发条件**：在十分钟有效期内，插件以同 owner/key 更新配置结构，仍适用于同一服务器，配置数据 revision 未变。旧计划可继续写入新版已不接受的值。

隔离服务函数复现中，当前 validator 拒绝 `{mode:"legacy"}`，应用函数仍返回该值和 revision 1。该复现不是一次完整 HTTP／热更新测试；上述路由调用链说明了缺失的检查位置。

[CFG-04 报告](../step8-container-extension-acceptance/41-CFG-04.md) 覆盖的是插件保持卸载、或类型变化后不再适用，因此不能覆盖“已重载且仍适用”的场景。

**建议**：配置计划绑定插件配置契约的语义修订和必要的服务器配置上下文；应用时对原计划值重新校验并比较修订。相同代码的正常重启不必一律失效，语义变化则要求新计划。

## F3：扩展配置栏目切换缺少迟到请求隔离

**优先级：中。证据：静态路径确认；本轮未做浏览器交互复现。**

[ServerSettings.tsx](../../../plugins/server-management/src/client/servers/settings/ServerSettings.tsx) 第 67～75 行对不同扩展栏目渲染同一个 `ExtensionSettingsSection`，未按 entry key 重建。

[ExtensionSettingsSection.tsx](../../../plugins/server-management/src/client/extensions/ExtensionSettingsSection.tsx) 第 31～51 行异步加载后直接设置 value、draft 和 revision，没有 AbortController、停止标记或请求序号。保存／规划的异步返回也未核对当前 entry。

**触发顺序**：

1. A 栏目请求仍未完成，用户切换到 B。
2. B 的加载先完成。
3. A 的迟到响应又写入复用组件的 draft／revision。
4. 界面当前 entry 仍是 B；如果 B 接受同形状数据且 revision 相同，用户保存可能把 A 的值写到 B。

切回内置栏目会卸载组件，并不代表“扩展 A → 扩展 B”同样安全。父工作区按 serverId 重建也只能解决换服务器，不能解决同服务器换扩展。

**建议**：为请求绑定 serverId + entryKey + 请求代次，并取消／忽略旧请求；保存时固定其归属。是否按栏目保留草稿另行明确，不能仅通过加 key 解决串数据后又引入无提示丢草稿。

## F4：当前核心自动化套件有 5 项失败

**优先级：中，建议首先恢复基线。证据：本轮实际测试。**

核心套件共 80 项：71 通过、5 失败、4 个数据库集成用例因未设置专用数据库跳过。容器套件 10 项全部通过。

5 个失败都来自[extension-fixture.test.ts](../../../plugins/server-management/test/extension-fixture.test.ts) 第 103、174、214、258、305 行开始的用例。它们构造的 job 缺少 `request_snapshot`，通过 `as unknown as WorkerContext` 绕过类型检查；[inspect.ts](../../../plugins/server-management/src/host/extensions/inspect.ts) 第 26 行读取 `request_snapshot.source` 时抛 TypeError。

失败使“观察提交”“关闭采集”“运行中卸载”“配置修订变化”“丢失 fence”这些用例尚未走到原本要断言的逻辑。最后一项期待 `job_lease_lost`，实际也只是同一个 TypeError。

正式[JobRecord](../../../plugins/server-management/src/host/execution/persistence/rows.ts) 第 21 行要求 request_snapshot，所以本轮证据证明的是测试夹具与实现漂移，不能直接宣称生产任务普遍缺字段。

**建议**：建立满足必填字段的 typed fixture builder，补手动／周期来源的差异测试，并覆盖 F1～F3 的交错时序。在隔离测试库中运行四项数据库用例，将整套结果作为交付检查；167 个手工清单勾选不能代替这一基线。

## F5：公共接口已有源码出口，但发行与插件接入边界尚未完整

**优先级：中。证据：源码导入、清单及构建脚本。**

核心[index.ts](../../../plugins/server-management/src/index.ts) 第 16～50 行已经导出类型，[client.tsx](../../../plugins/server-management/src/client.tsx) 也导出槽注册 helper，这是正确方向。

但正式容器插件仍：

- 在[index.ts](../../../plugins/server-containers/src/index.ts) 第 2～6 行导入兄弟目录下的核心 contracts、host runtime 和 OS 常量。
- 在[client.tsx](../../../plugins/server-containers/src/client.tsx) 第 2～3 行导入核心 i18n 和页面 DTO，并自己复制槽名与 OwnerProps。
- [包清单](../../../plugins/server-management/package.json) 没有 types／声明文件出口；[构建脚本](../../../scripts/build-plugin.mjs) 只用 esbuild 输出 JS，类型导出会被擦除。

**影响**：当前 monorepo 内能构建，不等于独立的 TypeScript 插件只安装核心包便能获得同样的类型契约。内部文件搬迁会直接破坏插件源码；复制的 OwnerProps 也容易与宿主变更脱节。

**建议**：提供可发布且实际生成声明的 contracts／client-api 接入面，并让正式插件与测试插件只通过该接入面使用。容器 OS 支持规则宜由容器插件拥有；真正通用的 OS 类型才作为公共契约。不必立即新建一个大型 SDK 仓库。

## F6：容器面板尚未形成完整的数据加载与刷新状态

**优先级：中。证据：静态路径确认；本轮未重新操作浏览器。**

[容器客户端](../../../plugins/server-containers/src/client.tsx) 第 29～35 行的查询只有 `.then`，没有错误状态、catch 或请求取消；初始列表直接是空数组。查询失败可能保留空列表或旧列表，并产生未处理的 Promise rejection。组件错误边界不负责捕获这类异步请求拒绝。

effect 只依赖 `props.api` 和 `server.id`；宿主传入的[extensionApi](../../../plugins/server-management/src/client/extensions/api.ts) 是固定对象。因此组件持续挂载、同服务器后台巡检更新时，没有显式重新加载清单的触发条件。退出面板重进可以重新加载，不能代替留在面板内的数据刷新。

后端[容器查询](../../../plugins/server-containers/src/index.ts) 第 155～159 行只返回 rows，不携带这次查询对应的观察时间／错误状态；核心已有的扩展观察接口还没有被该面板充分利用。

**建议**：建立 loading／error／empty／成功快照状态，采用可取消、有边界的刷新机制；给结果附观察时间，失败时明确保留的是上次成功快照。测试应覆盖“留在面板内产生新巡检结果”和“查询失败”，不只覆盖首次打开和分页样式。

## F7：容器插件的资源与持久化职责仍有反向耦合

**优先级：低；其中中英文缺失应随 UI 修复处理。证据：直接源码。**

- [核心样式](../../../plugins/server-management/src/client/shared/servers.css) 第 311～318 行直接认识 `.smp-container-panel`，包括使用 `:has()` 选择器判断插件 DOM。通用宿主布局仍依赖某个具体插件的类名。
- 容器客户端第 48 行的默认错误提示、第 91 行的“采集容器清单”硬编码中文；切换平台语言不会改变这两处。分页则使用临时的 zh 条件分支，其他文案依赖核心字典，资源归属不统一。
- 容器宿主入口第 100～123、155～159 行混合远端结果解析、逐行 SQL 写入和查询；解析使用类型断言，没有对容器 ID 等必需字段做明确校验。
- [0021 迁移](../../../plugins/database/migrations/0021_container_plugin_observations.sql) 在中央数据库包创建插件表。集中执行迁移本身合理，但插件与宿主数据库版本需有明确的依赖约束。

**建议**：核心只提供通用可滚动面板容器；容器插件拥有自己的样式、完整双语资源和小型 persistence／解析模块。保留核心传入事务连接的方式，避免插件另开事务破坏观察与明细的原子提交。这里不建议为了三条 SQL 引入通用仓储框架。

## F8：过渡实现与交接索引仍有残留

**优先级：低。证据：当前文件。**

[核心 software.ts](../../../plugins/server-management/src/host/recipes/software.ts) 第 28～30 行仍定义 Docker／Compose 命令，第 81 行保留未调用的 probeCompose，第 96 行保留 ContainerObservation。核心 parse、DTO、locale 中也仍有容器专用内容。当前正常执行路径已走插件，这些残留不等于核心仍在对所有服务器执行 Docker 巡检；但会误导后续维护者。

文档也存在状态冲突：

- [八步计划](../../design/server-management/detail-extensions-implementation-plan.md) 第 3、33、44 行仍写步骤 8 进行中。
- [报告索引](../step8-container-extension-acceptance/00-INDEX.md) 顶部写完成，但 SW-01 行及正文仍写完整首次安装待重测。
- [报告 21](../step8-container-extension-acceptance/21-SW-01-FULL.md) 和[报告 97](../step8-container-extension-acceptance/97-FINAL-REPORT.md) 已明确相应验收通过。

**建议**：后续单独清理无调用的过渡代码，并把最终状态同步到计划和索引；保留历史失败报告，但注明被哪个回测取代。本轮按“只评估”的要求，只记录这些漂移，没有修改原报告。
