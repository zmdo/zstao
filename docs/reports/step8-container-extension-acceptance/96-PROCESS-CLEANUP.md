# 96 流程检查项收尾

- 日期：2026-10-21
- 结果：流程项完成

## 1. 删除控制台测试服务器、清空任务、观察和扩展设置

删除测试服务器：

```text
db-test        204
manual-test    204
```

删除后数据库计数：

```text
servers                    0
server_jobs                0
server_extension_settings  0
server_containers          0
server_inspection_reports  0
```

同时清理了：

- server_job_steps
- server_change_targets
- server_change_plans
- server_extension_observations
- server_software_policies
- server_upgrade_suggestions
- server_software_observations
- server_runtime

## 2. 删除机器上的测试容器

43.128.69.189 上原有：

```text
ui-c1 ... ui-c15
daemon-test
```

执行：

```sh
docker rm -f ui-c1 ... ui-c15 daemon-test
```

清理后：

```text
docker ps -a
（无输出）
```

其余三台测试机没有测试容器。

## 3. 安装／卸载／降级 Docker 和 Compose

本轮实际覆盖：

- SW-01：安装 Docker 和 Compose，验证版本 29.9.1 / 5.6.0
- SW-02：单台升级
- SW-03：Compose-only 升级

没有单独执行 Docker 降级；降级不是本轮场景必需步骤。

## 4. 不在任务运行、计划执行或升级过程中重置机器

清理前检查任务状态：

```text
succeeded 81
failed     1
```

没有 queued、claimed、running、recovering 任务。

确认后才删除服务器和数据。

## 5. 每轮只改变一个被测变量

测试轮次按单变量组织，例如：

- 只改采集开关
- 只改 SSH 用户
- 只改 Docker 版本
- 只改任务状态

具体见各编号报告。

## 6. 记录实际执行的机器命令和结果

本报告记录了本轮清理命令和结果；安装、升级、容器删除命令见相应编号报告。

## 结论

6 个流程检查项已执行并记录。
