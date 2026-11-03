# 服务器接入商与云服务器接入设计

- 状态：方案设计，待评审
- 日期：2026-11-04
- 分支：`feat/server-management`
- 范围：`@smp/console-server-management` 的接入商配置、云服务器导入和服务器列表展示
- 首个接入商：腾讯云（轻量应用服务器、云服务器 CVM）
- 目标：接入商配置和云端实例发现使用统一接口，后续增加其他云厂商时不改服务器注册主流程

## 1. 背景

当前服务器登记只支持“主机地址 + SSH 凭据”的自定义方式。对于已经从云厂商购买的服务器，用户需要手工复制 IP、名称、地域等信息，容易出错，也无法判断某台云服务器是否已经接入。

本次改造增加两层能力：

1. **平台级接入商配置**：在“平台设置”中配置云厂商和 AK/SK 账号，账号既用于服务器发现，也为后续续费/账单能力预留。
2. **服务器登记双模式**：
   - 云服务接入：从接入商列出已购买的实例，多选后统一登记。
   - 自定义服务器：保留现有 IP + SSH 凭据方式，用于本地或非云服务器。

首个接入商只实现腾讯云，但 host 侧通过统一的 `CloudProvider` 接口隔离厂商差异。

## 2. 需求确认

- 平台设置中新增“服务器接入商”。
- 支持配置多个接入商账号；每个账号保存 AK/SK 等凭据。
- 接入商账号用于服务器管理，也为续费/资金能力预留。
- 首个接入商只做腾讯云。
- 登记服务器时二选一：
  - 云服务接入
  - 自定义服务器
- 云服务接入可从腾讯云列出：
  - 轻量应用服务器
  - 普通云服务器 CVM
- 已接入的实例在列表中置灰，并提示“已接入”。
- 支持多选；多选时 SSH 账户名和密钥必须统一。
- 多选时统一选择服务器分组和类型。
- 测试通过后才能添加。
- 服务器列表展示接入商。

## 3. 总体结构

```text
平台设置
└─ 服务器接入商
   ├─ 腾讯云账号 A（AK/SK，server/billing 能力）
   └─ 腾讯云账号 B（AK/SK，server 能力）

服务器管理
├─ 自定义服务器（现有流程）
└─ 云服务接入
   ├─ 选择接入商账号
   ├─ 列出腾讯云 CVM / 轻量实例
   ├─ 多选实例（已接入置灰）
   ├─ 统一 SSH 凭据
   ├─ 统一分组 / 类型
   ├─ 批量测试
   └─ 批量创建服务器
```

厂商适配层放在 host：

```text
server-management host
├─ provider registry
│  └─ tencent-cloud
├─ provider account service
├─ cloud instance service
└─ existing server CRUD / enrollment
```

客户端只依赖标准化后的 provider/instance/account DTO，不直接调用腾讯云 API。

## 4. 统一接入商接口

### 4.1 接口定义

```ts
export interface CloudProvider {
  key: string                    // 'tencent-cloud'
  displayName: string
  products: CloudProduct[]       // cvm / lighthouse
  test(credentials: ProviderCredentials): Promise<ProviderIdentity>
  listRegions(credentials: ProviderCredentials): Promise<CloudRegion[]>
  listInstances(credentials: ProviderCredentials, query: InstanceQuery): Promise<CloudInstance[]>

  // P2 资金/续费能力；没有实现的厂商可以省略
  billing?: {
    balance(credentials: ProviderCredentials): Promise<ProviderBalance>
    bills(credentials: ProviderCredentials, query: BillQuery): Promise<ProviderBill[]>
    quoteRenewal(credentials: ProviderCredentials, instanceId: string, period: number): Promise<RenewalQuote>
    renew(credentials: ProviderCredentials, instanceId: string, period: number): Promise<void>
  }
}
```

- `ProviderCredentials` 是解密后的账号凭据，只在 host 内存中存在，不进入客户端 DTO。
- `CloudProvider` 的所有方法使用标准化输入/输出；厂商 SDK 类型不得泄漏到 API 或客户端。
- 厂商接口错误转换为统一的 `ProviderError`：

