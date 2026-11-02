# 42 TASK-02：运行中任务取消

- 用例：TASK-02 running
- 结果：失败
- 测试时间：2026-10-21 03:55 CST
- 计划：`a908b208-1f15-46f5-88dc-abdb43de0917`
- 任务：`9eb6cba6-bce7-4324-b42f-ceca089f3f2c`

## 场景

在 `cancel-test`（43.128.72.83）上创建 Docker 安装计划，确认后等待任务进入执行，再调用：

```text
POST /server-jobs/:id/cancel
```

## 结果

任务状态：

```json
{
  "status": "cancelled",
  "phase": "connecting",
  "output_excerpt": "任务已取消。"
}
```

但计划状态仍为：

```text
scheduled
```

target 状态：

```text
pending
```

一段时间后没有重新入队，也没有把 target 标为 cancelled/failed。

## 问题

取消 apply_plan job 后：

- job 是 `cancelled`
- plan 仍是 `scheduled`
- target 回到 `pending`
- 计划不会继续，也不会自动结束
- 状态机不一致

## 结论

运行中任务取消没有完成：

- 任务本身取消了
- 但计划/目标没有结束
- 需要取消 apply_plan 时同步取消 target 和 plan，或明确禁止直接取消并引导取消计划。

## 未验证

- 已取消任务是否仍会写迟到结果
- 租约释放
