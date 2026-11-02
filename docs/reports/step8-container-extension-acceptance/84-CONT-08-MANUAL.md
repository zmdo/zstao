# 84 CONT-08：关闭采集后手动刷新

- 用例：CONT-08 手动刷新
- 结果：通过（修复后）
- 测试时间：2026-10-21 10:00 CST
- 对象：`manual-test`

## 修复

手动来源的巡检绕过扩展采集开关：

```ts
const manual = job.request_snapshot.source === 'manual'
if (!manual && enabled === false) continue
```

周期巡检仍遵守 `collect=false`。

## 验证

设置 `collect=false` 后手动巡检：

- 任务 `succeeded`
- 扩展结果重新出现：
  ```json
  {"key":"@smp/console-server-containers/container-check","status":"succeeded"}
  ```
- 容器清单被刷新

## 结论

手动刷新仍执行容器检查，周期巡检继续遵守关闭设置。

已勾选“手动刷新仍可执行”。
