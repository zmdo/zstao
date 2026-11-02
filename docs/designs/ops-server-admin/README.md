# 服务器运维管理工具

状态：已实现五个 AI 管理工具，复用现有领域服务、变更计划和任务执行器。管理审计、人工密钥导出、单服务器密钥轮换及审计保留策略均已接入。

核对基线：`ces/file-transfer-rebuild`，`1bbb320`，2026-10-23。产品前提：单用户系统，只有现有的一个平台账户。

## 1. 目标

为平台的唯一用户提供一组 AI 可调用的服务器管理工具，覆盖：

1. 管理非系统分组
2. 管理 SSH 密钥
3. 管理软件升级
4. 管理审计数据
5. 修改服务器信息

这些工具提供结构化的管理入口，通过现有登录、会话权限、变更计划和审计约束执行。普通权限逐次人工审批，完全权限直接执行。命令执行本身也可能修改远端系统，不能把新增工具理解成另一套账号权限等级。

## 2. 前置条件

### 2.1 单用户前提

规则：

- 系统只有一个平台账户，登录与审批都由这同一个用户完成
- 不新增 `user/ops/admin` 角色、账号权限组、多用户 RBAC 或逐服务器 ACL
- HTTP 管理入口继续使用现有 `consoleSession.read()` 校验登录
- AI 工具复用平台已有的 Harness 会话与宿主工具执行上下文，不新增账号与 agent 的多用户归属体系
- AI 参数不接收账号、角色、审批人或自报的审批结果；账号由服务端确定，会话、agent 和调用 ID 来自宿主
- 五个 AI 管理工具只提供给 `server-ops`（服务器运维）组的会话，`general`（默认组）和未归属会话不展示也不能调用。按宿主确认的会话工作区归属判定，不依赖侧栏当前选中组，也不接受 AI 自报组名
- 工作区组决定工具适用的业务场景，不引入用户角色；服务器分组 `server_groups` 仅组织服务器。会话权限单独决定是否需要人工审批

### 2.2 服务端检查

所有管理入口在服务端检查：

```text
调用是否来自平台现有的可信登录／Harness 执行入口
AI 会话是否属于服务器运维工作区组
目标是否属于平台登记的资源
本次操作是否由完全权限授权，或取得所需的人工审批
审批对应的参数、配置或计划是否仍然有效
```

HTTP 未登录继续返回现有 `unauthorized`。AI 执行缺少所需的可信上下文时拒绝；需要审批但没有审批服务、用户拒绝或取消时，返回 `approval_denied`，不得默认为批准。

检查失败不执行目标业务写入或远端操作；可以记录不含敏感内容的拒绝审计。不返回 `required: ops`，也不要求 AI 携带登录 cookie。

### 2.3 审批含义

本文的“审批”统一指唯一用户通过现有审批通道进行的一次人工确认。展示操作对象、完整变更和影响后，由用户批准或拒绝；不要求额外输入目标名称、二次确认或新增审批等级。

本文后续“需要审批”均指普通权限下的 AI 操作。宿主确认当前会话的有效权限预设为 `danger-full-access` 且实际 sandbox mode 也为 `danger-full-access` 时，管理工具、`platform_server_exec` 和 `platform_server_rsync` 直接执行，不调用审批服务。不能仅凭 `approval=never` 放行；Auto 即使使用不受限 sandbox 也继续走其审批通道。权限在每次调用时从宿主读取，切回普通权限立即恢复审批。模型参数无法声明授权，完全权限也不扩大管理工具的工作区范围，不跳过参数、修订、预检、摘要、维护窗口及任务锁校验。

完全权限执行的审计记录使用 `approval_status=not_required`、`permission_mode=danger-full-access` 和 `metadata.authorization_source=full-access`，不填写人工审批人、时间或审批 ID；普通权限通过审批时记录 `authorization_source=user-approval`。审计保留策略持久化授权来源，后续自动执行继承该来源与原授权调用 ID。审计页面以中英文展示授权来源。

审批正文使用 `locale/zh.json`、`locale/en.json` 中的固定模板，按界面语言展示操作、名称及地址、变更前后值、执行窗口和实际影响，不直接展示原始 JSON。分组删除列出受影响服务器；升级风险从冻结计划读取；启用审计保留策略须说明后续每日自动执行。结构化参数和快照继续用于审计和执行前校验。私钥下载确认页读取已保存的界面语言，未设置时跟随浏览器语言，未支持语言回退英文；展示密钥名称、指纹及引用服务器，并保持一次性确认与下载校验。

