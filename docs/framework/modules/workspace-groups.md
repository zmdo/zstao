# 工作区组

核对基线：`ces/develop`，`f2b8d86`，2026-10-20。这是 Harness 工作区／会话归属机制，与服务器实例的分组无关。

## 当前规则

| 对象 | 行为 |
| --- | --- |
| 默认组 | 稳定 ID `general`，显示“默认组 / Default Group”，排序 0 |
| 未归属 | 稳定 ID `unassigned`，显示“未归属 / Unassigned”，系统只读且排在最后 |
| 普通注册组 | 绑定目录，可有多个工作区；按 `order` 升序，再按 ID 排序 |
| 规范化目录 | 使用真实路径，符号链接别名不能跨组重复占用同一目录 |
| 同组重复选择目录 | 复用已有工作区，不重复创建 |
| 跨组选择已占用目录 | 返回冲突和原组／原工作区信息，客户端提供跳转 |
| 工作区标题 | 通过组服务添加／重命名时同组不能重复，跨组允许同名 |
| 默认工作区 | 每个普通组保证一个，位于绑定目录下的 `default-workspace` |
| 无工作区归属的会话 | 集中到“未归属”，该组不能添加目录、创建工作区或生成默认工作区 |

默认组绑定 `.smp/workspaces`，相对宿主系统用户 home 解析，不是相对仓库或 `DSH_HOME`。注册的 `directory` 和工作区真实 `path` 是不同字段。

## 数据与恢复

组定义、双语名称和 allow 规则保存在本次 `GroupRegistry` 实例中；工作区归属、目录预约和焦点写数据库。宿主 `workspaceRegistry` 的实际记录通过 workspace 存储后端持久化。

目录预约先写 `pending`，调用 registry 后建立成员再转 `ready`。两种存储不能共用事务，启动／读取时通过恢复和 reconcile 补齐，不保证跨进程的所有更改天然原子。

删除工作区后，历史会话仍可存在并归“未归属”；目录预约仍保留原组归属，因此不能靠删除后换组重新占用来绕过冲突。原组重新登记该目录可恢复会话关联。删除默认工作区后会补建默认工作区。

焦点保存组、工作区和具体 session，同时记工作区的最近 session。恢复时检查会话仍存在、未归档且归属匹配；没有可恢复对象时回退到可用工作区／空状态，而不是打开其他组的会话。

## 插件接入的当前 API

宿主注入 `workspaceGroups`：

| 方法 | 当前契约 |
| --- | --- |
| `register({ id, label, labelI18n?, directory, order? })` | 返回 `Promise<void>`，注册组、恢复数据、保证默认工作区 |
| `allow({ id, groups, pages? })` | 登记某功能／插件 ID 可用的组及关联页面 |
| `usable(id, groupId)`、`refusal(id, groupId)` | 调用方检查可用范围并获得拒绝说明 |
| `hiddenPages(groupId)` | 返回当前组应隐藏的页面 keys |
| `groupForSession(sessionId)` | 根据真实工作区归属确定会话组 |

`labelI18n` 允许 zh／en 的部分翻译，缺项回退 `label`。这与服务器定义要求完整双语 `LocalizedText` 不相同。

当前组 `register()` 没有逐贡献者的 dispose／撤回句柄，allow 规则也不是全局工具执行拦截器。页面可以据此过滤，工具或命令还需在自己的调用边界检查。不能因隐藏菜单就推断所有后端能力已被限制。

服务器管理的五个 `*_admin` AI 工具仅注册到 `server-ops` 会话作用域，默认组和未归属会话不可用。模型请求组装与工具执行均通过 `groupForSession()` 核对真实归属，侧栏切组不改变已有会话的工具范围。

## 客户端与原生 UI

客户端反射提供 `workspaceGroups`，供 frame 和档案页面消费。`GroupSidebar` 复用原生侧栏组件与其数据／动作接口，仅增加组选择和投影；`Picker` 适配对话栏上方工作区选择器和原生目录流程。

筛选以当前工作区组为上下文，不能只过滤侧栏而让对话栏选择器继续显示所有目录。异步切组使用导航 epoch，避免旧恢复结果把新选择覆盖。

## HTTP

根路径 `/console-api/workspace-groups`，统一控制台会话校验：

| 方法／子路径 | 用途 |
| --- | --- |
| `GET` 根路径 | 组、成员、焦点与 allow 快照 |
| `POST /workspaces` | 当前组添加目录 |
| `POST /rename` | 按组内重名规则改工作区标题 |
| `POST /remove` | 删除工作区并保持历史／默认工作区规则 |
| `POST /focus` | 记录真实会话焦点 |
| `POST /claim` | 兼容调用方认领，仍不能跨组抢目录 |
| `POST /search` | 当前组主会话消息搜索，使用宿主 sessionQuery，最多返回 50 个匹配项及 hasMore |

消息搜索与档案的标题／ID 筛选是两项能力。路径错误、跨组冲突等返回带 code 和可选 owner 的错误。

## 修改时注意

组名、服务器分组名和主菜单分组名都不是同一种身份。也不要把原生 workspaces API 的其他调用路径自动视为经过本服务的标题校验；这里保证的是使用组服务的入口，宿主外围能力需单独审查。

源码：[服务](../../../plugins/workspace-groups/src/service.ts)、[规则](../../../plugins/workspace-groups/src/rules.ts)、[客户端](../../../plugins/workspace-groups/src/client.tsx)、[侧栏](../../../plugins/workspace-groups/src/Sidebar.tsx)、[选择器](../../../plugins/workspace-groups/src/Picker.tsx)、[导航](../../../plugins/workspace-groups/src/navigation.ts)、[接口](../../../plugins/workspace-groups/src/index.ts)。
