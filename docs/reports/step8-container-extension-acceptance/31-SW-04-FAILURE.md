# 31 SW-04 失败路径：批量升级一台失败

- 用例：SW-04（失败暂停）
- 结果：失败
- 测试时间：2026-10-21 02:05～02:20 CST
- 计划：`60f8faf9-9622-4ed7-a3db-431c8b9488f5`

## 场景

两台服务器：

- `term-test`：43.128.69.189
- `batch-fail`：43.128.72.83

两台 Docker 均为 `26.1.1`，计划升级到 `29.9.1`，并发 1。

为了制造第二个目标失败，在预检完成后移除了 `batch-fail` 上 `ubuntu` 的 sudoers 规则。

## 结果

- 第一个目标 `term-test`：`succeeded`
- 第二个目标 `batch-fail`：
  - target 状态：`running`
  - job 状态：`recovering`
  - 计划状态：长时间保持 `running`
- 没有进入预期的 `paused`／`partial_failure`
- 没有按失败策略暂停后续目标
- 手动调用计划取消后，计划变为 `cancelled`

## 证据

任务：

```text
purpose: apply_plan
state: recovering
target: batch-fail
```

目标：

```text
name: batch-fail
state: running
mutation_started_at: 2026-10-20T18:08:25.427Z
finished_at: null
```

## 结论

批量失败路径未通过：

1. 目标失败后卡在 `recovering`，没有转成失败。
2. 失败策略没有暂停计划。
3. 需要限制恢复重试次数或把不可恢复的权限错误转为失败。

## 环境副作用

`batch-fail` 上 `ubuntu` 的 sudoers 规则尚未恢复（当前无法用 sudo 恢复），后续涉及该机器的 sudo 测试需要先从云控制台或 root 恢复。
