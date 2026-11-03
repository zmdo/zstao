# 极简脚本工作流方案（Script Workflow）

- 状态：方案草案；**实施暂缓**，先完成 ComfyUI 服务器与 API 模板设计
- 日期：2026-11-03
- 分支：`feat/workflow`
- 范围：CES 内部工作流编排；节点以脚本或插件动作实现；前端使用 React Flow
- 关联方案：[ComfyUI 服务器与 API 模板设计](../comfyui/README.md)
- 结论：**不引入 Flowable、Temporal 等完整工作流引擎**，构建一个轻量的 Cordis 插件；DSL 借鉴 GitHub Actions / Argo Workflows，执行器和可视化自己实现

## 1. 背景与目标

Dify 这类平台的节点太多、概念太重，普通用户学习成本高，也与 CES“单用户、业务插件化、单进程”的形态不匹配。本方案把工作流收敛为：

> 一张 DAG 图，每个节点要么是一段脚本，要么是一个已注册的插件动作。

### 1.1 目标

1. 工作流文件是纯文本（YAML），可由 **AI 会话生成和修改**，也可由人直接编辑。
2. 每个节点绑定一个脚本（Node.js / Bash / Python），或 `uses` 一个插件动作。
3. 其他 CES 插件可以注册动作，工作流把它们当作节点使用，例如：
   - `server-management.exec`：在服务器上执行命令
   - `cos.upload`：上传文件到 COS
   - `domain-manager.dns.update`：修改 DNS
4. 前端用 React Flow 展示和编辑；支持运行状态、日志、版本对比。
5. 复用 CES 现有能力：PostgreSQL、secrets、approval、audit、Harness 工具、console-kit。
6. 单进程可运行，不引入 Redis、Celery、JVM、Kubernetes。

### 1.2 非目标

- 不做 BPMN 流程建模、人工任务表单、会签、子流程版本等 BPM 功能。
- 不做 Dify 式的 30+ 节点、插件市场、多租户、RAG Pipeline。
- 不做通用 SaaS 工作流平台；只服务 CES 单用户。
- 不在第一版做分布式执行、跨机器调度、复杂循环/矩阵。
- 不把脚本放在浏览器里执行。

## 2. 已有轮子调研

| 项目 | 模型 | 技术栈 | 优点 | 不适合本方案的原因 |
| --- | --- | --- | --- | --- |
| Flowable | BPMN 2.0 流程引擎 | Java / Spring | 成熟、支持网关/会签/定时任务 | BPMN 学习成本高；Java 进程；脚本只是 Service Task 的附属；UI 是 BPMN Modeler，不是 React Flow；与 CES 单进程不匹配 |
| Camunda / Zeebe | BPMN / 云原生流程 | Java | 生态成熟、可视化强 | 同上；Zeebe 还需额外集群与网关 |
| Temporal | 代码即工作流，持久化执行 | Go/Java/TS SDK | 重试、恢复、长任务非常强 | 没有可视化编排；工作流写在代码里；Temporal Server/Cassandra 等运维重；对单用户 CES 过重 |
| Argo Workflows | Kubernetes CRD，steps/DAG | Go / K8s | “每个节点是容器/脚本”的语义最接近；YAML DAG；有 UI | 强依赖 Kubernetes；不能嵌入 CES 进程；适合借鉴 DSL，不适合直接依赖 |
| GitHub Actions | YAML + Runner | 托管服务 / Runner | `on/jobs/steps/needs/if/uses/run` 语义清晰；用户熟悉 | 不是可嵌入引擎；Runner 和平台绑定；jobs/steps 模型对任意 DAG 表达有限 |
| Kestra | YAML 声明式工作流 + 插件任务 | Java | 插件化任务、脚本任务、调度 | JVM 服务；部署重；插件/任务模型比本方案大 |
| Windmill | 脚本优先的工作流/任务平台 | Rust + TS/Python workers | 脚本即节点，DAG，自动生成 UI | 独立服务、worker 体系；License 与运维成本需要评估；不适合嵌入 CES 单进程 |
| Node-RED | 流式节点编程，Function 节点写 JS | Node.js | Apache 2.0；可在 Node 内嵌；节点插件机制成熟 | 自带编辑器，不是 React Flow；flow 模型偏低代码/消息流；嵌入后要维护第二套 UI 和运行时 |
| n8n | 节点自动化平台 | Node.js/TS | 节点生态大、可视化成熟 | fair-code License；完整平台；不适合作为 CES 内部组件 |
| Activepieces | 自动化平台 | Node.js/TS | TypeScript、piece 插件化 | 完整平台；运行时/UI/账号体系都要一起引入 |
| React Flow | 图编辑 UI 库 | React | 轻量、可控、React 生态 | 只是 UI，不是执行引擎；本方案采用 |
| BullMQ / pg-boss | 任务队列 | Node.js | 成熟、简单 | 只是队列，不提供 DAG、变量、节点、UI；可作为后续执行队列备选 |
| XState | 状态机 | TS | 状态建模强 | 不是持久化工作流引擎，也没有脚本节点/DAG UI；本方案不采用 |

