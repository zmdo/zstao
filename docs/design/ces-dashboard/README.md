# CES 仪表盘插件设计

- 状态：方案设计（核心决策已确认）
- 日期：2026-11-04
- 分支：`feat/dashboard`
- 插件包名：`@smp/console-dashboard`
- 目标：在侧边栏提供一个可直接打开的仪表盘，展示账户余额、投入、盈利、最近单据和投入/产出趋势，并提供稳定的插件数据接入点

## 0. 已确认决策

- 盈利金额 = 收入 - 支出，即净收益。
- 默认时间范围 = 近 30 天。
- 默认显示币种 = CNY，可切换 USD；使用配置汇率折算，不在 P1 接实时汇率 API。
- 首批接入 = 模型调用：余额、调用花费、单据推送。
- 侧边栏位置 = 最上方。

## 1. 背景

CES 目前有服务器管理、COS、工作区组等栏目，但没有一个统一查看“钱”的入口。账户可能分散在云服务器厂商、大模型厂商、银行或其他服务中；服务器管理和模型调用插件会产生账单或收益，但这些信息没有汇总视图。

本设计新增一个独立的仪表盘插件：

- 侧边栏直接出现“仪表盘”入口，不需要再展开子菜单
- 上半部分展示资金概览
- 下半部分左侧展示投入/产出趋势，右侧展示最近单据
- 其他插件可以通过宿主服务或 HTTP 接入点推送账户、余额和单据

## 2. 目标与非目标

### 目标

- 侧边栏一级入口，一次点击打开仪表盘。
- 账户余额按账户汇总，账户可来自不同厂商。
- 投入金额、盈利金额有明确口径，并支持时间范围。
- 最近单据可读、可定位来源。
- 趋势图和列表在桌面/窄屏都可用。
- 提供幂等、可校验的写入接入点。
- 不引入外部图表库；复用现有 SVG/主题 token。

### 非目标

- 不做支付、转账、充值、扣款等资金操作。
- 不做发票 OCR、文件上传、账单 PDF 解析。
- 不做多用户权限体系；CES 仍是单用户控制台。
- 不做实时汇率行情；P1 使用部署配置的 USD/CNY 汇率，支持 CNY/USD 显示切换。
- 不替代服务器管理、模型设置等原有页面。
- 不把账户密钥、API Key、发票原文存进仪表盘。

## 3. 产品形态与侧边栏入口

仪表盘是 `console.page` 上的一个独立页面：

```ts
{
  name: 'console.page',
  key: 'dashboard',
  label: pageLabel(() => copy.title, {
    group: 'dashboard',
    groupLabel: () => copy.groupTitle, // 仪表盘
    icon: 'chart',
  }),
  order: -2,
}
```

关键点：

- 不设置 `navigation: 'sidebar'`。默认 `tabs` 模式下，只有一个页面的栏目会渲染为**可直接点击的侧边栏项**，而不是带展开箭头的父菜单。
- `icon` 使用新增的 `chart` 图标；如果暂不改 frame，则先退回 `audit`/`box`，但不建议长期使用。
- 侧边栏分组顺序使用 `order: -2`，位于“对话 / Harness”之上。
- 点击侧边栏“仪表盘”直接打开页面。
- 页面标题、范围切换、币种切换和刷新按钮放在页面内容区顶部。

## 4. 页面布局

```text
┌──────────────────────────────────────────────────────────────────────┐
│ 仪表盘                     [CNY|USD] [近7天] [近30天] [本月] [全部] [刷新] │
├──────────────────────────────────────────────────────────────────────┤
│ ┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐ │
│ │ 账户余额            │ │ 投入金额            │ │ 盈利金额            │ │
│ │ ¥ 12,480.00        │ │ ¥ 3,260.00         │ │ ¥ 1,840.00         │ │
│ │ 4 个账户 · 截至 10:32│ │ 近 30 天           │ │ 近 30 天 · +12.4%   │ │
│ └────────────────────┘ └────────────────────┘ └────────────────────┘ │
├───────────────────────────────────────────┬──────────────────────────┤
│ 投入 / 产出趋势                             │ 最近单据                  │
│                                           │                          │
│  ¥                                         │ 10-31  模型调用   -¥42.00 │
│   │      ╭───╮                             │ 10-31  服务器续费 -¥320.00│
│   │  ╭───╯   ╰──╮      投入               │ 10-30  项目收入   +¥800.00│
│   │──╯           ╰──── 产出               │ 10-29  模型调用   -¥18.40 │
│   └──────────────────────── 日期           │ ...                      │
│                                           │ [查看全部]                │
└───────────────────────────────────────────┴──────────────────────────┘
```

