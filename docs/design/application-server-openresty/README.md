# 应用服务器 OpenResty 与网站发布

状态：2026-11-11 已发布到线上，两台托管测试服务器均已安装并监听 80/443。实际 Harness 会话已完成待办应用的入口发布，公网 HTTP 可用；公网 443 连通检查仍超时。详见 [线上验证记录](ONLINE-VALIDATION.md)。

## 用户体验

选择“应用服务器”类型后，必要软件为 Docker Engine、Docker Compose、OpenResty 网站网关。仍由现有组件预检、安装、校验流程执行；TCR 凭据沿用类型准备时的自动注入，不增加部署凭据配置。

AI 会话收到“构建并部署项目”后：

1. 在 OneDev 创建/发现仓库，开发测试、提交代码，由 OneDev 构建并推送 TCR 镜像。
2. 在目标应用服务器拉取固定 digest 并运行应用，业务端口绑定宿主机回环地址。
3. 通过同一服务器上的 OpenResty 转发网站入口，交付 IP/端口地址。
4. 用户提供域名时配置对应站点；托管域名通过现有 DNS 工具绑定目标服务器，非托管域名列出准确待配置记录。
5. 分别验证内部业务、网关入口和真实公网 URL，再报告交付结果。HTTPS 单独核验有效证书、证书链、域名与续期安排。

## 必要软件实现

扩展现有 `plugins/application-server`，新增软件 `openresty` 与配方 `openresty-docker`，显式依赖 `container-runtime/docker-engine`。不新建网关插件、网站管理页面或 Harness 工具。

配方使用官方 `openresty/openresty:1.27.1.2-13-alpine`，固定多架构镜像 digest `sha256:950d6b5cf5aef91da31745d5693e53dd292c33d6784ff7f52a08261712ce4b07`（2026-11-11 核对 Docker Hub，支持 amd64/arm64）。候选信息随插件发布，预检无需服务器先有 Docker。OpenResty 使用四段版本，软件定义保留完整版本，并把镜像构建修订/digest 纳入目标身份。

| 项目 | 约定 |
| --- | --- |
| 容器 | `ces-openresty`，`unless-stopped`，日志轮转 |
| 网络 | Linux host 网络，转发到 `127.0.0.1:<应用端口>` |
| 宿主机目录 | `/var/lib/ces/application-server/openresty` |
| 容器目录 | `/etc/ces-openresty`，整个目录只读挂载 |
| 配置 | 插件维护 `nginx.conf`；AI 维护 `sites/<项目>-<入口>.conf` |
| 证书 | `certs/`，与容器生命周期分离，私钥不入库 |
| 变更锁 | `/var/lib/ces/application-server/openresty.lock`，安装与站点修改共用 |

首次安装即**默认监听 IPv4 80/443**：HTTP 未配置站点时返回 404，保留网关健康路径；TLS 默认站点使用 `ssl_reject_handshake` 拒绝未知域名，无需安装自签名证书。后续 IP/域名站点共享这两个入口。未绑定域名证书时，不宣称网站 HTTPS 可用。

预检和执行前检查默认端口，其他服务占用时明确报错，不自动杀进程。检测核对目录归属、容器归属、实际镜像、网络、挂载、真实版本、配置测试与 HTTP/TLS 监听。拒绝覆盖同名非托管容器、外部目录、符号链接或漂移的基础配置。

替换时先用新镜像测试所有保留的站点配置，再保留并停止旧容器，创建并验证新容器；常规启动失败恢复旧容器，站点/证书不删除。进程被强制结束或主机重启后若遗留 `ces-openresty-previous`，恢复操作报告状态不确定，需核对新旧容器、实际监听及站点，再决定恢复或清理；不猜测删除旧实例。网关替换有短暂入口中断，不承诺零停机。

## Skill 范围

更新 `skills/project-delivery/SKILL.md`，新增 [入口发布说明](../../../skills/project-delivery/references/openresty.md) 与站点模板。应用的后台发布运行时保持原有职责；`succeeded` 仅表示应用内部部署验收成功，后续还需入口发布。

站点发布必须在同一次 SSH 命令的全局锁中完成：校验旧摘要与所有权 → 原子替换候选 → `openresty -t` → reload → 带 Host 的实际请求与发布标记核验。失败恢复旧文件及旧入口。DNS 在源站验证成功后切换，回滚仅修改本次发布拥有且未被并发改动的记录。

用户提供的域名无需新增平台配置。复用 `platform_domain_list`、`platform_domain_dns_list/create/update` 和既有权限/审计；绑定包括 `server_name` 和 DNS，两者不能互相代替。HTTP 域名绑定不会自动获得 HTTPS，首版不新增证书签发/续期服务。

## 兼容与上线

- 无数据库变更，无清理迁移。现有 TCR 注入与独立 Docker 认证目录不变。
- 已有应用服务器发布新插件后需通过必要软件“安装组件”流程补齐网关；不会在插件加载时远程安装软件或重启业务。
- 新 Skill 连同 `references/`、`templates/` 一起导入并启用。旧项目按自身发布范围迁移回环绑定及入口；不批量改其他 Compose 项目。
- B 与 test-72-83 此前均有旧测试容器占用 80。本次用户已明确授权处理两台测试服务器，线上验收会备份记录并停止冲突入口，使 OpenResty 接管 80/443；通用安装代码仍明确报告端口冲突。
- 删除服务器类型不自动删除网关及站点，沿用必要软件不随类型删除卸载的行为，避免中断已有网站。

## 验证

- 应用服务器单元测试覆盖四段版本约束、Docker 安装前规划、固定镜像、防覆盖、重复执行、站点保留、失败替换恢复和中断恢复状态；既有 TCR 测试继续通过。
- 插件类型检查、构建及打包清单检查；项目后台部署契约测试。
- 实际 Docker 验证记录见 [验证记录](VALIDATION.md)。公网 DNS/HTTPS 需使用用户实际提供的域名验收，测试域名的 Host 路由不能代表公网绑定已完成。

参考：[官方 OpenResty Docker 镜像](https://github.com/openresty/docker-openresty)、[Docker host 网络](https://docs.docker.com/engine/network/drivers/host/)、[Nginx 命令参数](https://nginx.org/en/docs/switches.html)、[默认 TLS 握手拒绝](https://nginx.org/en/docs/http/ngx_http_ssl_module.html#ssl_reject_handshake)。
