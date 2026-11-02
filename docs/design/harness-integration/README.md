# Harness 接入服务器管理方案

- 状态：方案草案
- 日期：2026-10-22
- 分支：`ces/harness-integration`
- 范围：服务器管理插件与 DeepSeek Harness 对话的工具接入

## 1. 目标

让 Harness 对话能够：

1. 查看本平台管理的服务器列表
2. 查看单台服务器状态
3. 通过 SSH 在服务器上执行命令
4. 在“服务器运维”组内管理服务器资产
5. 后续接入巡检、变更计划等操作

原则：

- 只操作本平台清单内的服务器
- Harness 不直接接触私钥、密码和任意 SSH 目标
- 只读操作默认允许
- 执行操作受权限模式控制
- 危险操作可审批
- 全程审计

## 2. 总体架构

```text
Harness 对话
    │
    ▼
工具注册表 ctx.tools
    │
    ▼
ServerManagementHarness 适配层
    │
    ├── 服务器目录 / 状态
    ├── 凭据解密
    ├── SSH 连接与执行
    └── 审计
    │
    ▼
服务器管理数据库 / 远端服务器
```

工具本身只做参数解析和结果展示；业务逻辑集中在适配层。

## 3. 能力分层

### 3.1 只读工具

| 工具 | 作用 |
| --- | --- |
| `platform_server_list` | 列出平台服务器 |
| `platform_server_get` | 查看单台服务器状态 |

特点：

- 默认允许
- 不返回 secret
- 不建立 SSH 连接
- 只查询平台数据库和已有观察

### 3.2 执行工具

| 工具 | 作用 |
| --- | --- |
| `platform_server_exec` | 通过 SSH 执行命令 |

特点：

- 必须解析到平台服务器
- 必须使用平台保存的凭据
- 有超时、输出和并发限制
- 受权限模式控制
- 全程审计

### 3.3 服务器资产工具（仅服务器运维组）

| 工具 | 作用 |
| --- | --- |
| `platform_server_add` | 登记服务器 |
| `platform_server_remove` | 移除服务器 |
| `platform_server_group_create` | 创建服务器分组 |
| `platform_server_group_move` | 移动服务器分组 |
| `platform_server_type_change` | 变更服务器类型 |
| `platform_server_upgrade` | 创建升级计划 |

这些工具只管理“服务器资产”，不是普通会话使用服务器的方式。

约束：

- 只在当前会话属于 `server-ops` 组时可用
- 需要在服务层再次检查 `server:write` 能力
- 删除、变更类型、升级需要预检和确认
- 不能绕过现有的变更计划、租约和审计

### 3.4 后续工具

| 工具 | 作用 |
| --- | --- |
| `platform_server_inspect` | 触发巡检 |
| `platform_server_plan` | 创建安装／升级计划 |
| `platform_server_plan_status` | 查看计划 |

这些工具只创建任务或计划，不直接执行变更。

## 4. 工具命名

统一使用 `platform_` 前缀：

```text
platform_server_list
platform_server_get
platform_server_exec
```

原因：

- 与外部服务器、通用 SSH 工具区分
- 减少工具名冲突
- 让模型明确这是平台内服务器

描述中仍要写清楚边界：

```text
Only servers returned by platform_server_list are managed by this platform.
Never connect to an arbitrary host.
```

## 5. 服务器解析

### 5.1 输入

工具只接受：

```ts
{
  server: string // 平台服务器 ID 或名称
}
```

不接受：

```text
host
port
username
password
private_key
```

### 5.2 解析顺序

1. 按 ID 精确匹配
2. 按名称匹配
3. 名称唯一：返回
4. 名称重复：返回 `server_ambiguous`
5. 找不到：返回 `server_not_managed`

### 5.3 错误

```json
{
  "code": "server_not_managed",
  "message": "这台服务器不在本平台管理范围内"
}
```

```json
{
  "code": "server_ambiguous",
  "candidates": [
    {"id": "...", "name": "web-01", "host": "..."}
  ]
}
```

