# 文件管理与 Harness 附件（腾讯云 COS，双桶）设计方案

- 状态：已确认，待实施
- 日期：2026-11-03（第 3 版：双桶——Harness 附件桶 + 默认桶，各自独立密钥）
- 分支：`feat/cos`
- 适用范围：单用户 CES / Harness 控制台，本地或内网部署
- 关联代码：`plugins/domain-manager`（插件结构、审批与审计模式）、`dsh-attachment` / `dsh-attachment-local`（附件服务接缝与本地实现）

## 1. 背景与目标

控制台需要两类对象存储能力：

1. **Harness 附件存储**：会话中上传的图片和文件（现在落在 `$DSH_HOME/attachments/v1`），改由专用 COS 桶接管，桶私有，不出现在文件管理界面，也不给 AI 工具访问。
2. **文件管理**：一个默认桶，文件管理页面与 AI 工具操作的都是它。

因此 COS 配置是**双桶**：

| 角色 | 名称 | 用途 | 是否对 Harness 公开 |
| --- | --- | --- | --- |
| `attachments` | Harness 数据桶 | 会话附件（图片、文件）的持久化后端 | 否（仅附件服务内部读写，UI/工具不可见） |
| `default` | 默认桶 | 文件管理页面 + AI 工具 | 是（页面可见、工具可操作） |

两个桶**各自独立**的 SecretId / SecretKey（最小权限），配置时两个桶都必须填写。

目标：

- 密钥只留在宿主；浏览器与 AI 工具接触不到任何密钥。
- 附件桶不暴露页面与工具，也不签发对外链接。
- 文件管理与现有「服务器管理」「域名管理」同一套视觉与交互。
- 所有文件操作与下载可审计；AI 写操作需审批。

## 2. 概念与边界

- **附件（attachment）**：会话消息里的图片或文件，由 DSH 的 `ctx.attachments`（`AttachmentStore`）服务保存，引用是内容寻址的 sha256，会话日志里只存引用。
- **默认桶对象**：用户在文件管理页面或 AI 工具里看到的对象，按 key 前缀浏览。
- 两者不互通：文件管理不能浏览附件桶；AI 工具也不能读写附件桶。
- 不做多租户、共享链接、在线预览；不做目录语义（COS 只有 key 前缀）；不做分片上传（超过上限走 P5 预签名直传）。

## 3. 现成方案调研

### 3.1 服务端 SDK

| 库 | 版本 | 许可 | 结论 |
| --- | --- | --- | --- |
| `cos-nodejs-sdk-v5` | 3.0.0 | ISC | **采用**。覆盖 `getBucket` / `putObject` / `getObjectUrl` / `deleteObject` / `headObject` |
| `cos-js-sdk-v5` | 1.10.1 | ISC | 仅浏览器直传时需要（配 STS），v1 不用 |

SDK 是 CJS、回调式（`main: index.js`，`engines.node >= 9`），用 `node:util.promisify` 包装并在构建时标 external。

### 3.2 附件服务接缝

`@deepseek-ai/dsh-attachment` 定义抽象类 `AttachmentStore`，明确允许非宿主文件后端：`imageHostPath()` / `fileHostPath()` 返回 `undefined` 表示「不是宿主文件后端」。必须实现：

`saveImage`、`readImage`、`saveFile`、`saveFileStream`、`readFileStream`、`readImageRequest`，以及两个路径方法。

本地实现 `@deepseek-ai/dsh-attachment-local` 由 `dsh-base` 的 `cordis.patch.yml` 以 `id: attachment-local` 挂载，根目录 `$DSH_HOME/attachments/v1`；它导出 `prepareImageFile`、`readRequestImageFile`、`requestImageVariantId` 等图片规范化/缓存工具，可复用。

### 3.3 上传方式

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| 服务端代理上传 | 密钥不出宿主、审计完整、无需桶 CORS | 占宿主带宽，受上限约束 | **默认桶与附件桶都用**（附件由宿主写入） |
| 预签名 PUT 直传 | 不占宿主带宽 | 需要 CORS、审计只能记签发 | P5，超过上限时用于默认桶 |
| 预签名 GET 下载 | 不占宿主带宽 | `fetch` 需要 CORS | 默认桶下载用 302 跳转 |

### 3.4 文件列表 UI 库

| 库 | 版本 | 许可 | 结论 |
| --- | --- | --- | --- |
| `@cubone/react-file-manager` | 1.36.0 | MIT | 功能全但带 i18next/字体/主题，与 `smp-console` 冲突，备选 |
| `chonky` | 2.3.2 | MIT | 2022 年后无更新，不用 |
| `react-dropzone` | 20.1.4 | MIT | 仅拖拽，可选 |
| `uppy` | 6.x | MIT | 过重，不用 |

