# 16 SW-02 回测：单台 Docker 升级

- 用例：SW-02（回测）
- 结果：通过
- 测试时间：2026-10-20 21:40 CST
- 对象：`container-missing`（43.128.72.83）

## 重置

- 删除控制台旧服务器登记和任务。
- 机器 Docker 降级到 `26.1.1`。
- 重新登记容器服务器。
- 重新巡检，确认 Docker `26.1.1`。

## 修复

升级完成后，`apply_plan` 在验证前关闭旧 SSH 会话并重新连接：

- `WorkerContext` 增加 `reconnect`。
- `applyPlanJob` 在 `verifying` 阶段前重连。
- 避免 Docker 升级导致旧会话失效后直接 `ssh_handshake_timeout`。

## 步骤

1. 创建 Docker `29.9.1` 升级计划。
2. 预检 `ready`。
3. 确认计划，时间窗口 2 小时，并发 1。
4. 等待执行。

## 证据

- 计划状态：`completed`
- 目标结果：`succeeded`
- Docker 升级后：
  ```json
  {"state":"installed","healthy":true,"version":"29.9.1"}
  ```
- 机器：
  ```text
  Docker version 29.9.1
  ```

## 结论

升级后重连修复有效，计划完成且验证成功。Compose 未包含在本次计划中，仍为 `2.27.1`。
