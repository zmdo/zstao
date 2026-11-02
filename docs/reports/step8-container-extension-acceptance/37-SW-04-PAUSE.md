# 37 SW-04：失败时暂停 pending 目标

- 用例：SW-04 pending pause
- 结果：通过（暂停）；重试预检阻塞
- 测试时间：2026-10-21 03:20 CST
- 计划：`fdc3c832-18b9-49bd-8614-12a3ee4a1d1b`

## 环境

四台服务器全部：

- 使用 `smp-noexec`
- 属于 docker 组
- 无 sudo
- Compose 2.27.1
- 目标升级 Compose 5.6.0

这样第一台必定执行失败，后续目标保持 pending，不依赖调度顺序。

## 结果

- 计划状态：`paused`
- 第一个执行的 `all-2`：`failed`
  - `job_recovering`
  - 实际为 sudo 权限失败
- 其余目标：
  - `all-1`：`pending`
  - `all-3`：`pending`
  - `all-4`：`pending`
- 没有继续调度 pending 目标
- 没有无限 recovering

## 证据

```json
[
  {"name":"all-1","state":"pending"},
  {"name":"all-2","state":"failed","error":"job_recovering"},
  {"name":"all-3","state":"pending"},
  {"name":"all-4","state":"pending"}
]
```

计划状态：

```text
paused
```

## 重试

- 将 `all-2` 的 Compose 手工升级到 5.6.0。
- 调用暂停计划的 retry。
- 生成新计划 `d4e55927-454b-4cbd-ba98-e1a1423feeb4`。
- 新计划预检阶段 `all-2` 失败，计划 `blocked`。
- 因此重试路径未完成验证。

## 结论

pending 暂停语义通过：失败目标发生后，计划进入 `paused`，其他目标保持 pending。

重试预检仍需修复/分析。
