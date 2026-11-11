# 在应用服务器发布网站入口

在应用镜像部署和内部业务检查成功后执行。所有 Docker、站点写入和 reload 命令均通过 `platform_server_exec` 在目标应用服务器执行；文件用 `platform_server_rsync` 传输。不要部署到 Harness 容器、本地机器或 OneDev 构建容器。

## 固定约定

- 必要软件容器：`ces-openresty`，Linux host 网络，可访问宿主机回环端口。应用 Compose 使用 `127.0.0.1:<内部端口>:<容器端口>`；容器内业务仍需监听 `0.0.0.0`。
- 宿主机目录：`/var/lib/ces/application-server/openresty`，整体只读挂载为容器内 `/etc/ces-openresty`。主配置 `nginx.conf` 由插件维护，仅通过 `sites/*.conf` 发布站点；证书放在 `certs/`。不要改容器内部文件或挂载单个配置文件。
- 插件首次安装即监听 IPv4 的 80/443。默认 HTTP 返回 404（保留网关健康路径），默认 HTTPS 拒绝未绑定域名的 TLS 握手，不安装假证书。站点加入后按 IP/域名路由；网关常驻并设置 `unless-stopped`。网关健康核对 HTTP 和 TLS 监听，不代表某个应用或公网可达。
- 站点命名：`ces-project-<OneDev项目ID>-<入口标识>.conf`，写入注释标明 project/serverId/releaseId。相同项目沿用该文件；不同项目不共用文件。入口标识仅使用小写字母、数字、连字符，不接受路径。
- 网关配置写操作及 reload 共用宿主机锁 `/var/lib/ces/application-server/openresty.lock`，与软件安装互斥。整个写入、测试、reload、探测、失败恢复必须在**同一次** SSH 命令持锁期间完成；不能在两次工具调用之间保留锁。可用 `flock -n` 或 Python `fcntl.flock`，忙时重试，不能删锁文件。

## 选择端口与站点

1. 查询平台服务器及 `docker inspect ces-openresty`、`docker exec ces-openresty openresty -t -q -c /etc/ces-openresty/nginx.conf`。检查 `ss -ltnp`、已有站点、项目当前发布记录和应用回环健康地址。容器缺失时走服务器管理的必要软件安装，不自行另起 Nginx。
2. 无域名：默认使用已由 OpenResty 监听的 80，`server_name` 填服务器实际公网 IP，不能使用 `_`（它不会匹配 IP，请求会落入网关默认 404）。同一个 IP/端口根路径只能属于一个应用；已有项目占用时使用其他公开端口或用户提供的域名，不擅自改为子路径部署。不要给业务容器直接发布 80/443，也不要在站点里重复声明 `default_server`。
3. 有域名：规范化为小写 ASCII 主机名（国际域名转 Punycode），拒绝 URL 路径、端口、空白、换行、通配符及配置字符。检查同名站点是否属于本项目。默认 HTTP 入口 80，同一 OpenResty 可按不同 `server_name` 共享 80。若端口归其他服务所有，报告冲突；除非已有明确迁移授权，不接管、停止或改写该服务。非标准端口必须明确写入交付 URL，DNS 本身不能映射端口。
4. 从 `templates/deploy/site.conf` 渲染候选文件。端口必须为 1–65535 的整数，入口端口不能等于上游端口；releaseId 使用已验证的小写字母、数字、下划线或连字符。域名模式填写精确 `server_name` 和 Host guard；IP 模式填写核实的公网 IP 并去掉 guard。保留 `$host` 等 Nginx 变量，勿被 shell 提前展开。未渲染占位符不允许上线。`ces-openresty.invalid` 是保留的网关健康主机名，不能用于应用站点。
5. 上游固定为本应用 `127.0.0.1:<内部端口>`。模板支持 HTTP/WebSocket，并在网关边界重建转发头；不要把任意客户端传来的 `X-Forwarded-For/Proto` 当可信值。需要保留 CDN 真实 IP 时，按已确认的代理地址范围另行配置 real_ip；不能全网信任。

## 安全发布与失败恢复

