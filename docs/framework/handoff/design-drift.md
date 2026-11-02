# 历史设计漂移对照

核对基线：`ces/develop`，`f2b8d86`，2026-10-20。旧设计作为背景保留；下表指出不能直接用于当前交接的部分，并给出当前实现入口。

## 对照表

| 历史资料／表述 | 当前事实 | 接手方式 |
| --- | --- | --- |
| remote-console 中仍列量化、资金账户等完整栏目 | 当前仓库没有这些业务插件 | 以[插件清单](../architecture/plugin-map.md)为准，不虚构目录／API |
| 旧服务器设计使用 `ops_jobs` | 0014 后已删除，执行使用计划／目标／`server_jobs`／steps | 看[数据](../modules/server-management/data-and-query.md) |
| 旧连接测试顺便安装选中组件 | 只读检查与独立准备／安装计划已拆开 | 看[执行](../modules/server-management/execution-and-upgrades.md) |
| 外部 `componentsDir`、component.json、detect.sh/install.sh | 当前核心内置 apt 配方，插件走版本 2 定义和结构化协议 | 看[定义](../modules/server-management/definitions-and-recipes.md) |
| 重启把 running 全改失败 | 当前有租约、fence、远端操作日志和恢复核对 | 不能靠清状态重放任务 |
| 服务器配置、指标、软件观察全挤在 servers 行 | 已拆配置／runtime／software observations／policies | 业务 SQL 位于各 persistence |
| `registerGroup()` 或较早的类型注册示例 | 当前为 `registerDefinitions()`，旧接口已退出 | 源码 `shared/contracts/definitions.ts` 是当前契约 |
| `data-model.md`、plugin-contract-v2.ts、schema-v2.sql 的完整终态 | 一部分字段／能力仍是设计；自定义 OS、PowerShell、动态附加软件依赖未支持 | 不用设计附件替换当前导出／迁移 |
| 较早记录说 C、D 是下一步 | C、D 版本策略、移动与升级已有代码 | 看当前执行文档，不重复实现 |
| “服务端分页”被理解成数据库 LIMIT/OFFSET | 实例列表和升级建议仍有应用层筛选／切片，任务报告等路径不同 | 明确每条查询的实现位置 |
| “只汇总后台巡检，手动巡检逐条显示” | 当前过滤没有来源标记，手动非准备类 inspect 同样被汇总／隐藏 | 看[任务执行](../modules/server-management/execution-and-upgrades.md)，不要把待改进规则写成现状 |
| session-shell／session-catalog 提到可视、operate、server_shell 等 | 这些工具与字段当前未实现，且旧直接移动规则不再适合现有类型预检 | 先重审需求和授权，不复制旧 SQL |
| 安装页可用被理解成空库完整建表 | baseline 没有建 accounts/wallets | 当前依赖旧基线，需单独补齐部署缺口 |
| 早期工作区“普通工作区组”名称 | 当前默认显示“默认组 / Default Group”，稳定 ID 仍 general | 修改名称不改归属身份 |
| 每个组内各建未分组区 | 已集中为只读“未归属”，收纳无工作区归属会话 | 看[工作区组](../modules/workspace-groups.md) |
| 原始侧栏被项目完全重写 | 当前工作区组复用原生侧栏及选择器交互；frame 管应用壳／菜单 | 不用自制会话列表替代宿主交互 |
| 最新详情设计描述容器插件与类型专属面板 | 用户已确认；步骤 1～6 已完成，步骤 7～8 未开始 | 看[下一步](status-and-roadmap.md) |
| 已确认终端切面板保留 | 步骤 2 已实现：隐藏 xterm，切面板不卸载 | 不要把隐藏实例写成输出重放缓冲 |
| “此前无数据，可破坏兼容” | 这是当时开发前提，如今可能已有测试实例和执行记录 | 每次变更先核对实际数据与进行中操作 |

## 哪些旧文档仍有用

- workspace-groups 的方案有助理解目录互斥、未归属和原生侧栏适配，但当前字段／方法以 service 和本目录专题为准。
- server-management 的阶段记录可追溯已完成的表结构、C／D 和权限修复，不能把早期示例与新目录路径混用。
- 最新详情扩展设计与八步计划仍是后续任务的目标和执行顺序；其“待实施”状态必须保留到对应步骤真正完成。
- `docs/spec/plugins.md` 仍有包结构和编写说明，但部分插件清单是早期范围；新增开发时与当前 manifest、源码及本目录一起核对。

## 维护规则

当前事实写入 `docs/framework` 对应专题；新需求在设计中注明已确认／待实施；完成后同时更新当前专题和计划状态。不要为了让旧文档看起来一致而重写历史执行事实，也不要因为历史文档有一个字段就为当前接口临时加兼容分支。

本次只补新的交接文档与导航，不批量删除或改写历史设计，不声称已经解决表中代码限制。

交接文档自身的后续更正和源码证据集中在[文档复核记录](document-review.md)。

资料入口：[历史设计目录](../../design)、[插件规范](../../spec/plugins.md)、[当前服务器后续方案](../../design/server-management/detail-extensions-and-container-plugin.md)、[实施计划](../../design/server-management/detail-extensions-implementation-plan.md)。