### 4.1 上半部分：资金概览

三张卡片横向排列；窄屏下纵向堆叠。

1. **账户余额**
   - 主值：所有启用账户最新余额折算到当前显示币种后的合计。
   - 副标题：`N 个账户 · 截至 HH:mm`。
   - 点击卡片打开账户明细弹层，按厂商/账户列出余额。
   - 余额是当前快照，不受时间范围切换影响。

2. **投入金额**
   - 主值：所选时间范围内的支出（expense）合计。
   - 副标题：范围文案，如 `近 30 天`。
   - 使用中性/偏暖色，不使用纯红表达所有支出。

3. **盈利金额**
   - 主值：`收入 - 支出`。
   - 副标题：范围文案；可显示环比（P2）。
   - 正数用现有成功色（绿），负数用错误色（红），同时显示 `+`/`-` 符号，不只依赖颜色。

卡片下方可以显示轻量说明：

```text
余额为各账户最新快照；投入和盈利按单据发生时间统计。
```

### 4.2 下半部分

左侧：投入/产出趋势图（约 60% 宽）。

- 双序列：投入、产出（收入）。
- 日粒度，按配置时区分桶；空日期补 0。
- 折线或面积图；复用服务器管理中 SVG 图表的实现方式，不引入 echarts/recharts。
- 图例、坐标轴、tooltip、空状态。
- 下方可显示净额摘要。

右侧：最近单据（约 40% 宽）。

- 默认最近 8 条。
- 列：日期、名称/来源、类型、金额。
- 收入绿色 `+`，支出偏红 `-`；同时显示类型标签。
- 点击行打开单据详情抽屉（P2）；P1 至少显示完整标题和来源。
- 空状态：`还没有单据`。
- `查看全部` 打开完整列表（P2）。

### 4.3 响应式

- `>= 1100px`：三卡片一行，图表/列表两栏。
- `720–1099px`：卡片保持三列但缩小；图表/列表改为上下。
- `< 720px`：卡片纵向堆叠；图表高度压缩；单据列表卡片式展示。

### 4.4 币种切换

- 页面顶部提供 `CNY | USD` 切换，默认 CNY。
- 切换只改变**展示币种**；数据库保留每条账户/余额/单据的原始币种。
- 后端按配置汇率折算到展示币种，返回 `fx` 信息：
  - 汇率值
  - 汇率时间
  - 汇率来源（P1 为 `config`）
- 汇率缺失时：
  - 同币种数据仍可显示；
  - 需要折算的数据排除，并在页面显示“缺少 USD/CNY 汇率”的提示；
  - 不静默把 USD 当 CNY 相加。
- 选择结果只保存在当前浏览器偏好，下次打开沿用。
- 账户明细同时显示原币金额和折算金额。

## 5. 指标口径

必须在 UI 和接口层保持一致，避免“余额”“投入”“盈利”各算一套。

### 5.1 账户余额

```text
balance = Σ latest_balance(account)
```

- 每个 `active` 账户取 `captured_at` 最新的一条余额快照。
- 同一账户旧快照不累加。
- 每个账户的原币金额按展示币种折算后汇总；缺少汇率时排除并提示。
- 默认展示币种为 CNY，可切换 USD。
- `asOf` 取各账户最新快照时间的最大值；账户明细显示各自时间。
- 没有快照的账户不计入总额，但仍在账户明细中显示“暂无余额”。

### 5.2 投入金额

```text
invested = Σ amount_minor
where kind = 'expense' and status = 'posted' and occurred_at ∈ range
```

### 5.3 盈利金额

```text
profit = Σ income(amount_minor) - Σ expense(amount_minor)
```

- 只统计 `posted`，不统计 `pending`、`void`。
- `盈利金额` 是净收益；如果产品要的是“总收入”，应改名为“收入”，不要混用。
- 单据的 `kind` 由推送方声明，仪表盘不根据标题猜类型。

### 5.4 时间范围

