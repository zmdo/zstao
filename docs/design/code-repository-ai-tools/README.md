# CES 代码提交与 OneDev 推送工具设计

- 状态：方案设计，未实现
- 日期：2026-11-04
- 分支：`feat/code-repository`
- 目标：让会话中的 AI 能在受控范围内检查工作区代码、创建 OneDev 项目、提交代码并推送到配置的 OneDev 仓库
- 关联方案：[CES 代码仓库管理插件设计](../code-repository/README.md)、[项目代码浏览 UI 设计](../project-code-browser/README.md)

## 0. 结论

1. 工具由 CES Host 执行，AI 只调用工具，不直接接触 OneDev 密码或 Git 凭据。
2. 第一版只支持已配置的 OneDev，不支持任意 Git 地址。
3. AI 可以查询本地仓库状态、确保 OneDev 项目存在、提交并推送当前工作区。
4. 项目不存在时允许创建，但必须由调用方显式传入 `createProject: true`，不能默认静默创建。
5. 推送使用 HTTPS + OneDev Access Token/Basic Auth，凭据由 Host 注入。
6. 禁止 force push；远端分支领先时返回明确错误，由 AI 或用户决定下一步。
7. 提交和推送属于修改型操作，默认需要用户审批；完全访问模式可以跳过逐次审批，但仍写审计。
8. 不把 OneDev 密码、Token、私钥、`.env` 等敏感内容返回给模型或写入提交。

## 1. 背景

当前“项目代码仓库”已经支持：

- OneDev 项目列表
- 分支、Tag、提交和文件浏览
- 从 OneDev 查看项目
- 项目管理中的 OneDev 配置

但 AI 仍需要人工执行：

```text
git init
git add
git commit
git remote add
git push
```

本方案增加一套面向会话的 Git 工具，使 AI 可以在明确授权下完成：

```text
检查工作区
→ 确认/创建 OneDev 项目
→ 提交代码
→ 推送分支
→ 返回提交和项目链接
```

## 2. 目标与非目标

### 目标

- AI 可以查看当前工作区的 Git 状态。
- AI 可以在 OneDev 中查找或创建项目。
- AI 可以提交工作区中的代码变更。
- AI 可以推送到 OneDev 的指定分支。
- 工具输出可追踪：项目、分支、commit SHA、文件列表。
- 凭据只在 Host 侧使用，不进入模型上下文。
- 默认不覆盖远端历史，不强制推送。
- 对敏感文件、超大文件、非工作区路径做拦截。
- 所有创建、提交、推送操作有审计记录。

### 非目标

- 不实现通用 Git 客户端。
- 不支持 GitHub、GitLab 等未配置的远端。
- 不实现 PR、Review、Merge、分支保护。
- 不实现 Git LFS、大文件上传和二进制资产管理。
- 不允许 AI 读取 OneDev 密码或 Git Token。
- 不允许 AI 选择任意远端 URL、任意主机或任意 SSH Key。
- 不自动解决远端分支冲突或自动 rebase。
- 不自动把代码发布到生产环境；部署流水线仍是独立能力。

## 3. 工具集

第一版建议提供三个工具。

### 3.1 `platform_git_status`

只读工具，用于在提交前了解工作区状态。

输入：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `workspace` | string | 否 | 工作区标识或相对路径；省略时使用当前会话工作区 |
| `project` | string | 否 | OneDev 项目名，用于查询远端项目状态 |

输出：

```text
workspaceRoot
isGitRepository
currentBranch
remoteName
remoteUrl
clean
changedFiles[]
untrackedFiles[]
ahead
behind
lastCommit { sha, subject, author, date }
project { id, name, path, exists, webUrl, cloneUrl }
```

用途：

- 判断是否已经初始化 Git。
- 判断是否有未提交修改。
- 判断远端是否已经有同名项目。
- 判断当前分支是否领先/落后远端。

### 3.2 `platform_git_repository_ensure`

确保 OneDev 中存在指定项目；不存在时可创建。

