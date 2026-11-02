# 17 SW-01 回测：安装后自动加入 docker 组

- 用例：SW-01（回测）
- 结果：阻塞
- 测试时间：2026-10-20 22:20～23:10 CST
- 对象：`container-missing`（43.128.72.83）

## 准备的修复

安装配方在软件包变更后，读取 `sudo` 组成员并执行：

```sh
usermod -aG docker <sudo 用户>
```

理由：sudo 用户已经等价于 root，加入 docker 组不额外扩大权限模型。

## 重置过程

- 停止 Docker。
- 卸载 `docker-ce`、`docker-ce-cli`、`containerd.io`、Compose 等包。
- 将 `ubuntu` 移出 `docker` 组并删除 docker 组。
- 确认机器上无 docker 命令。

## 执行

1. 重新巡检，Docker／Compose 为 `missing`。
2. 创建 install_missing 变更计划。
3. 预检 `ready`。
4. 确认计划。
5. 等待安装。

## 结果

- 计划状态：`partial_failure`
- 目标状态：`failed`
- 错误：
  ```json
  {"code":"command_timeout","detail":"命令执行超时"}
  ```
- 安装未完成。
- 随后直接 SSH 到 `43.128.72.83` 也出现握手挂起，无法读取最终用户组状态。

## 结论

- 自动加入 docker 组的代码尚未获得端到端证据。
- 当前阻塞点是安装命令超时和机器 SSH 无响应，不是组变更逻辑本身。
- 需要先恢复该测试服务器，重新安装 Docker，再验证 `id` 中是否出现 docker 组。

## 未通过项

- 安装后 `ubuntu` 是否自动进入 docker 组：未验证。
- 无手工干预直接巡检：未验证。