**结论**：不引入文件浏览器库，复用 `@smp/console-kit` 的 `Panel` / `smp-table`，自研「面包屑 + 表格 + 悬浮图标按钮」。

## 4. 总体架构

### 4.1 侧边栏

```
文件管理                （分组，icon: folder）
├── 文件管理            （icon: folder，默认桶）
└── 审计记录            （icon: audit）

平台设置（footer）
└── 对象存储            （icon: settings，双桶配置）
```

`NavGlyph` 需新增 `folder` 图标；`audit` / `settings` 已有。

### 4.2 插件划分

```
packages/cos-config/            共享：配置读取、密钥解密、SDK 客户端、key 规范化
plugins/cos-attachments/        @smp/cos-attachments：实现 AttachmentStore（桶 A）
plugins/cos-console/            @smp/console-cos：文件管理 UI、HTTP 接口、AI 工具、审计
```

- `cos-attachments` 只注入 `database`、`secrets`，不依赖 webServer；在 profile 中禁用 `attachment-local`（`- id: attachment-local, disabled: true`），插入本插件，由它提供 `ctx.attachments`。
- `cos-console` 提供页面、`/console-api/cos/*` 与 AI 工具（仅默认桶）。
- 两个插件都通过 `cos-config` 读取对应角色的配置，互不共享桶句柄。

### 4.3 附件后端（桶 A）行为

- 布局与本地一致，key 前缀 `v1/`：
  - `v1/objects/<sha256[0:2]>/<sha256>`：规范化图片（PNG，8-bit sRGB）
  - `v1/files/<sha256[0:2]>/<sha256>/<原文件名>`、`v1/file-objects/<sha256[0:2]>/<sha256>`：原始文件与去重副本
  - `v1/request-images/<hash[0:2]>/<hash>`：可选的模型请求变体缓存（也可只留本地）
- `saveImage`：复用本地实现的 `prepareImageFile` 规范化 → PUT → 头里带 sha256 元数据；内容寻址天然幂等、去重。
- `readImage`：GET → 校验 sha256 与尺寸/媒体类型 → 返回；失败按 `AttachmentError` 抛出。
- `saveFile` / `saveFileStream`：边读边算摘要，流式 PUT；`readFileStream`：流式 GET 并校验摘要。
- `readImageRequest`：本地缓存（`$DSH_HOME/cache/attachments-cos`）+ 复用本地编码工具；原图读不到时回源 COS。
- `imageHostPath` / `fileHostPath`：按需把对象物化到本地缓存再返回路径；物化失败返回 `undefined`（工具侧降级为「无法按路径打开」，图片仍能发给模型）。
- **首次启动回退**：桶 A 尚未配置或数据库不可用时，读写走 `$DSH_HOME/attachments/v1`（原本地布局），保证控制台能在配置前启动；配置完成后新写入进桶 A，读取先查桶 A 再回退本地，历史引用不失效。
- 缓存：原图与请求变体都落本地缓存目录，避免每次模型请求都走网络；v1 不做容量回收（与现状一致），后续加 LRU。

### 4.4 默认桶（桶 B）行为

- 页面与工具固定使用 `role='default'` 的配置，不存在桶选择器。
- 上传：浏览器 → 宿主 → COS（流式），`Content-Length` 必填（缺失 411），上限取设置页配置（413）。
- 下载：`GET /console-api/cos/objects/download?key=` → 302 到 300 秒签名 URL；`response-content-disposition` 通过 `Query` 传入。
- 列表：`Delimiter='/'`，目录（`CommonPrefixes`）+ 对象；分页用 marker 栈（COS 无总数）。
- 搜索：当前前缀内最多扫 5 页 × 1000 个 key，返回 `truncated`。

## 5. 数据模型

迁移 `plugins/database/migrations/0041_cos.sql`：

