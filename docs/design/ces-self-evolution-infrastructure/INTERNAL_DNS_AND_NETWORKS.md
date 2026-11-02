# 自演进基础设施内网域名与 Docker 网络方案

- 状态：方案设计，未实施
- 日期：2026-10-24
- 适用：A 基础设施、B 测试、C 生产
- 范围：内网域名、TLS、Docker 网络和跨主机访问

## 1. 目标

为三台服务器提供统一的内网域名：

```text
dev.ces.internal
test.ces.internal
prod.ces.internal
registry.ces.internal
```

同时保持：

```text
测试环境不能直接访问生产容器网络
生产环境不能直接访问测试容器网络
外网 DNS 不受影响
```

## 2. 非目标

第一版不做：

```text
统一扁平 Docker 网络
Docker Swarm Overlay
跨主机容器 IP 直连
公网 DNS 解析内网地址
把生产数据库暴露给测试环境
```

## 3. 总体结构

```text
               私有 DNS：ces.internal
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        A ces-infra      B ces-test       C ces-prod
        │                │                │
   dev.ces.internal  test.ces.internal  prod.ces.internal
   registry...       候选 CES           正式 CES
        │                │                │
      Caddy            Caddy            Caddy
        │                │                │
   OneDev/Postgres   测试容器          生产容器
```

每台主机保持独立的 Docker 网络，不共享 Docker bridge。

## 4. 域名规划

| 域名 | 指向 | 用途 |
|---|---|---|
| `dev.ces.internal` | A | OneDev Web/API/Git HTTPS |
| `registry.ces.internal` | A | OneDev 内置容器仓库 |
| `test.ces.internal` | B | 候选 CES 和测试入口 |
| `prod.ces.internal` | C | 正式 CES |
| `ces.internal` | C | 可选的生产短域名 |

内部域名统一使用：

```text
ces.internal
```

不使用：

```text
.local
```

因为 `.local` 与 mDNS 冲突。

## 5. Docker 网络

### A：ces-infra

```text
网络：ces-infra_default
服务：
  onedev
  postgres
  caddy
  coredns
  deploy-agent
```

### B：ces-test

```text
网络：ces-test_default
服务：
  candidate-ces
  postgres-test
  caddy
  build-agent
```

### C：ces-prod

```text
网络：ces-prod_default
服务：
  prod-ces
  postgres-prod
  caddy
```

三套网络互相独立。

### 跨主机访问

只开放必要连接：

| 来源 | 目标 | 端口 |
|---|---|---|
| B | A | 443，镜像仓库/OneDev API |
| C | A | 443，镜像拉取 |
| A | C | 22，发布执行器 SSH |
| 用户 | A/B/C | 443 |

不开放：

```text
B → C
C → B
B → 生产 PostgreSQL
任意主机 → 测试容器 IP
```

## 6. CoreDNS

### 6.1 部署方式

CoreDNS 作为 Docker 容器运行在 A：

```yaml
services:
  coredns:
    image: coredns/coredns:1.12.0
    restart: unless-stopped
    command: -conf /etc/coredns/Corefile
    volumes:
      - ./coredns/Corefile:/etc/coredns/Corefile:ro
      - ./coredns/zones:/etc/coredns/zones:ro
    ports:
      - 10.10.0.10:53:53/udp
      - 10.10.0.10:53:53/tcp
    networks:
      - ces-infra_default
```

只绑定私网地址：

```text
10.10.0.10:53
```

不绑定：

```text
0.0.0.0:53
```

### 6.2 Corefile

```caddy
ces.internal {
    file /etc/coredns/zones/ces.internal
    log
    errors
}

. {
    forward . 1.1.1.1 8.8.8.8
    cache 30
}
```

规则：

```text
ces.internal → 本地 zone
其他所有域名 → 公共上游 DNS
```

不能省略：

```text
forward . ...
```

否则访问 Google、GitHub、npm 等外部域名会失败。

### 6.3 zone 文件

```text
$ORIGIN ces.internal.
$TTL 60

@       IN SOA ns.ces.internal. admin.ces.internal. (
            2026102401 ; serial
            3600       ; refresh
            600        ; retry
            86400      ; expire
            60 )       ; minimum

@           IN NS  ns.ces.internal.
ns          IN A   10.10.0.10

dev         IN A   10.10.0.10
registry    IN A   10.10.0.10
test        IN A   10.10.0.11
prod        IN A   10.10.0.12
@           IN A   10.10.0.12
```

IP 为规划值，实施时替换。

## 7. 主机 DNS 配置

### 7.1 原则

不要：

```text
把所有主机的 /etc/resolv.conf 全部改成 CoreDNS
```

应该：