### 2.1 结论

没有现成轮子同时满足：

- 脚本即节点
- 插件动作注册
- React Flow 前端
- 单进程、PostgreSQL、无 Redis/JVM/K8s
- 与 CES 的 secrets/approval/audit/Harness 工具集成

因此：**自研一个薄执行器，借鉴 GitHub Actions 的 YAML 语义和 Argo 的 DAG 语义，不引入完整工作流引擎。**

## 3. 总体设计

```text
Harness 会话（AI tools）───┐
                            ├── workflow host plugin（Cordis）
CES 控制台（React Flow）────┘        ├─ DSL 校验 / 版本 / 存储（Postgres）
                                     ├─ 触发器（manual/schedule/webhook）
                                     ├─ 调度器 / 执行器
                                     ├─ Action Registry ← 其他插件注册
                                     ├─ 脚本运行器（node/bash/python 子进程）
                                     └─ SSE / 日志 / 运行记录 / 审计

脚本节点 ── child_process ── 运行工作目录
动作节点 ── 插件服务 ── server-management / cos / domain-manager / ...
```

### 3.1 组成

| 组件 | 职责 |
| --- | --- |
| `@smp/console-workflow` | 工作流宿主插件：DSL、存储、执行器、触发器、路由、工具、前端页面 |
| Action Registry | 插件动作注册表；节点元数据（JSON Schema、审批策略、分类、图标） |
| Script Runner | 在独立子进程中运行脚本，传入输入/上下文，收集输出 |
| Run Scheduler | 按 `needs` 调度 DAG；限制并发；处理重试/超时/取消 |
| React Flow 页面 | 画布、节点面板、检查器、运行面板、版本对比 |
| AI Tools | 让 Harness 会话生成、校验、保存、运行工作流 |

### 3.2 关键原则

1. **DSL 是唯一事实来源**：UI、AI、API 都围绕 YAML；React Flow 只是它的可视化投影。
2. **节点只有两类**：`run`（脚本）和 `uses`（插件动作）；控制逻辑通过 `needs` + `if` 表达，保持心智简单。
3. **插件不依赖工作流**：其他插件可选注入 `workflow` 服务并注册动作；没装工作流插件时它们照常工作。
4. **执行不阻塞主进程**：脚本跑在子进程；动作在宿主内异步执行；运行状态落库。
5. **AI 生成、人审核、再运行**：AI 不直接执行危险脚本。

## 4. 工作流 DSL

### 4.1 示例

```yaml
name: server-maintenance
description: 服务器磁盘检查与清理
on:
  manual:
    inputs:
      server:
        type: string
        description: 服务器 ID
        required: true
  schedule:
    cron: "0 3 * * *"
    timezone: Asia/Shanghai
    inputs:
      server: web-1
      threshold: 80
env:
  TZ: Asia/Shanghai

nodes:
  - id: check
    name: 检查磁盘
    run: |
      const fs = require('node:fs')
      const used = 92
      fs.writeFileSync(process.env.WF_OUTPUT, JSON.stringify({ used }))
    runtime: node

  - id: cleanup
    name: 清理临时文件
    needs: [check]
    if: ${{ nodes.check.outputs.used > 80 }}
    uses: server-management.exec
    with:
      server: ${{ inputs.server }}
      command: "rm -rf /tmp/cache/*"
    approval: always
    timeout: 5m

  - id: verify
    name: 复查
    needs: [cleanup]
    if: ${{ always() }}
    run: |
      const used = 42
      fs.writeFileSync(process.env.WF_OUTPUT, JSON.stringify({ used }))
    runtime: node

outputs:
  used: ${{ nodes.verify.outputs.used }}
```

