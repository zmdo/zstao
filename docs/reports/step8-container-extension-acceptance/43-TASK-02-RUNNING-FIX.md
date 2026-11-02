# 43 TASK-02 回测：运行中取消同步取消计划

- 用例：TASK-02 running
- 结果：通过
- 测试时间：2026-10-21 04:05 CST
- 计划：`399f5881-1255-47f5-a564-ba228792fbe0`
- 任务：`7712b451-7d4a-4dc4-abb6-884e243dee41`

## 修复

`cancelJob` 在事务中：

- 取消 job
- 如果是 `apply_plan`：
  - 取消 target
  - 取消 plan
  - 取消同计划其他活动目标／任务

## 步骤

1. 重置服务器和控制台数据。
2. 在 `cancel-test`（43.128.72.83）创建 Docker 安装计划。
3. 确认后等待执行。
4. 取消 apply_plan 任务。

## 证据

- 取消接口：`200`
- 取消后：

```json
{
  "job": "cancelled",
  "target": "cancelled",
  "plan": "cancelled"
}
```

没有再次出现：

- plan `scheduled`
- target `pending`

## 结论

运行中取消后，任务、目标和计划状态一致，计划不会被调度器再次领取。
