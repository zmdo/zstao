# 文件管理（腾讯云 COS）设计方案

- 状态：已确认，待实施
- 日期：2026-11-03
- 分支：`feat/cos`
- 适用范围：单用户 CES / Harness 控制台，本地或内网部署
- 关联代码：`plugins/domain-manager`（同款插件结构、审批与审计模式）、`plugins/server-management`（列表与审计页样式）

## 1. 背景与目标

控制台目前只有域名管理，没有文件存储入口。本方案接入腾讯云对象存储（COS），在左侧侧边栏新增「文件管理」分组，包含两个页面：

1. **文件管理**：浏览某个存储桶内的对象，支持上传、下载、删除、查询。
2. **审计记录**：记录对桶内文件的操作（上传、下载、删除、配置变更）。

目标：

- 密钥只留在宿主，浏览器拿不到 SecretId/SecretKey。
- 列表与操作风格和「服务器管理」「域名管理」一致，不引入第二套视觉。
- 所有写操作与下载都可追溯到时间、对象、结果。

## 2. 非目标

- 不做多租户、不做共享链接、不做在线预览（图片/文档渲染）。
- 不实现 COS 的目录语义（COS 没有真实目录，只有以 `/` 结尾的 key）；只做「前缀浏览 + 新建文件夹占位对象」的可选能力（P3 再定）。
- 不做大文件分片/断点续传（P4 用预签名直传解决）。
- 不接 CDN、不接图片处理、不接跨区域复制。
- 不做 AI 工具的完整增删改（P4 只读工具，写操作再评审）。

## 3. 现成方案调研

### 3.1 服务端 SDK

| 库 | 版本 | 许可 | 结论 |
| --- | --- | --- | --- |
| `cos-nodejs-sdk-v5` | 3.0.0（2026-07 发布） | ISC | **采用**。官方 Node SDK，覆盖 `getBucket` / `putObject` / `getObject` / `getObjectUrl` / `deleteObject` / `headObject` |
| `cos-js-sdk-v5` | 1.10.1 | ISC | 仅浏览器直传时使用；需要 STS 临时密钥，v1 不用 |

注意：`cos-nodejs-sdk-v5` 是 CJS、回调式 API（`main: index.js`，`engines.node >= 9`），在 ESM 插件里用 `createRequire` 或直接默认导入，再用 `node:util.promisify` 包装；esbuild 构建时把该包标为 external，不打进 `lib/`。

### 3.2 浏览器直传 vs 服务端代理

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| 服务端代理（浏览器 → 宿主 → COS） | 密钥不出宿主；审计天然完整；无需桶 CORS | 占用宿主带宽；大文件受内存/超时限制 | **v1 采用**（上限 100 MB） |
| 预签名 PUT 直传 | 不占宿主带宽，支持大文件 | 需要桶 CORS、暴露 key、审计只能记录签发动作 | P4 用于 >100 MB |
| 预签名 GET 下载 | 下载不占宿主带宽 | 需要 CORS 才能 `fetch`；直接跳转不受影响 | **采用**：302 到 5 分钟有效的签名 URL |

### 3.3 文件列表 UI 库对比

| 库 | 版本 | 许可 | 体积/依赖 | 适配度 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `@cubone/react-file-manager` | 1.36.0 | MIT | 依赖 i18next、react-icons、react-collapsed、@fontsource/nunito-sans | 功能全（网格/列表、右键菜单、重命名），但自带主题与字体，和 `smp-console` 样式体系冲突，需要大量覆盖 | 备选，不默认采用 |
| `chonky` | 2.3.2 | MIT | 较旧，2022 年后无更新 | 文件浏览器组件，定制成本高 | 不采用 |
| `react-dropzone` | 20.1.4 | MIT | 仅拖拽 | 只解决拖放，不提供列表 | 可选（P2 若要更好的拖拽体验） |
| `uppy` / `@uppy/core` | 6.x | MIT | 上传编排 + 自带 UI，体积大 | 与现有界面重复 | 不采用 |

**结论**：不引入重型文件浏览器。列表复用 `@smp/console-kit` 的 `Panel` / `TableCard` 与现有 `smp-table` 样式，自己做「面包屑 + 表格 + 悬浮图标按钮」，与域名/服务器列表保持一致；拖拽用原生 `input[type=file]` + 一个 `dragover` 蒙层即可，后续需要多文件进度再考虑 `react-dropzone`。

