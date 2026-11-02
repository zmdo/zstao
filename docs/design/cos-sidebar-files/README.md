# 右侧边栏「网络文件管理」设计方案（COS，第 2 版）

- 状态：草案，待确认
- 日期：2026-11-03（第 2 版：物化上限可配置、工作区解析与缓存路径修正）
- 依赖：`@smp/console-cos`（已有双桶 COS 接入）、`dsh-client-ui-sidebar-right`、`dsh-client-ui-sidebar-documentpreview`、`dsh-session`、`dsh-working-directory`
- 目标读者：实现者与评审者

## 1. 背景与目标

控制台已有「文件管理」页面，但操作时要在页面与会话之间切换。会话右侧边栏（`工作区` 所在列）支持插件注册 tab，因此新增「网络文件管理」：

1. 在右侧边栏浏览 COS **默认桶**（`role='default'`）；
2. 点击文件时**复用 DSH 自带的文档预览**（代码高亮、Markdown、PDF、图片、HTML）；
3. 让会话（模型/工具）能读到这些文件：物化到工作区后用 `read`/`grep` 访问。

非目标：

- 不在侧边栏编辑并回写 COS（只读预览；回写走文件管理页上传）；
- 不把 COS 挂成虚拟文件系统，不改变现有 `fs` 工具的工作区边界；
- 不接入附件桶；
- 不做多人共享与在线协作。

## 2. 入口与交互

- 入口：
  - 右侧边栏「More tools」卡片中的「网络文件管理」；
  - 文件管理页面新增「在侧边栏打开」按钮。
- tab 类型：`kind: 'cos-files'`，地址 `sidebar://cos-files`。
- 布局：
  - 顶部：当前前缀面包屑、刷新；
  - 列表：与文件管理页同一套 `smp-plugins` 表格（目录/文件、大小、时间）；
  - 操作：单击目录进入；单击文件在侧边栏**新开一个文档预览 tab**，COS 列表 tab 保留；
  - 每个文件行提供「下载」「在会话中引用」。
- 未配置默认桶时，tab 内展示「去平台设置 → 对象存储配置」的提示，不报错。

## 3. 总体架构

```
plugins/cos/src/client/
  sidebar/
    definition.ts      tab 类型定义 + guide 入口
    CosFilesBody.tsx   列表 / 面包屑 / 动作
    CosFilesTitle.tsx  标题「网络文件管理」
    materialize.ts     调物化接口、拼 dsh-resource 地址、打开预览
  client.tsx           注册 tab 类型、两个槽位、命令
```

- 仍是 `@smp/console-cos` 一个包；宿主复用 `/console-api/cos/*`，新增物化接口。
- 新增迁移 `0042_cos_preview_limit.sql`（预览上限列），见第 6 节。

## 4. 侧边栏 tab 的注册

按 `dsh-client-ui-sidebar-files` 的现有模式：

```ts
ctx.sidebarRightTabs.register({
  id: 'smp-cos-sidebar',
  kind: 'cos-files',
  priority: 'extension',          // 非 builtin band，内置 tab 不受影响
  title: () => '网络文件管理',
  guide: [{ id: 'cos-files', commandId: 'cos.files', order: 20, title, description }],
  keepMounted: true,
})
```

内容与标题槽位（`sessionId` 由槽位注入，已确认 `FilesBody` 同样接收该 prop）：

```ts
ctx.slots.inject('sidebar.right.pane.tab', () =>
  ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: 'smp-cos-sidebar', inject: () => ({ locale, sessionId }) },
    CosFilesBody,
  ),
)
ctx.slots.inject('sidebar.right.pane.tab.title', () =>
  ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: 'smp-cos-sidebar' }, CosFilesTitle),
)
```

guide 条目的 `commandId` 必须指向已注册命令，因此同时注册：

```ts
ctx.commands.register({
  id: 'cos.files',
  title: '打开网络文件管理',
  run: () => ctx.sidebarRight.open('sidebar://cos-files'),
})
```

P1 可先不加 guide（只从文件管理页按钮打开），命令注册完成后再补入口。

打开方式：`ctx.sidebarRight.open('sidebar://cos-files')`；文件预览用 `ctx.sidebarRight.open(fileAddress)` 新开预览 tab。

## 5. 浏览与分页

- 复用 `GET /console-api/cos/objects?prefix=&marker=&limit=&search=`；
- 与文件管理页共用 `listObjects` 与 key 边界校验；
- 分页沿用 marker 栈（COS 无总数），每页 20/50/100。

## 6. 打开文件：物化 + 内置预览

内置预览只接受 `dsh-resource://file/session/<sessionId>/<path>`，且 `canOpen` 要求 `scope === 'session'`，读取走会话工作区文件 API。COS 对象必须先物化到工作区。

### 6.1 工作区解析（宿主）

物化接口按 `sessionId` 解析工作区，路径确定：

```ts
const session = ctx.sessions.get(sessionId)          // 仅存活会话
const workspace = ctx.workingDirectory.get(session)  // 绝对路径
```

