# 服务器数据与查询

核对基线：`ces/develop`，`f2b8d86`，2026-10-20。

## 配置、观察、偏好与执行分离

| 表 | 内容与重要约束 |
| --- | --- |
| `server_groups` | 用户／系统来源、名称与翻译、插件身份、定义缓存；系统组受删除保护 |
| `ssh_keys` | 私钥密文和公钥指纹；被服务器引用时禁止删除 |
| `servers` | 名称、地址／端口／用户、认证引用、组、类型快照／修订、声明系统、安装偏好、配置修订；`host + ssh_port` 唯一 |
| `server_runtime` | SSH 连接、探测系统、配置／环境修订、资源指标及时间；一台服务器一行 |
| `server_software_observations` | 每服务器／软件的检测状态、版本、精确包、配方修订、最近成功观察 |
| `server_software_policies` | 用户收紧范围、自动检测开关、提醒时间和下一检测时间 |
| `server_container_scans` | 容器清单读取状态、检查／最近成功时间、错误 |
| `server_containers` | 最近成功的容器清单；当前仍由核心服务器管理读写 |
| `server_upgrade_suggestions` | 精确目标、依据快照、有效性和拒绝决定 |
| `server_change_plans` | 计划选择、确认摘要、授权、维护窗口、时区、并发和状态 |
| `server_change_targets` | 每台服务器的冻结目标、预检、期望修订与结果 |
| `server_jobs` | 队列、用途、租约、fence、远端操作 ID 和执行事实 |
| `server_job_steps` | 每步原状、结果、实际变化与错误 |
| `server_inspection_reports` | 每服务器／UTC 小时巡检成功／失败汇总 |

密码认证在服务器行存密文；私钥认证引用 `ssh_keys`，两者有约束互斥。删除服务器会清理当前 runtime／观察等子数据，任务和计划以 `server_identity` 与快照保留历史，不能把删除理解为所有历史都被级联删除。

类型定义的权威是当前活跃提供者。`type_snapshot` 和系统组定义缓存用于不可用时展示，不能授权继续执行已撤回的脚本。

## 当前列表字段

当前八列按顺序为：名称、地址、操作系统、类型、状态、是否安装必要软件、资源概况、最近检查。资源概况包含 CPU／内存／磁盘，升级提示附在实例相关操作中。分组由侧栏表达，不单设表格列；容器数量和 Docker 状态不作为所有服务器通用列。

“是否安装必要软件”对应登记偏好 `install_required_software`，不是安装成功事实。空置类型没有必要软件时显示不适用；是否已装、版本和健康由观察及详情的必要软件表表达。

## 列表聚合的真实位置

当前实现流程是：

1. 在只读事务内取数据库时间、分组、计数及所选范围的服务器与 runtime。
2. 批量取这些服务器的软件观察、运行任务、策略和升级计数。
3. 在进程内使用当前注册定义计算类型可用性、OS 适用性、范围符合情况、新鲜度和统一状态。
4. 在应用内做关键词、状态和需升级筛选，排序后 `slice()` 得到页，再返回 DTO。

SQL 已限制服务器 ID／分组范围，但没有对完整列表筛选使用 SQL `LIMIT/OFFSET`。这是服务端接口分页，不是完整 SQL 下推分页，也不是浏览器拉全量。规模增大时仍有候选集读取、内存和计算成本；此前用户要求暂不优化，交接不能说成已经完成 SQL 分页改造。

任务报告的查询是另一条路径，在 SQL 的 CTE 中过滤、计数和分页。不要因为任务支持 SQL 分页，就推断所有模块列表相同。

## 统一状态

当前状态码：`unverified`、`normal`、`disconnected`、`installing`、`upgrading`、`attention`。

状态综合活动软件变更、租约和恢复状态、SSH 事实、类型／OS、必要软件及观察新鲜度。替换阶段归入 installing 展示；过期 lease 或远端未知可显示需关注，不能只看任务 state 等于 running。

freshness 默认至少 90 秒，并受巡检周期影响；配置／环境／配方修订不匹配的观察不会当成当前已验证事实。类型翻译和普通指标刷新不应改变软件计划身份。

当前容器清单错误进入任务报告及容器扫描状态，未参与 `displayStatus()` 的独立原因聚合。因此可能出现 SSH／必要软件正常但最近有容器读取失败报告，不能把它直接解释为数据未入库。通用插件巡检影响状态是后续设计。

## 当前与计划表的分界

`server_extension_settings` 已在 `0017_server_extension_settings.sql` 中提供，用于扩展配置的带修订保存；`server_extension_observations` 已在 `0019_server_extension_observations.sql` 中提供，保存扩展巡检当前状态和最后成功结果。扩展配置接口、执行配置计划、巡检观察、来源过滤和任务取消已落地。见[后续交接](handoff.md)。

源码：[列表聚合](../../../../plugins/server-management/src/host/servers/list.ts)、[列表 SQL](../../../../plugins/server-management/src/host/servers/persistence/list-repository.ts)、[任务历史 SQL](../../../../plugins/server-management/src/host/tasks/persistence/history-repository.ts)、[迁移](../../../../plugins/database/migrations)。
