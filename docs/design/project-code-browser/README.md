# CES 项目代码浏览 UI 设计

- 状态：方案设计，未实现
- 日期：2026-11-04
- 分支：`feat/code-repository`
- 目标：在“项目代码仓库”中提供 GitHub 风格的只读代码浏览体验，不再依赖跳转 OneDev；同时在“项目管理”中支持查看已配置的 OneDev 密码
- 关联方案：[CES 代码仓库管理插件设计](../code-repository/README.md)

## 0. 结论

1. “项目代码仓库”从项目列表升级为项目列表 + 仓库详情，仓库详情在 CES 内完成。
2. “打开 OneDev”保留为辅助入口，不再作为查看代码的主要方式。
3. 首版只做只读浏览：目录、文件、分支、Tag、提交记录、README。
4. 不做在线编辑、PR、Issue、Blame、Actions 和完整代码搜索。
5. 不做 CodeMirror 交互编辑，不做手动虚拟滚动。
6. 首版不做完整 Diff；提交详情先展示提交元数据和变更文件摘要，Diff 留到 P2。
7. 视觉参考 GitHub，但颜色、边框和字体使用 CES 主题 token，必须同时支持亮色和暗色模式。
8. “项目管理”中的密码改为可以按需显示；密码通过 CES 后端解密后一次性返回，不进入 URL、日志或页面初始 HTML。

## 1. 目标与非目标

### 目标

- 在 CES 内查看 OneDev 项目。
- 在 CES 内切换分支和 Tag。
- 浏览仓库目录树和文件内容。
- 渲染 Markdown、README 和代码高亮。
- 查看提交列表和单次提交摘要。
- 保持轻量，不引入第二个设计系统。
- 适配现有 CES 亮色和暗色主题。
- 让非 OneDev 用户不需要记住 OneDev 管理员密码就能查看代码。

### 非目标

- 不实现 Git 写操作。
- 不实现在线提交、分支创建、Tag 创建、文件编辑。
- 不实现 Pull Request、Issue、Review、Blame。
- 不实现完整 Diff 页面和代码搜索。
- 不实现 OneDev 权限系统替代品；CES 登录用户默认只能浏览已接入项目。
- 不把 OneDev 密码暴露在 URL、localStorage、日志或页面源码中。

## 2. 页面结构

### 2.1 项目列表

保留现有 `/项目仓库管理/项目代码仓库` 页面，但调整交互：

- 项目行点击后进入 **仓库详情**，不跳转 OneDev。
- 行尾保留“打开 OneDev”链接，作为管理入口。
- 行尾显示默认分支、最近提交、最近更新时间和项目状态。
- 搜索保持本地过滤，数据来自 OneDev API。

### 2.2 仓库详情

```text
┌──────────────────────────────────────────────────────────────────────┐
│ ces-platform                                          [打开 OneDev]  │
│ CES platform source repositories                                   │
├──────────────────────────────────────────────────────────────────────┤
│ [<> Code] [Commits] [Branches] [Tags]                              │
├──────────────────────────────────────────────────────────────────────┤
│ [main ▾]  [路径 / 面包屑]                              [复制克隆地址] │
├───────────────────┬──────────────────────────────────────────────────┤
│ 目录树             │ 文件内容 / README                                │
│ ▾ src              │                                                  │
│   ▸ client         │  # CES                                           │
│   ▸ host           │                                                  │
│   README.md        │  ...                                             │
└───────────────────┴──────────────────────────────────────────────────┘
```

### 2.3 文件浏览

仓库详情默认显示 Code 标签页：

- 顶部：分支/Tag 选择器、面包屑、克隆地址。
- 左侧：目录树，支持展开/折叠，目录和文件都有类型图标。
- 右侧：当前目录文件列表，或文件内容。
- 如果没有选择文件，展示 README。
- 点击目录进入下一级；点击文件加载全文。
- 文件内容上方显示路径、文件大小和原始文件链接。

### 2.4 分支与 Tag

Code 标签页顶部的引用选择器合并显示：

```text
Branches
  main
  develop
Tags
  v0.1.0
  v0.2.0
```

规则：

- 默认选中项目默认分支。
- 如果默认分支为空，提示仓库尚未初始化。
- 切换分支或 Tag 后重新加载目录和文件。
- 当前引用状态保存在页面组件内；刷新页面可以回到默认分支。
- 不单独为分支和 Tag 建页面，顶部选择器足够覆盖只读场景。

### 2.5 Commits 标签

提交列表按时间倒序展示：

- 提交标题
- 提交 SHA 短码
- 作者
- 提交时间
- 变更文件数
- 提交所属分支/Tag 上下文

点击提交后展示：

- 完整 SHA
- 作者和提交时间
- 提交正文
- 变更文件列表
- 每个文件的增删行数

首版不渲染完整 Diff。P2 再接入 `react-diff-view`。

### 2.6 Branches 和 Tags 标签

