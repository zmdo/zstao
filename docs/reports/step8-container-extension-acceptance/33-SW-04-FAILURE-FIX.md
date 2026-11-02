# 33 SW-04 回测：执行阶段失败不再卡 recovering

- 用例：SW-04 失败路径
- 结果：通过（单目标执行失败）
- 测试时间：2026-10-21 02:45 CST
- 对象：`recovery-test`（43.128.69.189，用户 `smp-noexec`）

## 环境

- 清空控制台服务器和任务后重新登记。
- 用户 `smp-noexec`：
  - 属于 docker 组
  - 无 sudo
- Docker 29.9.1 已安装。
- Compose 2.27.1。

## 计划

- 只升级 Compose 到 5.6.0。
- 预检：`ready`
- 确认后执行。
- 由于执行监督进程需要 `sudo -n`，而用户无 sudo，执行阶段失败。

## 结果

- 计划状态：`partial_failure`
- target：`failed`
- job：
  ```text
  purpose: apply_plan
  state: failed
  recovery_attempts: 0
  ```
- 没有进入 `recovering`。
- Compose 仍为 2.27.1。
- 失败原因保留在 target result 中。

## 修复验证

`remoteOperation(start)` 的失败现在归类为不可恢复：

```ts
cause.code === 'job_recovering' && cause.params.operation === 'recover'
```

只有恢复阶段的错误才进入 `recovering`；启动/执行阶段失败直接 `finishJob('failed')`。

## 结论

执行阶段权限失败不再卡在 recovering；target 和计划正确结束。批量中“已有成功目标 + 后续失败”的 pause 语义还需一个双目标场景验证。
