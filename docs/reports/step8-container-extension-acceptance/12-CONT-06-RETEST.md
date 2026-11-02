# 12 CONT-06 回测：Docker 权限不足

- 用例：CONT-06（回测）
- 结果：通过
- 测试时间：2026-10-20 21:10 CST
- 对象：`container-restricted`（43.153.204.197，用户 `smp-limited`）

## 根因

1. 状态派生把 Docker `unknown` 一律归入 `unverified`。
2. 容器查询只返回容器行，不返回软件错误。
3. 面板只按查询结果显示空清单，没有读取服务器软件诊断。

## 修复

1. `displayStatus` 收到软件错误详情；错误包含 `permission denied` 时归入需关注。
2. 容器面板读取 Docker 软件状态：
   - 非 `installed` 时显示警告。
   - 有错误详情时显示错误详情。

## 步骤

1. 执行巡检。
2. 浏览器打开 `container-restricted`。
3. 点击“容器”。

## 证据

- 任务状态：`failed`（预期）
- 服务器状态：`attention`
- Docker 软件状态：
  ```json
  {"state":"unknown","detail":"permission denied while trying to connect to the docker API at unix:///var/run/docker.sock"}
  ```
- 面板文本：
  ```text
  容器

  permission denied while trying to connect to the docker API at unix:///var/run/docker.sock

  上次成功巡检未发现容器。
  ```

## 结论

权限不足时显示需关注和明确错误，不再只显示空清单。