两者任一失败返回 `session_not_found` / `workspace_unavailable`，不再依赖 `workingDirectory.ensure(agent)`。

### 6.2 缓存路径

```
<workspace>/.cos-cache/<etag 前 12 位>/<sha1(key) 前 12 位>-<basename>
<workspace>/.cos-cache/<etag 前 12 位>/<sha1(key) 前 12 位>-<basename>.meta.json
```

- `sha1(key)` 避免长 key 造成 Windows 路径超长、以及不同 key 同名 basename 冲突；
- `basename` 保留扩展名，供内置预览选择高亮/渲染器；
- 若 key 没有扩展名，用 `headObject` 的 `content-type` 映射扩展名（`.txt`/`.md`/`.json`/`.png`/`.pdf` 等）；
- `.meta.json` 记录 `{ key, etag, size, contentType }`，用于复用与清理。

### 6.3 物化流程

1. 侧边栏点击文件；
2. `POST /console-api/cos/materialize`，body `{ sessionId, key }`；
3. 宿主校验：key 在 `basePrefix` 内、`headObject` 取 etag/size、`size <= maxPreviewBytes`；
4. 命中缓存（同 etag + 同 sha1）直接返回；否则下载写入缓存；
5. 返回：
   ```json
   { "path": ".cos-cache/<etag>/<sha>-<name>", "absolute": "…", "size": 1234, "etag": "…", "contentType": "text/markdown" }
   ```
6. 客户端按段 percent-encode 拼地址并打开：
   ```
   dsh-resource://file/session/<sessionId>/<encoded relative path>
   ```
7. 内置 `dsh-client-ui-sidebar-documentpreview` 打开预览 tab。

### 6.4 不支持的类型

- 超过 `maxPreviewBytes`：`preview_too_large`，只给下载；
- 扩展名/content-type 不在内置预览支持范围：`unsupported_preview`，弹统一 Dialog（复用现有「无法打开」）。
- 二进制检测：`headObject` 的 content-type 不是 `text/*`、`application/json`、`application/pdf`、`image/*` 时直接走不支持分支，避免物化大二进制。

## 7. 配置：物化上限可配置

### 7.1 数据与设置

- 迁移 `plugins/database/migrations/0042_cos_preview_limit.sql`：
  ```sql
  alter table cos_buckets
    add column if not exists max_preview_bytes bigint not null default 20971520;
  ```
- 只对 `role='default'` 生效；attachments 行不使用。
- 平台设置 → 对象存储 → 默认桶新增「预览上限（MB）」：
  - 默认 20，范围 1–200；
  - 与现有字段一起自动保存；
  - 校验失败时回退原值并提示。
- `/console-api/cos/config` 的 `default` 返回 `maxPreviewBytes`；PUT 时校验范围。

### 7.2 生效点

| 位置 | 行为 |
| --- | --- |
| `POST /materialize` | `size > maxPreviewBytes` → 413 `preview_too_large` |
| `GET /objects/text` | 上限改为 `min(512KB, maxPreviewBytes)`，不再硬编码 512KB |
| `platform_cos_read` | 上限 `min(64KB, maxPreviewBytes)` |
| 侧边栏预览 | 超限只显示下载按钮 |

## 8. 会话读取

### 8.1 路径引用（推荐）

物化后返回工作区相对路径；侧边栏提供「在会话中引用」复制该路径，用户粘贴到对话，Agent 用 `read`/`grep` 直接访问。

### 8.2 工具

| 工具 | 参数 | 审批 | 说明 |
| --- | --- | --- | --- |
| `platform_cos_materialize` | `key` | 否 | 物化到当前会话工作区，返回相对路径、大小、etag |
| `platform_cos_read` | `key`、`max_bytes?` | 否 | 小文本直接返回内容，默认 64 KB，不超过预览上限 |

- 只允许默认桶，key 必须在 `basePrefix` 内；
- 工具在 agent 上下文中执行，可用 `workingDirectory.ensure(agent)` 获取工作区（与 HTTP 路径的 `sessions.get` 互为补充）；
- 返回内容中明确「这是只读副本，修改不会回写 COS」。

### 8.3 一致性

- 缓存按 etag 分目录；对象更新 → 新 etag → 新目录，旧目录由清理回收；
- 物化前先 `headObject`，etag 未变直接复用，不重复下载；
- 同一 key 并发物化加进程内单飞（in-flight map），避免重复写。

## 9. 宿主接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/console-api/cos/objects` | 已有，列表 |
| GET | `/console-api/cos/objects/download` | 已有，302 下载 |
| GET | `/console-api/cos/objects/raw` | 已有，内嵌预览（图片/PDF） |
| GET | `/console-api/cos/objects/text` | 已有，文本预览（上限改为配置） |
| POST | `/console-api/cos/materialize` | 新增，物化并返回工作区路径 |

新增错误码：`session_not_found`、`workspace_unavailable`、`preview_too_large`、`unsupported_preview`、`cache_full`。

