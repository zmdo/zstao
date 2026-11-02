# 18 SW-01 验证：自动加入 docker 组

- 用例：SW-01
- 结果：失败
- 测试时间：2026-10-21 00:45 CST
- 对象：`container-missing`（43.128.72.83）

## 前置

- 机器 SSH 已恢复。
- Docker 已完全卸载。
- `ubuntu` 不在 docker 组，docker 组已删除。
- 控制台服务器登记为容器类型。

## 执行

1. 创建 install_missing 计划。
2. 预检 `ready`。
3. 确认计划。
4. 等待完成。

## 结果

- 计划状态：`completed`
- 机器安装：
  ```text
  Docker version 29.9.1
  Docker Compose version v5.6.0
  ```
- 用户组：
  ```text
  uid=1000(ubuntu) groups=...,27(sudo),...
  ```
  没有 `docker` 组。
- 直接执行：
  ```text
  docker ps
  permission denied while trying to connect to the docker API
  ```

## 结论

计划完成了 Docker 安装，但自动加入 docker 组的逻辑没有生效。

可能原因：

1. 配方执行分支没有走到组处理代码。
2. `grp.getgrnam('sudo').gr_mem` 在该执行环境为空。
3. `usermod` 抛错但被 `except Exception: pass` 静默吞掉。
4. 计划使用了旧配方快照。

需要给配方加可观测日志或把组处理改为独立的受控步骤，再定位。