1. 从固定 commit 的发布快照渲染文件，把候选文件传入本项目暂存目录。为旧配置记录 SHA-256、是否存在、备份路径及本次候选 SHA-256。站点备份保存在该应用 `releases/<releaseId>/gateway/` 或网关 `backups/` 下，不能留成 `sites/*.conf` 被重复加载。拒绝符号链接、同名其他项目配置及预检后被他人改变的文件。
2. 取得全局网关锁，重新核对所有权、旧文件摘要、端口和重名站点。将候选文件写入 `sites/` 的临时文件（后缀不是 `.conf`），再同文件系统原子替换目标文件。
3. 执行 `docker exec ces-openresty openresty -t -q -c /etc/ces-openresty/nginx.conf`。失败立即恢复旧文件（首次创建则删除本次文件），重新检查旧配置；不要 reload 无效配置。
4. 测试通过后执行 `docker exec ces-openresty openresty -s reload -c /etc/ces-openresty/nginx.conf`。在同一锁内以有限次数和超时访问服务器回环入口，带实际 Host（HTTPS 用 `--resolve`），验证应用健康响应、业务路由及 `X-CES-Release` **等于本次 releaseId**。`reload` 返回 0 不证明新 worker 已成功监听；端口绑定失败可能仍在服务旧配置。
5. reload 或入口探测失败：仍在锁内恢复旧文件，再 `-t` 和 reload，验证旧入口。恢复失败必须报告“入口恢复失败”及实际状态，不能声称旧网站正常；首次发布没有旧站点则删除失败配置并 reload。SIGKILL/主机重启后的不确定状态通过文件摘要、容器日志和实际请求核对，不盲目覆盖重试。
6. 本机入口检查通过后释放锁，再从服务器外实际请求交付 URL，核对 release header、页面、API 和必要的 WebSocket。外部失败需区分 DNS、端口连通、防火墙/安全组和业务错误，不用 SSH 隧道或 `curl -k` 作为公网验收结果；不要因公网检查失败盲目重启健康应用。

## 用户提供域名时

1. 必须同时完成 **OpenResty 的 server_name 绑定** 与 **DNS 指向**。在变更前用 `platform_domain_list` 查所属托管域名，用 `platform_domain_dns_list` 查询用户给定的精确主机名，保存当前记录 ID、类型、内容、TTL、代理状态。域名由用户提供，不自行挑选其他业务域名。
2. 先部署和验证 OpenResty 站点（通过目标服务器 IP + Host / `--resolve`），再切 DNS，避免先把用户流量指向尚未就绪的入口。调用 `platform_domain_dns_create` 新增缺失 A 记录，或在当前部署授权覆盖该主机名且确认归属时用 `platform_domain_dns_update` 更新**查询到的 record_id**，`content` 使用核实的应用服务器公网 IPv4，带明确 `reason`；已有正确记录直接复用。不要使用 Harness/OneDev 地址或内网 IP。
3. 同名 CNAME、多个 A、AAAA 或已被其他应用使用的记录会影响流量，必须全部核对。无 IPv6 就不要创建 AAAA；已有其他目标的 AAAA/记录不能假装已完成全量切换，也不能顺手删除其他业务记录。需要变更超出当前发布范围时明确指出具体冲突。域名未托管时列出准确 DNS 记录交由域名管理方配置，同时报告“站点已配置，DNS 待完成”。
4. 使用现有平台工具的权限机制。已有代理状态不要擅自切换；新记录按用户要求及平台策略选择。DNS 已有 CDN 代理时，从实际域名验证 CDN → OpenResty 链路，不能仅比对 DNS 返回值是否等于源站 IP。
5. DNS 写入成功后检查实际解析与域名 HTTP 请求；缓存未更新时报告等待解析，记录待恢复位置。只在这条真实访问链路成功后报告“域名已绑定并可访问”。
6. 域名绑定默认只代表 HTTP，443 已监听也不代表网站 HTTPS 已配置。需要 HTTPS 时，先取得该域名有效证书、私钥及续期安排，挂入 `certs/<域名>/`，新增 `listen 443 ssl` 及精确 `server_name`，配置 `ssl_certificate` / `ssl_certificate_key` 并按同一事务发布。不要修改或复用默认 TLS 拒绝站点，不添加 `default_server`。证书内容和私钥不进 Git/日志；复用证书前核对域名、有效期和所有权。验证证书链与主机名通过后才开启 HTTP → HTTPS 跳转。不能拿自签名证书、CDN Flexible 模式或 `curl -k` 宣称端到端 HTTPS。缺证书/签发能力时明确报告 HTTPS 未完成。

## 交付记录与回滚

把服务器、项目、发布 ID、站点文件、旧/新摘要、内部端口、入口端口、域名、DNS 变更前后记录和内外网验收结果写入 `.ces/delivery/` 与本项目服务器发布记录。这里不保存私钥。

应用版本回滚后，如内部端口/域名/入口配置变动过，恢复对应站点快照并重新执行持锁测试、reload 和实际请求。DNS 回滚只针对本次修改且当前值仍等于本次写入值的记录；发现并发变化先核对，不批量删除。不修改数据库或其他应用站点。