| 是否审批 | 要求 |
|---|---|
| 否 | 只读查询不单独弹出审批，仍校验调用入口和目标 |
| 否 | 完全权限下的 AI 操作直接执行，仍保留业务校验和审计 |
| 是 | 通过现有审批通道展示目标、变更和影响，用户一次确认本次操作 |

审批绑定工具、action、目标、参数摘要和变更前快照；计划执行还绑定 `plan_id`、计划 revision、`review_digest`、精确软件目标和维护窗口。审批通过后、提交前重新校验；发生漂移时拒绝本次执行，重新读取并审批。

非计划操作的批准仅在当前工具调用内有效。计划的批准按现有确认摘要和可开始窗口执行，过期不自动补执行。AI 不能通过传入 `approved: true` 或审批人代替人工审批。

复用现有 Harness 审批结果，通过工具调用 ID 将审批请求、用户决策与管理审计关联，不新增审批交互。Web 人工导出也只确认一次，不再叠加 Harness 审批弹窗。

## 3. 工具划分

按领域拆分为五个工具：

```text
platform_server_group_admin
platform_server_key_admin
platform_server_upgrade_admin
platform_audit_admin
platform_server_admin
```

不建议使用一个万能工具，也不建议用单个 `action` 覆盖全部领域。

工具名中的 `admin` 表示管理操作，不表示管理员角色。各工具内部按本领域的 `action` 分派。

工具按会话作用域注册。注册入口只接受 Agent，使用宿主工具注册表校验其作用域；根 Context 或普通插件 Context 会在发布任何工具前被拒绝。每次组装模型请求时重新核对工作区归属，同时更新原生工具清单与程序调用 SDK；执行前再次核对，防止沿用旧工具清单调用。插件卸载或会话销毁时撤回注册。

## 3.1 现有能力与新增范围

| 领域 | 现有基础 | 本方案新增 |
|---|---|---|
| 分组 | 用户分组增删改查、系统分组保护 | AI 入口、审批及管理审计 |
| 密钥 | Web 导入、加密存储、列表、引用检查和删除 | AI 入口、服务端生成、轮换及人工导出 |
| 变更计划 | `move/upgrade` 预检、摘要确认、维护窗口、调度与恢复 | 单服务器 AI 入口和宿主人工审批衔接 |
| 审计 | 命令／传输审计及分页查询 | 管理事件、导出和保留策略 |
| 服务器 | 编辑、删除、连接复测和变更计划 | AI 入口、审批快照校验及结果表达 |

工具直接复用宿主领域服务，不另写一套 SQL 或软件执行器。Web 与 AI 入口共用资源保护、锁和计划校验；本文的逐次工具审批不要求给所有现有 Web 操作新增一层 Harness 弹窗。

## 3.2 调用契约

五个工具统一接收 `{ "action": "操作名", "input": { ... } }`。`input` 为结构化对象，未开放字段由服务端拒绝；只读操作使用空对象或查询参数。

| 工具 | action 与 input |
|---|---|
| `platform_server_group_admin` | `list {}`；`types {group_id:UUID|null}`；`create {name}`；`rename {group_id,name}`；`delete {group_id}` |
| `platform_server_key_admin` | `list {}`；`create {name}`；`delete/reveal {key_id}`；`rotate {server,key_id,expected_config_revision,operation_id?}` |
| `platform_server_upgrade_admin` | `check {server}`；`suggestions {server,page?}`；`plan {server,versions,expected_config_revision}`；`show/cancel {plan_id}`；`apply {plan_id,revision,review_digest,start,end,timezone}` |
| `platform_audit_admin` | `query/export {from?,to?,server_id?,kind?,status?,session_id?,tool?,page?,page_size?}`；`retention {mode:"get"/"run"}` 或 `{mode:"set",days,archive_directory,next_run,enabled}` |
| `platform_server_admin` | `update {server,expected_config_revision,patch}`；`rebind {server,expected_config_revision,target_group,target_type?,install_missing,software_policies}`；`delete {server,expected_config_revision}` |

`versions` 将软件 key 映射到精确版本。`patch` 仅接收第 8 节开放字段。所有 revision 都使用十进制字符串；日期时间使用带时区的 ISO 8601，维护时区使用 IANA 名称。`apply` 在普通权限下通过一次人工审批展示计划风险和窗口，完全权限下直接授权，再由宿主填写现有确认标志。

模型实际收到的 schema 展开 `input` 字段及 `patch`、`declared_os`、`software_policies[].restriction` 的嵌套结构。宿主 schema 不支持按顶层 action 条件切换必填项，因此工具描述逐项声明各 action 的必填/可用字段，执行入口使用同一契约校验，错误提供字段路径。原生调用与 PTC SDK 使用同一契约；返回值保持 JSON 文本兼容，PTC 用 `JSON.parse` 读取。