- 默认：`近 30 天`。
- 可选：`近 7 天`、`近 30 天`、`本月`、`全部`。
- 余额不受范围影响；投入、盈利、图表、最近单据受范围影响。
- 时间边界按配置时区（默认 `Asia/Shanghai`）计算，接口传绝对时间 `from`/`to`，避免客户端时区歧义。

### 5.5 币种换算

```text
converted = amount_minor × rate(original → display) / 10^(originalScale - displayScale)
```

- P1 只支持 CNY、USD；`usdCnyRate` 在部署配置中提供（1 USD = N CNY）。
- USD → CNY 使用 `usdCnyRate`；CNY → USD 使用其倒数。
- 折算结果四舍五入到展示币种最小单位，**先折算再汇总**，避免先汇总后换算的误差。
- 响应中返回 `displayCurrency` 和 `fx`；前端在金额下方显示汇率与时间。
- P2 接入汇率表/行情 API；P3 支持更多币种。

## 6. 数据模型

新增迁移：`plugins/database/migrations/0046_dashboard.sql`。

### 6.1 账户

```sql
create table dashboard_accounts (
  id uuid primary key,
  source text not null,
  external_id text not null,
  provider text not null,          -- 阿里云 / 腾讯云 / DeepSeek / 银行 / other
  display_name text not null,
  kind text not null default 'other'
    check (kind in ('cloud', 'llm', 'bank', 'other')),
  currency char(3) not null default 'CNY',
  status text not null default 'active'
    check (status in ('active', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);
```

- `source` 是推送方标识，建议使用插件包名，例如 `@smp/console-server-management`。
- `external_id` 是推送方自己的账户 ID；同一个 `source` 下唯一。
- `provider` 用于展示和分组，不参与归属判断。

### 6.2 余额快照

```sql
create table dashboard_balance_snapshots (
  id uuid primary key,
  account_id uuid not null references dashboard_accounts(id) on delete cascade,
  source text not null,
  external_id text not null,
  amount_minor bigint not null,
  currency char(3) not null default 'CNY',
  captured_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source, external_id)
);

create index dashboard_balance_latest_idx
  on dashboard_balance_snapshots (account_id, captured_at desc, id desc);
```

- 快照追加，不覆盖历史；最新一条用于余额卡片。
- `amount_minor` 是整数最小货币单位，避免浮点误差；CNY 为分。
- 同 `source` + `external_id` 重放时返回已有快照，不重复插入。

### 6.3 单据

```sql
create table dashboard_transactions (
  id uuid primary key,
  source text not null,
  external_id text not null,
  account_id uuid references dashboard_accounts(id) on delete set null,
  kind text not null check (kind in ('income', 'expense')),
  title text not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null default 'CNY',
  occurred_at timestamptz not null,
  status text not null default 'posted'
    check (status in ('posted', 'pending', 'void')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source, external_id)
);

create index dashboard_transactions_time_idx
  on dashboard_transactions (occurred_at desc, id desc);
create index dashboard_transactions_kind_time_idx
  on dashboard_transactions (kind, occurred_at desc);
```

- 单据是不可变事件；重复推送返回已有记录。
- 更正通过 `status='void'` 的新事件或反向单据表达，不原地修改金额（P1 约束）。
- `metadata` 只放展示所需的少量字段，禁止放密钥、发票原文、完整请求体。
- `metadata` 应用层限制 8 KiB。

### 6.4 保留与归档

- 账户使用 `status='archived'` 软删除，历史单据保留。
- P1 不做自动清理；后续可按保留策略归档。
- 不提供“删除流水”接口，避免破坏对账。

## 7. 插件接入点

这是本设计的核心。接入点分两层：

1. **同进程 Cordis 服务**：推荐给 CES 自己的插件。
2. **HTTP 接入**：给无法直接注入 Cordis 的外部集成。

### 7.1 宿主服务

仪表盘插件在 host `apply` 中提供：

```ts
export interface DashboardService {
  ingest(event: DashboardEvent): Promise<IngestResult>
  ingestMany(events: readonly DashboardEvent[]): Promise<IngestResult[]>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    dashboard: DashboardService
  }
}
```

事件类型：