这两个标签只做浏览，不做写操作：

- Branches：名称、最新提交 SHA、提交时间、是否默认分支。
- Tags：名称、指向的提交、创建时间或提交时间。

如果 OneDev API 只返回引用名称，可以先展示名称和对应 commit，再按需补充提交信息。

## 3. 视觉设计

### 3.1 GitHub 风格的边界

参考：

- 顶部仓库标题和描述
- 标签式导航
- 文件表格布局
- 目录/文件图标
- 提交列表的紧凑行布局
- 等宽代码字体
- 细边框和低对比背景

不直接采用：

- GitHub 的完整色板
- Primer 的全局 CSS
- GitHub 的复杂交互和动效

### 3.2 暗色模式

使用现有 CSS 变量：

```text
--dsw-alias-bg-layer-1/2
--dsw-alias-label-primary/secondary/tertiary
--dsw-alias-border-l1/l2/l3
--dsw-alias-interactive-bg-hover
--dsw-alias-interactive-bg-selected
```

要求：

- 亮色：白底、浅灰边框、深色文字。
- 暗色：深灰背景、低对比边框、浅色文字。
- 代码高亮使用 Shiki 的 CSS variables 主题，由主题 token 控制背景和前景。
- 不使用硬编码的 `#fff`、`#000` 作为主要颜色。
- 所有新增页面在系统暗色和手动暗色下都要检查。

### 3.3 图标

- 文件类型：复用 DSH `FileTypeIcon`
- 目录：`IconFolderOpenRegular` / `IconFolderCloseRegular`
- 其他操作：`@primer/octicons`
- 所有图标继承 `currentColor`，确保暗色模式可见

## 4. 组件选型

### 4.1 采用的组件

| 能力 | 选型 | 说明 |
|---|---|---|
| 页面布局 | `@smp/console-kit` | 复用 Panel、表格、按钮、主题 token |
| 目录树 | `react-arborist` | 目录树和展开状态；首版不额外引入虚拟滚动 |
| 文件/目录图标 | DSH FileTypeIcon + `@primer/octicons` | 与工作区文件外观一致 |
| 代码高亮 | `shiki` | 只读展示，不做交互编辑 |
| Markdown | `react-markdown` + `remark-gfm` + `rehype-sanitize` | README 和 `.md` 文件 |
| 请求 | `fetch` + `AbortController` | 不做复杂缓存层 |
| 状态 | React `useState` / `useReducer` | 页面状态简单，不引入 Redux |

### 4.2 明确不采用

| 组件 | 原因 |
|---|---|
| CodeMirror 6 | 首版只读，不需要编辑器、光标、选区、搜索等交互 |
| Monaco Editor | 体积过大，功能过剩 |
| `@tanstack/react-virtual` | 首版不做手动虚拟滚动；普通目录和提交列表足够 |
| `react-diff-view` | 首版不做完整 Diff，留到 P2 |
| MUI / Ant Design / Primer React | 不引入第二套设计系统 |
| iframe 嵌入 OneDev | 登录态、路由和主题难以统一 |

### 4.3 大文件和性能

- 文件超过 200KB：只展示前 200KB，并明确提示已截断。
- 二进制文件：展示文件元信息，不渲染内容。
- Shiki 语言包按需加载。
- 目录树按需加载子目录，不在首屏递归请求整棵树。
- 提交列表使用 OneDev 的分页参数；首版不虚拟滚动。
- 页面切换时用 `AbortController` 取消旧请求。

## 5. 密码显示设计

### 5.1 交互

“平台设置 / 项目管理”中的密码字段改为：

```text
密码  [********]  [显示] [复制]
```

行为：

1. 默认仍显示掩码。
2. 点击“显示”后请求 CES 后端解密当前密码。
3. 显示为明文，按钮变为“隐藏”。
4. 30 秒后自动隐藏。
5. 点击“复制”写入剪贴板，并提示“已复制”。
6. 页面切换、保存、关闭或重新加载后不保留明文。

### 5.2 后端接口

新增受登录保护的接口：

```text
POST /console-api/project-management/settings/reveal-password
```

返回：

```json
{
  "password": "..."
}
```

要求：

- 只允许已登录的 CES 管理员会话。
- 响应头使用 `Cache-Control: no-store`。
- 不写入访问日志、错误日志或浏览器 history。
- 不允许 GET 查询参数携带密码。
- 失败只返回通用错误，不泄露加密细节。
- 建议加简单频率限制，避免短时间重复调用。

### 5.3 安全边界

- 密码只在用户主动点击“显示”时解密。
- 明文不进入 React 全局状态，只保存在当前组件的短生命周期状态中。
- 不使用 `localStorage`、`sessionStorage`、URL 参数或剪贴板自动写入。
- 密码字段不会出现在页面初始 HTML、SSR 数据或错误堆栈中。
- 未来如果切换为 OneDev Access Token，仍然复用这套“按需显示”交互。

## 6. OneDev API 映射

