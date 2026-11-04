# CES 项目代码浏览 UI 设计

- 状态：P1 与独立密码管理功能已实现并通过本地验收；真实部署待联调，P2 未实现
- 日期：2026-11-04
- 分支：`feat/code-repository`
- 关联：[代码仓库管理设计](../code-repository/README.md)
- 基线：OneDev 16.9.7、dsh 0.2.1-rc.5、现有 `@smp/console-project-repositories` 插件

## 1. 目标与范围

在 CES 内浏览已配置 OneDev 账户可访问的代码仓库，保留“打开 OneDev”作为管理入口。CES 为单用户系统，不增加账号角色、项目授权表或 Git 托管服务。当前接入范围是配置账户的可见项目，不承诺尚未实现的 CES 仓库白名单。

页面继续注册到 `console.page`，Host 使用内部 OneDev 地址和加密保存的凭据。外部链接使用外部访问地址；浏览器不携带 OneDev 凭据。配置仍在 `DSH_HOME/project-management.json`，本次不增加数据库迁移。

| 阶段 | 范围 |
| --- | --- |
| P1 | 项目列表与详情、分支/Tag 选择、目录树、文件/Markdown/README、最近 100 条提交、克隆地址、URL 状态、亮暗主题、错误与性能边界 |
| 独立管理功能，与 P1 一起交付 | 已保存密码的显示、隐藏、复制，与密码修改输入框分离 |
| P2 | 提交详情、变更文件与增删行统计、Diff、文件历史、分支/Tag 详细列表、完整历史遍历 |

首版不做写操作、在线编辑、PR、Issue、Blame、代码全文搜索、匿名认证回退、多个仓库同时打开。只有 Code 与 Commits 两个标签；Branches/Tags 集中在引用选择器中。

## 2. 页面行为

### 项目列表

项目行或名称按钮进入 CES 详情，名称按钮支持键盘操作；行尾 OneDev 链接不触发行跳转。项目按 `offset/count` 每批 100 项读取，通过“加载更多”继续；搜索明确只过滤已加载项目。列表展示名称、路径、说明、能力，不逐项目补查最新提交。未启用代码管理的项目仍可打开 OneDev，但不进入代码浏览。

### 仓库详情

```text
返回项目列表 · 项目名称 / 描述                 打开 OneDev
Code | Commits
分支/Tag 选择器 · 当前 SHA · 刷新引用          复制克隆地址
目录树                    面包屑 / 目录列表 / 文件内容
                          当前目录 README
```

- 默认使用默认分支；无默认分支显示仓库尚未初始化。
- 目录树按需加载，折叠不重复请求缓存内容；换项目或 SHA 后释放缓存。
- 当前目录显示目录列表及该目录 README，不以根 README 替代子目录 README。查找不区分大小写，优先 `README.md`、`README.markdown`、`README`。
- 文件显示路径、原始大小、截断标志、源码/预览切换和下载入口。
- 未识别语言用纯文本；二进制仅显示元信息。Markdown 内图片使用受限资源接口。
- 窄屏目录树可折叠，代码与表格内部滚动。
- Commits 仅展示固定 SHA 可达的最近 100 条提交：标题、SHA、作者、提交时间。超过上限提示去 OneDev 查看更早记录，不伪造分页或变更文件数。

## 3. 引用、路径与页面状态

选择分支/Tag 后，先通过对应引用详情解析完整 commit SHA。目录、文件、README、图片和提交列表均使用此 SHA，直到切换引用或主动刷新引用；push 不得让目录与文件混用版本。

状态为 `projectId/refType/refName/resolvedCommitSha/path/kind/tab`，其中 `refType` 为 branch/tag，`kind` 为 directory/file。引用名称必须携带类型，支持同名分支/Tag；路径参数和引用名称分别编码。缓存按项目 ID + SHA + 路径隔离。

页面状态放入带 `console=project-code-repositories` 的 hash。frame 恢复外层栏目，插件恢复仓库状态，不引入 React Router。URL 带 SHA 时恢复固定快照；切换引用清除 SHA 后重新解析。支持返回目录、返回列表、浏览器后退/前进。

