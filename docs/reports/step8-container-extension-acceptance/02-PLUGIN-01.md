# 02 PLUGIN-01：容器插件加载与目录

- 用例：PLUGIN-01
- 结果：通过
- 分支：`ces/detail-extensions`
- 测试时间：2026-10-20 21:00 CST
- 环境：`http://127.0.0.1:9090`，本地测试 PostgreSQL，真实 SSH 测试服务器

## 步骤

1. 恢复容器插件并重启控制台。
2. 请求 `/console-api/server-types`。
3. 分别请求 `container-ready`、`container-missing`、`container-restricted` 的 `/extensions`。

## 证据

- 公共类型：
  ```json
  ["builtin/vacant", "@smp/console-server-containers/container"]
  ```
- 三个容器类型服务器的扩展目录均为：
  ```json
  [
    "inspection:@smp/console-server-containers/container-check",
    "query:@smp/console-server-containers/container-list",
    "settings:@smp/console-server-containers/container-settings",
    "panel:@smp/console-server-containers/containers"
  ]
  ```
- `vacant-with-docker` 没有这些条目。

## 结论

容器类型、面板、设置、巡检和查询目录均正确隔离。