```ts
type DashboardEvent =
  | {
      kind: 'account'
      source: string
      externalId: string
      provider: string
      displayName: string
      accountKind?: 'cloud' | 'llm' | 'bank' | 'other'
      currency?: string
    }
  | {
      kind: 'balance'
      source: string
      externalId: string
      accountExternalId: string
      amount: string              // 十进制字符串，如 "1280.50"
      currency?: string
      capturedAt?: string         // ISO 8601；缺省为接收时间
    }
  | {
      kind: 'transaction'
      source: string
      externalId: string
      accountExternalId?: string
      type: 'income' | 'expense'
      title: string
      amount: string
      currency?: string
      occurredAt: string
      status?: 'posted' | 'pending' | 'void'
      metadata?: Record<string, unknown>
    }
```

接入示例：

```ts
export const inject = ['dashboard']

export function apply(ctx: Context): void {
  ctx.effect(() => {
    void ctx.dashboard.ingest({
      kind: 'transaction',
      source: '@smp/console-server-management',
      externalId: `server-bill:${billId}`,
      type: 'expense',
      title: `服务器续费 ${serverName}`,
      amount: '320.00',
      occurredAt: new Date().toISOString(),
    }).catch(error => ctx.logger.warn(error))
    return () => {}
  })
}
```

约定：

- `source` 必填，使用包名或稳定集成 ID。
- 账户按 `(source, externalId)` 解析；不允许一个来源改另一个来源的账户。
- 单据按 `(source, externalId)` 幂等。
- 余额按 `(source, externalId)` 幂等；同一账户可有多条历史快照。
- 服务返回 `{ id, duplicate }`；重放不报错。
- 金额只接受十进制字符串，不接受浮点数；服务统一转 `amount_minor`。
- 错误使用带 `code` 的 `DashboardError`，不要解析错误文案。

### 7.2 HTTP 接入

给同源脚本或未来外部插件使用：

```http
POST /console-api/dashboard/ingest
Content-Type: application/json

{
  "events": [
    {
      "kind": "balance",
      "source": "@smp/console-server-management",
      "externalId": "balance:2026-11-04T10:00:00Z",
      "accountExternalId": "aliyun-main",
      "amount": "1280.50",
      "currency": "CNY",
      "capturedAt": "2026-11-04T10:00:00Z"
    }
  ]
}
```

响应：

```json
{
  "results": [
    { "id": "…", "duplicate": false }
  ]
}
```

认证与限制：

- 同源请求使用控制台登录 cookie。
- 可选 `Authorization: Bearer <DASHBOARD_INGEST_TOKEN>`，仅在部署时配置了 token 时启用；不要把 token 写入数据库或前端。
- 单请求最多 100 个事件，body 最大 64 KiB。
- 校验失败返回 400；未登录/无效 token 返回 401；重复事件返回 200。
- `source` 仅用于归属和幂等，不用于认证；Bearer token 的权限是整个 ingest 面。

### 7.3 可选的 UI 扩展

P2 可以增加 `dashboard.widget` 客户端 slot：

- 其他插件在金额概览下方增加自己的小卡片。
- keyed slot，owner 提供 `summary` 和 `range`。
- 这不是数据接入的替代；数据仍通过 `DashboardService` 进入统一模型。

### 7.4 首批模型调用接入（P1）

首批接入单独做成配套适配器 `@smp/console-model-billing`，避免仪表盘本身绑定模型厂商：

```text
模型调用 → llm/stream usage → 价格计算 → dashboard transaction
厂商余额 → 定时查询/API → dashboard account + balance
厂商账单 → 账单同步/手工推送 → dashboard transaction
```

#### 调用花费

- 注入 `llm`，通过 `llm/stream` waterfall 包装 `next()`，只读收集 `usage` chunk，原样透传所有 chunk。
- 必须调用 `next()`，不能截断模型流。
- 从 `GenerateOptions`/会话上下文中拿 provider、model、session/attempt 标识；取不到时使用请求指纹。
- 计价参数按模型配置：

```ts
interface ModelPrice {
  provider: string
  model: string
  currency: 'CNY' | 'USD'
  inputPerMillion: string
  outputPerMillion: string
  cacheReadPerMillion?: string
  cacheWritePerMillion?: string
}
```

- 成本 = 输入 token × 单价 + 输出 token × 单价 + 缓存读写费用；不把 token 数当金额。
- 生成一条 `expense` 单据：
  - `source = '@smp/console-model-billing'`
  - `externalId = model-call:<provider>:<attemptId>`（无 attemptId 时使用稳定指纹）
  - `title = 模型调用 · <model>`
  - `metadata` 只保留 provider、model、token 计数，不保存 prompt/回复正文。
