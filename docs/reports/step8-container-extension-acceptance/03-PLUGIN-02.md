# 03 PLUGIN-02：容器面板

- 用例：PLUGIN-02
- 结果：通过
- 分支：`ces/detail-extensions`
- 测试时间：2026-10-20 21:00 CST
- 环境：`http://127.0.0.1:9090`，本地测试 PostgreSQL，真实 SSH 测试服务器

## 步骤

1. 浏览器打开 `container-ready`。
2. 确认侧栏出现“容器”。
3. 点击“容器”。
4. 检查面板文本。
5. 在服务器上启动一个运行容器和一个 Compose 容器后重新打开面板。

## 证据

- 侧栏选项：
  ```text
  服务器详情 | 任务报告 | 终端 | 配置 | 容器
  ```
- 空清单时面板：
  ```text
  容器
  上次成功巡检未发现容器。
  ```
- 有容器时面板：
  ```text
  容器
  名称       镜像      状态                      端口
  smp-test   busybox   Exited (137) ...
  tmp-smp-compose-1  busybox  Up ...
  ```

## 说明

此前面板显示“扩展组件未加载”，原因是客户端面板键被误改为 `container-list`；已由提交 `c6fc7fc` 修复为 `containers`。

## 结论

容器面板注册、渲染和实时数据展示正常。