```text
只有 ces.internal 走 CoreDNS
其他域名继续使用原 DNS
```

### 7.2 systemd-resolved

```bash
resolvectl dns eth0 10.10.0.10
resolvectl domain eth0 '~ces.internal'
```

### 7.3 dnsmasq

```text
server=/ces.internal/10.10.0.10
```

这样：

```text
dev.ces.internal → CoreDNS
google.com       → 原 DNS
```

不受影响。

## 8. Docker 容器 DNS

### 同一 Compose 网络

直接使用服务名：

```text
onedev:6610
postgres:5432
caddy:80
```

不经过 CoreDNS。

### 跨主机域名

容器默认使用：

```text
127.0.0.11
```

Docker 内置 DNS 会转发到宿主机 DNS。

只要宿主机配置了：

```text
ces.internal → CoreDNS
```

容器访问：

```text
dev.ces.internal
```

就会正确解析。

### 不建议全局 dns

不要给所有服务统一加：

```yaml
dns:
  - 10.10.0.10
```

原因：

```text
容器所有 DNS 都依赖 CoreDNS
CoreDNS 故障会导致外网解析失败
```

除非有：

```text
CoreDNS 高可用
forward . 公共 DNS
```

## 9. TLS

`.internal` 无法申请公网证书，使用内部 CA。

推荐：

```text
step-ca
Caddy internal CA
Vault PKI
```

Caddy 示例：

```caddyfile
https://dev.ces.internal {
    tls internal
    reverse_proxy onedev:6610
}

https://registry.ces.internal {
    tls internal
    reverse_proxy onedev:6610
}
```

B：

```caddyfile
https://test.ces.internal {
    tls internal
    reverse_proxy candidate-ces:9090
}
```

C：

```caddyfile
https://prod.ces.internal {
    tls internal
    reverse_proxy prod-ces:9090
}
```

内部 CA 根证书需要分发到：

```text
浏览器
Agent 容器
构建容器
运维机器
```

否则会有证书不受信任警告。

## 10. 端口与暴露

每台主机只对外暴露：

```text
80/tcp
443/tcp
```

内部服务绑定：

```text
127.0.0.1:<port>
```

例如：

```text
A:
  127.0.0.1:6610 → OneDev

B:
  127.0.0.1:9090 → 候选 CES

C:
  127.0.0.1:9090 → 正式 CES
```

PostgreSQL 只存在于各自 Docker 网络：

```text
A：postgres:5432
B：postgres-test:5432
C：postgres-prod:5432
```

不映射到宿主机公网端口。

## 11. 高可用

第一版：

```text
A 运行 CoreDNS
B/C 使用 A 作为条件 DNS
B/C 可运行本地 dnsmasq 缓存
```

风险：

```text
A 故障 → 新域名解析失败
已有连接不受影响
生产 C 仍可运行
```

正式版建议：

```text
A + B 双 CoreDNS
或
云厂商私有 DNS
```

不要使用：

```text
CoreDNS 不可用时自动回退到公共 DNS
```

因为公共 DNS 不应该解析内网域名。

## 12. 安全要求

- CoreDNS 只监听私网地址
- 防火墙限制 53 端口来源
- 不开放公网递归解析
- 不把生产数据库域名写入 DNS
- 只暴露入口域名和必要服务
- 测试环境不能访问生产网络
- 生产环境不能访问测试网络
- DNS 记录变更需要审计
- 内部 CA 私钥不由普通容器持有

## 13. 实施顺序

```text
1. 确认 A/B/C 私网地址
2. 创建 ces.internal zone
3. 在 A 启动 CoreDNS
4. 验证 ces.internal 解析
5. 验证 google.com/github.com 转发
6. 在 A 配置条件转发
7. 在 A 的容器中验证内网域名
8. 在 B/C 配置条件转发和缓存
9. 配置 Caddy 和内部 CA
10. 验证 test/prod 隔离
11. 可选：增加第二 CoreDNS
```

## 14. 验收

必须验证：

```bash
dig @10.10.0.10 dev.ces.internal
dig @10.10.0.10 google.com
dig @10.10.0.10 github.com
```

以及：

```text
容器内解析 dev.ces.internal
容器内访问 google.com
B 容器不能访问 C 的 9090
B 容器不能访问 C 的 PostgreSQL
C 容器不能访问 B 的测试网络
A 停止后已有生产连接不受影响
```

## 15. 结论

```text
统一域名使用 CoreDNS
三台主机保持独立 Docker 网络
跨主机只通过 HTTPS/SSH
CoreDNS 只接管 ces.internal
其他 DNS 继续走原解析器
```

这样既能获得统一内网域名，又不会影响正常外网访问，也不会把测试和生产容器网络合并。