- 价格表缺失时不写入金额为 0 的单据；记录告警，P2 再补“未计价调用”列表。
- 同一 attempt 重放时由 dashboard 幂等去重。

#### 余额

- 每个模型厂商一个账户，例如 `DeepSeek`、`OpenAI`。
- 有余额 API 的厂商（P1 先做 DeepSeek）定时拉取，推送 `account` + `balance`：
  - 账户 `externalId = provider id`
  - 余额快照 `externalId = balance:<provider>:<capturedAt>`
- 拉取失败只记日志，不清空旧余额；页面继续显示最后一次成功快照及其时间。
- 没有余额 API 的厂商可通过脚本/HTTP ingest 手工推送。

#### 单据推送

- 厂商账单/发票同步走 `dashboard.ingest` 或 HTTP 接入点，不放进模型调用路径。
- 第一版支持“账单导入脚本/适配器”；不在仪表盘内做 PDF OCR。
- 账单的 `externalId` 使用厂商账单号，重复同步幂等。
- 账单币种保留原币，由仪表盘按显示币种折算。

#### 接入边界

- 模型计费适配器可以依赖 `llm`、`credentials`、`settings`、`dashboard`；仪表盘不反向依赖模型插件。
- 模型适配器未加载时，仪表盘仍可展示手工推送或其他来源的数据。
- 模型价格和厂商余额配置属于适配器，不写死进仪表盘。

## 8. 后端接口

### 8.1 概览

```http
GET /console-api/dashboard/summary?range=30d&currency=CNY
```

返回：

```ts
interface DashboardSummary {
  asOf: string
  displayCurrency: 'CNY' | 'USD'
  fx: {
    base: 'CNY' | 'USD'
    quote: 'CNY' | 'USD'
    rate: string
    asOf: string
    source: 'config'
  } | null
  range: { from: string; to: string; label: string }
  balance: {
    amount: string
    accountCount: number
    accounts: Array<{
      id: string
      provider: string
      name: string
      nativeAmount: string
      nativeCurrency: 'CNY' | 'USD'
      amount: string
      asOf: string | null
    }>
  }
  invested: { amount: string }
  profit: { amount: string }
  series: Array<{
    date: string                 // YYYY-MM-DD，配置时区
    income: string
    expense: string
  }>
  warnings?: string[]
  recent: Array<{
    id: string
    title: string
    type: 'income' | 'expense'
    amount: string
    occurredAt: string
    source: string
    accountName: string | null
    status: 'posted' | 'pending' | 'void'
  }>
}
```

- 认证：与控制台其他 `/console-api` 路由一致，检查 `consoleSession`。
- 无缓存：`cache-control: no-store`。
- 所有金额以十进制字符串返回，避免 JSON number 精度问题。
- `range=all` 时 `from` 取最早单据时间或空；图表按最近 90 天分桶并注明。
- `currency` 只接受 `CNY`/`USD`；缺省 CNY。
- `fx` 为展示币种相对原币的汇率；同币种数据不需要汇率。
- 汇率缺失时，`fx=null`，需要折算的金额被排除，并返回 `warnings`。

### 8.2 单据列表

```http
GET /console-api/dashboard/transactions?range=30d&currency=CNY&limit=50&cursor=...
```

P1 可以只返回最近若干条；P2 增加 cursor 分页和完整列表抽屉。

### 8.3 刷新与实时

P1：

- 页面挂载时加载一次。
- 每 60 秒自动刷新；页面不可见时暂停。
- 提供手动刷新。
- 推送成功不直接操作其他插件的页面，下一次刷新可见。

P2：

- `GET /console-api/dashboard/events` SSE，服务在 ingest 后广播 `summary-changed`。
- 页面收到事件后刷新；断线自动重连。

## 9. 前端结构