## 10. 缓存、清理与配额

- 位置：`<workspace>/.cos-cache/`；
- 单文件上限：`maxPreviewBytes`（配置）；
- 单会话配额：默认 500 MB，超出返回 `cache_full`，提示清理；
- 清理：
  - 会话启动/关闭时清理由本插件创建且超过 7 天的目录；
  - 只删除 `.cos-cache` 下带 `.meta.json` 的条目，不触碰用户文件；
  - 可按最久未访问淘汰至配额的 80%。

## 11. 安全与限制

- 只读副本，不提供写回；
- key 边界：`basePrefix` 校验，拒绝 `..`、绝对路径、控制字符；
- 工作区边界：物化路径必须在 `workspace` 下，禁止通过 key 穿越；
- 凭据只在宿主，Agent 与浏览器都拿不到 SecretKey；
- 审计：物化与实际下载都写 `cos_audit`（`action='download'`，detail 标注 `mode: 'materialize'`）；
- HTML 预览沿用 DSH 既有安全策略，不放宽。

## 12. 分阶段实施

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| P1 | `cos-files` tab、列表/面包屑/刷新、下载、命令注册 | 侧边栏能浏览默认桶 |
| P2 | 迁移 0042、设置页预览上限、`/materialize`、缓存、内置预览 | 文本高亮/图片/PDF 正常打开，超限提示 |
| P3 | 会话引用路径、`platform_cos_materialize` / `platform_cos_read` | Agent 能 `read` 物化文件 |
| P4 | 缓存配额与清理、错误弹框、审计字段 | 缓存不失控 |

## 13. 测试

- 单元：key 边界、缓存路径生成、etag 复用、预览上限解析、content-type 到扩展名映射；
- 接口：未登录 401；未配置 `cos_role_not_configured`；`/materialize` 超限 413；越界 `key_invalid`；非存活会话 `session_not_found`；
- 集成：侧边栏打开 `docs/readme.md` 出现高亮；`pic.png` 显示图片；`blob.bin` 弹「无法打开」；改设置页预览上限为 1MB 后 2MB 文件被拒；
- 会话：`platform_cos_materialize` 后 `read` 能读到；改本地副本不影响 COS；
- 清理：7 天前缓存被删除，工作区其他文件不受影响。

## 14. 风险与开放问题

1. **内置预览对隐藏目录**：`.cos-cache` 是点目录，若内置预览或工作区文件 API 过滤点目录，需改用 `cos-cache/`（普通目录）并加清理；
2. **预览 tab 行为**：`open(address)` 会新开/复用文档预览 tab，COS 列表 tab 保留；分屏行为由 dockkit 决定，不做定制；
3. **物化成本**：大文件下载占带宽与磁盘；已用配置上限与配额约束；
4. **只读语义**：Agent 修改副本不回写，UI 与工具都必须说明；
5. **会话关闭后的缓存**：会话工作区可能被保留，缓存清理依赖启动时扫描，需确认不会误删用户文件。

## 15. 复核记录（第 2 版）

| # | 原方案 | 问题 | 修正 |
| --- | --- | --- | --- |
| 1 | 物化上限固定 20 MB | 不可配置 | 新增 `max_preview_bytes`、设置项、迁移 0042，统一约束 materialize/text/tool |
| 2 | 宿主靠 `workingDirectory.ensure(agent)` 取工作区 | HTTP 路由没有 agent 上下文 | 改为 `ctx.sessions.get(sessionId)` + `ctx.workingDirectory.get(session)` |
| 3 | 缓存路径 `<etag>/<key>` | key 过长/同名冲突/Windows 路径超限 | 改为 `<etag>/<sha1(key)>-<basename>` + `.meta.json` |
| 4 | 地址直接拼原始 key | 空格/中文/`#` 会破坏地址解析 | 按路径段 percent-encode 后再拼 |
| 5 | 「在右侧同一个侧栏打开」 | 预览是独立 tab 类型，行为不明确 | 明确为新开文档预览 tab，COS tab 保留 |
| 6 | guide 条目直接给 `commandId` | 未注册命令时入口不可用 | 同时注册 `cos.files` 命令，P1 先不加 guide |
| 7 | `priority` 未说明 | 与内置 band 冲突风险 | 明确 `priority: 'extension'` |
| 8 | 文本预览硬编码 512 KB | 与可配置上限不一致 | 改为 `min(512KB, maxPreviewBytes)` |
| 9 | 未定义无扩展名文件 | 内置预览无法选渲染器 | 用 content-type 映射扩展名 |
| 10 | 未定义并发物化 | 重复下载/写冲突 | 进程内 in-flight 单飞 + etag 复用 |
| 11 | 清理范围模糊 | 可能误删用户文件 | 只删 `.cos-cache` 下带 `.meta.json` 的条目 |
| 12 | 未说明 tab 的 sessionId 来源 | 物化接口需要会话 | 槽位 `inject` 已提供 `sessionId`（与 FilesBody 一致） |
