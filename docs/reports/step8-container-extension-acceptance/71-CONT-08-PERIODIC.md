# 71 CONT-08：关闭采集后的周期巡检

- 用例：CONT-08 周期
- 结果：通过（周期停止采集）
- 测试时间：2026-10-21 08:50 CST
- 对象：`periodic-test`（43.128.69.189）

## 步骤

1. 手动巡检成功。
2. 设置 `collect=false`。
3. 将 `server_runtime.connection_checked_at` 设为两小时前。
4. 等待调度器（5 秒周期）创建 scheduled 巡检。

## 结果

调度器创建了：

```json
{
  "source": "scheduled",
  "state": "succeeded",
  "result": {"summary":"inspected"}
}
```

任务结果没有扩展检查结果。

服务器软件状态仍被核心检测流程读取，但 Docker 状态为 `unknown`（daemon 状态问题，不是扩展检查）。

## 结论

关闭采集后，周期巡检不再执行容器扩展检查。

## 未覆盖

- 手动刷新仍可执行（已知失败）
- 必要软件健康检测和升级检测不受影响
- 重新开启后的周期恢复