移组、切换类型或安装类型所需软件的完整链路为：`platform_server_get` 获取当前修订 → `group_admin.list/types` 获取实际分组 UUID、类型 key 和软件规则 → `server_admin.rebind` 创建草案 → `upgrade_admin.show` 等待 `awaiting_confirmation` 且全部目标预检 `ready` → 携带最新计划 revision/digest 和维护窗口调用 `apply`，由宿主请求用户审批 → `show` 等待计划 `completed` 且目标 `succeeded` → `platform_server_get` 核实结果。`software_policies: []` 继承目标类型默认规则；自定义策略只能收窄规则。

计划返回 `guidance` 和 `next_step`。待审批时 next_step 提供实际 plan_id/revision/review_digest，`required_input` 列出还需填写的维护窗口字段；阻塞、失败、取消等状态要求检查错误，不提示盲目重试。创建草案和进入 scheduled 都不表示已完成。升级检测 `check` 只排队，随后通过只读 `suggestions` 查看检查时间、错误和版本候选，避免重复排队。

通过已有 `platform_server_get` 读取配置 revision、凭据引用和 `key_rotations`。轮换的 `server` 必须是服务器 UUID；其他服务器操作也支持现有精确名称解析。中断轮换保留 `state` 与最后确认的 `phase`，返回或查询到 `operation_id` 后，以当前 revision 和同一旧密钥 ID 再调用 `rotate`；新密钥不会重新生成，先验证当前连接与引用，再继续部署或清理。结果不明确时保持互斥，不能绕过核对继续派发任务。

审计查询每页最多 100 条；导出最多 10,000 条，超限时缩小筛选范围。导出文件通过已登录的一次性下载地址交付，十分钟过期。保留策略的 `get` 只读，`set/run` 需要审批；启用后按已批准规则每日执行并关联原审批。

---

# 4. platform_server_group_admin

## 4.1 能力

```text
list
create
rename
delete
```

## 4.2 规则

这里的 `kind=user` 表示用户自定义分组，`kind=system` 表示插件提供的系统分组，均不是账号角色。

- `list` 可以展示用户分组和系统分组；创建、重命名和删除仅作用于 `kind=user` 的分组
- 插件贡献的 `kind=system` 分组不可由工具创建、删除或重命名，不能仅凭名称判断是否为系统分组
- “全部服务器”和“未分组”是列表视图；未分组对应 `servers.group_id = null`，没有可删除的分组记录
- 工作区的 `general`、`unassigned` 等标识不用于识别服务器系统分组
- 创建和重命名检查空值、重名、保留名称及现有 `varchar(80)` 长度限制
- 普通分组沿用现有 `name` 字段；不允许通过工具修改 `name_i18n`、`kind`、`plugin_id` 或类型定义等来源字段
- 删除需要审批，展示分组及所有将被解绑的服务器

删除复用现有领域规则：

```text
锁定分组和成员
→ 系统分组拒绝
→ 有非 builtin/vacant 类型的服务器时拒绝，要求先迁移
→ 检查空置服务器没有活动任务、没有当前有效的 OS 不匹配状态
→ 将允许解绑的空置服务器设为未分组并递增配置 revision
→ 删除分组
```

因此“分组中仍有服务器”不一律阻止删除：仅包含满足上述条件的空置服务器时可以解绑后删除。审批后成员变化必须重新核对审批快照，不能静默扩大解绑范围。

## 4.3 审计

记录：

```text
group_id
旧名称
新名称
服务器数量
解绑服务器快照
审批
结果
```

---

# 5. platform_server_key_admin

## 5.1 能力

```text
list
create
delete
rotate
reveal
```

## 5.2 普通操作

### list

只返回：

```text
key_id
name
fingerprint
created_at
referenced_server_count
```

不返回私钥。

### create

现有 `createKey` 是导入调用方提供的私钥，不是生成密钥对。

本工具的 `create` 由服务端生成 Ed25519 SSH 密钥对，再复用现有指纹校验、加密与持久化逻辑。工具只返回元数据，不在 AI 参数或输出中传递私钥。

已有私钥继续通过现有 Web 表单导入。创建或导入密钥不会自动将公钥安装到任何服务器。

### delete

删除前检查：

```text
ssh_keys
servers.ssh_key_id
```

被服务器引用时拒绝删除。