```sql
create table if not exists cos_buckets (
  role text primary key check (role in ('attachments', 'default')),
  bucket text not null,
  region text not null,
  secret_id text not null,
  secret_key_ciphertext text not null,
  base_prefix text not null default '',
  max_upload_bytes bigint not null default 104857600, -- 仅 default 使用
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

配置写入用 `insert ... on conflict (role) do update`；保存时两个角色必须在同一事务里一起写，缺一不可。

## 6. 配置与接口

### 6.1 设置页

平台设置 → 对象存储，两张卡片：

| 字段 | attachments 桶 | default 桶 |
| --- | --- | --- |
| Bucket（`name-appid`） | 必填 | 必填 |
| Region | 必填 | 必填 |
| SecretId | 必填 | 必填 |
| SecretKey | 必填（留空表示保持原值） | 必填（留空表示保持原值） |
| 根前缀 `basePrefix` | 可选（默认 `v1/`） | 可选（默认空） |
| 上传上限 MB | 不适用 | 1–2048，默认 100 |
| 测试连接 | 单独按钮 | 单独按钮 |

保存前分别用 `getBucket(MaxKeys=1)` 验证两个桶；任一失败则整体不保存。SecretKey 永不回传。

### 6.2 HTTP 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/console-api/cos/config` | 返回两个角色配置，`secretId` 脱敏，不含 `secretKey` |
| PUT | `/console-api/cos/config` | 一次提交两个桶；各自校验后事务写入 |
| POST | `/console-api/cos/config/{role}/test` | 用指定角色表单值测试连通性 |
| DELETE | `/console-api/cos/config` | 清空两个桶配置（不删桶） |
| GET | `/console-api/cos/objects?prefix=&marker=&limit=&search=` | 默认桶列目录/对象 |
| POST | `/console-api/cos/objects?key=&overwrite=` | 默认桶上传（流式，411/413） |
| GET | `/console-api/cos/objects/download?key=` | 默认桶 302 签名下载 |
| DELETE | `/console-api/cos/objects?key=` | 默认桶删除单个对象 |
| GET | `/console-api/cos/audit?page=&page_size=&action=&hours=&key=` | 审计分页 |

错误码：`cos_role_not_configured`、`cos_disabled`、`key_invalid`、`upload_too_large`（413）、`object_not_found`、`cos_forbidden`、`credentials_invalid`、`cos_clock_skew`、`cos_error`。

SDK 错误映射：`NoSuchKey` → `object_not_found`；`AccessDenied` → `cos_forbidden`；`InvalidAccessKeyId` / `SignatureDoesNotMatch` → `credentials_invalid`；`NoSuchBucket` → `cos_bucket_not_found`；其余带 `RequestId`。

## 7. 文件管理页面

- 顶部：面包屑前缀、搜索框、上传按钮、刷新图标；无桶选择器（固定默认桶）。
- 列表：目录行 + 对象行；列：名称、大小、修改时间、操作（下载 / 删除，悬浮图标）。
- 上传：拖入或点上传 → XHR 流式上传并显示进度；超限 413。
- 下载：302 到签名 URL，附件名 RFC 5987 编码。
- 删除：确认弹窗，只删单个对象，不递归删前缀；目录行无删除按钮。
- 分页：marker 栈（上一页/下一页），不显示页码比例。

审计页：动作 / 时间 / 对象名筛选，分页 20，行内展开详情（沿用域名审计的表格内展开方式）。

## 8. AI 工具（仅默认桶）

| 工具 | 参数 | 审批 | 说明 |
| --- | --- | --- | --- |
| `platform_cos_list` | `prefix?`、`search?`、`limit?` | 否 | 列对象/目录 |
| `platform_cos_get` | `key` | 否 | 元数据 + 300 秒签名链接 |
| `platform_cos_upload` | `path`（工作区内文件）、`key`、`overwrite?` | 是 | 读工作区文件流上传 |
| `platform_cos_delete` | `key` | 是 | 删除单个对象 |
| `platform_cos_audit_list` | `prefix?`、`action?`、`hours?`、`limit?` | 否 | 查询审计（含失败原因） |

约束：工具只解析 `role='default'`；`path` 必须在会话工作区内（`ctx.get('workingDirectory').ensure(agent)`）；未配置默认桶时返回 `cos_role_not_configured`；附件桶从不出现在工具返回值或参数中。

## 9. Harness 附件接管细节

- 在 profile patch 中禁用 `attachment-local`、插入 `@smp/cos-attachments`，保证只有一个 `ctx.attachments` 提供者。
- 附件桶配置来自 `cos_buckets`（`role='attachments'`），每次操作读取（带短 TTL 缓存），设置页保存后无需重启。
- 引用格式不变（sha256 + 元数据），所以历史会话引用继续有效；本地历史文件通过「读取回退」继续可读。
- 图片规范化仍用 `sharp`（复用 `dsh-attachment-local` 导出的 `prepareImageFile`，版本跟 dsh 0.2.1-rc.5 对齐）。
- 附件桶只做宿主内部读写，不签发下载 URL、不注册页面、不注册工具；失败只写日志并按 `AttachmentError` 返回。
- 读放大控制：原图与请求变体都进 `$DSH_HOME/cache/attachments-cos`，命中缓存不访问 COS。

## 10. 安全与限制

