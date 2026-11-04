# OneDev 流水线展示方案

- 状态：调研与方案设计，未实现
- 日期：2026-11-05
- 分支：`feat/code-repository`
- 目标：把 OneDev 的流水线运行展示到 CES 的“项目仓库管理 / 部署流水线”页面
- 关联实现：`plugins/project-repositories`（OneDev 配置、项目浏览、统一 `platform_onedev` 工具）

## 0. 结论

1. OneDev 的“流水线”不是 GitHub Actions 那种独立的 Workflow 对象，核心执行对象是 **Build（一次 Job 运行）**。
2. 流水线定义来自仓库根目录的 `.onedev-buildspec.yml`；其中每个 `jobs[]` 是一个 Job，Job 的一次执行产生一条 Build。
3. CES 第一版应展示 **Build 运行列表**，而不是虚构一个统一的 Pipeline 定义列表。
4. 列表跨所有 OneDev 项目，来源是 OneDev 的全局 Build 查询 API。
5. 点击一条 Build 进入仿 GitHub Actions 的运行详情：
   - 当前状态和耗时
   - 项目、Job、分支/Tag、Commit
   - 触发原因、提交人、Agent
   - Step 执行列表
   - 流式日志
   - 构建产物和依赖 Build
6. CES 不直接执行 Job；触发、取消、重建等写操作第一版不做，后续可通过 OneDev API 接入。
7. 当前部署还没有 `ces-build-test` / `ces-production-deploy` Agent，实际 Build 列表可能为空；这是环境前置条件，不是页面问题。

## 1. OneDev 流水线模型

### 1.1 Build Spec

仓库根目录：

```text
.onedev-buildspec.yml
```

当前 CES 仓库中的 Job：

| Job | 执行器 | 触发方式 | 作用 |
|---|---|---|---|
| `build` | `ces-build-test` | `main` 分支更新 | 构建候选镜像并发布 `image.json` |
| `candidate` | `ces-build-test` | 手动，参数 `image` | 部署候选环境 |
| `release` | `ces-production-deploy` | 手动，参数 `digest` | 发布正式环境 |
| `rollback` | `ces-production-deploy` | 手动，参数 `release` | 回滚正式环境 |

OneDev 中：

```text
Job 定义
  └─ 每次运行 → Build
       ├─ 状态
       ├─ Step 执行
       ├─ 日志
       ├─ 产物
       ├─ 参数
       └─ 依赖 / 被依赖
```

因此：

- “流水线列表”在数据层实际是“Build 列表”
- “流水线详情”实际是“Build 详情”
- 一个 Build 对应一个 Job，不自动等于一个多 Job 的完整发布流程
- `build`、`candidate`、`release` 是三个 Job；是否属于同一条发布链，要看 OneDev Build 依赖和参数

### 1.2 Build 状态

OneDev Build 状态：

```text
WAITING
PENDING
RUNNING
SUCCESSFUL
FAILED
CANCELLED
TIMED_OUT
```

映射到 CES：

| OneDev | CES 展示 |
|---|---|
| WAITING / PENDING | 排队中 |
| RUNNING | 运行中 |
| SUCCESSFUL | 成功 |
| FAILED | 失败 |
| CANCELLED | 已取消 |
| TIMED_OUT | 超时 |

颜色：

- 成功：绿色
- 失败/超时：红色
- 运行中：蓝色
- 排队中：灰色/黄色
- 取消：灰色

## 2. 页面形态

### 2.1 入口

保留：

```text
项目仓库管理 / 部署流水线
```

将当前占位页面替换为流水线运行列表。

### 2.2 列表

跨所有 OneDev 项目展示最近的 Build。

建议列：

| 列 | 内容 |
|---|---|
| 状态 | 图标 + 状态文字 |
| 项目 | OneDev 项目名称/路径 |
| 流水线 | Job 名称，例如 `build`、`candidate` |
| 引用 | 分支或 Tag |
| Commit | 短 SHA + 提交标题 |
| 触发 | 手动/分支更新/定时/重试 |
| 提交人 | Build submitter |
| 开始时间 | submitDate / runningDate |
| 耗时 | runningDuration |
| 操作 | 打开详情 |

筛选：

- 项目
- Job 名称
- 状态
- 分支
- Commit SHA
- 时间范围
- 关键词

刷新：

- 页面打开时加载
- 运行中的 Build 定时轮询
- 页面不可见时暂停轮询
- 支持手动刷新

分页：

- 使用 OneDev `offset` / `count`
- 第一版每页 20 或 50
- 不把所有 Build 一次性拉到浏览器

### 2.3 详情

仿 GitHub Actions 的运行详情：

