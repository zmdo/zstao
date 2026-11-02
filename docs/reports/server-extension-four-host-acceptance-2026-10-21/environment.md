# 环境准备与异常

## 网络前置条件

初始 SSH OpenSSH 和应用 ssh2 均有握手前关闭、认证等待 30 秒超时；本机路由经过 `utun0`，下一跳 `198.18.0.1`。用户确认将测试 IP 直连／关闭 TUN 后，路由变为 `en0`、网关 `10.103.151.254`，后续实机操作得以完成。直连后仍有间歇性认证超时，最终数据库快照中 .83、.98 显示 offline，但独立 SSH 复核成功。用户随后确认是本机联机不稳定，并要求不再排查。本轮将其作为环境干扰，保留原始失败记录，不列为待修产品缺陷，也不宣称连接稳定性已验证通过。

用户确认四台均可更新旧主机指纹。本机更新了发生变更或需重新登记的 .83、.98、.189 指纹；.197 的现有记录匹配，没有强制替换。私钥文件权限改为 0600，内容未改，报告不收录私钥。

## 四台机器的初始状态

| IP | 系统 | Docker | Compose | ubuntu 组状态 |
| --- | --- | --- | --- | --- |
| 43.128.69.189 | Ubuntu 24.04.4 | Docker CE 29.9.1 | 5.6.0 | 已在 docker 组 |
| 43.163.113.98 | Ubuntu 24.04.4 | Docker CE 29.9.1 | 5.6.0 | 已在 docker 组 |
| 43.128.72.83 | Ubuntu 24.04.4 | Docker CE 29.9.1 | 5.6.0 | 已在 docker 组 |
| 43.153.204.197 | Ubuntu 24.04.4 | docker.io 29.1.3 | docker-compose-plugin 2.27.1 | 不在 docker 组 |

均确认 ubuntu 可以免密 sudo。初始未发现容器；服务器并非全部没有软件，因此按实际检查准备场景，没有把“已重装”推断为干净软件环境。

## .197 第一次安装失败：环境清理遗漏

首次准备移除了 docker.io、docker-compose-plugin、containerd、runc，但旧 `docker.socket` 仍在运行。替换包后 systemd 记录 `Socket unit configuration has changed ... no open socket file descriptor left`，Docker CE 启动报 `no sockets found via socket activation`。

网页自动安装任务 `015b12bd-b3ac-42f5-878c-7cddcd286251` 正确报告失败和已变更软件包。此时 ubuntu 已加入 docker 组，失败并非加组失败。诊断见 [远端日志](43.153.204.197-install-diagnostic.txt)。

这是本次准备过程留下的状态，不能把此次失败记作干净环境安装失败。随后停止 docker.service、docker.socket、containerd.service，移除本次新装的 Docker CE 软件包，daemon-reload、reset-failed，移除 ubuntu 的 docker 成员资格，确认 docker 命令不存在且 socket inactive，见 [清理记录](43.153.204.197-clean-reset.txt)。

再从网页点击安装必要组件，最终安装与验证成功，见 [任务截图](ui-first-install-success.png)。保留第一次失败历史，未删除或改写失败结果。

初次准备脚本最后的 dpkg 格式化检查曾有 shell 引号错误，但卸载已执行；已另用独立命令确认 docker 不存在，见 [复核](43.153.204.197-clean-verified.txt)。

## 本地运行环境

- CES 地址 `http://127.0.0.1:9090/`；profile `tmp/dsh-home`。
- 测试前构建核心、容器、已有扩展测试插件并重启，加载修复后的产物。
- 使用数据库里已有的“新加坡通用密钥”。服务器列表初始为空，已有分组与密钥保留。
- profile 原来已启用数据库扩展测试插件，本次没有更改运行 profile。
- 中英文验证完成后恢复中文。
- 本次不重复运行原 167 条验收；代码竞争条件与独立插件类型消费沿用 [本轮修复的自动化证据](../server-detail-extensions-design-review-2026-10-21/remediation.md)。

## 证据归档处理

文本日志归档时统一为 LF、移除行尾空白和终端颜色控制码，保留命令输出内容及失败记录。JSON 仅统一末尾换行。截图保持原文件；无实际页面内容的 AX 差分导出未收录。
