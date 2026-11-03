# ComfyUI 服务器与 API 模板设计

- 状态：方案草案，先行设计
- 日期：2026-11-03
- 分支：`feat/workflow`
- 范围：独立部署的 ComfyUI GPU 服务器、API 模板契约、认证/监控/产物；不包含工作流引擎本身
- 关联：[极简脚本工作流方案](../script-workflow/README.md)
- 结论：采用 **方案 A**——ComfyUI 只做算力/模型服务；工作流 Runner 持有 **API 格式模板**，直接调用 ComfyUI `/prompt`，不依赖 ComfyUI UI 里的 workflow 文件

## 1. 目标与非目标

### 目标

1. 在一台独立的 GPU 服务器上部署 ComfyUI，作为 CES/工作流 Runner 的模型执行服务。
2. 明确定义 Runner 调用 ComfyUI 的 API 契约：提交、进度、产物、取消、错误。
3. 工作流模板以 **API 格式 JSON** 为准，由 Runner 随工作流包发布；ComfyUI 服务器不承担工作流定义管理。
4. 支持认证、内网访问、版本固定、模型/自定义节点校验、监控和故障恢复。
5. 保证 CES 挂掉时，Runner 仍可直连 ComfyUI 执行。

### 非目标

- 不在 ComfyUI 服务器上做工作流编辑、版本管理、AI 生成。
- 不把 ComfyUI UI 里的 workflow JSON 当作运行时契约。
- 不做多租户、计费、模型训练、自定义节点市场。
- 不在第一版做多机多卡调度；先一机一卡/一机多实例。

## 2. 总体架构

```text
CES（控制面）
  ├─ 服务器管理：部署/启动/停止 ComfyUI，登记端点
  ├─ 模板管理：随工作流包发布 API 模板
  └─ 监控：查看 Runner/端点状态（可降级）
        │
        │ 只做部署和配置，不在运行路径上
        ▼
Workflow Runner（后续实施）
  ├─ 本地模板目录 comfy/*.api.json
  ├─ 本地端点配置/密钥
  └─ comfyui.run action ── HTTPS/WS ──► ComfyUI Server
                                          ├─ 反向代理 / 认证
                                          ├─ ComfyUI API
                                          ├─ 模型 / 自定义节点
                                          └─ GPU
```

原则：

- **ComfyUI 是执行器，不是工作流平台。**
- 模板在 Runner，模型在 ComfyUI；两边版本通过 manifest/hash 对齐。
- CES 只负责部署和发布；CES 不可用时 Runner 使用缓存继续跑。

## 3. ComfyUI 服务器设计

### 3.1 部署形态

- 一台独立 GPU 服务器；Docker 或系统服务运行 ComfyUI。
- 模型目录、自定义节点目录、输入/输出目录使用持久卷。
- 反向代理（Caddy/Nginx）提供 TLS、认证、请求大小限制、访问日志。
- 只暴露内网/VPN；不对公网开放 UI 和 API。
- 每个 GPU 一个 ComfyUI 实例；多卡则多个实例/端点（`gpu-01`、`gpu-02`）。
- ComfyUI 版本、自定义节点版本、模型清单固定；升级走单独流程，不自动更新。

### 3.2 目录约定

```text
/opt/comfyui/
  models/                 # checkpoint、vae、lora、controlnet...
  custom_nodes/           # 固定版本，禁止运行时安装
  input/                  # 上传参考图
  output/                 # 生成结果
  user/default/workflows/ # 管理员 UI 工作流（仅用于导出 API 模板）
  logs/
```

- Runner 不直接读写这些目录；只通过 API。
- `input/`、`output/` 需要定期清理；Runner 下载产物后由 ComfyUI 清理策略处理。
- 自定义节点随镜像构建，不在运行时 `git clone`/`pip install`。

### 3.3 认证

ComfyUI 默认没有认证，必须：

- 放在反向代理后，使用 Bearer token / Basic Auth / mTLS。
- Runner 的端点配置里保存 token（Runner secret store）。
- ComfyUI 只监听内网地址；防火墙只允许 Runner 和运维网段。
- 管理 UI 可以保留，但只给管理员；与 Runner API 使用同一套认证。

