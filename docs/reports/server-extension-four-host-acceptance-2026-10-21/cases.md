# 已执行场景与证据

本页“通过”只针对描述的操作与结果。精确并发、异常时序和未执行场景见[待验证清单](pending-verification.md)。

## 接入、配置与界面

| 编号 | 操作与实际结果 | 证据／边界 |
| --- | --- | --- |
| LIVE-01 | .83 使用已有密钥测试连接成功，识别 Ubuntu 24.04 LTS、x86_64；遇到后续软件探测超时时未误报成功，关闭自动安装后可保存待验证资料 | 后续真实采集成功；不以此证明切换类型的每次检测都稳定完成 |
| LIVE-02 | 容器类型显示容器面板；.189 数据库测试类型提供自己的面板和配置，未混入容器面板 | 既有独立测试插件已在 profile 启用；本轮未做完整插件卸载／重载 |
| LIVE-03 | 容器采集默认开启；取消勾选、切换配置栏目再返回，草稿仍在；保存成功后按钮禁用 | [保存截图](ui-settings-saved.png)；正常路径验证，非故意制造迟到响应 |
| LIVE-04 | .189 的 collect=false 与 mode=enforce 草稿分别保留；保存一个栏目不覆盖另一个 | [数据库保存值](database-evidence.json)；之后执行配置恢复为 observe |
| LIVE-05 | .189 创建执行配置计划，确认应用后保存成功；再次创建并应用 observe 计划 | [截图](ui-execution-settings-applied.png)；快照中两条计划 applied |
| LIVE-06 | .189 创建 enforce 计划后保存不同的声明 OS，界面重载目录并清除旧计划展示；已保存 mode 仍为 observe | [截图](ui-plan-cleared-on-os-change.png)；未提交旧计划请求，不能作为后端拒绝的实机证据。仅更改地域未使计划失效，地域不属于执行配置修订 |
| LIVE-07 | 切换英文后核对容器面板及 Container Settings，再恢复中文 | [面板](ui-containers-english.png)、[配置](ui-container-settings-english.png)；非所有页面逐句检查 |
| LIVE-08 | 发现编辑已有服务器 OS 时类型下拉误显示为空置类型，修复为编辑模式保留类型及自动安装选择 | [复验](ui-os-edit-keeps-type.png)；重新构建核心，网页选择 22.04 后类型仍为数据库服务器，再恢复 24.04，不额外保存错误系统 |

## 容器观察与刷新（.83、.197）

| 编号 | 操作与实际结果 | 证据／边界 |
| --- | --- | --- |
| LIVE-09 | 尚无成功观察显示明确提示；成功采集且无容器则显示空清单 | [无观察](ui-no-observation.png)、[成功空清单](ui-containers-empty-success.png) |
| LIVE-10 | .83 建立 12 个 Created 容器，列表按 10 / 2 分页，第二页按钮状态正确 | [准备](43.128.72.83-prepare-direct.txt)、[第二页](ui-containers-page2.png) |
| LIVE-11 | collect=false 已保存时，手动“立即刷新”仍采集真实清单；之后恢复 collect=true | [配置保存](ui-settings-saved.png)、[最终配置](database-evidence.json) |
| LIVE-12 | 留在容器面板，远端新增 smp-acceptance-00-live；未离开面板或点击刷新，周期采集后自动出现新行 | [远端新增](43.128.72.83-live-change.txt)、[页面更新](ui-containers-live-refresh.png) |
| LIVE-13 | 停止 docker.service 与 docker.socket；采集失败后页面显示原因，并保留上次成功快照 | [停止记录](43.128.72.83-daemon-stop.txt)、[失败快照](ui-containers-stale-snapshot.png)；这里验证采集失败，不等同于 HTTP 查询失败 |
| LIVE-14 | 恢复服务与 socket，后续成功采集，页面自动清除失败提示 | [恢复记录](43.128.72.83-daemon-restored.txt)、[恢复截图](ui-containers-recovered.png) |

## 软件安装与组权限

### LIVE-15：首次安装（.197）

移除原有 Docker/Compose 后，第一次网站安装因准备过程遗留活动 socket 而失败；软件包和用户组已部分变更，网站记录了失败，未假报成功。详见[环境说明](environment.md)。

完整清理后，确认 docker 命令不存在、socket inactive、ubuntu 不在 docker 组，再从网站安装必要组件。任务 `c992d983-9d18-489e-984d-0e2aa90f98b4` 成功，变更计划 `50b761ff-87ab-486a-9482-87367e659fe0` 完成；新 SSH 会话确认 Docker 客户端／服务端 29.9.2、Compose 5.6.0，ubuntu 无需 sudo 即可查询容器。

证据：[清理](43.153.204.197-clean-reset.txt)、[任务截图](ui-first-install-success.png)、[独立 SSH 复核](43.153.204.197-installed-verified.txt)、[计划结果](plan-results.json)。

### LIVE-16：升级伴随组权限修复（.98）

保留 Docker 29.9.1，移除 ubuntu 的 docker 成员资格，新 SSH 会话确认 docker.sock permission denied。通过网站检测升级，选择 29.9.2，预检列出精确软件包和 ubuntu（UID 1000）加组操作，确认后执行。

计划 `002f4494-72d0-40e7-ae5f-6309c0df2221` 完成；实际变更含 `group-membership`；新 SSH 会话确认 ubuntu 已在 docker 组，Docker 客户端／服务端为 29.9.2，直接查询容器成功。

证据：[缺组复现](43.163.113.98-missing-group.txt)、[确认计划](ui-upgrade-user-group-plan.png)、[完成页面](ui-upgrade-completed.png)、[SSH 复核](43.163.113.98-upgraded-verified.txt)、[计划结果](plan-results.json)。

**验证边界：这是升级流程中的加组修复，不是“版本不变、只修复组权限”的独立操作。** 缺组时软件探测仍可能通过 sudo 回退报告已安装且健康，不能把软件检测成功当作普通用户已有 socket 权限。
