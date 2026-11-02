# 服务器管理交接索引

状态更新：`ces/detail-extensions`，2026-10-21；八步验收与代码设计修复后的现状。此模块当前包名为 `@smp/console-server-management`。

## 阅读分工

| 主题 | 文档 |
| --- | --- |
| 表结构、字段聚合、列表状态及分页位置 | [数据与查询](data-and-query.md) |
| 类型、系统分组、软件／配方注册与 OS 范围 | [定义与配方](definitions-and-recipes.md) |
| 登记识别、巡检、安装、移动、升级和恢复 | [执行与升级](execution-and-upgrades.md) |
| 现有 HTTP／WebSocket 路由 | [接口地图](http-api.md) |
| 详情面板、配置、巡检与独立插件接入 | [扩展接入](extension-api.md) |
| 八步交付状态与保留边界 | [交接状态与下一步](handoff.md) |

## 已实现的页面与操作

- 主侧栏“服务器管理”分组包含服务器实例、服务器密钥、升级管理。
- 实例有服务器分组侧栏、定高列表、状态／查询／分页，新增／编辑表单、详情工作区、移组和终端。
- 详情工作区有局部侧栏；服务器详情、任务报告、终端、容器、配置五个面板在切换时保留侧栏。
- 登记表单分服务器认证信息和服务器系统信息；先测试连接再识别系统，类型变化可使用按选择隔离的识别缓存。
- 已保存密钥不要求重新粘贴私钥；软件表展示版本要求和检测到的已安装版本。
- 升级管理顶部有升级建议、升级计划、执行记录，支持只读检测、拒绝／推迟提醒、共同版本预检及预约确认。

步骤 1～8 已交付，最终验收清单 167/167 通过。容器类型、配方、清单和配置由独立插件提供；本轮进一步补齐注册身份与配置并发校验、公共类型声明和面板刷新。详见[扩展接入](extension-api.md)。

## 当前类型

| 稳定键 | 名称 | 必要软件 |
| --- | --- | --- |
| `builtin/vacant` | 空置服务器 / Vacant server | 无，默认登记类型 |
| `@smp/console-server-containers/container` | 容器服务器 / Container server | 插件提供 Docker、Compose，限制为其 apt 配方支持的 Linux |

`builtin/general` 已退出当前类型目录。容器插件启用后通过 `publicTypes` 向公共目录贡献容器类型，默认登记类型仍为空置。

## 代码组织

| 目录 | 职责 |
| --- | --- |
| `src/index.ts`、`src/client.tsx` | 宿主／客户端装配，不集中写全部业务 |
| `src/client/servers` | 列表、登记、详情、终端、任务面板、工作区与页面 hooks |
| `src/client/keys`、`src/client/changes`、`src/client/upgrades` | 对应页面业务，三个同级目录 |
| `src/host/http` | HTTP 分派、参数与响应 |
| `src/host/servers`、`src/host/groups`、`src/host/keys` | 登记业务、组与凭据引用，三个同级目录 |
| `src/host/definitions`、`src/host/recipes` | 提供者注册、定义解析、脚本与精确计划，两个同级目录 |
| `src/host/execution`、`src/host/remote` | 队列、worker、SSH、远端监督器与恢复，两个同级目录 |
| `src/host/changes`、`src/host/upgrades`、`src/host/tasks` | 变更授权、升级建议／调度和任务查询，三个同级目录 |
| 各业务 `persistence/` | SQL、rows、inputs；连接由调用方提供 |
| `src/shared/contracts` | 公开插件／脚本协议 |
| `src/shared/dto` | HTTP 传输模型 |
| `src/host/database` | 本模块连接接口与事务辅助，实际池仍属于 database 插件 |

这套结构已完成上一轮重构。没有集中式 `store.ts` 或全模块统一 model 大目录，不代表持久化没有抽离；应按业务目录查找。

## 验证入口

`npm run test --workspace=@smp/console-server-management`，数据库集成测试使用 `SMP_TEST_DATABASE_URL`。测试涵盖规则、SSH 替身、隔离 PostgreSQL、Cordis 生命周期、脚本和远端日志恢复。实际运行结果按[测试约定](../../development/testing.md)记录。

源码：[宿主](../../../../plugins/server-management/src/index.ts)、[客户端](../../../../plugins/server-management/src/client.tsx)、[测试目录](../../../../plugins/server-management/test)。

## Harness 工作区组

服务器管理插件通过可选的 `workspaceGroups` 子注入注册一个 Harness 会话工作区组：

- ID：`server-ops`
- 中文：`服务器运维`
- 英文：`Server operations`
- 目录：`.smp/server-ops-workspaces`
- 顺序：20

`workspaceGroups` 不在时插件仍可启动；加载后注册失败只记录日志，不影响服务器管理主流程。