```ts
type ProviderErrorCode =
  | 'invalid_credentials'
  | 'permission_denied'
  | 'region_unavailable'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'instance_not_found'
```

### 4.2 标准化实例

```ts
interface CloudInstance {
  providerKey: string
  accountId: string
  instanceId: string
  name: string
  product: 'cvm' | 'lighthouse'
  region: string
  zone: string | null
  status: 'running' | 'stopped' | 'pending' | 'unknown'
  publicIpv4: string[]
  privateIpv4: string[]
  osName: string | null
  cpuCores: number | null
  memoryMb: number | null
  expiresAt: string | null
  alreadyRegistered: boolean     // 由服务端与 servers 表比对后填充
  registeredServerId: string | null
}
```

`alreadyRegistered` 由 host 统一计算，不能让客户端自行猜测。

### 4.3 Provider Registry

host 提供：

```ts
interface ServerProviderRegistry {
  register(provider: CloudProvider): () => void
  get(key: string): CloudProvider | undefined
  list(): readonly CloudProvider[]
}
```

- `server-management` 启动时注册 `tencent-cloud`。
- 后续其他云厂商插件可 `inject ['serverProviders']` 后注册自己的 adapter，不需要改服务器登记主流程。
- Provider key 必须稳定、全局唯一。

### 4.4 腾讯云适配器

`plugins/server-management/src/host/providers/tencent-cloud.ts`：

- 凭据：SecretId / SecretKey。
- 产品：
  - `cvm`：查询 CVM 实例。
  - `lighthouse`：查询轻量应用服务器。
- 能力：
  - `test`：调用一个轻量只读接口（例如地域列表或受限实例查询）验证 AK/SK。
  - `listRegions`：返回支持地域。
  - `listInstances`：按产品/地域分页拉取并标准化。
- 实现方式：
  - 优先使用腾讯云官方 Node SDK，按 CVM/Lighthouse 产品分包引入；版本固定在 `package.json`。
  - 适配器内部封装 SDK 错误、分页、限流和超时；外部只看到 `CloudProvider`。
  - 可选 `billing` 能力在 P2 接入；P1 不实现扣费/续费，只保存账号能力标记。
- 区域/分页：
  - 支持按地域串行或有限并发拉取，避免一次请求量过大。
  - 超时、重试和限流在 adapter 内处理。
- 不记录 AK/SK、请求签名或完整原始响应。

## 5. 接入商账号数据模型

新增迁移：`plugins/database/migrations/0047_server_providers.sql`。

```sql
create table server_provider_accounts (
  id uuid primary key,
  provider_key text not null,
  name text not null,
  credentials_ciphertext text not null,
  credential_hint text not null default '',
  default_region text not null default '',
  capabilities text[] not null default '{server}',
  enabled boolean not null default true,
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_key, name),
  check (provider_key <> ''),
  check (capabilities <@ array['server','billing','renewal']::text[])
);
```

- `credentials_ciphertext` 使用现有 `ctx.secrets.encrypt(JSON.stringify({secretId, secretKey}))`。
- `credential_hint` 只保存掩码后的 SecretId 后四位，供列表展示。
- `capabilities` 声明该账号能做什么：
  - `server`：列出实例
  - `billing`：查询余额/账单
  - `renewal`：续费
- 不保存明文 SK；API 不返回 SK。

服务器表扩展：

```sql
alter table servers
  add column provider_key text,
  add column provider_account_id uuid references server_provider_accounts(id) on delete restrict,
  add column provider_instance_id text,
  add column provider_product text,
  add column provider_region text,
  add column provider_zone text,
  add column provider_metadata jsonb not null default '{}'::jsonb;

create unique index servers_provider_instance_key
  on servers (provider_key, provider_region, provider_instance_id)
  where provider_key is not null and provider_instance_id is not null;

create index servers_provider_account_idx on servers (provider_account_id);
```

- 自定义服务器上述字段全部为 `null`，`provider_key` 为空。
- 云服务器必须同时有 `provider_key`、`provider_account_id`、`provider_instance_id`。
- 已接入判断以 `provider_key + provider_region + provider_instance_id` 为准。
- 删除仍有服务器引用的接入商账号时拒绝，避免悬空。
- 现有服务器数据不需要回填。

