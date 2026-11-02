# Harness 服务器文件传输方案

- 状态：方案草案
- 日期：2026-10-22
- 分支：`ces/harness-integration`
- 范围：通过 Harness 工具在平台管理的服务器上传、下载文件

## 1. 目标

提供两个受控工具：

```text
platform_server_upload
platform_server_download
```

原则：

- 只操作平台登记的服务器
- 只接受服务器 ID 或名称，不接受任意 SSH 目标
- 复用平台保存的凭据
- 不在 Harness 与服务器之间手写 SFTP 协议
- 上传、下载都经过审批和审计
- 文件大小、路径和输出有硬上限
- 不把私钥、密码和完整 secret 返回给模型

## 2. 技术选型

使用现有 Node SSH 依赖：

```text
ssh2
```

原因：

- 服务器管理已经使用 `ssh2`
- `ssh2` 本身提供 SFTP 子系统
- 不需要新增协议实现
- 可以复用现有连接、指纹校验和错误模型

可选的更高层封装：

```text
ssh2-sftp-client
```

它简化了 `fastGet`、`fastPut`、`list` 等操作；如果采用，只允许作为 `ssh2` 之上的薄封装，不能绕过平台的连接和凭据边界。

不自己实现：

- SFTP 协议帧
- 分块握手
- 密钥交换
- 文件权限协议

这些由 `ssh2` 负责。

## 3. 工具定义

### 3.1 `platform_server_upload`

参数：

```ts
{
  server: string
  remote_path: string
  content_base64: string
  mode?: number
  overwrite?: boolean
}
```

也支持：

```ts
{
  server: string
  remote_path: string
  source_path: string
  mode?: number
  overwrite?: boolean
}
```

`source_path` 只允许指向 Harness 工作区内已经存在的文件；不接受服务器上的任意路径作为源。

约束：

- `content_base64` 和 `source_path` 二选一
- 默认不覆盖已有文件
- 默认权限 `0644`
- 文件大小默认限制 10 MiB
- 路径必须是绝对路径，或明确相对于 SSH 用户 home
- 不允许通过 `..` 越出允许根目录

返回：

```json
{
  "path": "/opt/app/config.yml",
  "bytes": 1234,
  "sha256": "...",
  "mode": "0644",
  "overwritten": false
}
```

### 3.2 `platform_server_download`

参数：

```ts
{
  server: string
  remote_path: string
  max_bytes?: number
  encoding?: "text" | "base64"
}
```

返回：

```json
{
  "path": "/var/log/app.log",
  "bytes": 1234,
  "sha256": "...",
  "content": "...",
  "encoding": "text",
  "truncated": false
}
```

大文件默认只返回摘要或写入 Harness 工作区，不直接把完整内容塞进模型上下文。

## 4. 传输流程

### 上传

```text
解析平台服务器
→ 校验路径和大小
→ 审批
→ 写 pending 审计
→ 建立 SSH
→ 打开 SFTP
→ 写入临时文件
→ 校验大小和 SHA-256
→ 原子 rename 到目标路径
→ 更新审计
→ 关闭 SFTP 和 SSH
```

临时文件建议：

```text
<remote_path>.smp-upload-<uuid>.part
```

失败时删除临时文件，避免留下半截文件。

### 下载

```text
解析平台服务器
→ 校验路径
→ 审批
→ 写 pending 审计
→ 建立 SSH
→ 打开 SFTP
→ 读取文件元数据和大小
→ 超限则拒绝或截断
→ 计算 SHA-256
→ 返回文本/base64 或写入 Harness 工作区
→ 更新审计
→ 关闭 SFTP 和 SSH
```

## 5. 安全边界

### 路径

- 工具不接受 host、port、username、password、private_key
- 服务器上的路径也不能用来指定另一台服务器
- 默认限制在 SSH 用户 home 或配置的允许根目录
- 拒绝包含 `..` 的越界路径
- 拒绝符号链接逃逸

### 内容

- 上传内容不落日志
- 下载内容在审计中只保存摘要和大小
- 私钥、密码、token 不返回给模型
- 下载文本可以做敏感信息脱敏，但不能保证识别所有 secret
- 二进制文件默认返回 base64，且受大小限制

### 审批

与 `platform_server_exec` 相同：

- 每次上传/下载都请求审批
- 无审批通道时拒绝
- 拒绝也写审计

## 6. 审计

文件传输复用统一审计表：

```text
server_audit_log
```

通过 `kind` 区分：

```text
kind = upload
kind = download
```

文件传输写入：

```text
kind
server_id / server_name / host
actor_id / actor_kind
harness_session_id / agent_id
tool_call_id / root_tool_call_id
remote_path
local_path
bytes
sha256
mode
overwrite
approval_status
status
error_code / error_message
started_at / finished_at
```

不记录：

- 文件全文
- 私钥
- 密码
- 完整 secret

命令审计和文件传输审计共用：

- 分页
- 时间筛选
- 类型筛选
- 会话关联
- 审批状态
- 状态和错误模型

## 7. 代码结构

建议新增：

```text
plugins/server-management/src/host/harness/
  transfer.ts         上传/下载入口
  transfer-path.ts    路径校验
  transfer-audit.ts   文件传输审计
  sftp.ts             ssh2 SFTP 适配
```

`ssh2` 连接层新增：

```ts
interface SshSession {
  sftp(): Promise<SftpSession>
}

interface SftpSession {
  stat(path: string): Promise<FileStat>
  readFile(path: string, maxBytes: number): Promise<Buffer>
  writeFile(path: string, content: Buffer, mode: number): Promise<void>
  rename(from: string, to: string): Promise<void>
  unlink(path: string): Promise<void>
  close(): void
}
```

只暴露工具需要的最小 SFTP 操作，不把完整 SFTP 客户端交给模型。

## 8. 限制

建议默认值：

| 限制 | 默认 | 最大 |
| --- | --- | --- |
| 上传大小 | 10 MiB | 100 MiB |
| 下载大小 | 10 MiB | 100 MiB |
| 文本返回 | 256 KiB | 1 MiB |
| 路径长度 | 4096 字节 | 4096 字节 |
| 单服务器并发 | 1 | 1 |

这些限制与 `platform_server_exec` 一样，由平台设置管理，AI 单次调用只能在管理端上限内调整。

## 9. 分阶段

### 第一阶段

```text
platform_server_upload
platform_server_download
```

只支持单文件、文本和 base64、固定大小上限、审批、审计。

### 第二阶段

- 流式大文件
- 目录上传/下载
- 断点续传
- 下载到 Harness 工作区
- 文件列表

### 第三阶段

- 传输策略和允许根目录配置
- 与变更计划绑定
- 传输任务取消和恢复

## 10. 测试

至少覆盖：

- 非平台服务器拒绝
- 同名服务器歧义
- 审批拒绝不连接
- 路径越界拒绝
- 上传临时文件失败清理
- 上传成功并原子替换
- 覆盖关闭时拒绝
- 下载超过上限
- 下载文本/base64
- SHA-256 校验
- 审计成功、失败、拒绝
- SSH 断开
- 工具卸载时关闭 SFTP