检查与删除必须处理并发引用，保留数据库 `ON DELETE RESTRICT` 约束；不能只依赖工具预读到的引用数量。删除需要审批。

### rotate

第一版轮换只处理一台已登记服务器，明确旧密钥、目标服务器、配置 revision 和新密钥指纹。共享旧密钥在其他服务器上的引用保持不变。

流程：

```text
读取当前引用、主机指纹和配置 revision，检查活动任务
→ 用旧凭据预检远端公钥管理权限，准备新密钥及变更摘要
→ 人工审批
→ 保存加密的新密钥，通过旧连接追加新公钥，保留旧公钥
→ 使用新私钥建立独立 SSH 连接并核验主机指纹
→ 在短事务内复核旧引用及 revision，提交新引用并递增配置 revision
→ 通过已验证的新连接移除本次轮换明确管理的旧公钥
→ 再次验证新连接
→ 审计
```

远端公钥部署与撤回由固定 Python 脚本执行，原子替换目标用户的 `~/.ssh/authorized_keys`，保留其他公钥及旧公钥的限制选项。远端需要 Python 3，文件必须由当前 SSH 用户持有且不能是符号链接；自定义 `AuthorizedKeysFile` 不在首版范围内。主机指纹必须已固定。远端操作通过会话 advisory lock 串行化，数据库阶段写入使用短事务；活动轮换阻止同服务器任务领取及关键配置修改。

新连接验证和引用提交前失败时，旧引用与旧公钥保持可用。引用提交后旧公钥清理失败时，保留已验证的新引用和旧密钥材料，记录“已切换、待清理”，不宣称已经完成撤回。结果未知时先核对远端状态，不盲目重试或覆盖引用。

旧密钥记录不自动删除，其他服务器可能仍在使用；最终删除仍走独立的引用检查与审批。仅移除能明确归属于本次轮换的公钥，不覆盖整份 `authorized_keys`。

## 5.3 reveal

`reveal` 是高危能力。

要求：

- 独立 action
- 一次人工审批
- 审批展示密钥名称、指纹、引用服务器
- 不把私钥写入审计
- 不把私钥写入日志
- 一次性导出凭据仅供人工使用，服务端消费后失效
- 审计只记录 `action=reveal`、密钥 ID、指纹及审批与结果

默认交互：

```text
工具请求不含一次性下载凭据的人工导出页面入口
→ 用户在 Web 页面确认一次
→ 人工一次性下载
→ 工具只返回元数据和完成状态
```

“一次性”约束的是下载凭据，不能撤回已经下载或记录的内容。导出页面位于 `/console-api/server-admin-downloads/:id`：工具返回页面地址和十分钟有效期；该地址本身不能下载私钥，必须登录并在页面确认。确认凭据由页面生成，绑定当前密钥及引用快照，只能消费一次，不进入工具输出或审计。

如果以后要求通过 AI 返回私钥，必须单独明确接受以下后果后再设计，不以一次性输出承诺消除记录：

```text
私钥会进入模型上下文和会话历史
```

## 5.4 审批

| 操作 | 审批 |
|---|---|
| list | 否 |
| create | 是 |
| delete | 是 |
| rotate | 是 |
| reveal | 是 |

---

# 6. platform_server_upgrade_admin

## 6.1 能力

```text
check
plan
show
apply
cancel
```

## 6.2 流程

```text
check
→ plan
→ 等待只读预检完成
→ show 查看冻结的计划
→ apply 内发起人工审批
→ 确认现有计划并进入任务队列
```

禁止：

```text
check 后直接 apply
```

`plan` 创建计划前需要审批，创建后返回 `plan_id` 和预检状态，不代表已经可以执行。`show` 必须展示状态；预检未完成或被阻塞时，`apply` 拒绝执行。

`apply` 接受现有的单服务器计划标识、计划 revision／`review_digest`，以及此次确认的维护窗口（开始、结束和时区）与风险确认项。第一版固定单服务器串行；窗口和风险确认一并展示并绑定到本次人工批准，不能只审批计划 ID。

现有计划接口要求的替换、主要版本变化和服务影响确认项，从用户对完整计划的同一次批准中映射，不额外要求勾选、输入目标名称或再次弹窗。

`apply` 不接受任意命令、服务器补丁或重新指定的软件列表。服务端读取冻结计划并发起一次人工审批，批准后通过现有 `confirmChangePlan` 确认并排队，不新增另一条绕过计划的执行路径。

用户批准的目标、确认摘要、配置／环境／定义修订和维护窗口必须保持一致。计划执行前仍使用现有 worker 检查；未批准、过期或漂移时拒绝。审批身份与凭据由可信宿主填入，不允许 AI 自报。