```text
plugins/dashboard/
├─ package.json
├─ cordis.patch.yml
├─ icon.svg
├─ locale/
│  ├─ zh.json
│  └─ en.json
├─ src/
│  ├─ index.ts                 # host 入口、路由、服务
│  ├─ client.tsx               # console.page 注册
│  ├─ shared/
│  │  ├─ contracts.ts          # 事件、Summary、错误码
│  │  └─ amount.ts             # 十进制字符串 ↔ minor units
│  ├─ host/
│  │  ├─ service.ts            # DashboardService
│  │  ├─ repository.ts         # 查询/幂等写入
│  │  ├─ routes.ts             # console-api
│  │  └─ errors.ts
│  └─ client/
│     ├─ DashboardPage.tsx
│     ├─ OverviewCards.tsx
│     ├─ AccountBreakdown.tsx
│     ├─ TrendChart.tsx
│     ├─ RecentReceipts.tsx
│     ├─ dashboard.css
│     └─ api.ts
└─ test/

plugins/model-billing/           # 首批模型调用适配器，独立于仪表盘
├─ package.json
├─ cordis.patch.yml
├─ icon.svg
├─ locale/
└─ src/
   ├─ index.ts                   # 注入 llm/credentials/settings/dashboard
   ├─ usage.ts                   # llm/stream usage 收集
   ├─ pricing.ts                 # 模型价格表
   ├─ balance.ts                 # 厂商余额同步
   └─ receipts.ts                # 账单/单据推送
```

客户端：

```ts
export const inject = ['slots', 'locale']
```

页面使用 `ctx.slots.inject('console.page', …)` 注册，不替换 shell，不操作 `document.body`。

样式：

- 不使用外部图表库。
- 图表 SVG 参考 `ResourceHistory` 的坐标映射与 tooltip 方式。
- 卡片/列表使用现有 `Panel`、`TableCard`、`consoleCss` 的 token。
- 颜色通过 `--dsw-alias-*`、`--green`、`--red`；同时用符号和文字表达正负，不能只靠颜色。

## 10. 图表设计

- 双序列：`income`（产出）、`expense`（投入）。
- 默认最近 30 天，按日聚合。
- Y 轴使用紧凑货币格式（¥1.2k / ¥12k）。
- 空数据：显示坐标轴 + “暂无数据”，不显示假曲线。
- 单日多笔合并；tooltip 显示日期、收入、支出、净额。
- 访问性：图表旁提供隐藏的表格摘要，或可见的“数据明细”链接。
- P2：切换“金额/笔数”；P3：自定义指标。

## 11. 最近单据

- 默认 8 条，按 `occurred_at` 倒序。
- 显示：日期、标题、来源/账户、类型、金额。
- 金额格式化：`+¥800.00` / `-¥42.00`。
- 状态：
  - `posted` 正常；
  - `pending` 显示“待确认”；
  - `void` 降低透明度并标“已作废”。
- 点击行打开详情抽屉（P2）；P1 至少显示完整标题和来源。
- 空状态、加载态、错误态。

## 12. 安全与一致性

- 写入只接受已认证控制台会话或配置的 Bearer token。
- 不存储密钥、Token、发票原文；`metadata` 限制大小并做敏感字段黑名单。
- 账户/单据/余额均按 `source` 隔离。
- 所有写入幂等；重放不产生重复金额。
- 金额使用整数 minor units；拒绝超过 2 位小数、负数、NaN、Infinity。
- 单请求 100 条、64 KiB；单条标题 200 字符、metadata 8 KiB。
- 数据库约束 + 应用层校验双层；接口不返回原始 SQL 错误。
- 余额快照不参与“投入/盈利”计算，避免重复计算。
- 归档账户不计入余额；历史单据保留。

## 13. 配置与部署

`Config`：

```ts
interface Config {
  defaultCurrency: 'CNY' | 'USD' // 默认 CNY
  supportedCurrencies: ('CNY' | 'USD')[] // 默认 ['CNY', 'USD']
  usdCnyRate: number          // 1 USD = N CNY；缺少时 USD 折算不可用
  fxAsOf: string              // 汇率配置时间
  timeZone: string            // 默认 Asia/Shanghai
  refreshSeconds: number      // 默认 60
  ingestToken?: string        // 可选；空表示仅允许同源 cookie
}
```

- 配置通过 `Schema` 校验；`defaultCurrency`/`supportedCurrencies` 只接受 `CNY`/`USD`。
- `usdCnyRate` 必须是正数；缺失时界面显示汇率提示，USD 数据不参与 CNY 汇总。
- 部署时在 `docker/render-profile.mjs` 生成 `smp-dashboard` 配置；token 从环境变量读取，不写死。
- `docker/profile/package.json` 增加 `@smp/console-dashboard` 与首批适配器 `@smp/console-model-billing` 的依赖和 bundle。
- `cordis.patch.yml`：

