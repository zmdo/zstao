# 34 SW-04 回测：批量中一台失败不再卡 recovering

- 用例：SW-04 失败路径
- 结果：通过（双目标，一台成功一台失败）
- 测试时间：2026-10-21 03:00 CST
- 计划：`ce3ccc1f-6f94-4131-834e-60a281579ddc`

## 环境

- `term-test`：43.128.69.189，ubuntu，Compose 2.27.1
- `batch-fail`：43.153.204.197，smp-noexec，Compose 2.40.3
- 两台 Docker 均为 29.9.1
- 批量升级 Compose 到 5.6.0
- `smp-noexec` 属于 docker 组，但无 sudo

## 结果

- `term-test`：`succeeded`
  - Compose 升级到 5.6.0
- `batch-fail`：`failed`
  - 错误：
    ```json
    {
      "code": "job_recovering",
      "detail": "sudo: a password is required",
      "params": {"operation": "start"}
    }
    ```
  - 没有进入 `recovering`
- 计划状态：`partial_failure`
- 成功目标结果保留，失败目标单独记录

## 修复验证

失败目标的任务是执行阶段错误，`operation=start`，被归类为不可恢复：

- 直接 `finishJob(..., 'failed')`
- target 标为 `failed`
- 计划结束为 `partial_failure`

没有再出现 `target=running` / `job=recovering` 的无限循环。

## 未覆盖

- 失败发生时仍有 `pending` 目标时，计划是否进入 `paused`
- 失败后重试

## 结论

批量中一台失败、另一台成功时，任务能正确结束，成功结果保留，失败原因可读。