更多示例见 [examples/server-maintenance.yml](examples/server-maintenance.yml) 和 [examples/nightly-report.yml](examples/nightly-report.yml)。

> 示例里的 `notification.send`、`cos.*` 是动作示意；实际可用动作以 Action Registry 返回的列表为准。

### 4.2 顶层字段

| 字段 | 说明 |
| --- | --- |
| `name` | 工作流名称 |
| `description` | 描述，AI 生成时使用 |
| `on` | 触发器：`manual` / `schedule` / `webhook` |
| `env` | 全局环境变量 |
| `defaults` | 默认 `timeout`、`retries`、`continue-on-error` |
| `nodes` | 节点列表，见下 |
| `outputs` | 工作流最终输出，表达式映射 |

### 4.3 节点字段

| 字段 | 说明 |
| --- | --- |
| `id` | 唯一 ID，DAG 内引用 |
| `name` | 显示名 |
| `needs` | 前置节点 ID 列表，决定边 |
| `if` | 条件表达式；不满足则跳过 |
| `run` | 脚本内容；与 `uses` 二选一 |
| `runtime` | `node`（默认）/ `bash` / `python` |
| `uses` | 插件动作 ID，例如 `cos.upload`；与 `run` 二选一 |
| `with` | 动作输入，支持表达式 |
| `env` | 节点环境变量 |
| `timeout` | 节点超时，如 `10m` |
| `retries` | 失败重试次数，默认 0 |
| `continue-on-error` | 失败后是否继续下游 |
| `approval` | `never` / `always` / `dangerous`；动作也可声明默认策略 |

### 4.4 表达式

支持一个**安全的表达式子集**，不执行任意 JS：

- `${{ inputs.name }}`
- `${{ env.TZ }}`
- `${{ secrets.API_TOKEN }}`
- `${{ nodes.check.outputs.used }}`
- `${{ run.id }}`、`${{ run.trigger }}`
- `${{ always() }}`、`${{ success() }}`、`${{ failure() }}`
- 比较、布尔、算术：`> < >= <= == != && || ! + - * /`
- 字符串/数字/布尔字面量

实现建议：`jsep` 解析 AST + 自定义变量解析器；禁止函数调用、属性访问白名单、原型链；求值失败直接报错并标红节点。

### 4.5 脚本协议

每个脚本节点拿到：

| 环境变量 | 含义 |
| --- | --- |
| `WF_NODE_ID` | 当前节点 ID |
| `WF_RUN_ID` | 运行 ID |
| `WF_WORKSPACE` | 当前运行工作目录 |
| `WF_INPUTS` | 输入 JSON 文件路径（工作流 inputs、env、needs 输出） |
| `WF_OUTPUT` | 输出 JSON 文件路径；脚本写这里 |

约定：

- 退出码 `0` 成功；非 `0` 失败。
- 输出必须是合法 JSON；缺省视为 `{}`。
- `stdout/stderr` 作为日志流；输出不要混在 stdout。
- 单节点脚本 ≤ 256KB；输出 ≤ 1MB；日志 ≤ 10MB（超出截断）。
- 脚本在独立工作目录运行；路径穿越和 `file` 引用必须校验。

### 4.6 触发器

| 触发器 | 说明 |
| --- | --- |
| `on.manual` | 控制台或 AI 手动运行；可定义 inputs |
| `on.schedule` | Cron + 时区；可为定时运行提供固定 `inputs`；由宿主定时器计算 next_run |
| `on.webhook` | 生成一次性 token；`POST /console-api/workflows/hooks/:token` 触发；可选 HMAC |

第一版只支持 manual + schedule；webhook 放 P1/P2。

### 4.7 校验规则

- 节点 ID 唯一；`needs` 存在；无环。
- `run` 与 `uses` 必须二选一；`uses` 必须在 Action Registry 中。
- 动作输入按 JSON Schema 校验；必填、类型、枚举。
- 表达式引用的 `inputs` / `nodes` / `env` / `secrets` 必须存在。
- 脚本 runtime 在允许列表内；脚本大小/超时/重试在范围内。
- 触发器和 outputs 合法。
- 校验返回 `{ level, nodeId, path, message }`，前端定位到节点/字段，AI 据此修复。

