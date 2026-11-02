# 35 SW-04：失败时仍有 pending 目标的暂停语义

- 用例：SW-04 pending pause
- 结果：阻塞
- 测试时间：2026-10-21 03:10 CST

## 目标

准备 3 台健康服务器，使批量计划中：

- 一台成功
- 一台执行失败
- 一台保持 pending

验证失败后计划进入 `paused`。

## 环境检查

- `43.128.69.189`：Docker/Compose 可用
- `43.153.204.197`：Docker 可用，`smp-noexec` 无 sudo
- `43.128.72.83`：Docker daemon 可启动，但 Compose 插件包冲突
- `43.163.113.98`：Docker socket 仍无法启动

## 尝试

在 `43.128.72.83` 安装同包名 Compose 时，`docker-compose-plugin` 与已有 `docker-compose-v2` 冲突：

```text
trying to overwrite '/usr/libexec/docker/cli-plugins/docker-compose',
which is also in package docker-compose-v2
```

dpkg 进入错误状态，无法作为第三个健康目标。

## 结论

本轮没有凑齐 3 台可通过预检的健康服务器，因此没有验证：

- 失败后计划 `paused`
- pending 目标是否停止调度
- 重试路径

已有证据只覆盖两台：一台成功、一台失败，计划为 `partial_failure`。

## 下一步

- 从云控制台或 root 恢复 `43.163.113.98` 的 Docker socket。
- 修复 `43.128.72.83` 的 dpkg 状态并移除 `docker-compose-v2` 冲突。
- 再执行三目标批量升级。