不允许在解析失败时回退到任意 SSH。

## 6. 工具定义

### 6.1 `platform_server_list`

参数：

```ts
{
  query?: string
  group?: string // group id or exact name from platform_server_group_list
  status?: string
  page?: number
  page_size?: number
}
```

返回：

```json
{
  "total": 42,
  "page": 1,
  "page_size": 20,
  "pages": 3,
  "items": [
    {
      "id": "...",
      "name": "web-01",
      "host": "192.0.2.10",
      "group": {
        "id": "...",
        "name": "生产",
        "name_i18n": { "zh": "生产", "en": "Production" }
      },
      "type": "容器服务器",
      "status": "normal",
      "software": {
        "docker": "29.1.3"
      },
      "last_checked_at": "..."
    }
  ]
}
```

不返回：

- 私钥
- 密码
- secret_ciphertext
- 完整环境变量

### 6.2 `platform_server_group_list`

参数：

```ts
{
  query?: string
  page?: number
  page_size?: number
}
```

返回：

```json
{
  "total": 2,
  "page": 1,
  "page_size": 20,
  "pages": 1,
  "ungrouped": 3,
  "items": [
    {
      "id": "...",
      "name": "生产",
      "name_i18n": { "zh": "生产", "en": "Production" },
      "kind": "user",
      "server_count": 12
    }
  ]
}
```

用途：

- 让模型发现可用的分组名称和 ID
- 再用 `platform_server_list.group` 筛选服务器
- 不返回服务器凭据或服务器列表

### 6.3 `platform_server_get`

参数：

```ts
{
  server: string
}
```

返回：

- 基本信息
- 连接状态
- OS 核验
- 软件状态
- 最近巡检
- 最近任务
- 容器摘要
- 最近错误

### 6.4 `platform_server_exec`

参数：

```ts
{
  server: string
  command: string
  timeout_ms?: number
  command_max_bytes?: number
  output_limit_bytes?: number
}
```

返回：

```json
{
  "exit_code": 0,
  "stdout": "...",
  "stderr": "",
  "stdout_truncated": false,
  "stderr_truncated": false,
  "duration_ms": 123
}
```

限制：

- 命令最大长度：默认 8192 字节
- 超时：默认 30 秒，最大 120 秒
- 捕获输出：默认 64 KiB，最大 1 MiB
- 审计输出摘要：固定 4 KiB
- 单服务器并发：1

工具参数不传时使用平台默认值；传入时只能小于等于管理端配置的最大值。

### 6.5 执行限制配置

执行限制由管理员在：

```text
平台设置 → Harness → 服务器管理
```

配置，不允许 AI 直接修改全局限制。

新增设置项：

| 设置 | 默认值 | 可配置最大值 | 说明 |
| --- | --- | --- | --- |
| 默认命令超时 | 30 秒 | 120 秒 | 未传 `timeout_ms` 时使用 |
| 最大命令超时 | 120 秒 | 120 秒 | AI 单次调用的硬上限 |
| 默认命令字节数 | 8192 | 65536 | 未传 `command_max_bytes` 时使用 |
| 最大命令字节数 | 65536 | 65536 | AI 单次调用的硬上限 |
| 默认捕获输出 | 64 KiB | 1 MiB | 未传 `output_limit_bytes` 时使用 |
| 最大捕获输出 | 1 MiB | 1 MiB | AI 单次调用的硬上限 |

约束：

- 默认值不能大于对应最大值
- 所有值必须为正整数
- AI 只能调整单次调用参数，不能修改平台设置
- 修改设置后，新注册的工具 schema 使用新值
- 运行中的调用不受影响
- 审计输出摘要不参与 AI 调整，固定为 4 KiB

工具 schema 的描述会由当前配置动态生成，例如：

```text
timeout_ms: Defaults to 30000; maximum 120000.
command_max_bytes: Defaults to 8192; maximum 65536.
output_limit_bytes: Defaults to 65536; maximum 1048576.
```