### 4.8 与 GitHub Actions 的异同

相同：

- `on` / `env` / `needs` / `if` / `uses` / `run` 的语义接近
- 表达式使用 `${{ }}`
- 节点有超时、重试、失败继续

不同：

- **扁平 `nodes` + `needs`**，不是 `jobs`/`steps`；每个节点直接对应 React Flow 的一个节点
- `uses` 除了官方 action，主要指向 **CES 插件注册的动作**
- 表达式只支持安全子集，不做任意 JS 求值
- 没有 `matrix`；批量/循环后续用 `foreach` 或脚本解决
- 没有 Runner/市场；动作由本机插件提供
- `needs` 是显式 DAG，允许任意无环依赖，不局限于 steps 顺序

### 4.9 文件形态与版本

工作流以 **YAML 文件**为一等公民：

- 默认目录：`$DSH_HOME/workflows/`
- 文件名：`<workflow-id>.yml`
- 文件可放进 Git 工作区做版本管理；不强制
- DB 的 `workflows` 表保存 id、名称、文件路径、当前 hash；`workflow_versions` 保存每次保存时的 YAML 快照
- 运行绑定版本快照，不直接读实时文件，保证可复现
- AI 通过 `workflow_save` 写入文件并生成版本；也可以由用户在会话工作区直接编辑 YAML 后导入
- 导入/导出就是复制 YAML 文件；不需要专门的二进制格式

这样做的好处：

- AI 生成的是可读、可 diff、可提交的文件
- 运行历史能对应到确定的文件版本
- 用户可以用 Git、编辑器、AI 三种方式修改同一份定义

## 5. 执行模型

### 5.1 运行状态

```text
queued → running → succeeded
                 ├→ failed
                 ├→ cancelled
                 └→ skipped (节点级)
```

运行状态与节点状态分开存储；节点失败不一定让整个运行失败（取决于 `continue-on-error` 和下游 `if`）。

### 5.2 调度

- 解析 DAG；入度为 0 的节点进入 ready 队列。
- 每完成一个节点，递减下游入度；ready 节点按 `id` 稳定排序。
- 全局并发上限（默认 4），节点级并发受 `max-parallel` 控制。
- 单进程执行器 + Postgres 状态；不需要 Redis/Celery。
- 多实例部署时用 Postgres advisory lock 领取运行；第一版单实例可省略。

### 5.3 节点执行

1. 解析 `if`；false → `skipped`。
2. 解析 `with`/`env`/表达式；失败 → `failed`。
3. 需要审批时调用 CES approval；拒绝 → `failed`（`approval_denied`）。
4. 脚本节点：写临时脚本文件 → `spawn` 对应 runtime → 收集 stdout/stderr → 读 `WF_OUTPUT`。
5. 动作节点：调用注册的 `run(input, context)`；输出 JSON。
6. 超时/取消：kill 进程组；标记 `cancelled`。
7. 重试：仅对可重试错误（超时、5xx、动作声明可重试）；默认不重试脚本。
8. 写 `workflow_run_nodes` 状态、耗时、退出码、输出、日志路径。

### 5.4 日志与产物

- 每个节点日志写 `$DSH_HOME/workflows/runs/<runId>/<nodeId>.log`。
- SSE 推送 `node.started`、`node.log`、`node.finished`、`run.finished`。
- 运行工作目录 `$DSH_HOME/workflows/runs/<runId>/workspace`；脚本可写。
- 产物目录 `workspace/artifacts`；运行结束后可下载；默认保留 7 天，定时清理。
- 日志中 secrets 做掩码；动作输出标记 `secret` 的字段不返回 AI。

### 5.5 恢复与取消

- 进程重启后，`running` 运行标记为 `interrupted`；第一版不自动恢复，用户可重跑。
- 取消：停止调度；向子进程发送 `SIGTERM`，超时后 `SIGKILL`；已成功节点保留结果。
- 重跑：从失败节点重跑（P2）或整单重跑（P1）。

### 5.6 资源限制

| 项 | 默认 |
| --- | --- |
| 单节点超时 | 10 分钟，最大 1 小时 |
| 单运行超时 | 4 小时 |
| 单运行节点数 | 100 |
| 运行并发 | 4 |
| 节点并发 | 4 |
| 脚本大小 | 256KB |
| 单节点输出 | 1MB |
| 单节点日志 | 10MB |
| 保留 | 运行/日志 7 天，产物 7 天 |