## 6.3 范围

本方案第一版 AI 管理入口只支持单服务器。现有 Web 批量预检和升级计划能力已经存在，继续沿用。

AI 批量入口后续在现有能力上设计，需要表达：

- 分批
- 失败恢复
- 已发生的远端变更和恢复状态，不能承诺自动回滚
- 变更窗口

## 6.4 审批

| 操作 | 审批 |
|---|---|
| check | 否 |
| plan | 是 |
| show | 否 |
| apply | 是 |
| cancel | 是 |

`cancel` 沿用现有计划取消语义：取消未开始目标，不强杀已开始的包管理器；已经开始的任务继续收尾或恢复，并报告实际结果。

## 6.5 审计

管理审计的成功表示该操作已提交；`apply` 成功后计划仍可能处于 `scheduled/running`。实际远端执行结果和失败原因由原有计划／任务历史保存，通过审计中的 `plan_id` 使用 `show` 查询，不能把排队成功表述为软件已升级。

记录：

```text
server_id
plan_id
software
旧版本
目标版本
审批
执行结果
失败原因
```

---

# 7. platform_audit_admin

## 7.1 能力

```text
query
export
retention
```

## 7.2 不提供

```text
update record
delete single record
```

审计记录不允许 AI 单条修改或删除。

## 7.3 query

支持：

```text
时间范围
服务器
类型
状态
会话
工具
分页
```

## 7.4 export

导出前需要审批。

导出内容可能包含：

```text
命令
路径
主机
会话
```

必须记录导出行为。

## 7.5 retention

保留策略的新增、修改和手动执行由唯一用户审批。规则至少包括：

```text
保留天数
归档位置
执行时间
```

保留策略的修改和每次执行都要审计，展示将处理的时间范围与记录数量。按归档规则验证归档结果后才清理到期记录；归档失败不继续删除。

周期执行仅使用已批准且未改变的规则，规则改变需要重新审批。首版按天执行，每批最多归档 10,000 条；跳过仍在执行的记录、活动轮换依赖的审计及保留策略自身事件。归档文件以独占创建、0600 权限写入已批准的绝对目录，落盘后读回校验 SHA-256，再在同一事务删除对应记录并记录归档路径、校验值和数量。手动运行在审批前冻结截止时间和记录集合，发生漂移时拒绝。此能力不提供任意 SQL、按 ID 删除记录或绕过规则清理的入口。

## 7.6 审批

| 操作 | 审批 |
|---|---|
| query | 否 |
| export | 是 |
| retention | 是 |

---

# 8. platform_server_admin

用于修改服务器信息。

## 8.1 允许修改

```text
name
region
declared_os
install_required_software
```

`group_id` 和 `type_key` 不通过普通 `update` 直接修改，必须走 `rebind` 变更计划。

`internal_host` 目前由 SSH 探测更新，不属于普通编辑字段；现有表和编辑接口没有 `tags`，本版不将其列为已支持字段。修改声明系统不等于已经通过系统核验；开启必要软件安装也不授权任意升级或替换。

## 8.2 不允许直接修改

```text
secret_ciphertext
```

密钥材料的创建、删除、轮换和导出通过 `platform_server_key_admin`。`update` 可以选择已有的 `ssh_key_id`，但不能接收私钥、密码或直接改写密文；第一版不开放认证方式与密码的 AI 编辑。

## 8.3 高风险字段

```text
host
ssh_port
ssh_user
ssh_key_id
```

这些字段与其他修改一样只需一次人工审批，展示旧值、新值及所用密钥指纹。修改后必须触发现有连接复测，不能只写数据库。

沿用现有“保存配置后排队复测”的行为：响应分别表达配置已保存、测试待执行／运行中及任务 ID，不能提前宣称新连接可用。测试失败时报告“配置已保存、连接验证失败”，不将其描述为配置自动回滚。

## 8.4 移动分组和更改类型

移动分组和更改类型会影响软件需求，不能直接更新 `servers.group_id/type_key`。

工具输入契约：

```ts
type RebindRequest = {
  action: 'rebind',
  server: string,
  target_group: string | null,
  target_type?: string,
  install_missing: boolean,
  software_policies: SoftwarePolicy[],
  expected_config_revision: string
}
```

返回：

```json
{
  "plan_id": "...",
  "kind": "move",
  "requires_approval": true
}
```

`rebind` 只创建变更计划，不直接写服务器表。

