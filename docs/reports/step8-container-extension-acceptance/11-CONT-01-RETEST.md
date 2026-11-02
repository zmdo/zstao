# 11 CONT-01 回测：无 Docker 的面板诊断

- 用例：CONT-01（回测）
- 结果：通过
- 测试时间：2026-10-20 21:10 CST
- 对象：`container-missing`（43.128.72.83）

## 修复内容

容器面板现在读取 `server.software_status` 中的 Docker 状态：

- Docker 未安装或未验证时显示提示。
- Docker 检查有错误详情时直接显示详情。

## 步骤

1. 执行巡检。
2. 浏览器打开 `container-missing`。
3. 点击“容器”。

## 证据

- 服务器状态：`attention`，原因为 Docker／Compose `software_missing`。
- 面板文本：
  ```text
  容器

  Docker 未安装或未验证。

  上次成功巡检未发现容器。
  ```

## 结论

Docker 缺失时面板不再只显示空清单，诊断可见。