输入：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `project` | string | 是 | OneDev 项目名称/路径 |
| `description` | string | 否 | 项目描述 |
| `createProject` | boolean | 否 | 不存在时是否创建，默认 `false` |
| `visibility` | string | 否 | 第一版固定为 OneDev 项目默认可见性，不额外开放 |

输出：

```text
created: boolean
project: { id, name, path, description, webUrl, cloneUrl, defaultBranch }
```

行为：

- 先按名称/路径查询 OneDev 项目。
- 已存在：返回现有项目，不修改项目设置。
- 不存在且 `createProject: false`：返回 `project_not_found`，由 AI 请求用户确认。
- 不存在且 `createProject: true`：创建项目。
- 创建参数至少包含：

```text
name
key（可选）
description
codeManagement = true
packManagement = false
issueManagement = false
```

- 创建失败时返回 OneDev 错误摘要，不回传 OneDev 密码或内部凭据。
- 如果同名项目已经存在但路径不同，返回冲突错误，不自动复用。

### 3.3 `platform_git_publish`

提交并推送当前工作区。

输入：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `workspace` | string | 否 | 工作区标识或相对路径 |
| `project` | string | 是 | 目标 OneDev 项目 |
| `description` | string | 否 | 项目不存在时用于创建 |
| `createProject` | boolean | 否 | 项目不存在时是否创建，默认 `false` |
| `branch` | string | 否 | 目标分支，默认 `main` |
| `message` | string | 是 | 提交说明 |
| `paths` | string[] | 否 | 只提交指定路径；省略时提交所有非敏感变更 |
| `dryRun` | boolean | 否 | 只检查，不执行 commit/push，默认 `false` |

输出：

```text
project { id, name, webUrl }
branch
commit { sha, subject, author, date }
pushed: boolean
remoteUrl
changedFiles[]
createdProject: boolean
noChanges: boolean
```

行为：

1. 校验工作区属于当前会话允许的根目录。
2. 校验 Git 仓库：
   - 没有 `.git`：执行 `git init -b main`。
   - 已有 `.git`：不覆盖已有 remote；若 remote 与当前 OneDev 配置不一致，拒绝并要求确认。
3. 查询 OneDev 项目：
   - 不存在且 `createProject: true`：创建项目。
   - 不存在且未允许创建：返回 `project_not_found`。
4. 检查敏感文件和超大文件。
5. 按 `paths` 或全部非敏感变更执行 `git add`。
6. 无变更时返回 `noChanges: true`，不创建空提交。
7. 创建 commit。
8. 推送到 OneDev：

```text
git push <remote> HEAD:<branch>
```

9. 返回 commit SHA、分支、项目 URL 和变更文件。

禁止：

- `git push --force`
- `git push --force-with-lease`
- 自动 `git reset --hard`
- 自动删除远端分支
- 自动改写已有提交

## 4. 工具调用流程

```mermaid
sequenceDiagram
    participant U as 用户
    participant AI as 会话 AI
    participant T as CES Git 工具
    participant G as 本地 Git
    participant O as OneDev

    U->>AI: 把当前代码提交到 OneDev
    AI->>T: platform_git_status(workspace, project)
    T->>G: git status / branch / remote
    T->>O: 查询项目
    O-->>T: 项目状态
    T-->>AI: 变更、分支、项目状态

    alt 项目不存在
        AI->>U: 请求确认创建项目
        U-->>AI: 同意
        AI->>T: platform_git_repository_ensure(createProject=true)
        T->>O: POST 创建项目
        O-->>T: 项目 ID 和克隆地址
    end

    AI->>T: platform_git_publish(branch, message, paths)
    T->>T: 敏感文件/路径/大小检查
    T->>G: git add / git commit
    T->>O: git push（Host 注入凭据）
    O-->>T: 推送结果
    T-->>AI: commit SHA、项目链接、变更文件
    T->>T: 写审计记录
```

## 5. Git 执行模型

### 5.1 执行位置