创建前已经完成计划创建审批；响应中的 `requires_approval` 指后续执行仍需在 `apply` 中取得一次人工批准。创建计划和实际执行是两个不同操作，不区分审批等级。

`target_group` 使用服务器分组 ID 或 `null`；省略 `target_type` 时，仅在当前类型仍适用的情况下保留它，不自动选择新类型。revision 使用服务端返回的十进制字符串，避免数据库 bigint 经 JavaScript number 转换后丢失精度。

### 流程

```text
读取当前 group/type 和配置 revision
→ 校验目标分组及其允许的类型
→ 使用显式选择的目标类型；未指定时仅保留仍适用的当前类型
→ 缺少适用的类型选择时拒绝并要求显式选择
→ 展示请求摘要，取得审批
→ 复核源配置，生成 kind=move 计划并排队只读预检
→ 计算软件需求差异，冻结预检目标
→ show 展示计划
→ apply 人工审批
→ 执行
```

### 移动分组

- 目标可以是普通分组，也可以是提供者有效、当前可用的系统分组，沿用现有类型目录规则
- `target_group = null` 表示未分组，不传工作区的 `unassigned` 或 `general` 标识
- 目标分组必须存在，目标类型必须在该分组和服务器操作系统下适用；提供者已卸载时拒绝
- 不允许因为移动分组而静默更改类型
- 如果当前类型在新分组不可用，必须拒绝并提示选择类型

只移动分组、类型、软件需求和策略均不变，且当前软件已满足要求时，不产生软件变更。若实际缺失软件或目标组的约束变化，仍需展示预检差异，按显式的 `install_missing` 和冻结计划处理，不能仅因类型键相同就跳过检查。

### 更改类型

目标类型变化时，必须计算：

```text
新增软件
已满足软件
缺失软件
不再需要的软件
软件策略变化
```

`install_missing` 必须显式传入：

```text
true  → 计划包含缺失软件安装
false → 对缺失软件生成 defer-install，明确记录差距，不执行这些安装
```

不能默认静默安装。

这与现有移动计划一致：`install_missing=false` 可以在确认差距后提交新归属，不能因此声称必要软件已全部就绪。它只控制缺失软件的安装；已安装软件不满足目标策略时仍可能需要替换，必须在执行计划的同一次审批中展示替换内容并取得批准，不能自动批准替换。

类型切换后，旧类型不再需要的软件：

```text
不自动卸载
只标记为“不再受当前类型管理”
```

### 软件差异和审批

变更计划必须展示：

```text
旧分组 → 新分组
旧类型 → 新类型
新增软件
缺失软件
不再需要的软件
软件策略变化
是否安装缺失软件
```

`rebind` 创建计划与后续 `apply` 执行各自按操作请求一次审批，纯移组也沿用相同方式。软件安装、替换、可能降级、服务影响和策略变化必须在执行审批中展开，不因变更种类增加确认次数。

### 失败顺序

不能先更新 `group_id/type_key` 再安装软件。

正确顺序：

```text
预检
→ 审批
→ 软件变更
→ 验证
→ 更新服务器归属和类型
```

`defer-install` 验证的是缺失状态与计划快照一致，不要求已经安装。软件执行中失败时不提交新归属；若远端已有部分变更，必须记录并进入现有失败／恢复流程，不承诺远端已经回滚。

如果先提交类型再安装软件，安装失败会留下“新类型、旧软件”的不一致状态。

### 审计

记录：

```text
server_id
旧分组
新分组
旧类型
新类型
新增软件
移除策略
install_missing
plan_id
审批
执行结果
```

### 计划执行

`rebind` 创建的计划和升级计划统一通过变更计划执行：

```text
platform_server_upgrade_admin.show(plan_id)
platform_server_upgrade_admin.apply(plan_id)
platform_server_upgrade_admin.cancel(plan_id)
```

`apply` 的审批、冻结摘要、维护窗口与执行规则见第 6 节。显示工具名保留 `upgrade_admin`，实际统一承接 `move/upgrade` 变更计划；不得因为名称而拒绝合法的移组计划。

## 8.5 并发控制

`update`、`rebind`、凭据切换和服务器删除必须携带服务端返回的十进制字符串：

```text
expected_config_revision
```

revision 不匹配时返回：

```json
{
  "code": "server_revision_conflict"
}
```

单用户仍可能从多个页面或并行工具修改同一资源，所以保留并发校验。AI 管理入口在调用原有编辑服务前检查 expected revision，并在审批后锁内再次核对快照；现有 Web 编辑接口保留其原有契约。