## 6. 平台设置：服务器接入商

### 6.1 页面位置

注册为 `console.page`：

```ts
{
  name: 'console.page',
  key: 'server-providers',
  label: pageLabel(() => copy.title, {
    group: 'platform',
    groupLabel: () => copy.platformTitle,
    placement: 'footer',
    icon: 'server',
  }),
  order: 7,
}
```

- 放在“平台设置”底部导航，和模型、插件同组。
- 不占用服务器管理页面本身。

### 6.2 页面结构

```text
服务器接入商

腾讯云                                      [添加账号]
┌─────────────────────────────────────────────────────────┐
│ 生产账号    SecretId: ****ab12   默认地域: 广州          │
│ 能力: 服务器  状态: 已启用             [测试] [编辑] [停用] │
├─────────────────────────────────────────────────────────┤
│ 测试账号    SecretId: ****cd34   ...                    │
└─────────────────────────────────────────────────────────┘
```

- 接入商列表由 provider registry 提供；P1 只有腾讯云。
- “添加账号”选择接入商，填写：
  - 账号名称
  - SecretId
  - SecretKey
  - 默认地域（可选）
  - 能力：服务器、账单、续费（可多选；默认服务器）
- 保存前必须先“测试凭据”或保存时后台自动测试；失败不允许保存。
- SecretKey 输入后不回显；编辑时留空表示不修改。
- 账号可停用；停用后不能在服务器登记中选择，但已接入服务器保留 provider 信息。
- 删除账号时如果还有服务器引用，提示先迁移/删除服务器。
- 列表显示测试状态、最后测试时间。

### 6.3 多选说明

“接入商可以多选”在这里落地为：

- 可以配置多个接入商（P1 腾讯云一个 key，但 registry 支持多个 key）。
- 同一个接入商下可以配置多个账号。
- 服务器登记时选择一个具体账号；不同账号的实例不能在同一次云导入里混合。
- 后续新增其他云厂商只需注册新 provider，不需要改平台设置页面结构。

## 7. 服务器登记：双模式

### 7.1 模式切换

在“登记服务器”入口提供两个模式：

```text
[ 云服务接入 ] [ 自定义服务器 ]
```

- `自定义服务器`：现有 `ServerForm` 原样保留，只增加 provider 展示字段为“自定义”。
- `云服务接入`：新增 `CloudServerImport` 流程，不复用自定义表单的 host/user 输入区。
- 编辑已有服务器时不改变接入模式；云服务器可以编辑名称、分组、SSH 凭据等，但 provider 身份字段只读。

### 7.2 云服务接入步骤

```text
1. 选择接入商账号
2. 选择产品/地域并加载实例
3. 多选实例（已接入置灰）
4. 统一 SSH 凭据
5. 统一分组/类型
6. 批量测试
7. 创建
```

#### 步骤 1：选择账号

- 只展示 `enabled` 且具备 `server` 能力的账号。
- 无可用账号时提示去“平台设置 → 服务器接入商”添加。
- 账号显示：接入商、账号名、默认地域、SecretId 掩码。

#### 步骤 2：加载实例

- 产品筛选：全部 / 轻量应用服务器 / 云服务器。
- 地域筛选：账号支持的地域，可多选或全部。
- 状态筛选：运行中 / 已停止 / 全部（默认运行中）。
- 实例表列：
  - 实例名称
  - 实例 ID
  - 产品/地域
  - 公网 IP
  - 状态
  - 到期时间
  - 接入状态
- 加载中显示逐地域进度；失败地域显示错误和重试，不阻塞其他地域。

#### 步骤 3：选择实例

- 提供复选框，支持全选当前筛选结果。
- 已接入实例：
  - 禁用复选框
  - 状态列显示“已接入”
  - 悬浮/提示显示已接入的服务器名称
- 多选后底部显示“已选择 N 台”。
- 只有运行中的实例默认可选；已停止实例允许接入但提示需要开机后才能测试？建议 P1 禁止选择非运行状态，避免测试失败；若用户需要，可先到腾讯云开机。

