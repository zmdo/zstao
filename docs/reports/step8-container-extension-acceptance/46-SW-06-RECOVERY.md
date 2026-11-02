# 46 SW-06：worker 中断后的租约恢复

- 用例：SW-06
- 结果：通过
- 测试时间：2026-10-21 04:15 CST
- 计划：`5145ab6c-d5a8-4f5f-a685-5becd8180f1e`
- 对象：`lease-test`（43.128.72.83）

## 改进的测试方法

上一次只修改数据库租约时间，没有真正停止 worker，因此任务仍由原进程完成。

这次改为：

1. 创建 Docker 安装计划并确认。
2. 等待任务开始执行。
3. 直接杀掉控制台进程，模拟 worker 死亡。
4. 等待租约过期。
5. 重新启动控制台。
6. 观察新 worker 是否恢复任务。

## 恢复过程

杀死 worker 后：

```json
{
  "job": "recovering",
  "target": "pending",
  "plan": "scheduled"
}
```

重启后一段时间：

```json
{
  "job": "recovering",
  "target": "running",
  "plan": "running"
}
```

最终：

```json
{
  "job": "succeeded",
  "target": "succeeded",
  "plan": "completed"
}
```

机器结果：

```text
Docker version 29.9.1
```

## 结论

租约恢复通过：

- worker 中断后任务被重新领取
- 远端安装没有因为进程死亡丢失
- 新 worker 恢复并完成验证
- 计划最终 completed
- 没有重复创建一个新计划或重新排队旧任务

## 说明

`recovery_attempts` 显示为 0，是因为恢复成功发生在第一次重新领取，没有进入失败重试。
