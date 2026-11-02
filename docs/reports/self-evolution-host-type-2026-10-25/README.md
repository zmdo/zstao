# C 宿主服务器类型验收（2026-10-25）

- 状态：`host` 类型 requirements 已安装；`ces-host` 采用手工执行同一脚本完成
- C：`43.153.204.197`
- 代码：host 类型 5 项 requirements，新增 `scripts/host.sh`

## 1. 类型

```text
type: @smp/console-self-evolution/host
requirements:
  docker-engine
  docker-compose
  postgresql（postgresql-prod-docker）
  caddy（caddy-prod-docker）
  ces-host（ces-host-bootstrap）
```

`host.sh` 在 `/srv/ces-prod` 创建：

```text
compose 项目：ces-prod
postgres-prod：postgres:16.15，库 ces，用户 ces
caddy：caddy:2.10.2，0.0.0.0:80 -> 80
Caddyfile：reverse_proxy prod-ces:9090
```

`ces-host`：

```text
用户 cesdeploy
/srv/ces-prod/{runtime,data,bin,backups,.ssh}
/usr/local/sbin/ces-runtime 白名单入口
/etc/sudoers.d/cesdeploy（visudo 校验通过）
authorized_keys 来自 secrets/authorized_keys
```

## 2. 安装结果

执行 `install-components`：

```text
preflight：c07becf2... succeeded
apply job：91f391ff... succeeded
```

步骤结果：

```text
docker-engine    keep      29.9.2
docker-compose   keep      5.6.0
postgresql       installed 16.15.0（postgres-prod）
caddy            installed 2.10.2（caddy）
```

C 当前状态：

```text
status=normal
software_state=ready
ces-prod-postgres-prod-1  Up (healthy)
ces-prod-caddy-1          Up，0.0.0.0:80 -> 80
http://43.153.204.197/ → 502（prod-ces 尚未部署，属预期）
```

## 3. ces-host 的手工验证

第一次 apply plan 报 `command_timeout`，未进入完整执行。为继续验收，直接把
`host.sh` 复制到 C，以 execute 输入手工执行 `ces-host`：

```text
{"operation":"execute", ... "state":"completed",
 "changes":[{"kind":"user","service":"ces-host","image":"ces-host:1.0.0"}]}
```

随后 `cesdeploy` 用户、目录、authorized_keys、wrapper 和 sudoers 均存在。
`host` 类型的 detect 能识别为 installed，服务器状态恢复 normal/ready。

这说明脚本逻辑可用，但 **`ces-host` 的插件 execute 路径仍未验证**；PG/Caddy
的插件 apply 路径已验证。

## 4. 发现并修复的问题

`ces-host` 的 detect 以 `ubuntu` 用户执行，`/srv/ces-prod` 为 750
`root:cesdeploy`，直接对子路径做 `exists()` 会抛 PermissionError，导致
`software_detection_unknown`。

修复：用 `test -e`，失败时回退 `sudo -n test -e`，再判断路径。

## 5. 未完成

- `prod-ces` 尚未部署；Caddy 80 仍返回 502。
- A 的发布 Agent、release Job、发布记录和回滚未开始。
- C 的 `ces-runtime` 目前是占位脚本，不执行真实发布。
- B 的 build agent recipe 仍被 SSH 认证超时阻塞。

## 6. 下一步

1. 编写 `ces-runtime` 的真实 install/verify/rollback。
2. 在 A 上创建发布 Agent 与 `release` Job。
3. 首次把候选 digest 发布到 C，验证 80 入口和回滚。