### 3.4 健康检查

- `GET /system_stats`：设备、VRAM、队列等。
- `GET /object_info`：可用节点、模型枚举。
- `GET /queue`：当前队列。
- 反向代理健康检查可加 `/system_stats`（带认证）。

## 4. ComfyUI API 契约

| 用途 | 接口 | 说明 |
| --- | --- | --- |
| 提交任务 | `POST /prompt` | body：`{ prompt: <API JSON>, client_id }`；返回 `prompt_id`、`number`、`node_errors` |
| 实时事件 | `WS /ws?clientId=...` | `execution_start`、`executing`、`progress`、`executed`、`execution_error`、`execution_interrupted` |
| 查询结果 | `GET /history/{prompt_id}` | 节点输出、状态、错误 |
| 下载产物 | `GET /view?filename=&subfolder=&type=output` | 图片/文件 |
| 上传输入 | `POST /upload/image` | multipart；返回 `name/subfolder/type` |
| 节点信息 | `GET /object_info` | 校验 class_type、模型枚举、输入字段 |
| 队列 | `GET /queue` | 查看排队/运行中的 prompt |
| 中断 | `POST /interrupt` | 中断当前执行 |
| 删除排队 | `POST /queue` | body `{ delete: [prompt_id] }` |
| 系统状态 | `GET /system_stats` | GPU/VRAM/版本 |

注意：

- `/prompt` 只接受 **API 格式**，即 `{ "3": { "class_type": "...", "inputs": {...} } }`；不接受 UI 的 `nodes/links`。
- `client_id` 由 Runner 生成 UUID，用于关联 WS 事件。
- API 版本随 ComfyUI 固定；升级前用回归模板验证。

## 5. API 模板契约（方案 A）

### 5.1 模板来源

- 管理员在 ComfyUI UI 里搭建/调试工作流。
- 通过 **Save (API Format)** 导出 `*.api.json`。
- 导出文件随工作流包提交到 Runner 的 `comfy/` 目录；不把 UI workflow 作为运行时输入。
- Runner 保存模板 hash；运行记录绑定 hash，保证可复现。

### 5.2 模板目录

```text
workflows/<workflow-id>/
  workflow.yml
  comfy/
    portrait-v3.api.json
    portrait-v3.manifest.json
```

### 5.3 manifest

```json
{
  "name": "portrait-v3",
  "version": 3,
  "api": "portrait-v3.api.json",
  "hash": "sha256:...",
  "requires": {
    "comfyui": ">=0.3 <0.4",
    "classTypes": ["CheckpointLoaderSimple", "CLIPTextEncode", "KSampler", "VAEDecode", "SaveImage"],
    "models": ["flux1-dev.safetensors"]
  },
  "inputs": {
    "type": "object",
    "required": ["prompt", "seed"],
    "properties": {
      "prompt": { "type": "string" },
      "negative": { "type": "string", "default": "" },
      "seed": { "type": "integer" },
      "steps": { "type": "integer", "default": 28 },
      "reference": { "type": "string", "format": "artifact" }
    }
  },
  "bindings": {
    "6.inputs.text": "prompt",
    "7.inputs.text": "negative",
    "3.inputs.seed": "seed",
    "3.inputs.steps": "steps"
  },
  "uploads": {
    "10.inputs.image": "reference"
  },
  "outputs": {
    "images": "9.images"
  }
}
```

### 5.4 绑定规则

- `bindings` 的 key 是 API JSON 的路径：`<nodeId>.inputs.<field>`。
- value 是节点输入名（来自 `inputs` schema），不是任意字符串替换。
- `uploads` 用于 `LoadImage` 等需要先上传文件的字段；Runner 调 `/upload/image`，把返回的 `name/subfolder/type` 写入该路径。
- 绑定路径必须存在于模板；类型必须匹配；必填项缺失直接失败。
- 不允许模板里出现不受控的 `class_type` 注入；模板来自可信包。
- 输出选择：`outputs.images` 指向 `history` 里的节点输出，例如 `9.images`；也支持返回所有 `images`。