模型从工具 schema 读取这些值；如果配置被修改，需要重新加载插件或重启对应进程后，模型才会看到新的描述。

存储建议：

```text
server_management_settings
  id boolean primary key
  default_timeout_ms integer not null
  max_timeout_ms integer not null
  default_command_bytes integer not null
  max_command_bytes integer not null
  default_output_bytes integer not null
  max_output_bytes integer not null
  updated_by text
  updated_at timestamptz not null
```

这是平台级单例设置，不按服务器保存。

文件上传/下载的独立方案：

```text
./file-transfer.md
```

## 7. 权限模型

### 7.1 模式

```text
read   只读
exec   可执行，需要审批
full   完全权限，自动批准执行
```

### 7.2 工具行为

服务器使用能力对所有对话开放：

| 模式 | list/get | exec |
| --- | --- | --- |
| read | 允许 | 拒绝 |
| exec | 允许 | 逐次审批 |
| full | 允许 | 自动允许 |

服务器资产工具只在“服务器运维”组开放：

| 工具 | 其他对话 | 服务器运维组 |
| --- | --- | --- |
| `platform_server_list` | 允许 | 允许 |
| `platform_server_get` | 允许 | 允许 |
| `platform_server_exec` | 允许，受模式控制 | 允许，受模式控制 |
| `platform_server_add` | 拒绝 | 允许 |
| `platform_server_remove` | 拒绝 | 允许 |
| `platform_server_group_create` | 拒绝 | 允许 |
| `platform_server_group_move` | 拒绝 | 允许 |
| `platform_server_type_change` | 拒绝 | 允许 |
| `platform_server_upgrade` | 拒绝 | 允许 |

执行时同时检查：

```text
1. 当前会话组是否为 server-ops（仅资产工具）
2. 调用者是否具备对应能力
3. 服务器是否在调用者范围内
4. 是否需要审批
```

组检查是产品边界，能力检查是安全边界，两者都不能省略。

### 7.3 完全权限

完全权限下可以跳过交互审批，但仍保留：

- 平台服务器归属检查
- 凭据保护
- 超时
- 输出限制
- 并发限制
- 审计

“完全权限”不等于“可以连接任意主机”。

## 8. 审批接入

通过工具前置门实现：

```ts
ctx.on('tools/pre-execute', async (exec, next) => {
  if (exec.name !== 'platform_server_exec') return next()
  if (permission.mode === 'full') return next()
  if (permission.mode === 'read')
    return { kind: 'deny', reason: '当前模式不允许执行服务器命令' }
  return {
    kind: 'ask',
    reason: '在平台服务器上执行命令',
    displayReason: {
      zh: '是否允许在服务器上执行这条命令？',
      en: 'Allow this command to run on the server?',
    },
  }
})
```

没有审批服务时，`ask` 必须拒绝，不能静默执行。

## 9. SSH 执行

### 9.1 流程

1. 解析服务器
2. 读取服务器连接信息
3. 解密凭据
4. 建立 SSH 连接
5. 执行命令
6. 截断输出
7. 关闭连接
8. 写审计

### 9.2 约束

- 不使用用户传入的 host／port
- 不把私钥返回给模型
- 不使用本地 shell 拼接命令
- 不执行交互式命令
- 超时后关闭连接
- 调用取消时中止执行

### 9.3 命令工作目录

默认使用 SSH 用户 home；如需指定目录，使用单独参数，不接受任意注入。

## 10. 审计

### 10.1 目标

审计表不是任务表，也不是普通日志，而是一条按时间排列的操作流水。它必须能回答：

- 谁发起的
- 来自哪个 Harness 会话和 Agent
- 是否经过审批
- 在哪个服务器上做了什么
- 执行结果和耗时
- 输出是否截断

采用一张统一表，用 `kind` 区分命令和文件传输：

```text
server_audit_log
```

### 10.2 完整结构