## 4. 总体设计

### 4.1 侧边栏结构

```
文件管理            （分组，icon: folder）
├── 文件管理        （页面，icon: folder）
└── 审计记录        （页面，icon: audit）
```

与「域名管理」一致：`console.page` 注册两个页面，`group: 'cos-files'`、`navigation: 'sidebar'`。图标沿用 `NavGlyph` 的 `folder`（需新增）与已有 `audit`。

### 4.2 插件与文件结构

```
plugins/cos-file-manager/
├── package.json              @smp/console-cos-files, engines.dsh 0.2.1-rc.5
├── cordis.patch.yml          insert smp-cos-files
├── icon.svg / locale/{zh,en}.json
├── src/index.ts              宿主入口：路由注册、鉴权、工具注入
├── src/host/cos.ts           SDK 封装（promisify、错误映射、签名 URL）
├── src/host/service.ts       桶配置读写、密钥解密、key 规范化
├── src/host/audit.ts         写入与查询审计
├── src/host/tools.ts         P4 只读工具（可选）
├── src/client.tsx            注册两个页面
├── src/client/FilesPage.tsx  文件列表 / 上传 / 下载 / 删除
├── src/client/AuditPage.tsx  审计列表
├── src/client/copy.ts        中英文案
├── src/client/files.css      列表与拖拽样式
└── test/*.test.ts            key 规范化、审计、接口参数
```

依赖：`cos-nodejs-sdk-v5 ^3.0.0`（宿主，external）、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools`（仅 P4）。

### 4.3 页面与数据流

**文件管理页**

- 顶部：桶选择（多桶时显示）、面包屑前缀、「搜索」输入框、上传按钮、刷新图标。
- 列表：目录行（`CommonPrefixes`）与对象行；列：名称、大小、修改时间、操作（下载 / 删除图标，悬浮显示）。
- 上传：拖入或点上传 → `POST /console-api/cos/objects?bucket=&key=`，原始字节流，宿主直接 `putObject` 转发；进度用 XHR。
- 下载：点下载 → `GET /console-api/cos/objects/download?...` → 302 到 5 分钟签名 URL，浏览器直连 COS。
- 删除：确认弹窗 → `DELETE`；只删对象，不递归删前缀（v1 明确提示）。
- 搜索：以当前前缀为界，宿主最多扫描 5 页 × 1000 个 key 做名称包含匹配，返回 `truncated` 标记；超出提示缩小前缀。

**审计记录页**：与域名审计页同构（筛选：动作 / 时间 / 对象名，分页，行展开看 detail JSON）。

## 5. 数据模型

迁移文件 `plugins/database/migrations/0040_cos_files.sql`：

```sql
create table if not exists cos_buckets (
  id uuid primary key,
  name text not null,                        -- 展示名
  bucket text not null,                      -- examplebucket-1250000000
  region text not null,                      -- ap-guangzhou
  secret_id text not null,
  secret_key_ciphertext text not null,       -- ctx.secrets.encrypt
  base_prefix text not null default '',      -- 只允许浏览该前缀以内
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (bucket, region)
);

