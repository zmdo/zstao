# 右侧边栏「网络文件管理」设计方案（COS）

- 状态：草案，待确认
- 日期：2026-11-03
- 依赖：`@smp/console-cos`（已有双桶 COS 接入）、`dsh-client-ui-sidebar-right`、`dsh-client-ui-sidebar-documentpreview`
- 目标读者：实现者与评审者

## 1. 背景与目标

控制台已经有「文件管理」页面，但使用时要在页面与会话之间来回切换。会话右侧边栏（`工作区` 所在的列）本身支持插件注册 tab，因此可以增加一个「网络文件管理」：

1. 在右侧边栏浏览 COS **默认桶**（`role='default'`）的文件；
2. 点击文件时**复用 DSH 自带的文档预览**（代码高亮、Markdown、PDF、图片、HTML 等），而不是自己写一套渲染；
3. 让会话（模型/工具）能读到这些文件，例如把文件物化到工作区后用 `read`/`grep` 访问。

非目标：

- 不在侧边栏里编辑并回写 COS（只读预览；需要回写时走文件管理页上传）。
- 不把 COS 挂成虚拟文件系统；不改变现有 `fs` 工具的工作区边界。
- 不接入附件桶（`attachments` 仍隐藏）。
- 不做多人共享、在线协作。

## 2. 入口与交互

- 入口：右侧边栏「More tools」卡片中的一项「网络文件管理」，或在文件管理页面加一个「在侧边栏打开」按钮。
- tab 类型：`kind: 'cos-files'`，地址 `sidebar://cos-files`。
- 内容：
  - 顶部：当前前缀面包屑、刷新；
  - 列表：与文件管理页同一套 `smp-plugins` 表格样式（目录/文件、大小、时间）；
  - 操作：单击目录进入；单击文件在右侧**同一个**侧栏打开内置预览（或新建一个预览 tab）；
  - 文件行提供「下载」与「在会话中引用」两个动作。
- 权限：沿用控制台登录态（cookie），不额外要求配置。

## 3. 总体架构

```
plugins/cos/src/client/
  sidebar/
    definition.ts      sidebarRightTabs.register({ id: 'smp-cos-sidebar', kind: 'cos-files', ... })
    CosFilesBody.tsx   列表 + 面包屑 + 动作
    CosFilesTitle.tsx  tab 标题「网络文件管理」
    materialize.ts     调用宿主物化接口、拼 dsh-resource 地址
```

- 仍是 `@smp/console-cos` 这一个包，新增一个客户端入口（client.tsx 内注册 tab 类型与两个槽位）。
- 宿主侧复用 `/console-api/cos/*`；新增一个物化接口（见第 6 节）。
- 不新增数据库表；物化缓存放在会话工作区与 `$DSH_HOME/cache` 下。

## 4. 侧边栏 tab 的注册方式

按 `dsh-client-ui-sidebar-files` 的现有模式：

```ts
ctx.sidebarRightTabs.register({
  id: 'smp-cos-sidebar',
  kind: 'cos-files',
  priority: 'extension',
  title: () => '网络文件管理',
  guide: [{ id: 'cos-files', commandId: 'cos.files', order: 20, title, description }],
  keepMounted: true,
})
```

内容与标题：

```ts
ctx.slots.inject('sidebar.right.pane.tab', () =>
  ctx.slots.register({ name: 'sidebar.right.pane.tab', key: 'smp-cos-sidebar', inject: () => ({ locale, sessionId }) }, CosFilesBody),
)
ctx.slots.inject('sidebar.right.pane.tab.title', () =>
  ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: 'smp-cos-sidebar' }, CosFilesTitle),
)
```

- `kind` 与已有 `files`/`browser`/`terminal` 不冲突；
- tab 按会话持久化（localStorage `dsh.sidebar-right.v1.<sessionId>`）；
- 打开方式：`ctx.sidebarRight.open('sidebar://cos-files')` 或 `openTabFromTarget('cos-files', target)`。

## 5. 浏览与分页

- 复用现有接口：`GET /console-api/cos/objects?prefix=&marker=&limit=&search=`。
- 列表与文件管理页共用同一套 `listObjects` 逻辑和 key 边界校验；
- 分页沿用 marker 栈（COS 无总数），每页 20/50/100。

## 6. 打开文件：复用内置预览

内置预览只接受 `dsh-resource://file/session/<sessionId>/<path>`，读取走会话工作区的文件 API。COS 对象必须先**物化**到工作区。

### 6.1 物化路径

```
<workspace>/.cos-cache/<etag 前 12 位>/<URL 编码后的 key>
```

- 用 etag 或 sha256 分目录，对象变化时自然失效；
- 目录必须在会话工作区内，否则 `read` 与内置预览都会被沙箱拒绝；
- 文件名保留原扩展名，保证高亮/预览按扩展名选择渲染器。

### 6.2 流程

1. 侧边栏点击文件；
2. 调用 `POST /console-api/cos/materialize`，body：`{ sessionId, key }`；
3. 宿主校验 key 在前缀内、大小 ≤ 预览上限（默认 20 MB），下载到工作区缓存并返回：
   ```json
   { "path": ".cos-cache/<etag>/docs/readme.md", "absolute": "...", "size": 1234, "etag": "..." }
   ```
4. 客户端拼接地址并打开：
   ```
   dsh-resource://file/session/<sessionId>/<encoded relative path>
   ```
   `ctx.sidebarRight.open(address)`；
5. 内置 `dsh-client-ui-sidebar-documentpreview` 的 `canOpen` 命中 `scope=session`，接管渲染。

