# 文件管理（腾讯云 COS）设计方案

- 状态：已确认，待实施
- 日期：2026-11-03（第 2 版：按单桶、可配置上限、对象存储设置页、AI 工具更新）
- 分支：`feat/cos`
- 适用范围：单用户 CES / Harness 控制台，本地或内网部署
- 关联代码：`plugins/domain-manager`（插件结构、审批与审计模式）、`plugins/server-management`（列表与审计页样式）

## 1. 背景与目标

控制台目前没有文件存储入口。本方案接入腾讯云对象存储（COS），在控制台提供：

1. **文件管理**（侧边栏分组）：浏览桶内对象，支持上传、下载、删除、查询。
2. **审计记录**：记录对桶内文件的操作（上传、下载、删除）与配置变更。
3. **对象存储设置**（平台设置内）：集中配置腾讯云 SecretId / SecretKey / 桶 / 区域 / 前缀 / 上传上限。

目标：

- 密钥只留在宿主，浏览器拿不到 SecretId/SecretKey。
- 列表与操作风格和「服务器管理」「域名管理」一致。
- 所有写操作与下载可追溯到时间、对象、结果。
- AI 在 Harness 会话里能列文件、取下载链接、上传本地文件、删除对象（写操作需审批）。

## 2. 非目标

- 不做多租户、共享链接、在线预览。
- **不做多桶**：一个部署只接一个 COS 桶（第 2 版决策）。切桶等于改设置，旧桶对象不再出现在列表里。
- 不做目录语义：COS 没有真实目录，只有以 `/` 结尾的 key；只做「前缀浏览」，新建文件夹占位对象放 P5。
- 不做分片 / 断点续传；>100 MB 走 P5 的预签名直传。
- 不接 CDN、图片处理、跨区域复制。
- 不做文件夹递归删除（只删单个对象）。

## 3. 现成方案调研

### 3.1 服务端 SDK

| 库 | 版本 | 许可 | 结论 |
| --- | --- | --- | --- |
| `cos-nodejs-sdk-v5` | 3.0.0（2026-07 发布） | ISC | **采用**。官方 Node SDK，覆盖 `getBucket` / `putObject` / `getObject` / `getObjectUrl` / `deleteObject` / `headObject` |
| `cos-js-sdk-v5` | 1.10.1 | ISC | 仅浏览器直传时需要（配 STS 临时密钥）；v1 不用 |

该 SDK 是 CJS、回调式 API（`main: index.js`，`engines.node >= 9`）。插件里用 `node:util.promisify` 包装，esbuild 构建时标为 external，不打进 `lib/`。

### 3.2 上传方式

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| 服务端代理（浏览器 → 宿主 → COS） | 密钥不出宿主；审计完整；无需桶 CORS | 占用宿主带宽；受上限约束 | **v1 采用**，上限由设置页配置 |
| 预签名 PUT 直传 | 不占宿主带宽，支持大文件 | 需要桶 CORS，审计只能记签发动作 | P5，用于超过上限的文件 |
| 预签名 GET 下载 | 下载不占宿主带宽 | `fetch` 需要 CORS（直接跳转不需要） | **采用**：302 到 5 分钟签名 URL |

### 3.3 文件列表 UI 库

| 库 | 版本 | 许可 | 体积/依赖 | 结论 |
| --- | --- | --- | --- | --- |
| `@cubone/react-file-manager` | 1.36.0 | MIT | i18next、react-icons、react-collapsed、自带字体 | 功能全但主题冲突，覆盖成本高，备选 |
| `chonky` | 2.3.2 | MIT | 2022 年后无更新 | 不采用 |
| `react-dropzone` | 20.1.4 | MIT | 仅拖拽 | 可选（P3 增强拖拽） |
| `uppy` / `@uppy/core` | 6.x | MIT | 上传编排 + 自带 UI，体积大 | 不采用 |

**结论**：不引入文件浏览器库。列表复用 `@smp/console-kit` 的 `Panel` / `smp-table`，自研「面包屑 + 表格 + 悬浮图标按钮」，与域名/服务器列表同一视觉；拖拽用原生 `input[type=file]` + `dragover` 蒙层。

## 4. 总体设计

### 4.1 侧边栏结构

```
文件管理                （分组，icon: folder）
├── 文件管理            （icon: folder）
└── 审计记录            （icon: audit）

平台设置（footer 分组）
└── 对象存储            （icon: settings，key: cos-settings）
```

「对象存储」沿用 `frame` 的平台设置分组（`group: 'platform'`、`placement: 'footer'`），排在「插件」附近。`NavGlyph` 需新增 `folder` 图标（`audit`、`settings` 已有）。

### 4.2 插件与文件结构

