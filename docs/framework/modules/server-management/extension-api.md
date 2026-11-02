# 服务器详情扩展接入

更新：2026-10-21，`ces/detail-extensions`。本页说明代码设计评估后的接入方式；八步功能验收结果见[最终报告](../../../reports/step8-container-extension-acceptance/97-FINAL-REPORT.md)。

## 包入口

使用核心包发布的两个入口，不引用 `plugins/server-management/src/...`：

```ts
import type {
  DefinitionBundle, ServerExtensionBundle, ServerExtensionRuntime,
  ServerManagementHostContract, DbClient,
} from '@smp/console-server-management/contracts'
import {
  registerServerPanel, registerSettingsSection,
  type ExtensionSlotOwner, type SlotService,
} from '@smp/console-server-management/client-api'
```

`contracts` 汇集类型；其中宿主回调、数据库连接接口是可信宿主插件使用的能力，不是浏览器 JSON 数据。`client-api` 是轻量组件注册 helper，插件自己的 React 仍使用宿主 React。宿主注入 `serverManagement`，客户端注入 `slots`，owner 必须与 Cordis 插件名一致。

`npm run build` 先生成公共入口，随后构建各 workspace。核心包构建产出 `lib/contracts.js`、`lib/client-api.js` 和 `lib/types/**/*.d.ts`，包内不发布 src。声明生成使用 TypeScript declaration emit；独立消费测试会打包核心，把正式容器插件复制到仓库外，严格检查插件与声明。该检查不等同于整个宿主源码已通过 strict typecheck。

## 配置版本与确认

每个 settings 定义必须提供 `revision` 字符串。例如：

```ts
settings: [{
  key: 'container-settings',
  revision: '1',
  name: { zh: '容器设置', en: 'Container settings' },
  appliesTo: { types: ['@smp/console-server-containers/container'] },
}]
```

配置结构、默认值或执行语义改变时增加 revision。它与每台服务器已保存配置的行 revision 是两回事：前者表示插件契约版本，后者用于并发修改检查。相同代码重启保持契约 revision 不变。

`affectsExecution: true` 的配置只能创建计划并确认。确认摘要绑定值、预期配置行版本、契约 revision 和服务器 config_revision。应用时重新读取当前服务器、检查扩展适用性、验证原计划值及摘要；插件语义变化、服务器配置变化或旧值不再被接受时，必须重新规划。

同一服务器配置栏目切换保留各自已打开的草稿。栏目被撤回或退出工作区时卸载；迟到响应不能写回已卸载的编辑器。这里的草稿只在页面组件内保留，不持久化到数据库。

## 巡检与卸载

巡检从启动到验证、提交固定使用同一个注册对象。相同 owner/key 的新注册不能接管旧脚本输出。SSH 执行过程中不持有插件回调租用；脚本返回后只接受仍有效的注册。

进入验证和数据库提交后保留注册，卸载会先撤回新调用，再等待已经进入的回调及事务收尾。若撤回发生在异步 commit 回调期间，最终注册校验失败，事务回滚并记录失败观察。已经交给数据库提交的事务会收尾，不能把卸载理解为撤销已提交的数据。扩展查询也会等待回调结束并拒绝撤回后的迟到结果。

巡检观察与插件明细使用核心 `owned()` 提供的同一事务连接。插件不能自己另开事务。正常配置保存、执行配置计划以及观察提交使用同一服务器行锁，因此配置行尚不存在时也能正确竞争；巡检在锁内复核配置 revision。

周期巡检遵守 `enabled()`，手动巡检仍可采集。关闭容器自动采集不会关闭必要软件健康检测。

## 容器插件的职责

`@smp/console-server-containers` 拥有容器类型、Docker／Compose 配方、OS 适用范围、清单解析及持久化、文案、样式和面板。核心不识别插件的 DOM 类名。

插件启动要求 database 已执行 `0019_server_extension_observations.sql` 和 `0021_container_plugin_observations.sql`；缺少时在发布类型及扩展前失败。迁移仍由中央 database 插件管理，容器插件不运行迁移。

面板每十秒串行读取已保存清单，可点击“刷新列表”立即重读；此按钮不触发远端 SSH。主动采集使用工作区已有的手动巡检操作。清单显示上次成功采集时间；查询失败或最近采集失败时保留并标注旧快照，尚未成功采集与成功采集到空清单分别展示。退出面板会取消请求及后续刷新。

## 验证与边界

- 核心测试：`npm run test --workspace=@smp/console-server-management`；pretest 自动生成公共入口。
- 容器测试：`npm run test --workspace=@smp/console-server-containers`。
- 数据库测试：提供指向临时测试 PostgreSQL 的 `SMP_TEST_DATABASE_URL`，测试自行创建、清理隔离 schema。
- 此轮不改变 PostgreSQL 表结构，不清空历史，不执行远端软件安装。

源码：[注册目录](../../../../plugins/server-management/src/host/extensions/registry.ts)、[巡检](../../../../plugins/server-management/src/host/extensions/inspect.ts)、[配置计划](../../../../plugins/server-management/src/host/extensions/settings-plan.ts)、[容器插件](../../../../plugins/server-containers/src/index.ts)、[独立消费测试](../../../../plugins/server-management/test/public-api.test.ts)。