### 6.3 宿主如何定位工作区

物化接口需要会话的工作区路径。两种实现顺序：

1. 优先通过会话服务按 `sessionId` 取当前会话的 `workingDirectory`；
2. 取不到时退回 `ctx.get('workingDirectory').ensure(agent)`（仅在有 agent 上下文时可用）。

两者都不可用时返回 `workspace_unavailable`，侧边栏改为「下载」而不是内嵌预览。

### 6.4 不支持的类型

- 预览上限内但扩展名不在内置预览支持列表：返回 `unsupported_preview`，客户端弹统一 Dialog（复用「无法打开」弹框），只提供下载；
- 二进制大文件：直接 `unsupported_preview`，不物化。

## 7. 会话读取文件

目标：Agent 能用现有工具读到侧边栏里的文件，而不是只看到文件名。

### 7.1 路径引用（推荐）

物化完成后，侧边栏显示「在会话中引用」：

- 复制工作区相对路径（如 `.cos-cache/<etag>/docs/readme.md`），用户可直接粘贴到对话；
- 或由宿主工具 `platform_cos_materialize` 返回同一路径，Agent 再用 `read`/`grep`。

优点：不重复造读取逻辑，完全沿用文件工具的工作区边界与只读校验。

### 7.2 新增工具

| 工具 | 参数 | 审批 | 说明 |
| --- | --- | --- | --- |
| `platform_cos_materialize` | `key` | 否 | 物化到工作区缓存，返回相对路径、大小、etag |
| `platform_cos_read` | `key`、`max_bytes?` | 否 | 小文本直接返回内容（默认 64 KB 上限），避免 Agent 多一步读文件 |

- 两者都只允许默认桶、且 key 必须落在 `basePrefix` 内；
- `platform_cos_read` 仅对文本类扩展名开放，二进制返回 `unsupported_preview`。

### 7.3 缓存一致性

- 物化目录名带 etag；同一 key 的新版本会新建目录，旧目录由清理策略回收；
- 会话内再次物化先 HEAD 对象，etag 未变直接复用；
- 物化是只读副本：Agent 修改它不会回写 COS，需要在工具返回值里明确说明。

## 8. 宿主接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/console-api/cos/objects` | 已有，列表 |
| GET | `/console-api/cos/objects/download` | 已有，302 下载 |
| GET | `/console-api/cos/objects/raw` | 已有，内嵌预览（图片/PDF） |
| GET | `/console-api/cos/objects/text` | 已有，文本预览 |
| POST | `/console-api/cos/materialize` | 新增，物化到工作区并返回路径 |

错误码新增：`workspace_unavailable`、`preview_too_large`、`unsupported_preview`。

## 9. 缓存、清理与配额

- 位置：会话工作区 `.cos-cache/`（可见但带点前缀），外加 `$DSH_HOME/cache/cos-preview/` 存放缩略/临时；
- 上限：单文件 20 MB；单会话缓存 200 MB；超过时按最久未访问淘汰；
- 清理：会话结束或启动时清理超过 7 天的缓存；不删除用户工作区里的其他文件；
- 配额超出返回 `cache_full`，提示先清理。

## 10. 安全与限制

- 只读：物化副本不提供写回；文件管理页仍负责上传/删除；
- key 边界：所有接口先做 `basePrefix` 校验，拒绝 `..`、绝对路径、控制字符；
- 工作区边界：物化路径必须在会话工作区内，禁止通过 key 穿越到工作区外；
- 凭据：SecretId/SecretKey 只在宿主，侧边栏与 Agent 都拿不到；
- 预览：内置预览的 HTML 渲染按 DSH 既有安全策略处理，不额外放宽；
- 审计：物化与下载都记 `cos_audit`（`action='download'`，detail 标注 `materialize`）。

## 11. 分阶段实施

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| P1 | 注册 `cos-files` tab、列表/面包屑/刷新、下载 | 侧边栏能浏览默认桶 |
| P2 | `/materialize` 接口、工作区缓存、内置预览打开 | 文本代码高亮、图片、PDF 正常打开 |
| P3 | 会话引用路径、`platform_cos_materialize` / `platform_cos_read` | Agent 能 `read` 物化后的文件 |
| P4 | 缓存配额/清理、错误弹框、审计字段 | 缓存不失控，失败有明确提示 |

## 12. 测试

- 单元：key 边界、物化路径生成、etag 复用、大小限制；
- 接口：未登录 401；未配置 `cos_role_not_configured`；超限 `preview_too_large`；越界 `key_invalid`；
- 集成：侧边栏打开 `docs/readme.md` 出现高亮；打开 `pic.png` 出现图片；打开 `blob.bin` 弹「无法打开」；
- 会话：`platform_cos_materialize` 后 `read` 能读到内容；修改本地副本不影响 COS；
- 清理：过期缓存被删除，工作区其他文件不受影响。

## 13. 风险与开放问题

1. **内置预览的地址作用域**：只支持 `file/session`，所以必须物化；未来若 DSH 支持自定义资源协议直接预览，可以去掉落盘步骤。
2. **工作区定位**：宿主接口按 `sessionId` 找会话工作区的能力需要在实现时确认（会话服务或 `workingDirectory`）。
3. **缓存可见性**：`.cos-cache` 会出现在工作区侧栏里，可能干扰用户；可考虑用 `$DSH_HOME/cache` + 只读映射，但需要预览支持工作区外地址。
4. **PDF/大文件**：物化 20 MB 上限内可用；更大的文件只提供下载。
5. **只读语义**：Agent 修改物化副本不会同步回 COS，需要在 UI 与工具说明中写明。