create table if not exists cos_audit (
  id bigserial primary key,
  session_id text,
  actor text not null default 'console',     -- console | tool
  action text not null,                      -- config | list | upload | download | delete
  bucket text not null default '',
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

## 6. 宿主接口

全部挂在 `/console-api/cos` 下，`consoleSession.read()` 鉴权，风格与域名插件一致。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/console-api/cos/config` | 列出桶配置，`secretId` 脱敏，不含 `secretKey` |
| POST | `/console-api/cos/config` | 新增/更新桶：`name`、`bucket`、`region`、`secretId`、`secretKey`、`basePrefix`；先用 `getBucket(MaxKeys=1)` 验证凭据与桶 |
| DELETE | `/console-api/cos/config/{id}` | 删除配置（不删桶） |
| GET | `/console-api/cos/objects?bucket=&prefix=&marker=&limit=&search=` | 列对象/目录；`Delimiter='/'`；返回 `items`、`nextMarker`、`truncated` |
| POST | `/console-api/cos/objects?bucket=&key=&overwrite=` | 上传；`Content-Length` 必填，上限 100 MB；key 由服务端规范化 |
| GET | `/console-api/cos/objects/download?bucket=&key=` | 302 到签名 URL（300 秒），并记录 `download` 审计 |
| DELETE | `/console-api/cos/objects?bucket=&key=` | 删除单个对象；记录审计 |
| GET | `/console-api/cos/audit?page=&page_size=&action=&hours=&key=` | 审计分页查询 |

错误统一 `{ code, detail }`，例如 `cos_not_configured`、`object_not_found`、`key_invalid`、`upload_too_large`、`cos_forbidden`、`cos_error`。

## 7. 客户端设计

- 复用 `smp-list-panel` / `smp-table` / `smp-domain-icon-button` 等既有样式；
- 上传用 `XMLHttpRequest`（需要进度），请求头带 `X-Object-Key`；
- 拖拽蒙层：`dragover` 时显示，`drop` 后按文件逐个上传；
- 删除确认弹窗说明「只删除单个对象，不会删除以该名称结尾的文件夹」；
- 空态、错误条、加载态与域名页一致；
- 审计页复用域名审计页的表格与筛选组件（可抽公共小组件，或先复制）。

## 8. 安全与限制

- `secretKey` 用 `ctx.secrets`（Fernet）加密存入 `cos_buckets`，任何接口都不返回；
- `secretId` 只回传脱敏值（前 6 位 + `…`）；
- 浏览器只接触对象 key 和 5 分钟签名 URL，不接触长期凭据；
- key 规范化：去首尾空白、拒绝空、拒绝 `..` 段、限制 1024 字节、禁止以 `/` 开头；
- 上传上限 100 MB（`COS_MAX_UPLOAD_BYTES` 可调），超限 413；
- 下载响应头 `X-Content-Type-Options: nosniff`（若走代理），签名 URL 的 `response-content-disposition` 指定附件名；
- 所有路由要求控制台会话；P4 的 AI 工具默认只读，写操作沿用域名插件的审批模式。

## 9. 审计

- 记录点：配置新增/修改/删除、列目录（可采样，默认不记）、上传、下载（签发 URL 时）、删除；
- 字段：`session_id`、`actor`、`action`、`bucket`、`object_key`、`size_bytes`、`ok`、`error`、`detail`；
- 审计页筛选：动作、时间范围、对象名包含；分页 20 条；
- 失败也记录（如上传超限、删除 404），便于排查。

## 10. 分阶段实施

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| P1 | 插件骨架、桶配置页/接口、迁移、列表（目录 + 对象） | 能配置桶并浏览根前缀 |
| P2 | 上传（流式）、下载（签名跳转）、删除、审计写入 | 四类操作都成功且审计有记录 |
| P3 | 搜索、审计页、空态与错误打磨 | 搜索有截断提示；审计可筛选分页 |
| P4 | 可选：AI 只读工具、>100 MB 预签名直传、批量删除、新建文件夹占位对象 | 按需评审 |

## 11. 测试与验收

- 单元：key 规范化（空、`..`、前导 `/`、超长）、签名 URL 参数、审计筛选 SQL、上传大小限制；
- 接口：未登录 401；未配置桶 `cos_not_configured`；不存在对象 404；超限 413；
- 集成（手动）：用真实桶跑上传 → 列表 → 下载 → 删除，核对 COS 控制台与审计页；
- 安全：响应中不出现 `secretKey`；签名 URL 过期后不可用。

## 12. 风险与开放问题

1. **多桶 vs 单桶**：本方案支持多桶（表结构 + 顶部选择），若你只用一个桶，UI 可隐藏选择器。
2. **上传上限**：默认 100 MB；超过走 P4 的预签名直传，需要配置桶 CORS。
3. **搜索成本**：COS 无全文检索，只能按前缀扫描；大桶下搜索会受限，方案已给出截断提示。
4. **SDK 版本**：`cos-nodejs-sdk-v5@3.0.0` 是 2026-07 的新版本，实施时先核对 `putObject` 流式上传与 `getObjectUrl` 的回调签名是否与文档一致。
5. **是否要文件预览/分享链接**：当前不做，后续可加。
