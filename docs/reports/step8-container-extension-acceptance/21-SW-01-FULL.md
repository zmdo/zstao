# 21 SW-01 完整验收：安装 Docker 并自动加入 docker 组

- 用例：SW-01
- 结果：通过
- 测试时间：2026-10-21 01:35 CST
- 对象：`container-missing`（43.128.72.83，ubuntu）
- 代码：`3547ff7 Fix docker access planning and preserve recipe failure details`

## 前置重置

- 停止并卸载 Docker、Compose、containerd。
- 将 `ubuntu` 移出 docker 组。
- 删除 docker 组。
- 确认机器无 docker 命令。
- 重启控制台加载最新配方。

## 计划

- 计划 ID：`9460289e-4650-4e34-953b-82ba50c5bbfe`
- 类型：move + install_missing
- 预检结果：`ready`
- 预检目标包含：
  ```json
  {"dockerUser":{"name":"ubuntu","uid":1000}}
  ```
- 配置影响说明包含：
  ```text
  Ensure SSH user ubuntu (UID 1000) belongs to the docker group
  ```
- 确认后计划状态：`completed`

## 安装结果

机器检查：

```text
uid=1000(ubuntu) groups=...,988(docker),1000(netdev)
Docker version 29.9.1
Docker Compose version v5.6.0
docker ps -> 正常返回空列表
```

没有手工执行 `usermod`。

## 控制台结果

- 巡检任务：`succeeded`
- 服务器状态：`normal`
- Docker：`installed` 29.9.1
- Compose：`installed` 5.6.0
- 容器查询：空数组
- 容器面板：
  ```text
  容器

  上次成功巡检未发现容器。
  ```

## 结论

完整链路通过：

1. 无 Docker 的服务器
2. 预检冻结 SSH 账户
3. 安装 Docker／Compose
4. 自动将冻结账户加入 docker 组
5. 新 SSH 会话可直接访问 Docker
6. 巡检和容器面板正常

SW-01 通过。注意：产品仍会自动向 docker 组添加登记 SSH 用户，该组等价于 root 权限，属于需要明确接受的安全策略。