所有请求由 CES Host 发往内部 OneDev 地址，浏览器不直接访问 OneDev。

### 6.1 项目

```text
GET /~api/projects?offset=0&count=100
GET /~api/projects/{projectId}
GET /~api/projects/{projectId}/clone-url
```

### 6.2 分支和 Tag

```text
GET /~api/repositories/{projectId}/branches
GET /~api/repositories/{projectId}/tags
GET /~api/repositories/{projectId}/default-branch
```

### 6.3 目录

```text
GET /~api/repositories/{projectId}/directories/{revisionAndDirectory}
```

`revisionAndDirectory` 建议编码为：

```text
{branchOrTag}/{path}
```

例如：

```text
main/src/client
```

无子目录时只传：

```text
main
```

### 6.4 文件

```text
GET /~api/repositories/{projectId}/files?revision={branchOrTag}&file={path}
```

OneDev 返回 Base64 编码的文件内容。CES Host 负责解码，并根据大小、二进制类型和扩展名返回前端可展示的数据。

### 6.5 提交

```text
GET /~api/repositories/{projectId}/commits?query={ref}%20count(20)&count=20
GET /~api/repositories/{projectId}/commits/{commitHash}
```

实现时需要按 OneDev 实际查询语法调整 query，并请求：

- `PARENTS`
- `AUTHOR`
- `COMMITTER`
- `COMMIT_DATE`
- `SUBJECT`
- `BODY`
- `FILE_CHANGES`

### 6.6 CES 代理接口

建议新增：

```text
GET /console-api/project-management/repos/:id
GET /console-api/project-management/repos/:id/branches
GET /console-api/project-management/repos/:id/tags
GET /console-api/project-management/repos/:id/tree?ref=&path=
GET /console-api/project-management/repos/:id/file?ref=&path=
GET /console-api/project-management/repos/:id/readme?ref=
GET /console-api/project-management/repos/:id/commits?ref=&page=
GET /console-api/project-management/repos/:id/commits/:sha
```

这些接口统一：

- 使用内部 OneDev 地址
- 使用服务端保存的 OneDev 凭据
- 做路径校验，禁止 `..` 和绝对路径
- 对 OneDev 错误做脱敏
- 不把 OneDev 密码或内部 Token 返回前端

## 7. 前端状态模型

仓库详情只维护少量状态：

```text
selectedProjectId
selectedRefType: branch | tag
selectedRef
currentPath
selectedFile
activeTab: code | commits | branches | tags
treeCache
fileContent
commitPage
loading / error
```

不引入全局仓库状态；关闭页面即释放。

页面内路由建议保持在 `console.page` 内，不新增 React Router。若需要可分享链接，再使用 hash 或查询参数保存项目、分支和路径。

## 8. 错误与空状态

- 项目没有默认分支：显示“仓库尚未初始化”。
- 分支为空：显示空状态，不请求目录。
- 目录为空：显示“此目录没有文件”。
- 文件过大：显示截断提示。
- 文件为二进制：显示文件大小和类型，不渲染。
- OneDev 不可达：显示配置检查入口。
- 凭据失效：显示“请到项目管理重新保存密码”。
- 权限不足：显示 OneDev 返回的脱敏错误。
- 请求被取消：不显示错误。

## 9. 实施阶段

### P1：只读浏览

- 项目管理密码显示/隐藏/复制
- 仓库详情入口
- Code 标签页
- 分支和 Tag 选择
- 目录树
- 文件内容
- README / Markdown
- 提交列表
- 亮色和暗色适配

### P2：增强

- 提交详情
- 文件变更摘要
- Diff
- 文件历史
- 分支/Tag 详情
- 可分享的页面状态
- 大文件/提交列表性能优化

## 10. 验收标准

1. 点击项目行进入 CES 内仓库详情，不跳转 OneDev。
2. “打开 OneDev”仍然保留，但只作为辅助入口。
3. 可以切换分支和 Tag，目录和文件随之刷新。
4. 目录树中的目录和文件都有正确图标。
5. 文件内容支持代码高亮；Markdown 和 README 正确渲染。
6. 提交列表展示标题、SHA、作者、时间和变更文件数。
7. 暗色模式下页面背景、边框、文字、代码高亮均正常。
8. 密码默认掩码，点击显示后可见，30 秒自动隐藏。
9. 密码不会出现在 URL、页面源码、localStorage 或日志中。
10. OneDev 不可达、凭据错误、空仓库和超大文件都有明确状态。

## 11. 待确认

1. 首版是否需要显示克隆地址和复制按钮。
2. 提交详情中的 Diff 是否必须进入 P1，还是接受 P2。
3. 是否需要支持按路径过滤提交历史。
4. 是否需要保存当前分支/路径到 URL，以便刷新和分享。
5. 是否需要多项目同时打开，还是单项目详情即可。
6. 是否允许匿名 OneDev 访问作为后备；当前设计仍由 CES 代理认证。