#### 步骤 4：统一 SSH 凭据

多选时：

- 统一 SSH 用户名
- 统一端口（默认 22）
- 统一认证方式：
  - 密码：一次输入，批量使用
  - 私钥：选择已有 SSH Key，或新建 Key
- 如果一个批次无法使用同一凭据，用户必须取消多选，逐台添加。
- UI 明确提示：

```text
多选模式下，所选服务器必须使用相同的 SSH 用户名和密钥/密码。
```

- 凭据不写入 provider 账号表；沿用现有 `servers.secret_ciphertext` / `ssh_keys` 机制。

#### 步骤 5：统一分组和类型

- 分组：统一选择一个服务器分组。
- 类型：统一选择一个服务器类型。
- 类型必须支持所选实例的操作系统：
  - 使用实例返回的 OS 信息与现有 `typeSupportsOs` 计算交集。
  - 交集为空时不能继续，提示“所选实例操作系统不一致，请分批添加”。
- 如果接入商没有返回可靠 OS，使用现有“识别操作系统”流程；多选时逐台识别。
- 分组/类型是服务器管理原有概念，不新增 provider 专用分组。

#### 步骤 6：批量测试

- 点击“测试全部”后，对每台实例的 `host`/`port`/SSH 凭据执行现有连接测试。
- 结果逐台展示：成功/失败/错误原因。
- 添加按钮规则：
  - 所有选中实例都测试成功才允许添加；
  - 失败的实例可以取消选择后继续；
  - 测试结果有有效期（例如 5 分钟），凭据或目标变化后失效。
- 后端创建时必须校验测试凭证，不能只信任前端状态。

#### 步骤 7：创建

- 请求包含：
  - provider account id
  - instance ids
  - 统一 SSH 凭据/Key
  - 统一分组/类型
  - 测试凭证（每台）
- 后端重新校验：
  - 账号启用且属于当前 provider
  - 实例仍然存在且未接入
  - 测试凭证未过期
  - 分组/类型可用
- 在一个事务里批量插入；任一失败则回滚，或采用“全部成功/全部失败”策略。
- 创建成功后返回服务器列表；前端刷新，已接入实例置灰。

## 8. 服务器列表展示接入商

`ServerListItem`/`ServerDto` 增加：

```ts
provider: {
  key: string
  label: string
  accountId: string | null
  accountName: string | null
  instanceId: string | null
  product: 'cvm' | 'lighthouse' | null
  region: string | null
} | null
```

- `provider` 为 `null` 表示自定义服务器。
- 列表行在名称下方显示：
  - `腾讯云 · 轻量应用服务器 · 广州`
  - 或 `自定义服务器`
- 云服务器详情页显示 provider 身份和实例 ID；账号名可点击跳转平台设置。
- 自定义服务器不显示云厂商信息。
- 列表可按接入商筛选（P2），P1 至少展示徽标。

## 9. API 设计

### 9.1 接入商与账号

```http
GET    /console-api/server-providers
POST   /console-api/server-providers/accounts
PATCH  /console-api/server-providers/accounts/:id
DELETE /console-api/server-providers/accounts/:id
POST   /console-api/server-providers/accounts/:id/test
GET    /console-api/server-providers/accounts/:id/regions
GET    /console-api/server-providers/accounts/:id/instances?product=&region=&status=
```

响应中的账号：

```ts
interface ProviderAccountDto {
  id: string
  providerKey: string
  providerName: string
  name: string
  credentialHint: string
  defaultRegion: string
  capabilities: Array<'server' | 'billing' | 'renewal'>
  enabled: boolean
  lastTestAt: string | null
  lastTestOk: boolean | null
}
```

- 绝不返回 SecretKey。
- 编辑时 SecretKey 留空表示不修改。
- `test` 失败返回对应的 `ProviderError`。

### 9.2 云实例

```http
GET /console-api/server-providers/accounts/:id/instances?product=cvm&region=ap-guangzhou
```

返回标准 `CloudInstance[]`，其中包含 `alreadyRegistered` 和 `registeredServerId`。

### 9.3 批量测试

```http
POST /console-api/server-providers/instances/test
```