状态变化取消旧请求，异步结果写入前检查请求是否仍有效。文件在新引用中不存在时显示明确错误并提供返回目录/根目录入口。

## 4. 组件、主题与构建

- 布局使用 `@smp/console-kit` 与 CES 主题变量。
- 复用宿主 `@deepseek-ai/dsh-client-ui-primitives` 的 `CodeBlock`、`FileTypeIcon`、目录图标与语言识别，不额外打包编辑器或 Shiki。
- Markdown 使用 `react-markdown` + `remark-gfm`，通过自定义链接/图片组件处理仓库资源；关闭原始 HTML，不启用 MDX、rehype-raw 或任意 HTML 注入。
- 目录树采用受控 React 组件，借鉴技能浏览器，不新增 react-arborist、Octicons 或第二套设计系统。
- React 与宿主 UI primitives 使用现有 external；其余依赖随插件打包并锁定版本。
- 当前构建是单文件 CJS，动态 import 不等同于按需下载。未来自行引入 Shiki 时另行设计语言子集、资源加载和实例生命周期。
- 文案中英文，CSS 使用主题变量，覆盖系统与手动亮暗主题。

## 5. Markdown、资源与性能边界

相对链接以当前 Markdown 父目录为基准，先解析 `.`/`..` 再检查不能越过仓库根目录。不能简单拒绝所有带 `..` 的链接。内部跳转和图片均保持项目与 SHA；标题生成稳定锚点，`#anchor` 保持当前文档上下文。

普通链接在 CES 中打开；外部链接只允许 HTTP/HTTPS，使用新窗口及 `noopener noreferrer`。外部图片不自动加载，显示链接。仓库图片只允许签名验证的 PNG/JPEG/GIF/WebP；SVG/HTML 不在 CES 同源执行。

下载强制 `application/octet-stream`、`Content-Disposition: attachment`、`X-Content-Type-Options: nosniff`。上游截断内容不能作为完整文件下载。

| 资源 | 上限与降级 |
| --- | --- |
| 文本预览 | 200 KiB、5,000 行，按 UTF-8 边界截断；非 UTF-8 按不可预览处理 |
| 高亮 | 超过 2,000 字符的单行降级纯文本；截断 Markdown 显示源码 |
| 上游 JSON | 8 MiB，包含响应正文的 12 秒超时 |
| 图片与下载 | 4 MiB 且内容完整，超限提示使用 OneDev |
| 单目录 | 最多显示 2,000 项，超限明确提示 |

保留 OneDev 的原始 `size` 与 `isPartial`。请求受浏览器断开与插件卸载取消，卸载等待在途请求结束。代码不入数据库，不使用无界全局缓存。

## 6. OneDev 16.9.7 API 契约