Git 命令在 CES Host 进程内执行，不在模型沙箱或浏览器执行。

工作区来源：

- 当前会话已登记的工作区。
- 或工具参数中指向该会话允许根目录的路径。
- 不能使用任意宿主机路径。

路径校验：

- 绝对路径 canonicalize 后必须位于允许根目录内。
- 拒绝 `..`、符号链接逃逸和跨工作区路径。
- `.git` 路径必须在工作区根目录内。

### 5.2 凭据注入

OneDev 当前可使用：

```text
HTTPS Clone URL
用户名 + Access Token / 管理员密码
```

建议后续为 AI 创建专用 OneDev 用户和 Access Token，而不是复用管理员密码。

Host 执行 Git 时：

- Token 只放在临时凭据环境或 `GIT_ASKPASS` 临时脚本中。
- 不放在命令行参数。
- 不写入 `.git/config` 的 URL。
- 不写入日志。
- 不进入模型上下文。
- 临时凭据文件权限 `0600`，执行后删除。

推荐使用：

```text
GIT_ASKPASS=<临时脚本>
GIT_TERMINAL_PROMPT=0
```

而不是：

```text
https://user:token@host/repo.git
```

### 5.3 提交身份

统一使用可识别的 AI 提交身份：

```text
user.name  = CES AI
user.email = ces-ai@localhost
```

不继承宿主机的个人 Git 身份，也不要求 AI 知道用户邮箱。

### 5.4 远端配置

- 远端名固定为 `onedev`，或复用已有的 OneDev remote。
- 远端 URL 只能来自当前 OneDev 配置，不接受模型提供的 URL。
- 如果工作区已有 `origin`，不覆盖；可提示 AI 使用 `onedev`。
- 如果 `origin` 指向其他主机，不自动推送。

## 6. 项目创建

### 6.1 名称规则

- 只允许小写字母、数字、`-`、`_`、`.` 和 `/` 的受限组合。
- 不允许空名称、绝对路径、`..` 和 URL 字符。
- 项目名必须与 OneDev 项目路径一致或可明确映射。
- 名称冲突时返回 `project_exists`，由 AI 决定是否改用现有项目。

### 6.2 创建策略

- 默认 `createProject: false`，避免 AI 误创建大量项目。
- 用户确认后，AI 才能传 `createProject: true`。
- 创建请求幂等：先查询，再创建；创建冲突时重新查询并返回。
- 创建成功后，默认分支可以为空；第一次 push 时由 Git 创建。
- 不自动创建 README、Issue、PR 或额外项目配置。

### 6.3 项目设置

第一版创建参数：

```text
codeManagement: true
packManagement: false
issueManagement: false
wikiManagement: false
timeTracking: false
```

目的：只创建代码仓库，不把 OneDev 变成完整项目管理系统。

## 7. 文件安全规则

### 7.1 默认拒绝的敏感文件

提交前强制检查：

```text
.env
.env.*
*.pem
*.key
*.p12
*.pfx
id_rsa
id_ed25519
.ssh/
.aws/
.docker/
kubeconfig
credentials*
secrets*
```

以及：

- 文件名包含 `password`、`token`、`secret` 且不在允许白名单内。
- 超过 10 MiB 的单个文件。
- Git LFS 指针或二进制资产，第一版提示用户手动处理。

### 7.2 路径规则

- `paths` 必须是工作区相对路径。
- 不允许绝对路径。
- 不允许 `..`。
- 不允许 `.git/` 内部文件。
- 不允许修改工作区外文件。

### 7.3 AI 不得绕过的规则

- 不允许通过工具参数关闭敏感文件检查。
- 不允许通过 `git add -f` 绕过 `.gitignore`。
- 不允许强制推送。
- 不允许把 OneDev 凭据写入代码或提交说明。
- 如果用户明确要求提交敏感文件，工具拒绝并提示改为手动处理或使用安全 Secret 管理。

## 8. 权限与审批

