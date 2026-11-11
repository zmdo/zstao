# 线上发布与测试记录

日期：2026-11-11，Asia/Shanghai。用户明确授权处理服务器管理中登记的两台测试服务器，包括已有端口占用。

## 平台发布

- 平台运行提交：`3b5a904ba1051e621f5d7085c1ffd3975c2982e3`，分支 `codex/harness-project-delivery`。
- OneDev：`ces-platform`，构建 ID **12**、项目内编号 **6**，`SUCCESSFUL`。
- CES 镜像：`ccr.ccs.tencentyun.com/zstao/ces-integration@sha256:ae10a64575ec38f6d01287365ded9e40f414daab853ffedca29d49c3fee30286`。
- CES 已按固定 digest 重建并确认 healthy，运行容器包含新的 OpenResty 配方。无数据库变更。
- 完整 Skill（15 个文件，含 references/templates）已更新到 `/dsh-home/skills/project-delivery`。`SKILL.md` SHA-256 为 `6ff7d3d178c1c846f4ad7b50739f98c40568109fb90e1d829352575438b4e6a9`，实际会话已读取新入口说明。
- 主机备份目录：`/opt/ces/backups/openresty-20261111/`，含原 Compose、发布回执和原完整 Skill；旧镜像保留为 `ces:pre-openresty-20261111`。

## 必要软件安装

通过线上服务器管理 `/console-api/servers/<id>/install-components` 执行，测试了真实规划、安装、验证、状态持久化和类型准备流程，没有用手工安装代替平台安装验收。

| 服务器 | 地址 | 平台安装执行任务 | 最终状态 |
| --- | --- | --- | --- |
| B-163-98 | `43.163.113.98` | `b9ae3e32-3901-4a71-a053-1e48724fcaee` | succeeded，OpenResty 1.27.1.2，healthy，80/443 监听 |
| test-72-83 | `43.128.72.83` | `66917e2a-511d-490d-9658-5c1c9075652e` | succeeded，OpenResty 1.27.1.2，healthy，80/443 监听 |

两台服务器均为 Ubuntu 24.04 / x86_64。平台必要软件清单包含 Docker Engine、Docker Compose、OpenResty；安装后服务器状态为 normal。Docker 和 Compose 保持原版本，类型准备继续使用原 TCR 凭据注入机制。

首次保留原服务尝试安装，两台均报告 `gateway_port_in_use_80`，未停止或覆盖原服务。随后按本次授权处理冲突：

| 服务器 | 原入口 | 本次处理 |
| --- | --- | --- |
| B | `plan-a-ces`，80 → 9090 | 备份 inspect，restart 改为 no，停止容器；保留容器和数据 |
| test-72-83 | `ces-infra-caddy-1`，80 → 80 | 同上；原 OneDev 和 PostgreSQL 继续运行 |

备份位于各测试服务器 `/var/backups/ces-openresty-20261111/`，文件权限 0600。A 的原 OneDev 后续由 OpenResty 代理到 `127.0.0.1:6610`，仍可通过其公网 IP 的 HTTP 入口访问。

重复执行“安装组件”也通过：B 任务 `6098f0ed-cb28-44fa-852f-89f3f01c6255`、A 任务 `640738ea-cfd6-4f33-b1ce-c99b1a1d58c0` 均 succeeded，调用前后的网关容器 ID 相同。

## 网关功能测试

在 A 上创建独立、仅绑定回环地址的临时探测服务。临时域名使用 `*.example.test`，通过 Host/SNI 指定，不写 DNS。创建一天有效的测试 CA 和域名证书，客户端显式信任该 CA 并校验主机名，未使用 `curl -k` 跳过校验。

以下检查均通过：

1. 默认 HTTP 健康路径返回 200，未配置域名的普通请求返回 404；默认 TLS 拒绝未绑定的 SNI。
2. 真实 HTTP 上游转发，Host、协议和端口头正确；客户端伪造的 X-Forwarded-For 在网关边界重建。
3. 两个不同 Host 在同一个 80 端口返回各自发布标记。
4. WebSocket 101 握手、双向数据回显。
5. 服务器内 443 的 TLS SNI、测试 CA 证书链和主机名验证；HTTPS 上游收到 `X-Forwarded-Proto: https`。
6. 故意写入错误配置时 `openresty -t` 拒绝，未 reload 的旧站点继续服务；恢复文件后测试及 reload 成功。
7. 发布不可达上游，实际请求观察到 502，再恢复旧配置并验证 200 和旧发布标记。
8. 删除 A 的网关容器后，通过服务器管理重新安装。准备任务 `902e1c0c-f99a-42bb-b868-d49858740745` 对应流程完成，容器 ID 改变；站点和证书保留，上述 HTTP/WebSocket/TLS 与恢复检查再次通过。