- 两个桶各自独立的 SecretId/SecretKey，Fernet 加密存储，任何接口都不返回。
- 桶 A 私有不公开：无签名链接、无页面、无工具；仅宿主 SDK 读写。
- key 规范化：去空白、拒绝空、拒绝 `..`、限制 1024 字节、禁止以 `/` 开头；所有操作必须落在对应角色的 `basePrefix` 内。
- 默认桶上传上限来自配置（1 MB–2 GB，默认 100 MB）；附件桶大小受 DSH 图片/文件策略约束（沿用本地限制）。
- 会话鉴权沿用控制台 cookie；上传/删除额外校验 `Origin` / `Sec-Fetch-Site`（存在时必须同源）。
- 超时：上传请求关闭默认短超时，按上限估算（至少 10 分钟）。

## 11. 审计

- 默认桶：配置保存/清空、上传、下载（签发时）、删除，均写 `cos_audit`；失败也写。
- 附件桶：不进入 `cos_audit`（避免把隐藏桶暴露到页面）；仅记录宿主错误日志，必要时后续加内部指标。
- 字段：`session_id`、`actor`、`action`、`object_key`、`size_bytes`、`ok`、`error`、`detail`。

## 12. 分阶段实施

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| P1 | 迁移、双桶设置页与配置接口、两个桶的连接测试 | 两个桶都能保存并验证 |
| P2 | `@smp/cos-attachments`：图片/文件读写 + 本地回退 + 缓存 | 会话上传的图片进桶 A，刷新后可读 |
| P3 | 默认桶文件管理：列表、上传、下载、删除、审计 | 四类操作成功且审计有记录 |
| P4 | 搜索、审计页 | 搜索有截断提示，审计可筛选 |
| P5 | AI 5 个工具、超过上限的预签名直传、新建文件夹占位对象 | 会话内工具可调用，写操作弹审批 |

## 13. 测试与验收

- 单元：配置双角色校验、key 前缀边界、摘要校验、错误映射、审计筛选、脱敏。
- 附件后端：用 fake COS 客户端测 save/read/stream/回退；验证未配置时走本地、配置后走 COS、历史本地引用仍可读。
- 接口：未登录 401；缺角色 `cos_role_not_configured`；超限 413；不存在对象 404。
- 集成（手动）：会话上传图片 → 桶 A 出现 `v1/objects/...`；文件页上传/下载/删除 → 桶 B 与审计正确。
- 安全：接口响应不含 SecretKey；附件桶的 key 不出现在文件页与工具结果；签名 URL 过期不可用。

## 14. 风险与开放问题

1. **双份存储**：附件桶和默认桶是两套独立存储，流量/费用分别计算；附件桶没有 UI，排障只能看 COS 控制台与日志。
2. **读放大**：附件读取多一次网络往返，靠本地缓存抵消；首次读大图可能变慢。
3. **回退语义**：配置桶 A 前的本地附件继续可读，但新附件只写 COS；两处并存期间没有自动迁移，需要时可加一次性搬迁脚本。
4. **SDK 版本**：`cos-nodejs-sdk-v5@3.0.0` 较新，实施前核对流式 `putObject` 与 `getObjectUrl` 回调签名。
5. **附件桶私有**：不提供任何下载链接，用户无法直接取回原图；如需导出，后续在文件管理里加「只读导入」入口（需先确认边界）。

## 15. 复核记录（2026-11-03）

对照 `cos-nodejs-sdk-v5@3.0.0` 类型定义、`dsh-attachment` 接缝与现有插件核对：

| # | 复核项 | 结论 | 处理 |
| --- | --- | --- | --- |
| 1 | 附件后端可行性 | `AttachmentStore` 允许非文件后端（路径方法返回 `undefined`） | 新增 `@smp/cos-attachments`，禁用 `attachment-local` |
| 2 | 流式上传 | `UploadBody = Buffer \| String \| Stream`，`ContentLength` 可选 | 仍强制 `Content-Length` 做上限校验，缺失 411 |
| 3 | 签名 URL | `getObjectUrl` 无 `ResponseContentDisposition` 字段 | 通过 `Query['response-content-disposition']` 传入 |
| 4 | 列表分页 | 仅 `IsTruncated` / `NextMarker`，无总数 | UI 用 marker 栈 |
| 5 | 附件根目录 | `$DSH_HOME/attachments/v1`，本地实现导出 `prepareImageFile` 等工具 | 复用规范化工具，key 布局保持一致 |
| 6 | 单桶改双桶 | 原第 2 版为单桶 | 改为 `role` 两行配置，各自密钥，必须同时配置 |
| 7 | 迁移编号 | `0040` 已被域名审计原因占用 | COS 使用 `0041` |
| 8 | 测试注入 | SDK 回调式 CJS | `cos-config` 提供 client factory，单测注入 fake |
| 9 | 图标 | `NavGlyph` 只有 chat/settings/server/audit/globe | P1 增加 `folder` |
| 10 | 非 ASCII key | COS 列表需 `encoding-type` | 列表请求带 `EncodingType: 'url'` |