| 工具 | 类型 | 默认审批 |
|---|---|---|
| `platform_git_status` | 只读 | 不需要 |
| `platform_git_repository_ensure` | 可能创建项目 | 需要 |
| `platform_git_publish` | 提交和推送 | 需要 |

规则：

- 创建项目、commit、push 都改变外部状态，默认需要用户批准。
- 完全访问模式可以跳过逐次审批，但仍记录审计。
- 审批内容至少展示：
  - 项目名
  - 分支
  - commit message
  - 将要提交的文件列表
  - 是否创建项目
  - 目标 OneDev 地址
- 不把密码或 Token 放进审批文本。

## 9. 审计与数据

建议增加轻量审计表：

### `code_publish_audit`

- `id`
- `project_id`
- `project_path`
- `workspace_root`
- `branch`
- `commit_sha`
- `message`
- `files`（JSON）
- `created_project`（boolean）
- `pushed`（boolean）
- `actor`（当前 CES 用户）
- `status`（success、failed、rejected、no_changes）
- `error_code`
- `created_at`

不记录：

- OneDev 密码
- Access Token
- 文件内容
- 完整 Git 命令中的凭据

审计记录可用于页面展示和问题追踪，不替代 OneDev 自身的提交历史。

## 10. 错误模型

建议错误码：

```text
workspace_not_found
workspace_not_allowed
not_a_git_repository
remote_conflict
project_not_found
project_exists
project_create_forbidden
project_create_failed
sensitive_file
file_too_large
invalid_path
invalid_branch
no_changes
commit_failed
push_rejected
non_fast_forward
upstream_unavailable
upstream_credentials
```

工具返回错误时：

- 给 AI 可操作的原因。
- 不返回 OneDev 内部 HTML、堆栈或凭据。
- 不把失败包装成成功。
- `non_fast_forward` 明确提示需要拉取/合并或换分支，不自动 force。

## 11. 与现有插件的关系

复用：

- `project-management.json` 中的 OneDev 内部/外部地址和加密凭据
- 现有 OneDev Host 客户端
- 现有 OneDev 项目查询和创建能力
- 现有审计和权限基础设施（如可复用）

新增：

- Git 工作区检查
- OneDev 项目自动创建
- commit/push 执行器
- 工具定义与审批
- 发布审计记录

不改变：

- 项目代码仓库浏览页面
- 现有“从 OneDev 浏览”入口
- 现有密码显示机制

## 12. 实施阶段

### P1

- `platform_git_status`
- `platform_git_repository_ensure`
- `platform_git_publish`
- 敏感文件和路径检查
- 基础审批
- 基础审计

### P2

- 独立分支创建
- 提交前 diff 摘要
- 推送失败后的 fetch/状态提示
- 项目创建模板
- 多工作区选择

### P3

- PR/Review 集成
- 分支保护
- Git LFS
- 更多 Provider
- 代码扫描和策略校验

## 13. 验收标准

1. AI 可以查询当前工作区 Git 状态，不产生写操作。
2. 项目存在时能把工作区变更提交并推送到指定分支。
3. 项目不存在且 `createProject: true` 时能创建项目并推送。
4. 项目不存在且未允许创建时不会自动创建。
5. 没有变更时不会生成空提交。
6. 远端分支领先时返回 `non_fast_forward`，不会 force push。
7. 敏感文件、超大文件和越界路径被拒绝。
8. OneDev 密码和 Token 不出现在工具输出、提交、日志或审计中。
9. 每次创建、提交、推送都有审计记录。
10. 失败不会留下“已推送”的虚假成功状态。

## 14. 待确认

1. AI 是否默认允许创建 OneDev 项目，还是必须每次由用户确认。
2. 提交身份使用 `CES AI`，还是要求使用当前用户的 OneDev 身份。
3. 是否允许推送到 `main`，还是默认创建 `ai/<task>` 分支。
4. 敏感文件规则是否允许用户按项目配置白名单。
5. 是否需要支持在推送前展示 diff 并要求二次确认。
6. 是否将 Git 操作限制在单独的工作树，而不是当前开发工作区。