```yaml
- insert:
    - id: smp-dashboard
      name: '@smp/console-dashboard'
```

- 新增 `plugins/database/migrations/0046_dashboard.sql`；由 database 插件启动时执行。
- 侧边栏图标 `chart` 需要在 `plugins/frame/src/client.tsx` 的 `NavGlyph` 中增加一个分支；这是唯一的 shell 侧小改动。
- `docker/render-profile.mjs` 增加 `smp-dashboard` 配置：默认币种、USD/CNY 汇率、时区、刷新间隔。

## 14. 测试与验收

### 单元测试

- 金额字符串 ↔ minor units：`0.01`、`1.00`、`999999.99`、非法输入。
- 范围计算：近 7 天、近 30 天、本月、全部；时区边界。
- 汇总：最新余额去重、收入/支出/净利、CNY/USD 折算、空数据、负利润。
- 幂等：重复 account/balance/transaction 返回 duplicate。
- 来源隔离：两个 source 使用相同 externalId 不冲突。

### 集成测试

- 迁移能在现有 PostgreSQL 上执行。
- `POST /console-api/dashboard/ingest` 的认证、校验、重复请求。
- `GET /console-api/dashboard/summary` 的认证和金额字符串。
- 页面入口（侧边栏直接打开）加载正常。
- CNY/USD 切换和汇率缺失提示。
- 模型调用适配器产生的单据可幂等重放。

### 验收标准

1. 侧边栏出现“仪表盘”，一次点击打开，不展开二级菜单。
2. 上半部分显示余额、投入、盈利三张卡片。
3. 余额按账户/厂商汇总，展示账户数。
4. 投入=支出；盈利=收入-支出；范围切换后数字和图表同步。
5. 下半部分左侧趋势图、右侧最近单据。
6. 其他插件可通过 `ctx.dashboard.ingest` 推送账户、余额、单据。
7. HTTP 接入点可幂等重放，重复数据不重复计数。
8. CNY/USD 切换后金额按配置汇率折算，缺少汇率时明确提示。
9. 模型调用适配器能推送余额、调用花费和单据。
10. 空数据、加载、错误、窄屏均有正确状态。
11. 不引入外部图表依赖，不修改 DSH 核心插件生命周期约定。

## 15. 实施顺序

### P1

- 迁移、repository、DashboardService
- summary 路由与认证
- 页面注册（侧边栏最上方）、三张卡片、趋势图、最近单据
- CNY/USD 切换与配置汇率折算
- `@smp/console-model-billing` 适配器：DeepSeek 余额、调用花费、账单推送
- 手动/定时刷新
- 基础单元/集成测试

### P2

- HTTP ingest + Bearer token
- 账户明细弹层
- 单据详情抽屉、完整列表
- SSE 实时刷新
- 隐藏/聚合小账户等交互

### P3

- `dashboard.widget` 客户端扩展槽
- 更多币种、汇率行情与历史
- 目标/预算、环比、导出
- 账户自动发现/同步适配器

## 16. 风险与待确认

| 风险 | 应对 |
| --- | --- |
| 各插件对“收入/支出”口径不一致 | 接入契约强制 `type`，UI 不猜；文档写明 |
| 同一账户重复推送导致余额翻倍 | 按账户取最新快照，不累加快照历史 |
| 重复单据 | `(source, external_id)` 唯一 + duplicate 返回 |
| 多币种直接相加 | 按展示币种配置汇率折算；缺失时排除并提示 |
| 推送量过大 | 批量上限、索引、分页；P2 流式/队列 |
| 浏览器时区与业务时区不一致 | 服务端按配置时区聚合，接口返回绝对时间 |
| 仪表盘成为插件硬依赖 | 推荐 host service；外部集成走 HTTP；文档说明加载顺序 |

待确认：

1. USD/CNY 汇率由部署配置手工维护，还是后续接入行情 API？P1 先手工配置。
2. 首批仅 DeepSeek 模型调用，还是同时支持 OpenAI 等厂商的余额接口？
3. 模型价格表由适配器配置维护，还是跟随后台模型配置自动同步？
4. 是否需要“全部单据”独立页面，还是只在仪表盘内抽屉展示？
5. 账单导入第一版是否需要文件上传（CSV）？当前设计只做 API/脚本推送。