## 6. 插件接入

### 6.1 服务与注册表

工作流插件提供一个 Cordis 服务 `workflow`：

```ts
export interface WorkflowAction {
  id: string                    // server-management.exec
  version: string               // 1
  title: string
  description: string
  category: string              // server / storage / network / ai
  icon?: string
  inputSchema: JsonSchema
  outputSchema?: JsonSchema
  approval?: 'never' | 'always' | 'dangerous'
  run(input: JsonValue, ctx: WorkflowActionContext): Promise<JsonValue>
}
```

其他插件：

```ts
export const inject = ['workflow']

export function apply(ctx: Context) {
  ctx.workflow.registerAction({
    id: 'server-management.exec',
    version: '1',
    title: '在服务器执行命令',
    category: 'server',
    inputSchema: {
      type: 'object',
      required: ['server', 'command'],
      properties: {
        server: { type: 'string' },
        command: { type: 'string' },
      },
    },
    approval: 'always',
    async run(input, context) {
      return ctx.serverManagement.exec(input.server, input.command, context.signal)
    },
  })
}
```

要点：

- 插件**不 import 工作流内部实现**，只通过服务注册。
- 注册返回 disposer；插件卸载时动作消失。
- 动作 ID 带版本：`uses: server-management.exec@1`；未指定时用最新已注册版本。
- 动作缺失/版本不匹配时，工作流校验失败，不会静默跳过。
- 动作的 `inputSchema` 同时用于前端表单、AI 生成和运行前校验。

### 6.2 可注册什么

其他插件可以注册：

- 单步动作：执行命令、上传 COS、改 DNS、发通知。
- 查询动作：列服务器、查状态、查审计。
- 复合动作：部署、回滚、备份（插件内部可以再做编排）。
- 工作流自身也可以注册 `workflow.run`，把另一个工作流作为节点；需要限制递归深度和禁止环。

### 6.3 审批与 secrets

- 动作声明 `approval`；运行器在动作执行前调用现有 approval 服务。
- 工作流节点也可覆盖 `approval`，取更严格者。
- 动作声明需要的 secrets（如 `server-management.ssh_key`）；工作流用 `${{ secrets.NAME }}` 引用；运行器只解析实际用到的 secrets。
- 动作输出中标记 `secret` 的字段不写日志、不返回 AI、不入审计详情。

### 6.4 插件加载顺序

- 工作流插件通过 `inject: ['workflow']` 让其他插件可选依赖。
- 工作流未安装时，其他插件不注册动作，功能不受影响。
- 动作注册表在启动后动态可用；前端 `/actions` 接口返回当前可用动作和 schema。

### 6.5 ComfyUI 节点（方案 A）

ComfyUI 采用**方案 A**：ComfyUI 服务器只做算力/模型服务；Runner 持有 API 格式模板并直接调用 `/prompt`，不依赖 ComfyUI UI 里的 workflow 文件。

```yaml
- id: generate
  name: 生成图片
  uses: comfyui.run
  with:
    endpoint: gpu-01
    template: comfy/portrait-v3.api.json
    bindings:
      "6.inputs.text": ${{ inputs.prompt }}
      "3.inputs.seed": ${{ inputs.seed }}
    timeout: 15m
  outputs:
    images: ${{ nodes.generate.outputs.images }}
```

节点要点：

- `endpoint` 是 Runner 本地端点注册表 ID，不是任意 URL
- `template` 是随工作流包发布的 **API 格式 JSON**（ComfyUI `Save (API Format)` 导出）
- `bindings` 按 `<nodeId>.inputs.<field>` 绑定参数，不做字符串替换
- `uploads` 用于参考图：Runner 先 `POST /upload/image`，再绑定返回的文件名
- Runner 负责 `/prompt` 提交、WebSocket 进度、`/history` 结果、`/view` 下载、取消/超时
- 产物存 Runner artifacts，是否上传 COS 由后续 `cos.upload` 节点决定
- 模板 manifest/hash、ComfyUI 版本、`object_info` hash 记入运行记录
- 端点并发默认 1；多 GPU 注册多个端点

