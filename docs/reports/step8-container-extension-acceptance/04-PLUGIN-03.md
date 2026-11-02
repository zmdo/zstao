# 04 PLUGIN-03：容器设置

- 用例：PLUGIN-03
- 结果：通过
- 分支：`ces/detail-extensions`
- 测试时间：2026-10-20 21:00 CST
- 环境：`http://127.0.0.1:9090`，本地测试 PostgreSQL，真实 SSH 测试服务器

## 步骤

1. 浏览器打开 `container-ready` 的“配置”。
2. 点击“容器设置”。
3. 关闭“采集容器清单”并保存。
4. 通过 API 读取设置。
5. 重新开启并保存，恢复测试状态。

## 证据

- 配置栏目：
  ```text
  基础配置 | 软件策略 | 容器设置
  ```
- 保存后：
  ```json
  {"value":{"collect":false},"revision":"1"}
  ```
- 恢复后：
  ```json
  {"value":{"collect":true},"revision":"2"}
  ```
- 页面显示“已保存”。

## 结论

观察型扩展设置可保存、可重载，修订递增。