全部临时测试站点、证书、CA 私钥及探测进程均已清理。最终 A 只保留 `legacy-onedev-ip.conf`，B 只保留实际待办应用的 `ces-project-6-web80.conf`；两台仍默认监听 80/443，restart 均为 unless-stopped。

## 实际 Harness 会话验收

新建标准 Harness 会话 `session-33c3f112-db2c-4247-89f5-b9d2f7e60408`，工作区 `/srv/workspaces/openresty-verification`。仅该会话临时使用完全访问权限，结束后恢复 `workspace-write`。

输入要求是在 B 上发布已有中文待办应用到默认 80，必要时将业务端口改为回环绑定并保存到项目，完成必要的提交、构建、部署、入口配置与业务验证；未提供仓库地址、配置内容或具体工具参数。没有提供域名，因此明确不改 DNS。

实际观察到 AI：

1. 加载 `project-delivery` 并读取 `references/openresty.md`，通过平台工具找到服务器和 `apps/zh-todo` 项目。
2. 将 Compose 改为 `127.0.0.1:18100:8080`，保留数据卷；本地 18 项应用测试通过，提交并推送 `d4336621bde5af7839ac55e92bb18b3de3665111`。
3. 触发 OneDev 构建 **13**（项目内编号 **4**），成功并获取固定镜像 digest。独立读取构建及产物再次核对一致；该构建复用了镜像层缓存，不将缓存日志表述为本次重新执行 18 项测试。
4. 通过后台发布运行时完成 `rel-20261111-1`，状态 succeeded；独立 Docker inspect 证实业务端口只绑定 `127.0.0.1`。
5. 生成精确 `server_name 43.163.113.98` 的站点，通过平台 rsync/exec 写入，使用共同网关锁、原子替换、配置校验、reload 和发布标记探测。
6. 验证外部 HTTP 页面、健康接口、增删改及重启持久化，并清理其测试数据。

最终应用镜像：

```text
ccr.ccs.tencentyun.com/zstao/ces-project-6@sha256:bdcb197407d0e292120893b3ea387055cd2aaff7f2fe033294a93aa9290158a0
```

实际工具调用：skill 1、platform_server_list 1、platform_server_get 1、platform_onedev 7、platform_server_exec 17、platform_server_rsync 3；另有本地开发与文件工具。过程中 AI 自行纠正了漏填 server、修改前未用 read 读取文件、CES 本地无 Python 等工具错误，没有人工提供站点配置或替代它发布。

独立业务复核从 CES 主机访问 **B 的公网 IP:80**，15 项检查通过：健康、新增字段、单条读取、编辑保留字段、搜索、优先级/逾期/完成/进行中筛选、统计、非法输入、删除、实际重启应用后的数据保留及测试数据清理。只删除本次创建的任务，最终恢复验收前的任务数量。

## 访问结果与验证边界

- [B 待办应用](http://43.163.113.98/)：公网 HTTP 200，发布标记 `rel-20261111-1`，页面与 API 请求通过。应用在 B，入口也在 B，没有使用本地部署或 SSH 隧道作为交付地址。
- [A 原 OneDev](http://43.128.72.83/)：通过 OpenResty 转发原有回环服务；最终公网请求返回 HTTP 200，发布标记 `legacy-onedev-20261111`。
- **公网 443 未通过连通验证**：工作机 TLS 握手超时；从 CES 主机对两台公网地址做 TCP 检查，80 可连接、443 超时。服务器本机 443 监听、默认 TLS 拒绝及带证书 HTTPS 均已验证。两机 UFW inactive，INPUT 默认 ACCEPT，YJ 链为针对来源 IP 的 22 端口规则；未读取云安全组，无法据此断定具体网络拦截位置。没有把内部 HTTPS 成功当成公网 HTTPS 可用。
- 没有用户指定的真实域名，本次未变更 DNS、未签发公认 CA 证书或配置生产续期。Host/SNI 测试验证了域名路由能力，不能代替真实 DNS 绑定验收。
- 独立内置浏览器打开公网 IP 时返回 `ERR_BLOCKED_BY_CLIENT`，因此本次不声称完成独立浏览器交互或视觉验收。工作机 API 复核也发生过一次连接中断，已清理当时创建的两条测试任务，改从 CES 对公网入口完成上述完整 15 项复核。
- 首次测试脚本在 reload 后立即请求时遇到旧默认 404；补充等待新发布标记后通过。站点上线以实际响应标记为准，不以 reload 返回 0 为准。
