# 右侧边栏「网络文件管理」设计方案（COS，第 3 版）

- 状态：草案，待确认
- 日期：2026-11-03（第 3 版：全局预览缓存 + 工作区硬链接，定时清理）
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
- 新增迁移 `0042_cos_preview_limit.sql`（预览上限列），见第 7 节。

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

## 6. 打开文件：全局缓存 + 工作区硬链接

内置预览只接受 `dsh-resource://file/session/<sessionId>/<path>`，读取走会话工作区的文件 API。COS 对象必须先物化到工作区。

因为桶是全局的，**下载只做一次**：对象落到全局预览缓存，再在会话工作区放一个硬链接作为预览入口。

### 6.1 工作区解析（宿主）

```ts
const session = ctx.sessions.get(sessionId)          // 仅存活会话
const workspace = ctx.workingDirectory.get(session)  // 绝对路径
```

两者任一失败返回 `session_not_found` / `workspace_unavailable`，不依赖 `workingDirectory.ensure(agent)`。

### 6.2 全局缓存布局

缓存根默认 `$DSH_HOME/cache/cos-preview`，可用插件配置 `previewCacheDir` 覆盖（不放进设置页，避免每个部署都改 UI）。

```
<cacheRoot>/<etag 前 12 位>/<sha1(key) 前 12 位>-<basename>
<cacheRoot>/<etag 前 12 位>/<sha1(key) 前 12 位>-<basename>.meta.json
```

- `sha1(key)` 避免长 key 造成 Windows 路径超长、以及不同 key 同名 basename 冲突；
- `basename` 保留扩展名，供内置预览选择高亮/渲染器；
- 若无扩展名，用 `headObject` 的 `content-type` 映射扩展名（`.txt`/`.md`/`.json`/`.png`/`.pdf` 等）；
- `.meta.json` 记录 `{ key, etag, size, contentType, createdAt, lastAccessAt }`；
- 写入策略：先写 `<file>.tmp`，fsync 后 `rename` 到位，再写 meta，避免读到半文件。

### 6.3 工作区链接布局

```
<workspace>/.cos-cache/<sha1(key) 前 12 位>-<basename>
<workspace>/.cos-cache/.index.json          # 可选：记录本会话创建过的链接
```

- 优先 `fs.link(globalPath, workspacePath)`（NTFS 同卷零拷贝）；
- 硬链接失败（`EXDEV` 跨卷、`EPERM` 权限、文件系统不支持）→ 回退为复制；
- 已存在同名入口时：校验 etag 一致则复用，不一致则替换；
- 工作区入口只是预览/读取用的名字，数据仍在全局缓存（复制回退时除外）。

### 6.4 物化流程

1. 侧边栏点击文件；
2. `POST /console-api/cos/materialize`，body `{ sessionId, key }`；
3. 宿主校验：key 在 `basePrefix` 内、`headObject` 取 etag/size、`size <= maxPreviewBytes`；
4. 全局缓存命中（同 etag + 同 sha1 + meta 一致）→ 跳过下载；否则下载并原子落盘；
5. 确保工作区入口：硬链接优先，失败复制；
6. 返回：
   ```json
   { "path": ".cos-cache/<sha>-<name>", "absolute": "…", "size": 1234, "etag": "…", "contentType": "text/markdown", "linked": true }
   ```
7. 客户端按段 percent-encode 拼地址并打开：
   ```
   dsh-resource://file/session/<sessionId>/<encoded relative path>
   ```
8. 内置文档预览接管渲染，COS 列表 tab 保留。

### 6.5 不支持的类型

- 超过 `maxPreviewBytes`：`preview_too_large`，只给下载；
- 扩展名/content-type 不在内置预览支持范围：`unsupported_preview`，弹统一 Dialog；
- 二进制检测：content-type 不是 `text/*`、`application/json`、`application/pdf`、`image/*` 时直接走不支持分支，不下载。

## 7. 配置：预览上限与缓存

### 7.1 预览上限（可配置）

- 迁移 `plugins/database/migrations/0042_cos_preview_limit.sql`：
  ```sql
  alter table cos_buckets
    add column if not exists max_preview_bytes bigint not null default 20971520;
  ```
- 只对 `role='default'` 生效。
- 平台设置 → 对象存储 → 默认桶新增「预览上限（MB）」：默认 20，范围 1–200，随现有字段自动保存。
- `/console-api/cos/config` 返回 `maxPreviewBytes`；PUT 时校验。

