# 72 CONT-08：关闭采集后的健康检测与重新开启

- 用例：CONT-08 健康检测／重新开启
- 结果：通过
- 测试时间：2026-10-21 09:00 CST
- 对象：`health-test`

## 关闭采集

设置 `collect=false` 后手动巡检：

- 任务 `succeeded`
- 没有扩展检查结果
- 软件状态仍为：
  ```json
  {
    "docker-engine": {"state":"installed","version":"29.9.1"},
    "docker-compose": {"state":"installed","version":"5.6.0"}
  }
  ```

结论：必要软件健康检测仍在执行。

## 重新开启

恢复 `collect=true` 后巡检：

- 任务 `succeeded`
- 扩展结果重新出现：
  ```json
  {"key":"@smp/console-server-containers/container-check","status":"succeeded"}
  ```

结论：重新开启后容器采集恢复。

## 未覆盖

- 手动刷新仍可执行（已知失败）
- 升级检测偏好
