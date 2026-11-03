# MatrixMedia 接入插件设计

- 状态：可行性研究 / 方案设计，待评审
- 日期：2026-11-04
- 分支：`feat/matrixmedia`
- 目标项目：[hanliang97/MatrixMedia](https://github.com/hanliang97/MatrixMedia)
- 目标：在 CES 中增加一个“矩阵媒体”插件，通过 MatrixMedia 的 API 完成多平台视频发布、账号/历史查看和后续的数据统计
- 结论：**可以接入，但必须增加一个部署在 MatrixMedia 主机上的本地网关（Gateway）**。不能让 CES 直接访问 MatrixMedia 的 `127.0.0.1:30088`。

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

### 方案 A：专用 Windows/Mac 主机 + Gateway（推荐）

- 一台长期在线的 Windows 或 macOS 主机运行 MatrixMedia GUI。
- 用 VNC / 远程桌面完成首次扫码登录；之后保持登录态。
- 同机运行 `matrixmedia-gateway`（Node 服务）。
- Gateway 只监听内网/VPN 地址，例如 `10.0.0.20:30188`。
- CES 通过私有网络或 HTTPS 反代访问 Gateway。

优点：MatrixMedia 官方支持桌面端，登录和真实浏览器模式最稳定。

### 方案 B：Linux + Xvfb + 桌面环境

- Linux 服务器安装 Electron 依赖，使用 Xvfb/虚拟显示运行 MatrixMedia。
- 通过 noVNC 或 VNC 完成扫码登录。
- Gateway 同机运行。

优点：可放在云服务器；缺点：Electron/桌面依赖复杂，MatrixMedia 并非官方 Linux 无头服务器，升级和排障成本高。

### 方案 C：本地桌面 + 隧道（不推荐）

- 在个人电脑运行 MatrixMedia，通过 SSH 隧道把 30088 暴露给 CES。
- 只适合临时验证；电脑休眠、网络变化、登录态失效都会导致不可用。

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
│ 视频地址（https://...）                        │ 平台账号          │
│ 标题                                           │ ☑ 抖音 138...    │
│ 简介 / 标签                                    │ ☑ 视频号 138...  │
│ 平台选择                                       │ ☐ 小红书 ...      │
│ 草稿 / 定时                                     │                  │
│ [发布]                                         │ 网关状态          │
├───────────────────────────────────────────────┴──────────────────┤
│ 最近发布：标题 · 平台 · 状态 · 时间 · 查看详情                     │
└──────────────────────────────────────────────────────────────────┘
```

P1 字段：

- 视频 URL（必须是 `https://`，由 CES/COS 提供）
- 标题（必填）
- 简介
- 标签
- 账号/平台多选
- 草稿
- 可选定时时间
- 发布按钮

P2：

- 本地文件上传到 COS 后自动生成 URL
- 封面
- 视频号商品/短剧/剧集字段
- 创作声明
- 平台专属参数

### 5.3 账号与平台

Gateway 返回：

```ts
interface MatrixAccount {
  platform: 'dy' | 'ks' | 'blbl' | 'bjh' | 'tt' | 'sph' | 'xhs' | 'fqsp'
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

### 5.5 设置

放在“平台设置”下，页面 key `matrixmedia-settings`：

- Gateway 地址（HTTPS/内网地址）
- Gateway Token（密码输入，保存后不回显）
- 测试连接
- 默认平台/默认账号（可选）
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
2. 填写标题、简介、标签、视频 URL。
3. CES 检查 URL 白名单。
4. Host 调 Gateway `/v1/publish`。
5. 单平台：显示最终结果；多平台：显示 `submitted` 和 job。
6. 前端轮询 CES job 状态，直到完成/失败/部分成功。
7. MatrixMedia 登录失效时显示 `login_required`，提示去 GUI 扫码后重试。

### 账号状态

- 进入页面时加载账号列表。
- 账号状态过期时提示重新登录。
- 不允许在 CES 页面输入 MatrixMedia 账号密码或 Cookie，登录只在 MatrixMedia GUI 完成。

### 媒体 URL

- MatrixMedia 支持 `http(s)` 远程视频 URL；CES 可继续使用 COS/对象存储的 URL。
- P1 不做文件上传，避免 CES 与 MatrixMedia 之间传输大文件。
- 如果必须上传，P2 先上传到 COS，再传 COS URL 给 MatrixMedia。

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
- 发布属于外部平台写操作，需在 UI 明确确认；P2 增加二次确认/发布审批。
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
3. 可以选择已登录账号和平台，提交视频 URL 发布。
4. 多平台发布能显示 submitted 和最终结果。
5. 发布记录可查询。
6. 可配置 Gateway URL/Token 并测试连接。
7. 不暴露 30088，不把 Token 发送到浏览器。
8. 自定义媒体 URL 通过白名单校验。

## 11. 实施分期

### P1（建议先做）

- MatrixMedia Gateway（最小版：health/platforms/accounts/publish/jobs/history）
- CES 插件：设置、账号状态、发布表单、发布记录
- 只支持 HTTPS 视频 URL
- 单/多平台，草稿，基本错误处理

### P2

- COS 上传后自动发布
- 定时发布、封面、创作声明
- 平台专属字段（视频号商品/短剧/剧集）
- 重试、取消、审批
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
| 大文件传输 | P1 只传 URL；P2 走 COS |
| 平台风控/封号 | 限速、人工确认、遵守平台规则 |
| MatrixMedia 版本升级导致接口变化 | Gateway 固定版本兼容层，插件不直接依赖内部实现 |
| Token 泄漏 | 服务端保存、私有网络、轮换、最小权限 |

待确认：

1. MatrixMedia 部署在 Windows、macOS 还是 Linux Xvfb？
2. CES 与 MatrixMedia 是否在同一内网，是否需要公网 TLS 反代？
3. P1 是否只支持视频 URL，还是必须支持本地上传？
4. 是否需要发布审批/二次确认，还是单用户直接发布？
5. 首批平台是否只做抖音、视频号、小红书，还是一次性开放 8 个平台？
6. 是否需要把发布记录/统计同步到 CES 仪表盘？