```
plugins/cos-file-manager/
├── package.json              @smp/console-cos, engines.dsh 0.2.1-rc.5
├── cordis.patch.yml          insert smp-cos
├── icon.svg / locale/{zh,en}.json
├── src/index.ts              宿主入口：路由、鉴权、工具注入
├── src/host/cos.ts           SDK 封装（promisify、错误映射、签名 URL）
├── src/host/config.ts        单桶配置读写、密钥解密、上限校验
├── src/host/objects.ts       列表 / 上传 / 下载 / 删除
├── src/host/audit.ts         审计写入与查询
├── src/host/tools.ts         AI 工具（4 个）
├── src/client.tsx            注册 3 个页面
├── src/client/FilesPage.tsx  文件列表与上传/下载/删除
├── src/client/SettingsPage.tsx 对象存储设置
├── src/client/AuditPage.tsx  审计列表
├── src/client/copy.ts / files.css
└── test/*.test.ts
```

依赖：`cos-nodejs-sdk-v5 ^3.0.0`（宿主，external）、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools`（AI 工具）。

### 4.3 页面与数据流

**对象存储设置页（平台设置）**

- 字段：展示名（可选）、Bucket（`name-appid`）、Region（如 `ap-guangzhou`）、SecretId、SecretKey、根前缀 `basePrefix`（只允许浏览该前缀内，默认空）、上传上限 MB（默认 100，范围 1–2048）、启用开关。
- SecretKey 不回传，输入框留空表示「保持原值」。
- 「测试连接」按钮：用当前表单值调 `getBucket(MaxKeys=1)`，返回延迟与结果。
- 保存时先校验 bucket/region 格式与上限范围，再写库。

**文件管理页**

- 顶部：面包屑前缀、搜索框、上传按钮、刷新图标（无桶选择器——单桶）。
- 列表：目录行（`CommonPrefixes`）+ 对象行；列：名称、大小、修改时间、操作（下载 / 删除，悬浮显示）。
- 上传：拖入或点上传 → `POST /console-api/cos/objects?key=`，原始字节流；`Content-Length` 必填（缺失 411），超过配置上限 413；宿主以 `putObject({ Body: stream, ContentLength })` 流式转发，不整包缓冲；key 相对 `basePrefix` 解析，越界拒绝。
- 下载：`GET /console-api/cos/objects/download?key=` → 302 到 300 秒签名 URL（`getObjectUrl({ Sign: true, Expires: 300 })`）；附件名通过 `Query['response-content-disposition']` 传入并做 RFC 5987 编码；跳转前写 `download` 审计。
- 删除：确认弹窗 → `DELETE`；只删单个对象，文案里明确不会递归删除前缀；目录行不提供删除按钮。
- 搜索：以当前前缀为界，宿主最多扫描 5 页 × 1000 个 key 做名称包含匹配，返回 `truncated`；超出提示缩小前缀。
- 分页：COS 列表没有总数，用 marker 栈（上一页/下一页保存历史 marker），不显示页码比例。

**审计记录页**：筛选动作 / 时间 / 对象名，分页 20 条，行展开看 detail JSON。

## 5. 数据模型

迁移 `plugins/database/migrations/0041_cos.sql`：

```sql
-- 单行配置：id 恒为 true。
create table if not exists cos_config (
  id boolean primary key default true check (id),
  name text not null default '',
  bucket text not null default '',
  region text not null default '',
  secret_id text not null default '',
  secret_key_ciphertext text not null default '',
  base_prefix text not null default '',
  max_upload_bytes bigint not null default 104857600,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists cos_audit (
  id bigserial primary key,
  session_id text,
  actor text not null default 'console',     -- console | tool
  action text not null,                      -- config | upload | download | delete
  object_key text not null default '',
  size_bytes bigint,
  ok boolean not null,
  error text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists cos_audit_created_idx on cos_audit (created_at desc);
create index if not exists cos_audit_key_idx on cos_audit (object_key);
```

配置只有一行，写入使用 `insert into cos_config (id) values (true) on conflict (id) do update set ...`，避免重复行。

## 6. 宿主接口

全部挂在 `/console-api/cos` 下，`consoleSession.read()` 鉴权，错误统一 `{ code, detail }`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/console-api/cos/config` | 读取配置；`secretId` 脱敏（前 6 位 + `…`），不含 `secretKey` |
| PUT | `/console-api/cos/config` | 保存配置；`secretKey` 为空表示保持原值；保存前 `getBucket` 验证 |
| POST | `/console-api/cos/config/test` | 用当前表单或已存配置测试连通性，返回 `{ ok, latencyMs, bucket }` |
| DELETE | `/console-api/cos/config` | 清空配置（不删桶） |
| GET | `/console-api/cos/objects?prefix=&marker=&limit=&search=` | 列目录/对象；`Delimiter='/'`；返回 `items`、`nextMarker`、`truncated` |
| POST | `/console-api/cos/objects?key=&overwrite=` | 上传；`Content-Length` 必填（缺失 411）；上限取配置；key 必须落在 `basePrefix` 内 |
| GET | `/console-api/cos/objects/download?key=` | 302 到签名 URL（300 秒）；记录下载审计 |
| DELETE | `/console-api/cos/objects?key=` | 删除单个对象；记录审计 |
| GET | `/console-api/cos/audit?page=&page_size=&action=&hours=&key=` | 审计分页 |

错误码：`cos_not_configured`、`cos_disabled`、`key_invalid`、`upload_too_large`（413）、`object_not_found`、`cos_forbidden`、`cos_error`。

### 6.1 SDK 错误映射

`cos-nodejs-sdk-v5` 的错误对象是 `{ statusCode, code, message, error, RequestId }`（旧字段 `error` 可能是 `{ Code, Message }`）。映射规则：

| COS 错误码 / 状态 | 返回 |
| --- | --- |
| `NoSuchKey`（404） | `object_not_found` |
| `AccessDenied` / `Forbidden`（403） | `cos_forbidden` |
| `InvalidAccessKeyId` / `SignatureDoesNotMatch` | `cos_credentials_invalid` |
| `NoSuchBucket` / `BucketNotFound` | `cos_bucket_not_found` |
| `RequestTimeTooSkewed` | `cos_clock_skew` |
| 其他 | `cos_error`，附 `RequestId` 便于查腾讯云工单 |

## 7. AI 工具

在 Harness 会话中注册 5 个工具，写操作沿用域名插件的审批模式（full-access 直通，否则逐次批准），全部记 `actor='tool'` 审计。

| 工具 | 参数 | 审批 | 说明 |
| --- | --- | --- | --- |
| `platform_cos_list` | `prefix?`、`search?`、`limit?` | 否 | 列对象/目录，返回 key、大小、修改时间 |
| `platform_cos_get` | `key` | 否 | 返回对象元数据 + 300 秒签名下载链接 |
| `platform_cos_upload` | `path`（工作区内本地文件）、`key`、`overwrite?` | 是 | 读本地文件流上传到 COS |
| `platform_cos_delete` | `key` | 是 | 删除单个对象 |
| `platform_cos_audit_list` | `prefix?`、`action?`、`hours?`、`limit?` | 否 | 查询 COS 操作审计，含失败原因 |

约束：

- `path` 必须落在当前会话工作区内（`workingDirectory.ensure(agent)`），拒绝 `..` 越界；
- 上传同样受设置页上限约束；
- 未配置桶时工具返回 `cos_not_configured`，不静默失败；
- 返回值只含对象信息与签名链接，不含任何密钥。

## 8. 安全与限制

- `secretKey` 用 `ctx.secrets`（Fernet）加密存储；任何接口都不返回；
- `secretId` 只回传脱敏值；
- 浏览器只接触对象 key 与 5 分钟签名 URL；
- key 规范化：去空白、拒绝空、拒绝 `..` 段、限制 1024 字节、禁止以 `/` 开头；
- **前缀边界**：列表、上传、下载、删除都先把 key 解析为 `basePrefix + 相对路径`，解析后必须以 `basePrefix` 开头，否则 `key_invalid`；`basePrefix` 非空时自动补 `/`；
- 上传上限来自配置（1 MB–2 GB，默认 100 MB），超限 413；
- 下载 302 时设置 `response-content-disposition` 指定附件名（非 ASCII 用 RFC 5987 编码）；代理下载（P5 可选）加 `X-Content-Type-Options: nosniff`；
- 所有路由要求控制台会话；配置变更也写审计；
- CSRF：沿用控制台现有模式（同源 cookie、无 CSRF token）。上传/删除接口额外校验 `Origin`/`Sec-Fetch-Site`（存在时必须是 same-origin），降低跨站表单提交风险；
- 超时：宿主对上传请求关闭默认 2 分钟 socket 超时，按 `max_upload_bytes` 估算超时（至少 10 分钟），避免大文件被中途掐断。

## 9. 审计

- 记录点：配置保存/清空、上传、下载（签发链接时）、删除；列表默认不记；
- 字段：`session_id`、`actor`、`action`、`object_key`、`size_bytes`、`ok`、`error`、`detail`；
- 失败也记录（超限、404、权限不足），方便排查；
- 审计页筛选：动作、时间范围、对象名包含。

## 10. 分阶段实施

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| P1 | 插件骨架、迁移、对象存储设置页与配置接口、测试连接 | 能保存并验证一个桶 |
| P2 | 文件列表（目录 + 对象）、面包屑、刷新 | 能浏览根前缀与子前缀 |
| P3 | 上传（流式 + 进度）、下载（签名跳转）、删除、审计写入 | 四类操作成功且审计有记录 |
| P4 | 搜索（含截断提示）、审计记录页 | 搜索与筛选可用 |
| P5 | AI 5 个工具、>上限预签名直传、新建文件夹占位对象 | 会话内工具可调用，写操作弹审批 |

## 11. 测试与验收

- 单元：key 规范化、上限解析与范围、签名 URL 参数、审计筛选、配置脱敏；
- 接口：未登录 401；未配置 `cos_not_configured`；禁用 `cos_disabled`；超限 413；不存在对象 404；
- 集成（手动）：真实桶完成 上传 → 列表 → 下载 → 删除，核对 COS 控制台与审计页；
- 安全：响应中不出现 `secretKey`；签名 URL 过期不可用；AI 上传越界路径被拒。

## 12. 风险与开放问题

1. **单桶的取舍**：切换桶需要改设置，旧桶对象不再显示；如果以后要多桶，需要把 `cos_config` 扩成多行并加桶选择器。
2. **上传上限**：代理上传占宿主带宽与内存（流式转发，不整包缓冲），默认 100 MB；大文件建议用 P5 预签名直传。
3. **SDK 版本**：`cos-nodejs-sdk-v5@3.0.0` 较新，实施前核对 `putObject` 流式 Body 与 `getObjectUrl` 回调签名。
4. **搜索成本**：COS 无全文检索，扫描上限 5×1000，超出提示缩小前缀（已确认接受）。
5. **AI 上传的路径边界**：只允许工作区内文件；是否需要「只读模式」开关（禁止 AI 删除）待定，默认沿用审批。



## 13. 复核记录（2026-11-03）

对照 `cos-nodejs-sdk-v5@3.0.0` 的 `index.d.ts`、仓库现有插件与 dsh 能力逐条核对，结论与修正如下：

| # | 复核项 | 结论 | 处理 |
| --- | --- | --- | --- |
| 1 | 流式上传 | `UploadBody = Buffer \| String \| Stream`，`ContentLength` 可选（流式时走服务端流式上传） | 仍强制要求 `Content-Length`，用于上限校验；缺失返回 411 |
| 2 | 签名 URL | `getObjectUrl` 支持 `Expires`（默认 900 秒）与 `Query`；没有 `ResponseContentDisposition` 字段 | 附件名改由 `Query['response-content-disposition']` 传入并签名 |
| 3 | 错误对象 | `{ statusCode, code, message, error, RequestId }`，旧字段 `error` 可能是 `{ Code, Message }` | 新增 6.1 错误映射表，统一返回 `code/detail` 并带 `RequestId` |
| 4 | 列表分页 | `getBucket` 只返回 `IsTruncated` / `NextMarker`，没有总数 | 文件页分页改为 marker 栈，不显示页码比例 |
| 5 | 单行配置 | `id boolean primary key check (id)` 需要幂等写入 | 明确使用 `insert ... on conflict (id) do update` |
| 6 | 前缀边界 | 原方案只在列表提了 `basePrefix` | 列表、上传、下载、删除全部强制校验前缀，越界 `key_invalid` |
| 7 | 侧栏图标 | `NavGlyph` 目前只有 `chat` / `settings` / `server` / `audit` / `globe` | P1 增加 `folder` 图标 |
| 8 | 工作区边界 | 服务器管理用 `ctx.get('workingDirectory')` 的 `ensure(agent)` | AI 上传沿用该服务，未注入时工具返回不可用 |
| 9 | 审批 | 域名插件已有 `authorizeOperation`（full-access 直通，否则逐次批准） | COS 写工具直接复用同一模式 |
| 10 | 会话内审计 | 域名插件已提供 `platform_domain_audit_list` | 对称新增 `platform_cos_audit_list`，工具数 4 → 5 |
| 11 | 迁移编号 | `0040` 已被 `0040_domain_audit_reason.sql` 占用 | COS 迁移改为 `0041_cos.sql` |
| 12 | 连接测试权限 | `getBucket` 需要 ListBucket 权限，只有对象读写权限的密钥会失败 | 设置页文案注明；保存前必须通过该测试 |
| 13 | 测试注入 | SDK 是回调式 CJS，直接 mock 困难 | `host/cos.ts` 接受 client factory，单测注入 fake 客户端 |
| 14 | 非 ASCII key | COS 列表对特殊字符需要 `encoding-type` | 列表请求带 `EncodingType: 'url'`，返回时解码 |

遗留风险（不影响 P1–P3）：

- 控制台沿用同源 cookie、无 CSRF token；上传/删除额外做 `Origin` / `Sec-Fetch-Site` 校验。
- 代理上传占宿主带宽，大文件仍建议 P5 预签名直传。
- `getObjectUrl` 的签名 URL 一旦泄露，在有效期内可被任何人下载；有效期固定 300 秒，且只对单个 key 签发。
