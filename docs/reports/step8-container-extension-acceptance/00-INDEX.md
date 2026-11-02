# 步骤 8 验收执行记录

> 原步骤 8 最终状态见 [97-FINAL-REPORT.md](97-FINAL-REPORT.md)。后续设计修复的定向回归见[四台测试服务器补充验收](../server-extension-four-host-acceptance-2026-10-21/README.md)，该补充不代表再次执行全部 167 项。

- 首轮执行时间：2026-10-20 20:50～21:05 CST；最近补充：2026-10-21
- 分支：`ces/detail-extensions`
- 测试环境：本地控制台 + 4 台真实 SSH 测试服务器
- 状态：完成（167 / 167）

## 已完成用例

| 编号 | 用例 | 结果 | 报告 |
| --- | --- | --- | --- |
| 01 | CORE-01 仅核心启动 | 部分通过 | [01-CORE-01.md](01-CORE-01.md) |
| 02 | PLUGIN-01 插件加载与目录 | 通过 | [02-PLUGIN-01.md](02-PLUGIN-01.md) |
| 03 | PLUGIN-02 容器面板 | 通过 | [03-PLUGIN-02.md](03-PLUGIN-02.md) |
| 04 | PLUGIN-03 容器设置 | 通过 | [04-PLUGIN-03.md](04-PLUGIN-03.md) |
| 05 | CONT-01 无 Docker | 回测通过 | [05-CONT-01.md](05-CONT-01.md) / [11-CONT-01-RETEST.md](11-CONT-01-RETEST.md) |
| 06 | CONT-02 空容器清单 | 通过 | [06-CONT-02.md](06-CONT-02.md) |
| 07 | CONT-03 运行容器 | 通过 | [07-CONT-03.md](07-CONT-03.md) |
| 08 | CONT-04 停止容器 | 通过 | [08-CONT-04.md](08-CONT-04.md) |
| 09 | CONT-05 Compose 容器 | 通过 | [09-CONT-05.md](09-CONT-05.md) |
| 13 | SW-01 安装缺失软件 | 通过；完整首次安装及加组链路见报告 21 | [13-SW-01.md](13-SW-01.md) / [17-SW-01-RETEST.md](17-SW-01-RETEST.md) / [18-SW-01-VALIDATION.md](18-SW-01-VALIDATION.md) / [19-SW-01-DIAGNOSTIC.md](19-SW-01-DIAGNOSTIC.md) / [20-SW-01-GROUP-FIX.md](20-SW-01-GROUP-FIX.md) / [21-SW-01-FULL.md](21-SW-01-FULL.md) |
| 14 | SW-02 单台 Docker 升级 | 回测通过 | [14-SW-02.md](14-SW-02.md) / [16-SW-02-RETEST.md](16-SW-02-RETEST.md) |
| 15 | SW-04 批量升级 | 成功路径通过 | [15-SW-04.md](15-SW-04.md) / [23-SW-04.md](23-SW-04.md) |
| 10 | CONT-06 权限不足 | 回测通过 | [10-CONT-06.md](10-CONT-06.md) / [12-CONT-06-RETEST.md](12-CONT-06-RETEST.md) |

## 本轮发现并修复

1. 容器面板槽键错误：
   - 客户端注册 `container-list`，宿主目录是 `containers`
   - 已由 `c6fc7fc` 修复
2. 破坏性切换删表后插件查询失效：
   - 新增 `0021_container_plugin_observations.sql`
   - 插件巡检改为 `docker ps -a --format '{{json .}}'`
   - 插件巡检 commit 写回 `server_containers`

## 已修复并回测

### CONT-06 权限不足

- 原问题：权限失败时服务器显示 `unverified`，面板可能误显示为空清单。
- 已修复并回测，结果见[报告 12](12-CONT-06-RETEST.md)。

### CONT-01 面板诊断

- 无 Docker 时的状态和面板诊断已回测，结果见[报告 11](11-CONT-01-RETEST.md)。

### SW-01 Docker 用户组

- 预检固定实际 SSH 用户及 UID，不再遍历 `sudo` 组；执行和校验确认成员关系，失败原因进入远端任务结果。
- 自动化测试 20 项通过；`43.128.69.189` 上复现权限拒绝后，使用新配方恢复权限，新 SSH 会话验证通过。
- 报告 20 当时只完成用户组专项回归；后续[报告 21](21-SW-01-FULL.md)已完成首次安装、自动加组和新 SSH 会话验证。最终结论为通过。

## 最终状态

- 清单 167 / 167 完成。
- 13 个产品问题已修复。
- 已知限制：错误边界同会话自动恢复、Docker 降级未单独测试。
- 详见 [97-FINAL-REPORT.md](97-FINAL-REPORT.md)。