### 5.5 模板校验

运行前：

1. 校验 manifest schema。
2. 校验 API JSON 的节点和字段。
3. `GET /object_info`：
   - 所有 `class_type` 存在
   - 模型枚举包含 manifest 声明的模型
   - 输入字段类型匹配
4. 校验模板 hash 与 manifest 一致。
5. 记录 ComfyUI 版本、`object_info` hash、模型清单 hash。

任何一项失败都提前报错，不提交任务。

## 6. Runner 侧 `comfyui.run` 节点

### 6.1 YAML

```yaml
- id: generate
  name: 生成图片
  uses: comfyui.run
  with:
    endpoint: gpu-01
    template: comfy/portrait-v3.api.json
    bindings:
      "6.inputs.text": ${{ inputs.prompt }}
      "7.inputs.text": ${{ inputs.negative }}
      "3.inputs.seed": ${{ inputs.seed }}
      "3.inputs.steps": 28
    uploads:
      "10.inputs.image": ${{ inputs.reference }}
    timeout: 15m
  outputs:
    images: ${{ nodes.generate.outputs.images }}
```

### 6.2 执行流程

1. 解析 `endpoint` → Runner 本地端点配置（URL/token/超时/并发）。
2. 加载模板和 manifest，校验。
3. `GET /system_stats`、`GET /object_info` 预检。
4. 处理 `uploads`：`POST /upload/image`，绑定返回的文件名。
5. 解析 `bindings`，生成完整 API JSON。
6. `POST /prompt`，拿到 `prompt_id`；**立即持久化**。
7. 连接 `WS /ws?clientId=...`，转发进度到 Runner 事件流。
8. 完成后 `GET /history/{prompt_id}`，下载 `outputs`。
9. 产物写 Runner artifact 目录，记录 hash/尺寸/MIME。
10. 返回 `images` 数组。

### 6.3 状态

```text
pending → submitting → queued → running → downloading → succeeded
                                              ├→ failed
                                              ├→ cancelled
                                              └→ interrupted
```

- `queued` 可显示 `/queue` 位置。
- `running` 更新 `progress`。
- 失败带 `prompt_id`、ComfyUI 节点 ID、错误类型。

### 6.4 超时/取消/恢复

- 超时：先 `POST /interrupt`，再 `POST /queue` 删除自己的 `prompt_id`；标记 `timeout`。
- 用户取消：同上；不要影响其他人的队列项。
- Runner 重启：
  - 有 `prompt_id` → `GET /history/{prompt_id}` 补收；仍在跑 → 重连 WS；已丢失 → `interrupted`。
  - 没有 `prompt_id` → 无法恢复，标记失败。
- ComfyUI 重启/任务丢失 → 节点失败，记录端点不可用。
- 不自动重试超时/失败任务；重试会产生新的 GPU 任务和费用，必须显式。

### 6.5 并发

- 每个端点默认 `maxConcurrency: 1`；GPU 任务串行。
- 多 GPU → 多端点；Runner 按端点信号量调度。
- 队列长度、等待时间作为指标；超过阈值告警。
- 不要让多个工作流同时把大量任务塞进同一个 ComfyUI 队列。

## 7. 产物

- Runner 下载 `/view` 返回的图片，保存到 `runs/<runId>/artifacts/comfyui/`。
- 校验 content-type、大小、扩展名；计算 sha256。
- 返回结构：

```json
{
  "promptId": "...",
  "template": "portrait-v3@3",
  "templateHash": "...",
  "images": [
    { "path": "artifacts/comfyui/0001.png", "width": 1024, "height": 1024, "sha256": "..." }
  ]
}
```

- 是否上传 COS 由后续 `cos.upload` 节点决定；ComfyUI 节点不直接持有 COS 凭据。
- PNG 可能内嵌 workflow/prompt 元数据；按隐私要求决定是否剥离。
- 产物默认保留 7 天，由 Runner 清理任务删除。

## 8. 监控

### 8.1 ComfyUI 侧