```text
┌──────────────────────────────────────────────────────────────────────┐
│ ← 部署流水线     build #128     [成功]       [在 OneDev 查看]       │
├──────────────────────────────────────────────────────────────────────┤
│ 项目：ces-platform                                                   │
│ 分支：main     Commit：bd49e49c    提交人：zhangming                 │
│ 触发：Branch update    耗时：1m 42s    Agent：ces-build-test          │
├──────────────────────────────────────────────────────────────────────┤
│ 运行步骤                                                             │
│ ✓ checkout        2s                                                  │
│ ✓ image           1m 30s     [查看日志]                              │
│                                                                      │
│ ┌──────────────── 日志 ────────────────────────────────────────────┐ │
│ │ ...                                                              │ │
│ │ ...                                                              │ │
│ └──────────────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────────────┤
│ 产物：image.json                                                     │
│ 依赖 Build：...                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

详情区域：

1. **顶部摘要**
   - Build 编号
   - Job 名称
   - 状态
   - 项目
   - 分支/Tag
   - Commit
   - 触发方式
   - 耗时
   - Agent
   - “在 OneDev 查看”按钮

2. **Step 时间线**
   - 来自 `stepExecutions`
   - 展示 Step 名称、状态、耗时
   - 点击 Step 定位日志

3. **日志**
   - 通过 OneDev Build Log Stream 获取
   - 默认自动跟随最后一个日志
   - 支持暂停滚动、复制、搜索
   - 运行中的 Build 增量拉取
   - 日志很大时只保留最近一段，历史部分按需加载
   - 不把完整日志写入 CES 数据库

4. **产物**
   - 通过 Artifact API 列出
   - 显示名称、大小、下载
   - 不把产物内容写入浏览器状态

5. **依赖和关联 Build**
   - 使用 Build Dependencies / Dependents API
   - 第一版可以只展示数量
   - P2 展示可点击的上游/下游 Build

6. **参数**
   - 例如 `candidate` 的 `image`、`release` 的 `digest`
   - 展示为只读键值

### 2.4 空状态

需要区分：

- 没有配置 OneDev
- OneDev 没有项目
- 项目没有 Build
- Job 未触发
- Agent 离线导致 Build 一直等待
- Build 被取消

不能把所有情况都显示成“暂无数据”。

## 3. OneDev API 对接

所有请求由 CES Host 代理，浏览器不直接访问 OneDev。

### 3.1 全局 Build 列表

```text
GET /~api/builds?offset=0&count=50
```

返回 Build 数组：

- `id`
- `projectId`
- `jobName`
- `refName`
- `commitHash`
- `status`
- `stepExecutions`
- `submitterId`
- `agentId`
- `submitDate`
- `runningDate`
- `finishDate`
- `pendingDuration`
- `runningDuration`
- `submitReason`
- `retryDate`

项目名称通过项目缓存映射；OneDev Build 只返回 `projectId`。

### 3.2 Build 详情

```text
GET /~api/builds/{buildId}
GET /~api/builds/{buildId}/params
GET /~api/builds/{buildId}/dependencies
GET /~api/builds/{buildId}/dependents
```

用于详情摘要、参数和关联 Build。

### 3.3 日志

```text
GET /~api/streaming/build-logs/{buildId}
```

特点：

- 流式响应
- 运行中可持续读取
- 需要 Host 代理，避免浏览器直接持有 OneDev 凭据
- 需要处理断开、重连和增量位置

第一版可以采用：

```text
EventSource/SSE 代理
```

或更简单的：

```text
fetch + ReadableStream
```

如果代理实现复杂，先做 2 秒轮询读取最新日志窗口。

### 3.4 产物

```text
GET /~api/artifacts/{buildId}/infos
GET /~api/artifacts/{buildId}/contents/{path}
```

第一版只展示元数据和下载链接，不在 CES 数据库中保存产物内容。

### 3.5 重跑和取消

OneDev 提供：

```text
POST /~api/job-runs/rebuild
DELETE /~api/job-runs/{buildId}
```

但第一版页面只读，不暴露写操作：

- 重跑
- 取消
- 删除 Build

这些操作需要单独的审批、防误操作和审计设计，放到 P2。

## 4. CES 接口设计

建议增加：

```text
GET /console-api/project-management/pipelines
GET /console-api/project-management/pipelines/:buildId
GET /console-api/project-management/pipelines/:buildId/logs
GET /console-api/project-management/pipelines/:buildId/artifacts
GET /console-api/project-management/pipelines/:buildId/dependencies
```

列表参数：

```text
project
job
status
branch
offset
count
```

响应：

```json
{
  "builds": [
    {
      "id": 128,
      "number": 128,
      "projectId": 1,
      "projectName": "ces-platform",
      "jobName": "build",
      "refName": "main",
      "commitHash": "bd49e49c...",
      "commitSubject": "feat: ...",
      "status": "SUCCESSFUL",
      "submitter": "zhangming",
      "submitReason": "Branch update",
      "submitDate": "...",
      "finishDate": "...",
      "duration": 102,
      "agent": "ces-build-test"
    }
  ],
  "nextOffset": 50
}
```

## 5. 页面和状态模型

前端只需要单页状态：

```text
selectedBuildId
projectFilter
jobFilter
statusFilter
offset
builds
currentBuild
logs
artifacts
activeTab
loading / error
```

不引入 Redux。

路由建议使用 console hash：

```text
#console=project-pipelines
#console=project-pipelines&build=128
```

这样可以：

- 刷新后恢复详情
- 浏览器后退回到列表
- 与当前仓库浏览器的 hash 状态保持一致

## 6. 组件选型

### 列表

复用现有控制台列表：

```text
Panel + smp-list-panel
表格 + 固定表头 + 分页
```

与“平台设置 / 插件”一致。

不新增表格库。

### 状态

使用小型内联状态组件：

- 圆点 / 图标
- 文本
- 颜色 token
- `role="status"`

### 日志

第一版：

```text
<pre> + 等宽字体 + 行号
```

如果要长日志搜索/高亮，再引入：

```text
CodeMirror 6
```

第一版不引入 Monaco。

### 图标

复用：

```text
@deepseek-ai/dsh-client-ui-primitives
```

状态图标可继续使用现有 SVG 或 `@primer/octicons`。

### 轮询

原生 `setInterval` + `AbortController`，不引入请求库。

## 7. 认证与安全

- 浏览器不直接访问 OneDev
- CES Host 使用现有加密 OneDev 凭据
- Build 日志和产物只通过 CES 代理返回
- 代理需要限制响应体大小和超时
- 日志中可能包含敏感信息，页面默认不做全文持久化
- 产物下载必须校验路径
- 不在 URL 中携带 OneDev 凭据
- 不把 OneDev 内部地址暴露到日志

## 8. 前置条件

目前 OneDev 环境已经有：

- OneDev 16.9.7
- `ces-platform` 项目
- `.onedev-buildspec.yml` 中的 Job 定义
- 代码仓库

但还缺：

- `ces-build-test` Agent
- `ces-production-deploy` Agent
- 构建执行环境
- 镜像仓库和发布凭据

没有 Agent 时：

- 可以显示 Job 和 Build 状态
- 新触发的 Build 可能一直处于等待状态
- 不能验证真实执行日志和产物

所以页面可以先做，真实数据验证需要 Agent 上线。

## 9. 实施阶段

### P1：只读运行列表和详情

- 跨项目 Build 列表
- 项目、Job、状态、分支、时间筛选
- 分页
- Build 详情
- Step 时间线
- 日志流式展示
- 产物元数据
- 运行中轮询/日志增量
- 空状态和错误状态

### P2：流水线操作

- 手动触发 Job
- 重跑 Build
- 取消 Build
- 删除 Build
- 参数表单
- 依赖/下游 Build 可点击
- GitHub Actions 式 Job 图形视图

### P3：多 Job 发布链

- 把 build → candidate → release 关联为一条发布链
- 以 commit/digest 为线索展示上下游
- 验收状态和正式发布记录
- 与部署流水线设计合并

## 10. 验收标准

1. 页面能列出所有 OneDev 项目的最近 Build。
2. Build 列表能按项目、Job、状态和分支筛选。
3. 点击 Build 能进入 CES 内详情，不跳转 OneDev。
4. 详情显示状态、项目、Job、分支、Commit、触发、耗时和 Agent。
5. 详情显示 Step 状态和耗时。
6. 能查看运行日志，运行中可增量刷新。
7. 能列出构建产物并下载。
8. 暗色模式正常。
9. OneDev 不可达、无 Agent、无 Build 时有明确状态。
10. 浏览器不接触 OneDev 密码和内部凭据。

## 11. 待确认

1. “流水线”是否只按 Build 展示，还是需要把多个 Job 聚合为一条发布链。
2. 是否需要从 `.onedev-buildspec.yml` 解析 Job 定义并展示“未运行过”的流水线。
3. 日志第一版用流式 SSE 还是轮询。
4. 是否需要重跑/取消/手动触发；如果需要，审批和审计规则要先定。
5. 构建产物是否允许从 CES 直接下载，还是只跳转 OneDev。
6. Agent 和镜像仓库的部署时间。