现有 `config_revision` 仅对影响执行的配置变化递增；名称、地区等普通元数据编辑不递增。为同时保护审批期间的元数据变化，服务端还需冻结参与本次变更的旧值摘要，提交时在锁内核对。revision 或审批快照任一变化都拒绝旧操作，不通过扩大配置 revision 的用途让普通名称变更使软件计划失效。

查询工具需提供 revision；审批快照由服务端生成并保留到本次提交，不能只比较 AI 自报的旧值。`rebind` 在创建计划时先校验期望修订，之后复用目标快照和计划确认检查。

## 8.6 修改流程

```text
读取当前值
→ 生成 diff
→ 一次人工审批
→ 在短事务中锁定记录，复核 revision 与审批快照
→ 同一事务内写入配置和管理审计，在需要时排队复测
→ 返回保存状态及测试任务
→ 异步测试完成后记录实际连接结果
```

## 8.7 删除服务器

建议单独 action：

```text
delete
```

要求：

- 一次人工审批，展示目标服务器及删除影响
- 无 `claimed/running/recovering` 活动任务
- 展示并确认将取消的排队任务、待执行计划和目标
- 审计保留服务器快照

复用现有 `deleteServer`：事务内拒绝活动任务，取消排队任务及待执行计划／目标后删除登记。已经完成的历史计划和任务不阻止删除，继续保留身份和快照；不能将“无关联升级计划”解释成必须清除历史。

如果待取消计划包含其他服务器，审批必须展示计划级影响；不能以单服务器删除静默批准取消其他目标。审批后出现新的相关任务或计划时重新审查。删除登记不删除远端服务器、容器或软件。

## 8.8 审批

| 操作 | 审批 |
|---|---|
| update | 是 |
| rebind | 创建计划、执行计划各审批一次 |
| delete | 是 |

---

# 9. 审计模型

现有 `server_audit_log.kind` 包含：

```text
command
upload
download
transfer
```

新增管理事件类别：

```text
admin
```

同时使用通用目标与管理事件元数据：

```text
tool_name
metadata.action
metadata.target_type
metadata.target_id
metadata.before
metadata.after
metadata.parameters
```

审计记录必须包含：

```text
唯一平台账号
调用来源（AI 工具或 Web）
会话／agent／工具调用 id（AI 调用时）
action
目标类型
目标 id
变更前
变更后
审批
结果
错误
```

目标类型至少区分 `server/group/key/plan/audit_policy/audit_export`。无关联服务器的分组、密钥或保留策略操作不伪造 `server_id`、服务器名或主机；迁移 `0033_server_admin.sql` 已调整服务器快照的非空限制，保留旧命令／传输事件的读取兼容。

账号是唯一的平台用户，agent 仅表示执行来源；不记录或新增账号权限组和审批等级。审批记录包含请求标识、参数／计划摘要、用户决策和时间，来自现有审批通道。新增管理事件从唯一账户读取账号，使用 `actor_kind` 区分 Harness、Web 和定时执行；调用 ID 关联审批。计划确认仍使用原有字段，管理审计同时记录完整确认参数与结果。

数据库迁移、DTO、查询、导出和审计页面均已支持 `admin` 与 `metadata`。分组或密钥创建后记录实际资源 ID，服务器删除后保留名称和主机快照。

管理写入与审计应在同一数据库事务提交。远端操作在变更前持久记录意图及审批，按阶段更新结果；结果未知时可核对恢复，不能将“审计未落库”误报为“远端没有执行”。变更前后快照均只保留允许展示的字段，不记录私钥、密码、密文或一次性下载凭据。

密钥 reveal 只记录：

```text
key_id
fingerprint
action=reveal
```

不记录私钥内容。

这里的“只记录”限制密钥内容；通用账号、调用关联、审批和结果字段仍然保留。

---

# 10. 审批矩阵

| 操作 | 审批 |
|---|---|
| 分组 list | 否 |
| 分组 create/rename | 是 |
| 分组 delete | 是 |
| 密钥 list | 否 |
| 密钥 create | 是 |
| 密钥 delete/rotate | 是 |
| 密钥 reveal | 是 |
| 升级 check | 否 |
| 升级 plan | 是 |
| 计划 show | 否 |
| 升级 apply | 是 |
| 计划 cancel | 是 |
| 审计 query | 否 |
| 审计 export | 是 |
| 审计 retention | 是 |
| 服务器 update | 是 |
| 服务器 rebind | 创建计划、执行计划各审批一次 |
| 服务器 delete | 是 |

---

# 11. 实施顺序