请求：

```json
{
  "accountId": "…",
  "instances": ["ins-1", "ins-2"],
  "ssh": {
    "user": "root",
    "port": 22,
    "authMethod": "private_key",
    "keyId": "…"
  }
}
```

返回逐台结果和测试凭证：

```json
{
  "results": [
    { "instanceId": "ins-1", "ok": true, "testId": "…", "expiresAt": "…" },
    { "instanceId": "ins-2", "ok": false, "error": { "code": "ssh_auth_failed" } }
  ]
}
```

### 9.4 批量创建

```http
POST /console-api/servers/cloud
```

请求包含 accountId、instanceIds、SSH 凭据、groupId、typeKey、testIds。后端校验 provider 账号、实例、测试凭证和唯一性，事务内创建。

### 9.5 现有服务器接口

- `GET /console-api/servers` / `GET /console-api/servers/:id` 的 DTO 增加 `provider` 字段。
- 自定义服务器创建接口保持不变。
- 云服务器更新只允许改名称、分组、SSH 凭据等，不允许改 provider 身份字段。

## 10. 安全与一致性

- AK/SK 使用 `ctx.secrets` 加密；数据库、日志、API 响应中不出现 SecretKey。
- Provider adapter 只解密当前请求需要的凭据，用完即弃。
- 接入商账号测试和实例列表都要求控制台登录。
- 云实例 ID 唯一性由数据库约束保证；UI 置灰只是辅助。
- 批量创建使用事务；部分失败时不留下半批数据。
- 测试凭证绑定：
  - provider account
  - instance id
  - SSH 凭据哈希
  - 过期时间
- 不在 provider metadata 中保存实例的完整 API 响应；只保存展示和审计所需字段。
- 失败错误保留 cause，但对外只返回稳定 code 和可读消息。

## 11. 资金/续费扩展

本次 P1 只完成服务器发现和接入，但账号模型为续费预留：

- `capabilities` 支持 `billing` / `renewal`。
- `CloudProvider.billing` 为可选接口。
- 腾讯云账号的 AK/SK 可以继续用于：
  - 查询账户余额
  - 查询账单
  - 续费报价
  - 发起续费
- 续费涉及资金操作，P2 必须增加：
  - 报价/确认两步
  - 操作审计
  - 金额上限或二次确认
  - 失败回滚/幂等
- 仪表盘接入时通过 `ctx.dashboard.ingest` 上报余额和账单，不直接读取 provider 账号表。

## 12. 腾讯云实现细节

- 产品：
  - CVM：普通云服务器
  - Lighthouse：轻量应用服务器
- 账号能力：
  - `server`：DescribeInstances / DescribeRegions
  - `billing`/`renewal`：P2
- 认证：SecretId + SecretKey；不强制子账号 UIN。
- 地域：
  - 优先使用账号支持的地域列表。
  - 默认地域来自账号配置或第一个可用地域。
- 分页：
  - 按地域、产品分页拉取，直到取完。
  - 单次拉取限制条数和超时；失败地域不阻塞其他地域。
- 公网 IP：
  - 优先公网 IPv4；没有公网 IP 的实例不允许直接接入，除非用户选择“使用内网地址”（P2）。
- 实例状态：
  - P1 只允许 `running` 实例选中。
- SDK 异常：
  - 鉴权失败、权限不足、限流、地域不可用分别映射 `ProviderError`。

## 13. 前端结构

```text
plugins/server-management/src/
├─ client/
│  ├─ providers/
│  │  ├─ ProvidersPage.tsx          # 平台设置页
│  │  ├─ AccountDialog.tsx
│  │  └─ ProviderBadge.tsx
│  └─ servers/
│     ├─ cloud/
│     │  ├─ CloudServerImport.tsx
│     │  ├─ CloudInstanceTable.tsx
│     │  ├─ CloudCredentials.tsx
│     │  └─ CloudTestPanel.tsx
│     └─ form/ServerForm.tsx        # 现有自定义流程
└─ host/
   ├─ providers/
   │  ├─ registry.ts
   │  ├─ contract.ts
   │  ├─ tencent-cloud.ts
   │  └─ accounts.ts
   ├─ servers/cloud.ts
   └─ http/providers.ts
```