完整设计见 [ComfyUI 服务器与 API 模板设计](../comfyui/README.md)。

## 7. AI 会话生成工作流

### 7.1 Harness 工具

| 工具 | 作用 |
| --- | --- |
| `workflow_actions_list` | 列出可用动作、分类、输入 schema |
| `workflow_get` | 读取工作流 YAML + 版本 |
| `workflow_validate` | 校验 YAML，返回带节点/字段定位的错误 |
| `workflow_save` | 保存草稿（不运行） |
| `workflow_run` | 运行工作流（需要用户审批） |
| `workflow_runs_get` | 查看运行状态、节点结果、日志摘要 |

### 7.2 生成流程

```text
用户描述需求
  → AI 调用 workflow_actions_list
  → AI 写 YAML
  → workflow_validate
  → 有错则修复（循环）
  → workflow_save（草稿）
  → 用户在 React Flow 查看/修改
  → 用户点运行或 AI 调 workflow_run（审批）
```

### 7.3 约束

- AI 不直接拿到 secrets 值，只能引用名称。
- AI 生成的脚本默认需要运行审批；危险动作 `approval: always`。
- `workflow_save` 只保存草稿，不自动发布/运行。
- 保存时做 diff，UI 高亮 AI 修改；用户可回滚。
- 大工作流建议 AI 分步生成，先骨架后节点，避免一次输出过长。
- DSL 文档和动作目录应作为工具描述/系统提示的一部分，减少瞎编。

## 8. 前端可视化

### 8.1 技术选型

- `@xyflow/react`（React Flow）
- `dagre` 或 `elkjs` 自动布局
- 代码编辑：CodeMirror 6（YAML / JS / Python）
- 表单：JSON Schema 渲染（动作 `with` 字段）
- 实时：SSE（事件）+ 轮询兜底
- 组件复用 `@smp/console-kit`

### 8.1.1 页面布局

| 区域 | 内容 |
| --- | --- |
| 顶部栏 | 名称、版本、保存、运行/取消、YAML 模式、更多 |
| 左侧 | 节点面板：脚本节点、已注册动作、模板；可搜索/分类 |
| 中间 | React Flow 画布；缩放、MiniMap、自动整理 |
| 右侧 | 检查器：配置/脚本/动作表单/输出/变量选择器 |
| 底部抽屉 | 运行日志、节点耗时、失败详情、时间线 |

默认是“画布 + 右侧检查器 + 底部日志”，不把所有信息塞进节点卡片；节点卡片只显示标题、类型、状态和关键徽标。

```text
┌──────────────────────────────────────────────────────────────┐
│ 服务器巡检  v3        [保存] [运行] [YAML] [更多]             │
├──────────┬───────────────────────────────────┬───────────────┤
│ 节点面板 │  [check] ──→ [cleanup] ──→ [verify] │ 检查器        │
│          │       ╲                           │ 配置/脚本/动作 │
│ 脚本     │        ╲──→ [notify]              │ 输出/变量      │
│ 动作     │                                   │               │
│ 触发器   │        （React Flow 画布）         │               │
├──────────┴───────────────────────────────────┴───────────────┤
│ 运行日志 / 节点耗时 / 失败详情 / 时间线                        │
└──────────────────────────────────────────────────────────────┘
```

### 8.2 节点视觉

每个节点是一张卡片：

```text
┌─────────────────────────────┐
│ [icon] 检查磁盘        [脚本] │
│ node: check                 │
│ 状态：成功 · 1.2s           │
└─────────────────────────────┘
```

- 左侧色条区分类型：触发器 / 脚本 / 动作；审批、重试、超时是徽标
- 图标来自动作元数据或 runtime
- 徽标：`approval`、`retries`、`timeout`、`secret`
- 运行态：边框呼吸/旋转、成功绿色、失败红色、跳过灰色
- 失败节点显示错误摘要，点击打开日志

### 8.3 边与布局

- `needs` 生成实线边；`if` 表达式显示为边标签/虚线
- 自动布局：从左到右按拓扑层级；用户拖动后保存 `ui.position`（不进 DSL，单独存 UI 元数据）
- 支持“自动整理”、缩放、MiniMap、框选、对齐
- 大图只渲染可视区域（`onlyRenderVisibleElements`）

### 8.4 检查器

右侧面板按节点显示：

