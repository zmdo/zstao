# rsync 代理

状态：已实现。

## 目标

给 AI 一个受控的 rsync 执行入口：

```text
AI 提供完整 rsync 命令行
→ 平台分词和校验
→ 检查全局禁用参数
→ 绑定平台服务器
→ 审批（传输）
→ 执行 rsync
→ 审计
```

传输本身完全交给 rsync，不建立 transfer 表、不启动 worker，也不自己维护断点偏移。

## 工具

```ts
platform_server_rsync({
  server: string
  command: string
  timeout_ms?: number
})
```

`command` 必须是一条 `rsync` 命令行。

示例：

```bash
rsync -avz --partial --append-verify ./dist/ ubuntu@prod-01:/srv/app/
```

## 解析

使用 `shell-quote` 做命令行分词，拒绝：

- shell 操作符
- 变量展开
- 通配符展开
- 重定向
- 子命令

然后解析 rsync 参数：

- 短参数合并，例如 `-avze`
- 长参数，例如 `--delete`、`--rsh=ssh`
- `--` 后的操作数
- 需要值的参数

不使用 shell 执行，最终只把 argv 交给 `spawn('rsync', argv)`。

## 参数策略

全局配置：

```json
{
  "rsyncDeniedFlags": [
    "-e",
    "--rsh",
    "--rsync-path",
    "--delete",
    "--remove-source-files",
    "--files-from",
    "--password-file",
    "--write-batch",
    "--read-batch"
  ]
}
```

配置在：

```text
平台设置 → Harness → 服务器管理 → Rsync
```

命中配置中的禁用参数时返回：

```json
{
  "code": "rsync/flag-denied",
  "flag": "--delete"
}
```

空列表表示不进行参数级拦截，这是明确的管理员选择。

## 服务器绑定

命令行中的远端操作数必须属于所选服务器：

```text
[user@]host:path
```

校验：

- host 等于平台服务器 host 或名称
- 可选 user 等于该服务器的 SSH 用户
- 至少存在一个远端操作数
- 拒绝 `rsync://`
- 禁止通过参数连接另一个 host

## SSH

平台使用服务器凭据生成临时密钥和 known_hosts，通过：

```text
RSYNC_RSH
```

注入 SSH 命令。

默认禁用：

```text
-e
--rsh
--rsync-path
```

当前只支持私钥认证；密码认证需要额外依赖，暂不支持。

## 审批和审计

审批工具名：

```text
platform_server_rsync
```

审批类型：

```text
transfer
```

审计类型：

```text
transfer
```

审计记录：

- 服务器
- 完整命令行
- 解析后的 argv
- 命中的禁用参数
- 审批状态
- 退出码
- 耗时
- stdout/stderr 摘要

## 超时和执行

- `timeout_ms` 默认 10 分钟，最大 10 分钟
- 支持 AbortSignal
- 超时或取消时终止 rsync 进程组
- stdout/stderr 受执行限制约束
- 使用工作区作为本地 cwd

## 非目标

- 不做 transfer 表
- 不做 worker
- 不做进度持久化
- 不做自动重试
- 不做断点状态
- 不自动安装远端 rsync

## 错误

```text
rsync/invalid-command
rsync/command-required
rsync/unsupported-shell-syntax
rsync/flag-denied
rsync/server-required
rsync/server-mismatch
rsync/auth-unsupported
rsync/rsync-unavailable
rsync/timeout
rsync/failed
```

## 测试

至少覆盖：

- 引号和空格
- 短参数合并
- 长参数和等号值
- `--` 操作数
- 禁用参数命中
- 远端 host 匹配和不匹配
- shell 操作符拒绝
- 审批拒绝
- rsync 非零退出
- 超时和取消
