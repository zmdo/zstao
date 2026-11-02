# 36 SW-04：四目标失败顺序与暂停观察

- 用例：SW-04 pending pause
- 结果：未覆盖 pending（失败目标最后执行）
- 测试时间：2026-10-21 03:15 CST
- 计划：`ed9f1323-50de-438f-822c-5a9429510f0a`

## 环境

四台健康服务器：

- `s1`：43.128.69.189
- `s2`：43.128.72.83
- `s3`：43.163.113.98
- `fail`：43.153.204.197（smp-noexec）

全部预检 `ready`，批量升级 Compose 到 5.6.0，并发 1。

## 实际执行顺序

从 `mutation_started_at` 看：

1. `s3` 成功
2. `s2` 成功
3. `s1` 成功
4. `fail` 失败

失败目标最后执行，因此失败发生时已经没有 pending 目标，计划正确结束为 `partial_failure`。

## 结果

- 三个成功目标保留 5.6.0
- `fail` 失败：
  ```json
  {"code":"job_recovering","detail":"sudo: a password is required","params":{"operation":"start"}}
  ```
- 没有卡在 recovering
- 计划：`partial_failure`

## 未覆盖

这次没有验证：

- 失败发生时仍有 pending 目标
- 计划是否进入 `paused`
- pending 目标是否停止调度

## 结论

失败分类修复继续有效；但 pending 暂停语义仍未获得证据，需要控制执行顺序，让失败目标在仍有 pending 时发生。