- **配置**：`id/name/needs/if/timeout/retries/approval`
- **脚本**：CodeMirror，运行时选择、示例、格式化
- **动作**：根据 `inputSchema` 生成表单 + JSON 模式
- **输出**：最近一次运行的 outputs 预览
- **变量选择器**：从 `inputs/env/nodes.*.outputs` 插入表达式

### 8.5 运行视图

- 顶部：运行/取消/重跑；inputs 表单；触发器信息
- 画布：节点状态实时更新；失败路径高亮
- 底部抽屉：日志流、节点耗时、退出码、输出
- 时间线：节点开始/结束/重试的甘特式视图（P2）
- 失败节点可“从该节点重跑”（P2）

### 8.6 版本与 AI diff

- 左侧版本列表：草稿/已保存版本；可对比
- YAML 双栏 diff；AI 修改高亮
- 运行记录绑定版本；可回答“这次运行为什么和上次不同”
- 回滚到旧版本（生成新版本，不删除历史）

### 8.7 空状态与模板

提供 3–5 个模板：

- 服务器巡检/清理
- COS 发布（构建 → 上传 → 校验）
- 域名切换（DNS 修改 → 验证 → 通知）
- 每日报表（查询 → 汇总 → 通知）

模板就是普通 YAML，可被 AI 复制修改。

## 9. 数据模型

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `workflows` | `id, name, description, path, current_version, enabled, created_at, updated_at` | 工作流索引；YAML 文件为主 |
| `workflow_versions` | `id, workflow_id, version, yaml, hash, created_by, created_at` | 不可变版本；保存即新版本 |
| `workflow_runs` | `id, workflow_id, version, status, trigger, inputs, actor, started_at, finished_at, error, workspace` | 一次运行 |
| `workflow_run_nodes` | `run_id, node_id, status, attempt, started_at, finished_at, exit_code, outputs, error, log_path` | 节点级状态 |
| `workflow_schedules` | `workflow_id, cron, timezone, next_run_at, enabled` | 定时触发器 |
| `workflow_webhooks` | `workflow_id, token_hash, enabled, created_at` | Webhook 触发器 |
| `workflow_artifacts` | `run_id, node_id, path, size, expires_at` | 产物索引 |

- 工作流定义以 `$DSH_HOME/workflows/<id>.yml` 文件为准；DB 存索引、hash 和版本快照。
- 解析后的 JSON 只作缓存；保存时先校验再落文件。
- UI 位置不入 DSL；单独 `ui` 字段或 `workflow_versions` 的旁路表。
- 运行日志/产物放文件系统；DB 只存路径和状态。
- secrets 继续用现有 secrets 服务，不新建明文表。

## 10. 安全

1. **脚本是任意代码**：默认需要运行审批；AI 生成的脚本必须人工确认；显示脚本 diff。
2. **子进程隔离**：独立工作目录、最小环境变量、进程组 kill、超时、输出上限。
3. **容器沙箱（P2）**：通过 CES 容器运行时把脚本放进 `node:22` / `python:3.11` 容器；默认禁网或按节点声明网络；挂载运行工作目录；限制 CPU/内存。
4. **路径校验**：`file` 引用、产物路径、工作目录不允许 `..` 和绝对路径逃逸。
5. **secrets**：只解析引用到的 secrets；日志掩码；不返回 AI；审计不记录值。
6. **动作审批**：危险动作默认 `always`；审批展示动作、目标、参数摘要。
7. **Webhook**：随机 token、哈希存储、限流、可选 HMAC；不暴露内部 ID。
8. **审计**：创建/修改/保存/运行/取消/审批/动作执行都写入现有审计；记录 actor（用户/工具）。
9. **AI 工具**：写操作需要审批；不允许 AI 读取 secrets；运行/发布分离。

## 11. 性能与容量

- 单用户场景，瓶颈是脚本和外部 API，不是调度器。
- 子进程启动开销约几十毫秒；20 节点 DAG 的调度开销可忽略。
- 单进程并发 4；CPU 密集脚本通过子进程并行，避免阻塞事件循环。
- Postgres 状态更新逐节点写入；运行历史查询按 `workflow_id, started_at` 索引。
- React Flow 100 节点以内流畅；超过 200 节点建议折叠/分组。
- 后续需要更高并发时，可把执行队列换成 BullMQ/pg-boss，DSL/UI 不变；不建议一开始上 Temporal。

