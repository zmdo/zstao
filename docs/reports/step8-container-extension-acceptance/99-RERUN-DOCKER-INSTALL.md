# 99 代码更新后 Docker 首次安装复跑

- 日期：2026-10-21
- 对象：`验收-189-扩展配置`（43.128.69.189）
- 结果：通过

## 步骤

1. 在 43.128.69.189 上卸载 Docker、Compose 并清理配置。
2. 确认：
   ```text
   docker: command not found
   ```
3. 通过变更计划把服务器切换到容器类型，`install_missing=true`。
4. 预检完成，计划进入 `awaiting_confirmation`。
5. 确认计划，执行完成。

## 结果

计划：

```text
completed / succeeded
```

安装后：

```text
Docker version 29.1.3
Docker Compose version 2.40.3
```

服务器状态：

```json
{
  "status": "normal",
  "docker-engine": {"state":"installed","version":"29.1.3"},
  "docker-compose": {"state":"installed","version":"2.40.3"}
}
```

## 结论

- Docker/Compose 首次安装通过
- 预检、确认、执行、复检链路通过
- 安装后服务器状态和软件版本正确

## 说明

测试把原数据库测试服务器切换成了容器服务器，这是本次安装测试的副作用。