- 平台设置页使用现有 `console.page` 注册；不要新增侧边栏主入口。
- 服务器登记模式切换放在现有登记入口，不改变“服务器管理”导航。
- 列表徽标复用现有 table/list 样式，不引入新表格组件。

## 14. 测试

### 单元

- Provider registry 注册/查找/注销。
- 腾讯云实例响应标准化：
  - 公网/内网 IP
  - 产品类型
  - 状态
  - 地域/可用区
  - OS
- AK/SK 加密/解密；API DTO 不含 SecretKey。
- 已接入判断：
  - 同 provider + region + instance id 判重
  - 不同账号访问同一实例仍判重
- 批量测试/创建：
  - 未测试拒绝
  - 测试过期拒绝
  - 凭据变化后测试失效
  - 部分失败事务回滚
- 分组/类型 OS 兼容性。

### 集成

- 平台设置添加/测试/停用腾讯云账号。
- 拉取腾讯云 CVM/Lighthouse 实例（mock 或测试账号）。
- 多选实例统一 SSH 凭据、统一分组/类型创建。
- 列表显示腾讯云徽标、已接入置灰。
- 自定义服务器流程不受影响。
- 删除仍被服务器引用的账号被拒绝。
- 非腾讯云 provider 的注册不需要修改服务器登记主流程。

## 15. 验收标准

1. 平台设置出现“服务器接入商”，可以添加多个腾讯云账号。
2. AK/SK 加密保存，接口不回显 SecretKey。
3. 服务器登记有“云服务接入”和“自定义服务器”两种模式。
4. 云服务接入能列出腾讯云 CVM 和轻量实例。
5. 已接入实例置灰并提示。
6. 多选实例可统一 SSH 凭据、分组和类型。
7. 多选混合 OS 无法选到兼容类型时给出明确提示。
8. 必须测试通过才能批量添加。
9. 服务器列表显示接入商和实例信息。
10. 自定义服务器流程保持可用。
11. 新接入商通过 `CloudProvider` 注册即可扩展，不改主流程。

## 16. 实施顺序

### P1

- 迁移、provider contract/registry
- 腾讯云 adapter：test/regions/listInstances
- 接入商账号 host API + 加密
- 平台设置页面
- 云实例列表与已接入判断
- 云服务接入 UI、统一凭据/分组/类型、批量测试/创建
- 服务器列表 provider 徽标
- 单元/集成测试

### P2

- 腾讯云账单/余额/续费能力
- 内网 IP 接入
- 按接入商筛选
- 云实例搜索/批量刷新
- 多账号实例去重与权限审计

### P3

- 其他云厂商 adapter
- 实例到期提醒/自动续费
- 与仪表盘打通余额和账单

## 17. 风险与待确认

| 风险 | 应对 |
| --- | --- |
| AK/SK 权限过大 | 文档建议腾讯云子账号最小权限；服务端不记录密钥 |
| 多账号重复实例 | provider + region + instance id 唯一约束，账号不参与唯一键 |
| 多选实例 OS/凭据不一致 | 统一凭据 + OS 类型兼容检查；不满足则分批添加 |
| 批量测试后实例状态变化 | 创建时后端重新校验，测试凭证短有效期 |
| 腾讯云 SDK 体积/版本 | 适配器隔离，按产品依赖固定版本 |
| 续费误操作 | P2 报价 + 二次确认 + 审计，P1 不实现扣费 |
| 已有自定义服务器 | provider 字段可空，不回填，不影响现有流程 |

待确认：

1. 腾讯云账号是否只使用主账号 AK/SK，还是要求用户填写子账号 UIN？
2. 已停止的云服务器是否允许接入（本设计 P1 只允许运行中）。
3. 没有公网 IP 的实例是否必须支持内网接入（当前放 P2）。
4. 多选失败时是“全部成功才创建”还是允许部分成功（当前按全部成功/事务回滚）。
5. 续费能力的账号是否和服务器发现账号共用同一 AK/SK（当前设计共用，通过 capabilities 声明）。