## 12. 实施顺序（2026-11-03 调整）

**先做 ComfyUI，Workflow 暂缓。** ComfyUI 的 API 契约、模板格式、认证、产物和监控是工作流节点的前置依赖；这些不稳定，工作流节点设计会反复改。

### 12.1 先行：ComfyUI（C0 / C1）

**C0：ComfyUI 服务器**

- GPU 服务器、Docker/系统服务、反向代理认证
- 模型/自定义节点固定版本
- `/system_stats`、`/object_info`、`/queue` 健康检查
- 导出一个 API 格式模板（txt2img）并验证 `/prompt`
- 日志、清理、基础监控

**C1：Runner 的 `comfyui.run`**

- 端点注册表、认证、并发=1
- 模板/manifest 校验
- 提交、WS 进度、history、产物下载
- 超时、取消、Runner 重启恢复
- 指标/日志/告警

C1 完成后，先用一个独立小工具验证：

```text
API 模板 → Runner → ComfyUI → 图片 → Runner artifact
```

### 12.2 暂缓：Workflow

以下设计保留，但不在本轮实施：

- YAML DSL、脚本节点、`needs`/`if`
- Action Registry、其他插件动作
- React Flow 编辑器
- AI 生成工作流
- 定时/Webhook、版本、diff

恢复条件：

1. ComfyUI API/模板契约稳定，C1 端到端通过
2. 模板/端点/产物的版本和监控有明确约定
3. 确认 Workflow Runner 的控制面/执行面边界

### 12.3 恢复后的阶段

**P1：Workflow MVP**

- YAML DSL + 校验器
- 脚本节点、`needs`/`if`、并行/超时
- Action Registry + `comfyui.run` + `server-management.exec` + `cos.upload`
- React Flow 只读/基础编辑
- 运行历史、日志、审批

**P2：增强**

- 定时/Webhook、重试、取消、失败节点重跑
- 版本 diff、产物、容器沙箱
- AI 工具：list/get/validate/save/run

**P3：可选**

- `foreach`/`matrix`/子工作流
- 内部模板市场
- 分布式执行（如确有需要）

## 13. 风险与备选

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 脚本安全 | 任意代码执行 | 审批 + 子进程隔离；P2 容器沙箱 |
| DSL 设计过度 | 学习成本回升 | 只保留 `needs/if/run/uses/with`；控制节点类型数量 |
| 动作 schema 不统一 | UI/校验困难 | 强制 JSON Schema；注册时校验 |
| AI 生成错误 | 工作流不可用 | `validate` 工具 + 定位错误 + 人工 review |
| React Flow 大图性能 | 卡顿 | 自动布局、折叠、只渲染可视区域 |
| 长任务/重启 | 运行中断 | 状态落库；标记 interrupted；P2 恢复 |
| 依赖外部动作 | 动作缺失 | 版本化动作 ID；校验失败明确报错 |

**备选**：如果后续确实需要企业级持久化/重试/分布式，可把执行层换成 Temporal，DSL 和 React Flow 保持不变；不建议现在引入。

## 14. 待确认

1. 脚本运行时是否只支持 Node/Bash/Python，还是需要 PowerShell？
2. 第一版是否就上容器沙箱，还是先子进程 + 审批？
3. 动作审批粒度：按动作、按节点、按运行？
4. 运行/日志/产物保留多久？是否需要手动清理？
5. 定时器时区是否统一 `Asia/Shanghai`？
6. 工作流是否需要“环境/变量组”（dev/prod）？
7. AI 是否可以自动运行低风险工作流，还是所有运行都要审批？
8. 动作 ID 是否现在就引入版本号，还是先单版本？

## 附录：相关文件

- [服务器巡检示例](examples/server-maintenance.yml)
- [COS 发布示例](examples/nightly-report.yml)
- 现有插件规范：[docs/spec/plugins.md](../../spec/plugins.md)
- 现有插件地图：[docs/framework/architecture/plugin-map.md](../../framework/architecture/plugin-map.md)
- 现有审批/审计：[plugins/cos/src/host/approval.ts](../../../plugins/cos/src/host/approval.ts)、[plugins/cos/src/host/audit.ts](../../../plugins/cos/src/host/audit.ts)