### 7.2 缓存配置（插件配置）

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `previewCacheDir` | `$DSH_HOME/cache/cos-preview` | 全局缓存根，必须可写 |
| `previewCacheTtlMs` | 7 天 | 全局/工作区缓存 TTL |
| `previewCacheMaxBytes` | 2 GB | 全局缓存总大小上限 |
| `previewCleanupIntervalMs` | 6 小时 | 定时清理间隔 |

### 7.3 上限生效点

| 位置 | 行为 |
| --- | --- |
| `POST /materialize` | `size > maxPreviewBytes` → 413 `preview_too_large` |
| `GET /objects/text` | 上限改为 `min(512KB, maxPreviewBytes)` |
| `platform_cos_read` | 上限 `min(64KB, maxPreviewBytes)` |
| 侧边栏预览 | 超限只显示下载按钮 |

## 8. 会话读取

### 8.1 路径引用（推荐）

物化后返回工作区相对路径；侧边栏提供「在会话中引用」复制该路径，用户粘贴到对话，Agent 用 `read`/`grep` 直接访问。

硬链接与普通文件在读取侧无差别；复制回退时也一样。

### 8.2 工具

| 工具 | 参数 | 审批 | 说明 |
| --- | --- | --- | --- |
| `platform_cos_materialize` | `key` | 否 | 物化到当前会话工作区，返回相对路径、大小、etag、是否硬链接 |
| `platform_cos_read` | `key`、`max_bytes?` | 否 | 小文本直接返回内容，默认 64 KB，不超过预览上限 |

- 只允许默认桶，key 必须在 `basePrefix` 内；
- 工具在 agent 上下文中执行，可用 `workingDirectory.ensure(agent)` 获取工作区（与 HTTP 路径的 `sessions.get` 互为补充）；
- 返回内容中明确「这是只读副本，修改不会回写 COS」。

### 8.3 一致性

- 全局缓存按 etag 分目录；对象更新 → 新 etag → 新目录；
- 物化前先 `headObject`，etag 未变直接复用，不重复下载；
- 同一 key 并发物化加进程内单飞（in-flight map）。

## 9. 宿主接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/console-api/cos/objects` | 已有，列表 |
| GET | `/console-api/cos/objects/download` | 已有，302 下载 |
| GET | `/console-api/cos/objects/raw` | 已有，内嵌预览（图片/PDF） |
| GET | `/console-api/cos/objects/text` | 已有，文本预览（上限改为配置） |
| POST | `/console-api/cos/materialize` | 新增，物化并返回工作区路径 |

新增错误码：`session_not_found`、`workspace_unavailable`、`preview_too_large`、`unsupported_preview`、`cache_full`、`cache_write_failed`。

## 10. 缓存清理

宿主在 `apply` 里用 `ctx.setInterval` 注册定时任务（默认 6 小时），启动时也跑一次：

1. **全局缓存**：扫描 `<cacheRoot>/<etag>/` 下带 `.meta.json` 的条目；
   - 超过 TTL（7 天）→ 删除文件与 meta；
   - 总量超过 `previewCacheMaxBytes` → 按 `lastAccessAt` 从旧到新删到 80%；
   - 删除不存在的硬链接目标不影响会话（NTFS 引用计数保留数据）。
2. **工作区缓存**：扫描各会话工作区 `.cos-cache/`；
   - 只处理带 `.index.json` 记录、或文件名匹配 `<12 位 hex>-*` 的条目；
   - 超过 TTL 或会话已不存在 → 删除链接/副本；
   - 不触碰 `.cos-cache` 之外的文件。
3. **并发安全**：清理与物化用同一把进程内锁；删除前检查 `lastAccessAt` 与 mtime，24 小时内访问过的跳过。

## 11. 安全与限制

- 只读副本，不提供写回；
- key 边界：`basePrefix` 校验，拒绝 `..`、绝对路径、控制字符；
- 工作区边界：工作区入口必须在 `workspace` 下，禁止通过 key 穿越；
- 全局缓存目录必须可写、且不位于用户工作区内部；
- 凭据只在宿主，Agent 与浏览器都拿不到 SecretKey；
- 审计：物化与实际下载都写 `cos_audit`（`action='download'`，detail 标注 `mode: 'materialize'`、`etag`）；
- HTML 预览沿用 DSH 既有安全策略，不放宽。

## 12. 分阶段实施

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| P1 | `cos-files` tab、列表/面包屑/刷新、下载、命令注册 | 侧边栏能浏览默认桶 |
| P2 | 迁移 0042、设置页预览上限、全局缓存 + `/materialize`、硬链接/复制、内置预览 | 文本高亮/图片/PDF 正常打开，超限提示 |
| P3 | 会话引用路径、`platform_cos_materialize` / `platform_cos_read` | Agent 能 `read` 物化文件，跨会话复用同一缓存 |
| P4 | 定时清理、配额、错误弹框、审计字段 | 缓存不失控，跨卷回退可用 |

