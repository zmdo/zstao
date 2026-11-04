# MatrixMedia 接入插件设计

- 状态：暂缓（保留方案，暂不实现）
- 决策时间：2026-11-04
- 日期：2026-11-04
- 分支：`feat/matrixmedia`
- 目标项目：[hanliang97/MatrixMedia](https://github.com/hanliang97/MatrixMedia)
- 目标：在 CES 中增加一个“矩阵媒体”插件，通过 MatrixMedia 的 API 完成多平台视频发布、账号/历史查看和后续的数据统计
- 结论：**可以接入，但必须增加一个部署在 MatrixMedia 主机上的本地网关（Gateway）**。不能让 CES 直接访问 MatrixMedia 的 `127.0.0.1:30088`。

## 0. 已确认决策

1. **部署平台**：优先专用 Windows 主机；macOS 为备选；Linux + Xvfb 仅作为实验性方案。
2. **网络**：CES 与 MatrixMedia 在同一内网，Gateway 只监听内网地址，不对公网开放。
3. **媒体流转**：视频由其他生成服务产出并上传对象存储；CES/工作流保存对象引用，发布时解析成 MatrixMedia 可下载的 URL。
4. **审批**：发布前必须有审批；审批通过后直接进入发布，不再做二次确认。
5. **平台范围**：不在代码中写死平台列表；由 MatrixMedia 的 `/platforms` 返回，CES 通过配置启用/禁用。

## 0.1 暂缓决定

当前优先服务国内平台。调研后暂未找到能同时满足以下条件的成熟替代：

- 覆盖抖音、快手、视频号、小红书、B站、百家号、头条、番茄视频
- 有稳定、公开、可自助接入的发布 API
- 可自托管或成本可控
- 不依赖某一家商业公司的封闭接口

因此：

- MatrixMedia 接入方案保留为设计文档，暂不进入开发。
- 不把 MatrixMedia 部署和 Gateway 加入当前部署计划。
- 如果后续必须做国内矩阵发布，再按本文的 Gateway 方案实施。
- 优先级更高的替代路线先做调研/试用：蚁小二企业 API、官方开放平台（抖音等）、MediaX；海外平台可考虑 Postiz。

**重启条件**（任一满足即可重新评估）：

1. 国内平台官方发布 API 权限可稳定申请。
2. 蚁小二企业 API 的覆盖、配额、价格经实际试用验证。
3. 业务明确接受商业闭源服务，并承担订阅成本。
4. 需要覆盖的国内平台数量减少，可用官方 API 组合完成。

## 1. 调研结论

MatrixMedia（矩媒）是一个基于 Electron 的自媒体矩阵发布工具，支持：

- 抖音、快手、视频号、小红书、哔哩哔哩、百家号、头条、番茄视频
- 本地视频或 `http(s)` 远程视频 URL
- 单平台/多平台发布
- 草稿、定时发布、创作声明、平台专属参数（如视频号商品/短剧/剧集）
- 账号数据、发布记录、评论互动
- GUI、CLI、HTTP API、MCP

参考：

- [项目 README](https://github.com/hanliang97/MatrixMedia)
- [HTTP API 文档](https://github.com/hanliang97/MatrixMedia/blob/main/docs/http-api.md)
- [MCP 文档](https://github.com/hanliang97/MatrixMedia/blob/main/docs/mcp.md)
- [项目内置 DSH 插件](https://github.com/hanliang97/MatrixMedia/tree/main/dsh-plugin)
- [官网文档](https://hanliang97.github.io/MatrixMedia/)

### 1.1 关键限制

MatrixMedia 的 HTTP API 不是公网多用户 API：

1. 只有在 **GUI 主进程运行** 时，内置 Express 服务才会监听。
2. 服务绑定在 `127.0.0.1:30088`，不监听公网地址。
3. `/publish`、`/changeData`、`/stats` 等接口有 `isTrustedLocalRequest` 守卫：
   - 请求带本次启动随机生成的 `X-Matrix-Token`，或
   - `Origin`/`Referer` 是 `localhost` / `127.0.0.1` / `[::1]`
4. Token 只通过 IPC 发给 MatrixMedia 自己的页面，外部脚本无法直接取得。
5. 平台登录需要在 GUI 中扫码；MCP/CLI 不能替所有平台完成扫码。
6. 多平台 `/publish` 返回 `submitted` 后，最终结果要查 `pushData` 发布记录或 CLI `history`。

因此：

- 直接把 `30088` 暴露到公网是不可接受的。
- 只把现有 `dsh-plugin`（stdio MCP）装到 CES 也不可行：它要求 MatrixMedia 桌面端与 DSH 在**同一台机器**上，而 CES 是服务器部署。
- 推荐在 MatrixMedia 主机上运行一个很小的 **MatrixMedia Gateway**，由它在本机访问 `127.0.0.1:30088`，再以受控 API 暴露给 CES。

## 2. 可行性判断

**可以写插件接入，但接入形态应是：**

```text
CES（Docker / 服务器 A）
        │  HTTPS + Bearer Token
        ▼
MatrixMedia Gateway（服务器 B / 与 MatrixMedia 同机）
        │  Origin: http://localhost:30088
        ▼
MatrixMedia GUI（127.0.0.1:30088）
        │
        └─ 浏览器/桌面登录态
```

不推荐：

```text
CES ─────► 公网 30088 ─────► MatrixMedia
        （无鉴权、仅 loopback 设计，不可取）
```

## 3. 推荐部署形态

### 方案 A：专用 Windows 主机 + Gateway（推荐）

- 一台长期在线的 Windows 11 主机/虚拟机运行 MatrixMedia GUI。
- 用 RDP / VNC 完成首次扫码登录；之后保持登录态。
- 同机运行 `matrixmedia-gateway`（Node 服务）。
- Gateway 只监听内网地址，例如 `10.0.0.20:30188`。
- CES 与 MatrixMedia 在同一内网，通过内网 HTTPS 或私有反代访问 Gateway。

推荐 Windows 的原因：

- MatrixMedia 官方提供 Windows/macOS 桌面端，Linux 不是官方一等桌面平台。
- GUI 自动化、Chrome/真实浏览器模式、远程桌面和无人值守在 Windows 上更容易维护。
- 可以把 MatrixMedia 作为独立小主机，避免与 CES 容器耦合和图形依赖污染。

macOS 也可以，适合团队已经以 Mac 为主的环境；不建议为了部署去维护 Linux 桌面/Xvfb 组合。

### 方案 B：macOS 主机 + Gateway（可选）

- 与方案 A 相同，只是宿主为 macOS。
- 适合已有 Mac mini/Studio 的团队。
- 必须处理 macOS 休眠、自动登录、系统更新和远程桌面。
- 真实浏览器发布模式在 macOS 上同样可用。

### 方案 C：Linux + Xvfb（实验性，不推荐生产）

- Linux 服务器安装 Electron 依赖，使用 Xvfb/虚拟显示运行 MatrixMedia。
- 通过 noVNC 或 VNC 完成扫码登录。
- Gateway 同机运行。

缺点：MatrixMedia 并非官方 Linux 无头服务器，桌面依赖、浏览器自动化、升级和排障成本高；只建议做技术验证。

### 方案 D：本地桌面 + 隧道（不推荐）

- 在个人电脑运行 MatrixMedia，通过 SSH 隧道把 30088 暴露给 CES。
- 只适合临时验证；电脑休眠、网络变化、登录态失效都会导致不可用。

### 3.1 内网与网络边界

已确认 CES 与 MatrixMedia 在同一内网，网络设计为：

```text
CES 容器
  │ 内网 HTTPS / 私有反代
  ▼
Gateway 10.0.0.20:30188（只监听内网）
  │ 127.0.0.1:30088
  ▼
MatrixMedia GUI
```

- Gateway 不绑定 `0.0.0.0`，只绑定内网网卡或回环 + 内网反代。
- CES → Gateway 走内网 HTTPS；证书可用内部 CA 或反代证书。
- Gateway → MatrixMedia 只走 loopback，不经过内网。
- 防火墙只允许 CES 所在网段访问 Gateway；MatrixMedia 主机的 30088 不允许被其他机器访问。
- 推荐开启 mTLS 或至少使用反向代理来源 IP 白名单 + Bearer Token。

### 3.2 对象存储媒体流

视频生成不在本插件内；生成服务完成视频后上传对象存储。推荐流转：

```text
视频生成服务
  → 对象存储（COS/S3/OSS）
  → 产生对象 key + 元数据
  → CES/工作流创建发布单
  → 审批通过
  → 发布执行时生成可下载 URL（预签名或对象存储网关 URL）
  → MatrixMedia 下载 URL 到临时目录
  → 上传到目标平台
```

设计约定：

- CES 保存 `MediaRef`，不保存视频二进制：

```ts
interface MediaRef {
  provider: 'cos' | 's3' | 'oss'
  bucket: string
  key: string
  contentType?: string
  size?: number
  checksum?: string
  expiresAt?: string
}
```

- 发布任务同时保存 `mediaRef` 和可选的直接 URL；直接 URL 只作为兼容入口。
- **预签名 URL 在发布执行时生成**，不要在提交审批时生成：
  - 审批可能等待数小时；提前生成的 URL 会过期。
  - 定时发布在到点执行时再生成 URL。
- URL 有效期应覆盖 MatrixMedia 下载视频的时间（建议至少 2 小时；大文件按大小调整）。
- MatrixMedia 主机必须能访问对象存储域名或内网 endpoint；不允许访问任意内网地址。
- URL 只出现在 host/gateway 内存中，不写入普通日志；需要审计时记录对象 key，不记录签名查询串。
- 没有对象存储时，P1 也允许手工填写 HTTPS 视频 URL，但仍需通过域名白名单。
- 工作流接入时，发布节点接收 `MediaRef`，而不是直接传大文件。

### 3.3 工作流接入约定

本插件不绑定具体工作流实现，给工作流暴露稳定的发布意图：

```ts
interface PublishIntent {
  media: MediaRef
  title: string
  description?: string
  tags?: string[]
  platforms: Array<{ platform: string; phone: string }>
  draft?: boolean
  scheduledAt?: string
}
```

工作流负责：

1. 视频生成完成并上传对象存储。
2. 生成 `MediaRef`。
3. 创建发布意图。
4. 进入审批节点。
5. 审批通过后触发插件发布。
6. 轮询发布 job，把结果写回工作流/仪表盘。

插件负责：

- 校验 `MediaRef`/URL。
- 执行时解析短期 URL。
- 调用 Gateway 发布。
- 返回 job id 和平台结果。

工作流与插件之间不传视频二进制，只传对象引用和元数据。

## 4. Gateway 设计

Gateway 是 CES 与 MatrixMedia 之间的唯一接口，职责：

- 在本机调用 MatrixMedia HTTP API（自动补 `Origin: http://localhost:30088`）。
- 对 CES 提供稳定、带鉴权的 `/v1/*` API。
- 统一错误、超时、重试和长任务状态。
- 隔离 MatrixMedia 的随机 `X-Matrix-Token` 和本地登录态。
- 不把 30088 暴露给 CES 或公网。

### 4.1 认证

- CES → Gateway：`Authorization: Bearer <gateway-token>`。
- Token 由部署时生成，保存在 CES 的服务端密钥/配置中，不进入浏览器。
- Gateway 只接受来自 CES 所在网段的请求；建议再加 mTLS 或私有网络 ACL。
- Gateway → MatrixMedia：本机 loopback，补 `Origin: http://localhost:30088`；不改变 MatrixMedia 的登录态。

### 4.2 Gateway API

```http
GET  /v1/health
GET  /v1/platforms
GET  /v1/accounts?platform=
GET  /v1/creative-statements
POST /v1/publish
GET  /v1/jobs/:id
GET  /v1/history?platform=&status=&days=
GET  /v1/stats?phone=&platform=
POST /v1/stats/sync
GET  /v1/works/stats?phone=&platform=&title=
```

- `/v1/publish` 统一封装 MatrixMedia `/publish`；单平台等待结果，多平台返回 `jobId`。
- `/v1/jobs/:id` 查询网关维护的发布任务；网关通过 MatrixMedia 发布记录/CLI history 对账。
- `/v1/accounts` 读取 MatrixMedia 账号（CLI `accounts --json` 或受控 `changeData`）。
- `/v1/history` 读取 MatrixMedia 发布记录（CLI `history --json`）。
- `/v1/stats` 转发 MatrixMedia 的 stats 接口。

### 4.3 任务模型

MatrixMedia 多平台发布会立即返回 `submitted`，最终结果异步写入发布记录。Gateway 需要：

1. 创建 gateway job，记录请求摘要和幂等键。
2. 调用 MatrixMedia `/publish`。
3. 单平台：返回最终结果。
4. 多平台：返回 `jobId`，后台轮询/查询发布记录，更新每个平台状态。
5. 对外状态：

```text
queued → submitted → running → partial | success | failed
```

- 网关重启后任务不能只存在内存；至少使用 SQLite/JSON 持久化 job 摘要。
- 相同幂等键的请求复用 job，不重复上传。

### 4.4 Gateway 部署

- Node.js 服务；建议 Docker 或 systemd。
- 与 MatrixMedia 同机；端口仅内网。
- 环境变量：

```text
MATRIXMEDIA_API=http://127.0.0.1:30088
MATRIXMEDIA_BIN=/path/to/matrixmedia
GATEWAY_TOKEN=<random>
GATEWAY_BIND=10.0.0.20
GATEWAY_PORT=30188
```

- 使用 `MATRIXMEDIA_BIN` 调用 CLI 读取账号/历史；若只依赖 HTTP，可逐步替换为 `/changeData`。
- Gateway 不保存 MatrixMedia 登录 cookie；登录态仍由 GUI 管理。

### 4.5 并发与队列

MatrixMedia 原生是**单并发**：

- 每个 MatrixMedia 实例只有一个发布任务队列，`taskBusy` 为真时后续任务排队。
- 一次多平台发布也是**逐个平台入队**，不会并行上传多个平台。
- 视频号任务之间还有额外等待（源码约 4 秒）。
- 账号统计采集建议与发布共用同一条串行队列，避免同一登录态被并发操作。

因此本方案：

- Gateway/CES 默认 `maxConcurrentPublishes = 1`：同一 MatrixMedia 实例同时只允许一个发布 job。
- 默认 `maxQueueSize = 20`；超过后拒绝新任务，提示稍后再试。
- 同一平台账号永远串行，即使未来把并发调大。
- 远程视频 URL 的下载发生在入队前；Gateway 必须用同一个并发闸门限制下载，避免多个 HTTP 请求同时下载大文件。
- 如果确实要提高吞吐，增加 MatrixMedia 实例/Gateway，按账号或平台路由；不要靠提高单实例并发。
- 统计、评论、发布在 Gateway 内共享队列或至少共享账号级互斥。

## 5. CES 插件形态

新增插件包：

```text
@smp/console-matrixmedia
```

（实现时使用 `@smp/console-matrixmedia`。）

### 5.1 侧边栏

建议注册为“矩阵媒体”栏目：

```ts
{
  name: 'console.page',
  key: 'matrixmedia',
  label: pageLabel(() => copy.title, {
    group: 'matrixmedia',
    groupLabel: () => copy.groupTitle, // 矩阵媒体
    icon: 'globe',                     // 或新增 video 图标
  }),
  order: 4,
}
```

P1 可以用单页面内 Tab：

- 发布
- 发布记录
- 设置（或放到“平台设置”）

如果拆成多个页面，使用 `navigation: 'sidebar'` 形成栏目子菜单；P1 建议单页面，降低入口复杂度。

### 5.2 页面布局

```text
矩阵媒体
[发布] [记录] [连接状态]

┌───────────────────────────────────────────────┬──────────────────┐
│ 媒体对象（对象存储 key / https://...）           │ 平台账号          │
│ 标题                                           │ ☑ 抖音 138...    │
│ 简介 / 标签                                    │ ☑ 视频号 138...  │
│ 平台选择                                       │ ☐ 小红书 ...      │
│ 草稿 / 定时                                     │                  │
│ [提交审批]                                     │ 网关状态          │
├───────────────────────────────────────────────┴──────────────────┤
│ 最近发布：标题 · 平台 · 状态 · 时间 · 查看详情                     │
└──────────────────────────────────────────────────────────────────┘
```

P1 字段：

- 媒体引用：对象存储 `MediaRef`（provider/bucket/key）或已经可用的 HTTPS URL
- 标题（必填）
- 简介
- 标签
- 账号/平台多选
- 草稿
- 可选定时时间
- 提交审批按钮（审批通过后自动发布，不再二次确认）

P2：

- 对象存储上传控件（生成服务仍可继续作为主链路）
- 封面
- 视频号商品/短剧/剧集字段
- 创作声明
- 平台专属参数

### 5.3 账号与平台

Gateway 返回：

```ts
interface MatrixAccount {
  platform: string             // 由 Gateway /platforms 返回，不写死
  platformName: string
  phone: string
  partition: string
  loggedIn: boolean
  displayName?: string
}
```

- CES 不保存 MatrixMedia 账号密码/cookie。
- 账号状态每次从 Gateway 读取，可缓存 30 秒。
- 已登录账号才能勾选；未登录提示去 MatrixMedia GUI 重新扫码。
- 多平台发布时，`platforms` 对象数组可分别指定 `phone`；P1 默认同一 `phone`，不同账号时逐平台选择。

### 5.4 发布记录

- 数据源：Gateway job + MatrixMedia history。
- 列：标题、平台、状态、提交时间、完成时间、失败原因。
- 状态：
  - `queued` / `submitted` / `running`
  - `success`
  - `partial`（部分平台成功）
  - `failed`
- 支持按平台/状态筛选；P2 支持重试。
- 发布结果详情展示每个平台的 `message`/`exitCode`。

### 5.5 发布审批

发布前必须有审批；审批通过后直接执行，不再做二次确认。

状态机：

```text
draft
  → pending_approval
  → approved
  → queued
  → submitted / running
  → success | partial | failed

pending_approval → rejected
draft/approved → cancelled
```

规则：

- 用户提交发布单后进入 `pending_approval`，不调用 MatrixMedia。
- 审批人通过后状态变为 `approved`，发布 worker 立即入队并调用 Gateway。
- **审批通过后不再弹“确认发布”对话框**；审批本身就是唯一确认。
- 被拒绝的发布单不能直接重试，必须修改内容后重新提交审批。
- 已审批内容和媒体引用不可静默修改；修改后审批失效，重新走审批。
- 审批记录写入 `approved_by`、`approved_at`、`approval_note`，并进入审计日志。
- 审批人/角色由配置决定；如果接入工作流，则由工作流审批节点推进状态。
- 定时发布仍在审批通过后排队，到点执行；到点不再次确认。

### 5.6 平台可配置

平台列表不写死：

- Gateway 的 `GET /v1/platforms` 返回 MatrixMedia 当前支持的平台、code、名称、别名和自动化状态。
- CES 配置可选 `enabledPlatforms`（允许列表）和 `disabledPlatforms`（排除列表）；空允许列表表示使用 Gateway 全部平台。
- 设置页展示当前启用平台；发布页只展示启用且已登录的平台。
- 新增平台时优先只更新 Gateway/MatrixMedia，CES 配置不需要发版；如果平台字段有特殊差异，由 Gateway 适配。
- 账号 DTO 的平台字段使用 `platform: string`，不使用封闭联合类型。
- 未知平台或 MatrixMedia 不支持的平台不显示在发布表单中。

### 5.7 设置

放在“平台设置”下，页面 key `matrixmedia-settings`：

- Gateway 地址（HTTPS/内网地址）
- Gateway Token（密码输入，保存后不回显）
- 测试连接
- 默认平台/默认账号（可选）
- 启用平台（可多选，默认来自 Gateway）
- 审批策略/审批人
- 对象存储 provider、endpoint、bucket 前缀
- 媒体 URL 前缀/允许的存储域名（安全限制）

设置保存在 CES 服务端：

- URL 可放配置/数据库。
- Token 使用现有 `ctx.secrets` 加密，或放部署环境变量；不要写入前端。

## 6. CES Host 插件设计

### 6.1 包结构

```text
plugins/matrixmedia/
├─ package.json
├─ cordis.patch.yml
├─ icon.svg
├─ locale/{zh,en}.json
├─ src/
│  ├─ index.ts                    # host：Gateway 客户端、配置、API
│  ├─ client.tsx                  # console.page 注册
│  ├─ shared/contracts.ts
│  ├─ host/
│  │  ├─ gateway.ts               # fetch + Bearer + 超时/重试
│  │  ├─ routes.ts                # /console-api/matrixmedia/*
│  │  ├─ jobs.ts                  # 发布任务持久化
│  │  └─ settings.ts              # Gateway 配置
│  └─ client/
│     ├─ MatrixMediaPage.tsx
│     ├─ PublishForm.tsx
│     ├─ JobList.tsx
│     ├─ AccountsPanel.tsx
│     └─ matrixmedia.css
└─ test/
```

### 6.2 配置

```ts
interface Config {
  gatewayUrl: string
  gatewayToken: string       // 支持环境变量注入
  requestTimeoutMs: number
  mediaHostAllowlist: string[]
  pollIntervalMs: number
  maxConcurrentPublishes: number // 默认 1
  maxQueueSize: number           // 默认 20
  enabledPlatforms: string[] // 空 = 使用 Gateway 全部平台
  disabledPlatforms: string[]
  approval: {
    required: boolean        // 默认 true
    approvers: string[]      // CES 用户/角色标识
  }
  media: {
    provider: 'cos' | 's3' | 'oss'
    endpoint: string
    bucket: string
    prefix: string
    signedUrlTtlSeconds: number
  }
}
```

- Gateway URL 必须是 HTTPS 或私有网络地址。
- Token 从部署环境读取，不返回客户端。
- `mediaHostAllowlist` 防止把任意内网 URL 交给 MatrixMedia 下载（SSRF 防护）。

### 6.3 Host API

```http
GET  /console-api/matrixmedia/health
GET  /console-api/matrixmedia/platforms
GET  /console-api/matrixmedia/accounts
POST /console-api/matrixmedia/publish
GET  /console-api/matrixmedia/jobs
GET  /console-api/matrixmedia/jobs/:id
GET  /console-api/matrixmedia/history
```

- 所有路由要求 CES 控制台登录。
- `publish` 校验媒体 URL 域名白名单，代理到 Gateway。
- CES 不直接访问 MatrixMedia 的 30088。
- 不在浏览器中暴露 Gateway Token。

### 6.4 任务持久化

新增迁移（编号实施时确定，例如 `0048_matrixmedia_jobs.sql`）：

```sql
create table matrixmedia_jobs (
  id uuid primary key,
  idempotency_key text not null unique,
  title text not null,
  media_url text not null,
  platforms jsonb not null,
  status text not null,
  results jsonb not null default '{}'::jsonb,
  error jsonb,
  gateway_job_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

- `idempotency_key` 由媒体 URL + 标题 + 平台 + 账号 + 发布参数计算，避免重复上传。
- CES 只保存任务摘要和结果，不保存 MatrixMedia 登录态。
- 如果 Gateway 是唯一真实状态源，CES 表可以作为展示缓存/审计。

## 7. 关键交互

### 发布

1. 用户选择已登录账号和平台。
2. 填写标题、简介、标签和对象存储 `MediaRef`（或 HTTPS URL）。
3. CES 检查 URL/对象存储白名单，生成待审批发布单。
4. 审批人通过后，发布 worker 在执行时把 `MediaRef` 解析成短期下载 URL。
5. Host 调 Gateway `/v1/publish`。
6. 单平台：显示最终结果；多平台：显示 `submitted` 和 job。
7. 前端轮询 CES job 状态，直到完成/失败/部分成功。
8. MatrixMedia 登录失效时显示 `login_required`，提示去 GUI 扫码后重试。

### 账号状态

- 进入页面时加载账号列表。
- 账号状态过期时提示重新登录。
- 不允许在 CES 页面输入 MatrixMedia 账号密码或 Cookie，登录只在 MatrixMedia GUI 完成。

### 媒体引用

- MatrixMedia 支持 `http(s)` 远程视频 URL；CES 主链路传对象存储 `MediaRef`，执行时生成短期 URL。
- P1 不做 CES 到 MatrixMedia 的文件上传，避免两个服务之间搬大文件。
- 工作流节点负责把视频生成服务的对象 key 传给发布任务；插件不依赖具体工作流实现。
- 没有对象存储时仍允许手动 HTTPS URL，但必须通过域名白名单。

## 8. 现有 DSH 插件与 MCP 的关系

MatrixMedia 仓库自带 `dsh-plugin-matrixmedia`：

- 通过 `@deepseek-ai/dsh-mcp-client` 启动 `npx matrixmedia-mcp`。
- MCP 通过 **stdio** 调用本机 MatrixMedia CLI。
- 适合“MatrixMedia 桌面端与 DSH 同机”的桌面场景。

本 CES 插件的差异：

- CES 是服务器部署，MatrixMedia 可以在另一台机器。
- 走 HTTP Gateway，不依赖 stdio。
- 提供控制台页面和任务列表，而不是只暴露会话工具。

如果未来 CES 与 MatrixMedia 同机，也可以复用现有 MCP 工具作为补充，但不建议把它作为 Web 页面主链路。

## 9. 安全与合规

- 绝不直接暴露 MatrixMedia 的 `127.0.0.1:30088`。
- Gateway 必须鉴权、限流、限制来源网段。
- Gateway Token 只存在 CES 服务端和 Gateway 环境变量中。
- 媒体 URL 使用白名单，防止 SSRF 和内部地址探测。
- 不保存平台密码、Cookie、二维码。
- 发布属于外部平台写操作，必须有审批；审批通过即发布，不再二次确认。
- 遵守目标平台的内容和自动化规则；账号被风控/封禁的风险由运营方承担。
- 日志不记录完整视频 URL 查询串、Token 或平台账号敏感信息。

## 10. 测试与验收

### 单元/集成

- Gateway 客户端超时、401、5xx、重试。
- 媒体 URL 白名单（允许/拒绝内网、非 HTTPS）。
- 任务幂等：相同请求复用 job。
- 多平台发布结果汇总：success/partial/failed。
- 未登录账号不能选择。
- CES 不直接请求 30088。

### 部署验证

- Gateway 与 MatrixMedia 同机，30088 仅 loopback。
- CES 通过私有网络访问 Gateway。
- 单平台发布成功。
- 多平台提交后能查询最终结果。
- MatrixMedia GUI 退出后，Gateway 返回明确 `service_unavailable`。
- 重启 Gateway 后任务状态可恢复。

### 验收标准

1. CES 侧边栏出现“矩阵媒体”。
2. 可查看 MatrixMedia 平台账号状态。
3. 可以选择已登录账号和平台，提交对象存储媒体引用（或 HTTPS URL）进入审批。
4. 多平台发布能显示 submitted 和最终结果。
5. 发布记录可查询。
6. 可配置 Gateway URL/Token 并测试连接。
7. 不暴露 30088，不把 Token 发送到浏览器。
8. 对象存储 MediaRef 或自定义媒体 URL 通过白名单/对象存储校验。
9. 发布单必须审批；审批通过后直接发布，无二次确认。
10. 平台列表来自 Gateway，启停通过配置控制。
11. 默认单并发发布，队列满时明确拒绝，不把任务无界堆积。

## 11. 实施分期

### P1（建议先做）

- MatrixMedia Gateway（最小版：health/platforms/accounts/publish/jobs/history）
- CES 插件：设置、账号状态、发布表单、发布记录、审批状态
- 对象存储 `MediaRef` / HTTPS URL；执行时解析短期 URL
- 审批通过后直接发布，不做二次确认
- 平台列表从 Gateway 读取，配置启用/禁用
- 单/多平台，草稿，基本错误处理

### P2

- 对象存储上传控件/工作流深度集成
- 定时发布、封面、创作声明
- 平台专属字段（视频号商品/短剧/剧集）
- 重试、取消、审批工作流深度集成
- 统计与评论只读页

### P3

- 评论回复（必须人工确认）
- 多 Gateway/多账号矩阵编排
- 发布策略、模板、内容日历
- 与 CES 仪表盘打通发布量/收益

## 12. 风险与待确认

| 风险 | 应对 |
| --- | --- |
| MatrixMedia 官方不是无头服务器产品 | 推荐专用桌面主机；Linux 方案标注实验性 |
| 30088 只有 loopback + 本地 Origin 守卫 | 必须部署 Gateway，不能直接暴露 |
| 平台登录需要 GUI 扫码 | Gateway 不承担登录；用 VNC/远程桌面 |
| 多平台最终结果异步 | Gateway job + 发布记录轮询，不谎报成功 |
| 预签名 URL 过期 | 执行时生成；审批/定时等待期间不生成 URL |
| 大文件传输 | P1 只传 MediaRef/URL；视频由对象存储承载 |
| 并发过高导致账号风控 | 默认单并发、账号级串行、队列上限；通过增加实例扩容 |
| 平台风控/封号 | 限速、人工确认、遵守平台规则 |
| MatrixMedia 版本升级导致接口变化 | Gateway 固定版本兼容层，插件不直接依赖内部实现 |
| Token 泄漏 | 服务端保存、私有网络、轮换、最小权限 |

待确认：

1. 专用主机的具体规格（Windows 版本、CPU/内存/磁盘、是否需要 GPU）？
2. 对象存储使用现有 COS，还是独立 S3/OSS？bucket/prefix 如何分配？
3. 审批人由 CES 用户、外部工作流角色，还是固定管理员担任？
4. 首批启用平台清单（由配置决定，不写死）？
5. 是否需要把发布记录/统计同步到 CES 仪表盘？

## 13. 备选方案调研（2026-11）

| 方案 | 类型 | 国内平台 | 稳定性判断 | 结论 |
| --- | --- | --- | --- | --- |
| MatrixMedia | 桌面浏览器自动化 | 8 个 | 依赖 DOM/登录态，中低 | 本文方案；暂缓 |
| 蚁小二 | 商业 SaaS + 企业 API/CLI | 国内主流平台 | 商业维护，中高；依赖平台接口 | 最接近的 API 替代，需企业询价 |
| CreBee | 商业 Agent 中台 | 宣称 18+ | 资料以宣传为主，待验证 | 可做 POC，不作主方案 |
| MediaX | 开源官方 API SDK | 抖音/小红书/微信/B站/YouTube 等 | 协议层高，项目早期 | 长期官方 API 路线 |
| Postiz | 开源/云，官方 API | 海外为主 | 高 | 国内平台不适用 |
| Mixpost | 开源自托管，官方 API | 海外为主 | 高 | 国内平台不适用 |
| Ayrshare / Upload-Post | 商业统一 API | 海外为主 | 高 | 国内平台不适用 |

### 13.1 蚁小二

- 免费版：5 个账号、每天 3 次 APP 发布、单人。
- VIP：20 个账号、10 个成员、无限 APP 发布；官网当前未公开固定 VIP 数字，显示 `? / 月 / 权益包`。
- 官方 FAQ 口径：付费会员月度 59 元起、年度 590 元起。
- 企业 API/CLI：需要单独申请开发者 Key、按企业方案报价，不等同于 VIP 订阅。

参考：

- [蚁小二定价页](https://www.yixiaoer.cn/vip)
- [蚁小二收费 FAQ](https://xueyuan.yixiaoer.cn/article/46634)
- [蚁小二开放 API 说明](https://xueyuan.yixiaoer.cn/article/46925)

### 13.2 CreBee

- 宣称提供 HTTP API、MCP、Agent Skill，覆盖 18+ 平台。
- 公开资料以营销内容为主，暂未验证 API 文档、配额和实际发布稳定性。
- 可列为 POC，不作为当前实现依据。

参考：[CreBee 对比介绍](https://edu.crebee.cn/tools/crebee-vs-rongmeibao-agent-skill-mc.html)

### 13.3 MediaX

- 开源多平台 SDK，走平台 OAuth/开放平台接口。
- 适合长期做官方 API 接入，但需要各平台应用审批，项目仍在迭代。
- 不是开箱即用的发布产品。

参考：[ArtisanCloud/MediaX](https://github.com/ArtisanCloud/MediaX)

### 13.4 为什么仍暂缓

- 国内平台里，视频号、小红书、快手、百家号、头条等没有统一、稳定、对所有开发者开放的发布 API。
- 商业工具能降低维护成本，但引入订阅、配额、供应商依赖和数据合规问题。
- 当前没有必须立即上线的国内矩阵发布需求，先保留设计，避免过早引入一个高维护成本的发布通道。