```sql
create table server_audit_log (
  id                  uuid primary key,
  kind                text not null check (kind in ('command','upload','download')),
  server_id           uuid references servers(id) on delete set null,
  server_name         text not null,
  host                text not null,

  actor_id            text not null,
  actor_kind          text not null,
  harness_session_id  text,
  agent_id            text,
  harness_turn        integer,
  harness_step        integer,
  harness_event_seq   bigint,
  tool_call_id        text,
  root_tool_call_id   text,
  parent_tool_call_id text,
  tool_name           text not null,

  permission_mode     text not null,
  approval_status     text not null,
  approval_id         text,
  approved_by         text,
  approved_at         timestamptz,
  approval_reason     text,

  command             text,
  command_digest      text,
  command_length      integer,
  command_truncated   boolean not null default false,
  redaction_applied   boolean not null default false,
  cwd                 text,

  remote_path         text,
  local_path          text,
  bytes               bigint,
  sha256              text,
  mode                text,
  overwrite           boolean not null default false,

  status              text not null,
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  duration_ms         integer,
  exit_code           integer,
  signal              text,
  timed_out           boolean not null default false,
  cancelled           boolean not null default false,
  error_code          text,
  error_message       text,

  stdout_excerpt      text,
  stderr_excerpt      text,
  stdout_bytes        bigint,
  stderr_bytes        bigint,
  stdout_truncated    boolean not null default false,
  stderr_truncated    boolean not null default false,
  stdout_digest       text,
  stderr_digest       text,

  metadata            jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  check (
    (kind = 'command' and command is not null and remote_path is null)
    or (kind in ('upload','download') and remote_path is not null and command is null)
  )
);
```

### 10.3 kind 与专属字段

| kind | 必填专属字段 | 其他字段 |
| --- | --- | --- |
| `command` | `command` | `command_digest`, `exit_code`, stdout/stderr |
| `upload` | `remote_path` | `bytes`, `sha256`, `mode`, `overwrite` |
| `download` | `remote_path` | `bytes`, `sha256`, `local_path` |

公共字段包括服务器快照、调用者、会话、审批、状态、时间、错误和 metadata。

### 10.4 字段说明

| 分组 | 字段 | 说明 |
| --- | --- | --- |
| 类型 | `kind` | `command` / `upload` / `download` |
| 服务器快照 | `server_id`, `server_name`, `host` | 删除服务器后仍可追溯 |
| 调用者 | `actor_id`, `actor_kind` | 用户／系统／Harness |
| 会话 | `harness_session_id`, `agent_id`, `harness_turn`, `harness_step` | 回到具体会话和轮次 |
| 轨迹 | `harness_event_seq`, `tool_call_id`, `root_tool_call_id`, `parent_tool_call_id` | 工具调用和嵌套调用 |
| 权限 | `permission_mode` | `read` / `exec` / `full` |
| 审批 | `approval_status`, `approval_id`, `approved_by`, `approved_at`, `approval_reason` | 审批服务返回 |
| 命令 | `command`, `command_digest`, `command_length`, `command_truncated` | 脱敏命令和原始摘要 |
| 文件 | `remote_path`, `local_path`, `bytes`, `sha256`, `mode`, `overwrite` | 文件传输信息 |
| 结果 | `status`, `started_at`, `finished_at`, `duration_ms` | 执行状态和耗时 |
| 结果 | `exit_code`, `signal`, `timed_out`, `cancelled` | 命令退出和取消 |
| 输出 | `stdout_excerpt`, `stderr_excerpt`, `stdout_bytes`, `stderr_bytes` | 摘要和字节数 |
| 输出 | `stdout_truncated`, `stderr_truncated`, `stdout_digest`, `stderr_digest` | 截断标记和摘要 |
| 其他 | `metadata`, `created_at` | 非敏感上下文和创建时间 |

### 10.5 索引

```sql
create index server_audit_log_created
  on server_audit_log (created_at desc, id desc);
create index server_audit_log_kind_time
  on server_audit_log (kind, created_at desc);
create index server_audit_log_server_time
  on server_audit_log (server_id, created_at desc);
create index server_audit_log_actor_time
  on server_audit_log (actor_id, created_at desc);
create index server_audit_log_session
  on server_audit_log (harness_session_id);
create unique index server_audit_log_tool_call
  on server_audit_log (harness_session_id, tool_call_id)
  where harness_session_id is not null and tool_call_id is not null;
```

