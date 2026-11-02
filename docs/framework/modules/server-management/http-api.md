# 服务器接口地图

核对基线：`ces/develop`，`f2b8d86`，2026-10-20。本页列现有分派，不是完整 OpenAPI。请求和返回结构进一步看 `shared/dto`、`shared/changes.ts`、输入解析和业务 service。

## 共同规则

业务 HTTP 注册复用 `consoleSession.read(cookie)`。终端 WebSocket 自己校验同一会话。只隐藏 UI 不能授权或撤销宿主能力。

服务器错误返回 `{ code, params, detail }`，detail 当前提供中文回退，客户端按当前语言翻译结构化 code。远端原始字符串保留可读内容。404／405／422 等取决于具体分派路径，不要假设所有错误都会返回同一种 HTTP 状态。

POST 返回 202 的任务／计划只是已接受，不是安装成功。客户端应查任务／计划，而不能拿返回 2xx 当作软件已满足。

## 登记、实例与凭据

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET／POST | `/console-api/servers` | 列表分页响应／登记服务器 |
| POST | `/console-api/servers/test-connection` | 表单认证预览，返回指纹与 receipt，不写服务器登记 |
| POST | `/console-api/servers/identify-system` | receipt 关联的系统与必要软件只读识别 |
| GET／PATCH／DELETE | `/console-api/servers/:id` | 详情／编辑基础登记及策略／删除 |
| GET | `/console-api/servers/:id/containers` | 当前核心容器观察读取 |
| POST | `/console-api/servers/:id/test` | 排队已登记服务器连接检查 |
| POST | `/console-api/servers/:id/inspect` | 排队只读巡检 |
| POST | `/console-api/servers/:id/install-components` | 必要软件准备与独立安装计划流程 |
| GET／POST | `/console-api/server-groups` | 读分组／创建用户分组 |
| DELETE | `/console-api/server-groups/:id` | 删除用户组，系统组禁止；成员受类型与任务规则校验 |
| GET／POST | `/console-api/ssh-keys` | 读密钥元数据／创建密钥 |
| DELETE | `/console-api/ssh-keys/:id` | 删除未被引用的密钥 |
| GET | `/console-api/server-types?group_id=...` | 当前分组的类型定义；无组用内置默认选项 |
| GET | `/console-api/components` | 当前内置软件摘要，不能当作所有插件软件的全局目录 |

实例列表参数：`group_id`、`q`、`status`、`order`、`page`、`page_size`、`needs_upgrade`。不传组表示全部，`group_id=ungrouped` 表示未分组；服务内转换为空组范围。默认每页 10，最大 100；排序接受 `name/last_checked`。具体聚合与分页位置见[数据查询](data-and-query.md)。

## 任务报告

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | `/console-api/server-jobs` | 按服务器查询任务与小时报告 |
| GET | `/console-api/server-jobs/:id` | 读单个任务 |

历史查询要求 `server_id`，可传 `q/action/status/from/to/page/page_size`。时间必须带时区，默认每页 10，最大 100。任务类型是显式允许列表，新增扩展任务需要同时更新查询和 DTO，不能任意制造 action 后假设筛选已支持。

列表并非该服务器全部任务：非准备类 `inspect` 仅显示 failed／blocked，手动与周期不区分；成功以符合条件的已结束 UTC 小时报告展示。排队／运行中的这类巡检也不在列表，但仍可通过返回的任务 ID 查询单条。自动检测成功另有隐藏规则，详见[执行专题](execution-and-upgrades.md)。`inspection:...` 小时报告 ID 是列表生成的标识，不是可用于单任务 UUID 路由的任务 ID。

## 升级和移动计划

以下根路径为 `/console-api/server-changes`：

| 方法／子路径 | 行为 |
| --- | --- |
| GET `/inventory` | 服务器与类型／软件名称视图 |
| POST `/detect` | 指定范围的只读升级检测 |
| GET `/suggestions` | 建议筛选／分页、筛选范围的选择与检测结果 |
| POST `/suggestions/:id/reject` | 拒绝该精确目标 |
| POST `/suggestions/:id/restore` | 撤销拒绝 |
| POST `/suggestions/:id/defer` | 延后提醒 |
| POST `/versions` | 多服务器共同目标版本及阻塞信息 |
| GET／POST `/plans` | 读最近 200 个移动／升级计划（无分页）／创建移动或升级预检草稿 |
| GET `/plans/:id` | 逐台冻结目标、预检和执行结果 |
| POST `/plans/:id/confirm` | 核对摘要、窗口等并排队执行 |
| POST `/plans/:id/pause`、`cancel` | 控制未开始目标 |
| POST `/plans/:id/retry` | 为未成功目标重新创建预检计划 |
| GET `/records` | 执行记录分页，每页 20 |

各列表的查询边界不同：

| 列表 | 当前读取／分页位置 |
| --- | --- |
| 升级建议 | 应用 service 筛选和 slice，每页 20 |
| 检测结果 | SQL 先按最近检测时间取最多 200 条策略检查，再按筛选条件处理；不是完整检测历史 |
| 升级计划 | SQL 取最近创建的 200 个 move／upgrade 计划，响应为数组；页面直接展示，无分页入口 |
| 执行记录 | SQL LIMIT／OFFSET，每页 20 |

不能把固定截断列表当作可翻页的全量查询。相关读取见[升级 SQL](../../../../plugins/server-management/src/host/upgrades/persistence/repository.ts)和[计划 SQL](../../../../plugins/server-management/src/host/changes/persistence/repository.ts)。

## 浏览器终端

精确升级路径：`/console-api/servers/terminal?id=<server-uuid>`。连接建立后转接 SSH shell，支持输入和 resize 消息。同一详情工作区内切面板保持连接（步骤 2 的隐藏 xterm）；离开工作区、切换服务器或连接身份变化时关闭。

## 尚不存在的接口

`registerServerExtensions()` 已提供宿主元数据注册（步骤 4）。步骤 5 已分派 `GET /servers/:id/extensions`、`GET /extension-data`、`GET/PUT /extension-settings`、`/extension-settings/plan|apply`、`GET /extension-inspections`、`GET /extension-observations` 和 `POST /server-jobs/:id/cancel`。会话侧 `server_list/server_shell/server_move` 等工具也未在当前宿主入口注册；设计中的 `session_access/login_privilege` 不是当前表字段。

源码：[路由装配](../../../../plugins/server-management/src/host/http/routes.ts)、[服务器](../../../../plugins/server-management/src/host/http/servers.ts)、[计划](../../../../plugins/server-management/src/host/http/changes.ts)、[任务](../../../../plugins/server-management/src/host/http/jobs.ts)、[DTO](../../../../plugins/server-management/src/shared/dto)、[终端](../../../../plugins/server-management/src/host/remote/terminal.ts)。