## 13. 测试

- 单元：key 边界、缓存路径生成、etag 复用、content-type 到扩展名映射、硬链接失败回退；
- 接口：未登录 401；未配置 `cos_role_not_configured`；`/materialize` 超限 413；越界 `key_invalid`；非存活会话 `session_not_found`；
- 集成：
  - 侧边栏打开 `docs/readme.md` 出现高亮；`pic.png` 显示图片；`blob.bin` 弹「无法打开」；
  - 两个会话打开同一个 key：全局缓存只下载一次（第二个会话 `linked: true` 且无新下载）；
  - 跨卷场景（缓存与工作区不同盘）：回退复制成功，`linked: false`；
  - 设置页把预览上限改成 1MB 后，2MB 文件被拒；
- 会话：`platform_cos_materialize` 后 `read` 能读到；改本地副本不影响 COS；
- 清理：TTL 过期条目被删，硬链接会话仍可打开；工作区其他文件不受影响。

## 14. 风险与开放问题

1. **硬链接的卷限制**：缓存与工作区不同卷时回退复制，跨会话去重失效（仍共享全局缓存文件，只是会话侧多一份副本）；部署时尽量让 `previewCacheDir` 与工作区同卷。
2. **NTFS 硬链接权限/文件系统**：非 NTFS、网络盘可能不支持，统一走复制回退。
3. **点目录可见性**：`.cos-cache` 若被内置预览或工作区 API 过滤，改用 `cos-cache/` 并接受它出现在工作区列表。
4. **预览 tab 行为**：`open(address)` 新建/复用与分屏由 dockkit 决定，不做定制。
5. **清理竞态**：删除全局名字不影响已链接文件；复制回退的文件若正在被预览，删除前检查 24 小时内访问时间。
6. **只读语义**：Agent 修改副本不回写 COS，UI 与工具都需说明。
7. **`/tmp` 不跨平台**：缓存根用 DSH_HOME 下的路径，不写死 `/tmp`；如需临时目录，用 `os.tmpdir()`。

## 15. 复核记录

### 第 2 版修正

| # | 原方案 | 问题 | 修正 |
| --- | --- | --- | --- |
| 1 | 物化上限固定 20 MB | 不可配置 | 新增 `max_preview_bytes`、设置项、迁移 0042 |
| 2 | 宿主靠 `workingDirectory.ensure(agent)` | HTTP 路由没有 agent 上下文 | 改为 `ctx.sessions.get` + `ctx.workingDirectory.get` |
| 3 | 缓存路径 `<etag>/<key>` | 路径过长/同名冲突 | 改为 `<etag>/<sha1>-<basename>` + meta |
| 4 | 地址直接拼 key | 特殊字符破坏解析 | 按段 percent-encode |
| 5 | 「同一个侧栏打开」 | 预览是独立 tab | 明确新开预览 tab |
| 6 | guide 无命令 | 入口不可用 | 注册 `cos.files` 命令 |
| 7 | `priority` 未说明 | 与内置 band 冲突 | 明确 `extension` |
| 8 | 文本预览硬编码 512 KB | 与可配置上限不一致 | `min(512KB, maxPreviewBytes)` |
| 9 | 无扩展名文件 | 无法选渲染器 | content-type 映射扩展名 |
| 10 | 并发物化 | 重复下载 | in-flight 单飞 |
| 11 | 清理范围模糊 | 误删用户文件 | 只处理 `.cos-cache` 与带 meta 的条目 |
| 12 | `sessionId` 来源 | 未确认 | 槽位注入已确认 |

### 第 3 版修正

| # | 原方案 | 问题 | 修正 |
| --- | --- | --- | --- |
| 1 | 每个会话各自下载到 `<workspace>/.cos-cache` | 全局桶重复下载，浪费带宽与磁盘 | 改为全局缓存 `$DSH_HOME/cache/cos-preview`，下载一次 |
| 2 | 工作区必须放完整副本 | 与「全局缓存」目标冲突 | 工作区只放硬链接；跨卷回退复制 |
| 3 | 无定时清理 | 缓存只增不减 | `ctx.setInterval` 定时任务 + 启动清理，TTL/容量双策略 |
| 4 | `/tmp` | Windows 不存在 | 缓存根放 DSH_HOME，可用插件配置覆盖 |
| 5 | 清理与物化并发 | 可能删掉正在写的文件 | 同一把进程内锁 + 24 小时访问保护 |