### 10.6 写入流程

命令执行：

```text
解析服务器
→ 权限检查
→ 审批
→ 写 pending 审计（kind=command）
→ SSH 执行
→ 更新结果
```

文件传输：

```text
解析服务器
→ 路径和大小校验
→ 审批
→ 写 pending 审计（kind=upload/download）
→ SFTP 传输
→ 更新结果
```

审批被拒绝时：

```text
写 denied 审计
→ 不建立 SSH/SFTP 连接
```

### 10.7 隐私与保留

不记录：

- 私钥
- 密码
- 完整 secret
- 完整环境变量

约束：

- 命令和输出摘要写入前必须脱敏
- 文件内容不落审计，只记录路径、大小和 SHA-256
- 删除服务器不删除历史审计
- 审计只追加，不通过业务接口删除
- 审批信息必须来自审批服务，不能由模型填写
- 审计记录与工具调用 ID 关联，便于从 Harness 会话回到服务器历史
- 后续可增加保留期限和归档策略，初版不自动清理

## 11. 系统提示

在服务器管理插件中注册：

```text
When the user asks about a managed server's status, health, software,
containers, tasks or recent errors, call platform_server_list or
platform_server_get instead of guessing.

Only servers returned by platform_server_list are managed by this platform.
Never assume localhost, an IP address, or an SSH target is managed.

For commands on a managed server, use platform_server_exec.
```

## 12. 与“服务器运维”工作区组的关系

工作区组负责：

- 会话组织
- 运维默认工作区
- 会话模板

工具负责：

- 实际访问服务器

两者独立：

```text
服务器运维组 = 入口和上下文
platform_* 工具 = 能力
```

使用服务器的工具对所有对话注册；管理服务器资产的工具只在 `server-ops` 组注册或执行。
组只是产品边界，真正的授权仍在服务层检查。

## 13. 代码结构

建议新增：

```text
plugins/server-management/src/host/harness/
  service.ts      服务器解析、list/get/exec
  tools.ts        工具注册
  approval.ts     权限和审批
  audit.ts        审计写入
  schema.ts       工具参数
```

在 `src/index.ts` 中：

```ts
ctx.inject(['tools'], (child) => {
  registerServerHarnessTools(child, deps)
})
```

使用可选子注入，避免没有 Harness 工具服务时阻塞服务器管理插件启动。

## 14. 测试

至少覆盖：

- 列表不泄露 secret
- 按 ID／名称解析
- 同名服务器返回歧义
- 未管理服务器拒绝
- read 模式拒绝 exec
- exec 模式触发审批
- full 模式跳过审批
- 审批拒绝不执行
- 命令超时
- 输出截断
- 非零退出码
- SSH 断开
- 插件卸载时关闭连接

## 15. 分阶段落地

### 第一阶段

```text
platform_server_list
platform_server_get
```

只读，先让 Harness 回答服务器状态。

### 第二阶段

```text
platform_server_exec
```

加审批、超时、输出限制、审计。

### 第三阶段

```text
platform_server_inspect
platform_server_plan
platform_server_plan_status
```

接入巡检和变更计划。

### 第四阶段

```text
platform_server_add
platform_server_remove
platform_server_group_create
platform_server_group_move
platform_server_type_change
platform_server_upgrade
```

只对“服务器运维”组开放，并复用现有预检、确认、租约和审计。

## 16. 验收标准

- Harness 能列出平台服务器
- Harness 能按名称查询单台状态
- 外部主机不会被视为平台服务器
- 只读模式不能执行命令
- 普通模式执行前必须审批
- 完全权限自动批准，但仍受边界和审计约束
- 命令输出不含 secret
- 所有执行都有审计记录
- 非运维组不能调用服务器资产工具
- 运维组内的资产工具仍受能力和确认约束