已对照 [RepositoryResource](https://github.com/theonedev/onedev/blob/v16.9.7/server-core/src/main/java/io/onedev/server/rest/resource/RepositoryResource.java)、[ProjectResource](https://github.com/theonedev/onedev/blob/v16.9.7/server-core/src/main/java/io/onedev/server/rest/resource/ProjectResource.java)、[CommitQuery.g4](https://github.com/theonedev/onedev/blob/v16.9.7/server-core/src/main/java/io/onedev/server/search/commit/CommitQuery.g4)。真实部署联调单独记录。

```text
GET /~api/projects?offset=0&count=100
GET /~api/projects/{id}
GET /~api/projects/{id}/clone-url
GET /~api/repositories/{id}/branches
GET /~api/repositories/{id}/tags
GET /~api/repositories/{id}/default-branch
GET /~api/repositories/{id}/branches/{encodedBranch}
GET /~api/repositories/{id}/tags/{encodedTag}
GET /~api/repositories/{id}/directories/{sha}/{encodedPathSegments}
GET /~api/repositories/{id}/files?revision={sha}&file={encodedPath}
GET /~api/repositories/{id}/commits?query={encodedQuery}&count=101&field=AUTHOR&field=COMMIT_DATE&field=SUBJECT
```

默认分支端点是原始字符串响应（例如未加引号的 `main`，即使 Content-Type 是 application/json），单独按文本读取；不存在时返回 204，不解析空 JSON。引用列表返回名字，引用详情返回 `refName/commitHash`。文件返回 `path/sha/base64Content/size/isPartial`。

提交 query 为 `commit(SHA) order-by-date`，数量是独立 count 参数，不使用 `count(20)` 查询条件。该接口没有 page/offset；P1 请求 101 条，展示前 100 条并判断更多记录，不请求 FILE_CHANGES。P2 才实现经过验证的完整历史遍历。

目录仅返回 `path/isFile`；不能将所有非文件视为普通目录。符号链接/submodule 无法读取时显示不支持，不跟随到宿主文件系统。

### CES 接口

```text
GET  /console-api/project-management/projects?offset=0
GET  /console-api/project-management/repos/:id
GET  /console-api/project-management/repos/:id/resolve?type=branch|tag&name=
GET  /console-api/project-management/repos/:id/tree?sha=&path=
GET  /console-api/project-management/repos/:id/file?sha=&path=
GET  /console-api/project-management/repos/:id/asset?sha=&path=
GET  /console-api/project-management/repos/:id/raw?sha=&path=
GET  /console-api/project-management/repos/:id/commits?sha=
POST /console-api/project-management/settings/reveal-password
```

元数据包含项目、默认分支、分支/Tag 名称及无凭据克隆地址。README 复用目录与文件接口。所有接口先检查 CES 登录，只读接口仅允许 GET。校验 ID/SHA/路径，不接受任意上游 URL 或查询；上游结构校验，错误分类脱敏，不回传原始错误正文、内部认证头或秘密。

## 7. 密码显示与复制

“新密码”输入框留空仍表示沿用保存值。新增独立“已保存密码”区域，初始只有掩码。

- 显示/复制均主动请求独立 POST 接口；只有这些动作向浏览器返回保存密码。正常代理认证仍需在后端解密。
- 要求同源 JSON 请求，检查 Origin/Fetch Metadata，复用 CES 会话，不新增管理员角色。
- 成功和失败均 no-store；失败仅通用错误，不暴露加密细节；简单限流归插件实例持有。
- 显示最多 30 秒，手动隐藏、保存、页面隐藏/切换/卸载均清除明文并取消未完成请求。
- 隐藏时也能主动复制，只在本次操作持有明文；复制失败明确提示。
- 不使用 URL、持久存储、日志、初始 HTML 或全局状态保存明文。
- 用户能在开发者工具观察已返回的明文；自动隐藏不能清除系统剪贴板，不承诺远程销毁。

## 8. 验收与交付

1. 第二批项目可加载，搜索明确作用于已加载项目；无代码管理的项目有明确状态。
2. 点击项目进入 CES，外部链接不触发行跳转。
3. 同名分支/Tag、带斜杠引用、中文与特殊字符路径正常。
4. 浏览资源固定到同一 SHA，push 不改变快照，快速切换不会被旧响应覆盖。
5. 刷新恢复、后退/前进、返回目录与项目列表正常。
6. 嵌套 README、上级目录链接、图片、锚点正常；越界路径和危险协议被拒绝。
7. 字节/行数/长行、二进制、上游 partial、超限下载均有明确状态。
8. 提交显示最近 100 条并注明上限。
9. 未登录、凭据错误、404、超时、不可达与空仓库都有明确状态，错误不泄露上游秘密。
10. 密码显示/复制与新密码草稿分离，过期和页面隐藏清除明文。
11. 亮暗、中英文、窄屏布局正常，构建不重复打包 React。

交付记录测试、构建、浏览器验证与实际 OneDev 联调范围。P2 不得标为已实现。

## 9. 实施记录

本次已实现第 1 节 P1 和独立密码管理功能。测试、构建、真实宿主组件的浏览器夹具验证及截图见[验收记录](../../reports/project-code-browser-2026-11-04/README.md)。验证未使用实际 OneDev 凭据、未部署到现有运行实例。