- `/system_stats`：GPU、VRAM、队列。
- 反向代理访问日志：请求量、延迟、错误。
- ComfyUI 日志：执行错误、OOM、模型加载失败。
- 可选 sidecar/exporter 把 ComfyUI 指标转 Prometheus；没有原生 metrics 时用轮询 `/system_stats` + `/queue`。

### 8.2 Runner 侧

指标：

```text
comfyui_jobs_total{endpoint,status}
comfyui_queue_wait_seconds
comfyui_execution_seconds
comfyui_download_seconds
comfyui_errors_total{type}
comfyui_endpoint_up{endpoint}
comfyui_progress
```

日志字段：`run_id`、`node_id`、`endpoint`、`prompt_id`、`template`、`template_hash`、`comfyui_version`。

### 8.3 告警

- 端点不可用（`/system_stats` 连续失败）
- 队列等待超过阈值
- 执行失败率/OOM
- 模板校验失败（模型/自定义节点缺失）
- Runner 心跳丢失
- 任务超时/卡死

告警由 Runner/外部 Prometheus/Alertmanager 直接发出，不依赖 CES。

## 9. 安全

- ComfyUI 不直接暴露公网；反向代理认证 + 内网访问。
- Runner 只访问端点注册表中的地址，禁止用户/AI 任意填 URL（防 SSRF）。
- 模板来自可信工作流包；禁止运行时注入 `class_type`/模型路径。
- 上传图片校验 MIME/大小/文件名；不使用原始文件名拼接路径。
- 自定义节点和模型是供应链的一部分：镜像固定、版本固定、升级需回归。
- 产物下载校验大小/类型；不把 ComfyUI 的临时路径暴露给浏览器。
- Secrets（ComfyUI token、后续 COS 凭据）存 Runner secret store，不写 YAML/日志。

## 10. 故障与恢复

| 故障 | 表现 | 处理 |
| --- | --- | --- |
| ComfyUI 进程挂 | 端点 health 失败 | Runner 节点失败；告警；重启后重试 |
| GPU OOM | `execution_error` | 标记失败；提示降低分辨率/模型；不自动重试 |
| 队列卡住 | 长时间 `queued` | 查 `/queue`；删除自己的任务；告警 |
| Runner 重启 | 运行中断 | 按 `prompt_id` 补收；丢失标记 interrupted |
| 模板与服务器不匹配 | 预检失败 | 提前报错；列出缺失节点/模型 |
| 网络分区 | 提交/WS 失败 | 节点失败；不重复提交；人工重试 |

## 11. 实施顺序

### C0：ComfyUI 服务器（先行）

- GPU 服务器、Docker/系统服务、反向代理认证
- 模型/自定义节点固定版本
- `/system_stats`、`/object_info`、`/queue` 健康检查
- 导出一个 API 格式模板（txt2img）并验证 `/prompt`
- 监控/日志/清理策略

### C1：Runner 的 `comfyui.run`

- 端点注册表、认证、并发=1
- 模板/manifest 校验
- 提交、WS 进度、history、产物下载
- 超时/取消/重启恢复
- 指标/日志

### C2：增强

- 图生图/上传参考图
- 多模板、多端点、队列指标
- 批量/多图
- 产物清理、保留策略
- 模板目录/管理员 UI（可选）

### 与 Workflow 的关系

- **工作流方案暂缓**，等 C0/C1 的 API 契约稳定后再继续。
- 先做 ComfyUI 服务器和 `comfyui.run`，可以独立验证模板、认证、GPU、产物、监控。
- 工作流 DSL/React Flow/AI 生成保留设计，但不在本轮实施。

## 12. 待确认

1. GPU 型号/显存、ComfyUI 版本、固定哪些自定义节点？
2. 模型清单和存放方式；是否允许用户上传模型？
3. 认证方式：反代 Basic Auth、Bearer token、mTLS？
4. 模板由谁维护：CES 工作流包，还是 ComfyUI 管理员导出后提交？
5. 端点数量/多卡策略；每个端点并发是否固定 1？
6. 产物保留多久；是否需要自动上传 COS？
7. 是否需要保留 ComfyUI UI 给管理员，还是只开 API？
8. 是否需要多租户/按用户隔离？当前按单用户设计。