```text
1. 复用现有单用户登录、Harness 调用入口和一次人工审批，接入管理审计
2. 分组管理，补齐审批快照与现有删除规则的衔接
3. 服务器信息修改，补齐 revision／旧值校验和连接复测结果表达
4. 密钥列表、生成和删除
5. 单服务器升级与 rebind，复用现有变更计划执行
6. 单服务器密钥轮换，补齐远端公钥部署、阶段记录和失败恢复
7. 审计查询、导出与保留策略
8. 密钥 reveal 的人工一次性导出
9. AI 批量入口（另行设计）
```

所有修改工具从首次开放起就接入管理审计，不等到审计查询／导出工具实现后再补记。`reveal` 在单服务器管理能力之后实施，因为它直接向人工交付密钥材料。

---

# 12. 测试要求

至少覆盖：

```text
唯一用户通过现有可信入口调用 → 不要求新增角色或权限组
HTTP 未登录／AI 缺少所需执行上下文 → 拒绝
审批通道缺失、用户拒绝或取消 → 无目标业务写入或远端变更
每个需要审批的操作 → 用户确认一次，不额外输入目标名称或重复弹窗
AI 自报 approved → 不能替代人工审批
系统分组删除 → 拒绝
全部服务器／未分组视图 → 不能作为真实分组删除
分组含非空置服务器 → 拒绝删除
分组仅含满足解绑条件的空置服务器 → 展示解绑影响，审批后转为未分组并删除
分组审批期间成员变化 → 拒绝沿用旧审批
有服务器引用的密钥删除 → 拒绝
密钥生成 → AI 参数、输出与审计中均无私钥
轮换新公钥部署或新连接验证失败 → 旧引用和旧公钥保持可用
轮换引用已切换但旧公钥清理失败 → 保留可用新连接，记录待清理
共享密钥轮换单台服务器 → 不修改其他服务器引用，不自动删除旧密钥
修改服务器 revision 冲突 → 拒绝
审批期间名称／地区变化，即使配置 revision 未变 → 旧值快照校验拒绝覆盖
连接配置保存后复测失败 → 分别报告保存成功与连接失败，不伪报回滚或连接可用
internal_host／tags／密文等非开放字段 → 拒绝普通编辑
移动分组导致当前类型不可用 → 要求显式选择类型
目标系统分组不可用或类型不适用 → 拒绝
rebind 未审批直接 apply → 拒绝
install_missing=false → 缺失项为 defer-install，不安装，不伪报软件已就绪
rebind 不自动卸载旧类型软件
升级未审批、预检未完成、计划过期或摘要／修订漂移 → 拒绝 apply
计划取消 → 不强杀已开始的软件变更
审计单条删除 → 拒绝
无关联服务器的管理事件 → 可记录通用目标与完整审批信息
保留策略归档失败 → 不删除待归档记录
密钥 reveal → 仅人工一次性下载，正文和下载凭据不进入 AI 输出／审计
删除服务器有 claimed/running/recovering 任务 → 拒绝
删除服务器有待执行任务／计划 → 审批展示取消范围，确认后取消并保留历史
远端部分完成后失败 → 保留阶段事实，不宣称远端回滚
```

---

# 13. 非目标

第一版不做：

- AI 批量升级入口（现有 Web 批量能力保留）
- 批量密钥轮换
- 多服务器批量修改
- 审计记录单条删除
- 密钥明文写入审计
- 新增账号、角色、权限组、多用户 RBAC 或逐服务器 ACL
- 复用工作区组或服务器分组作为权限组
- 通过 AI 参数／输出传递私钥或密码

## 14. 源码与相关文档

- [单用户登录与敏感数据](../../framework/operations/auth-and-secrets.md)
- [现有工具登记](../../../plugins/server-management/src/host/harness/tools.ts)
- [分组规则](../../../plugins/server-management/src/host/groups/service.ts)
- [密钥导入与删除](../../../plugins/server-management/src/host/keys/service.ts)
- [服务器编辑与删除](../../../plugins/server-management/src/host/servers/service.ts)
- [变更计划](../../../plugins/server-management/src/host/changes/service.ts)
- [软件差异与 defer-install](../../../plugins/server-management/src/host/recipes/planning.ts)
- [管理工具与生命周期](../../../plugins/server-management/src/host/admin/runtime.ts)
- [管理领域入口](../../../plugins/server-management/src/host/admin/service.ts)
- [管理审计、下载与轮换存储](../../../plugins/server-management/src/host/admin/persistence/repository.ts)
- [数据库迁移](../../../plugins/database/migrations/0033_server_admin.sql)
- [管理流程集成测试](../../../plugins/server-management/test/admin.integration.test.ts)
