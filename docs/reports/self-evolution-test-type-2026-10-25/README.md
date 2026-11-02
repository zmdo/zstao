# B 测试服务器类型验收（2026-10-25）

- 状态：`test` 类型定义、recipe 和插件安装路径已跑通；构建 Agent 仍为手工安装
- B：`43.163.113.98`
- 代码：`test` 类型 requirements 4 项，新增 `scripts/test.sh`

## 1. 类型

```text
type: @smp/console-self-evolution/test
requirements:
  docker-engine
  docker-compose
  postgresql（postgresql-test-docker）
  caddy（caddy-test-docker）
```

`test.sh` 在 `/srv/ces-test` 创建：

```text
compose project: ces-test
postgres-test：postgres:16.15，库 ces_test，用户 ces，健康 pg_isready
caddy：caddy:2.10.2，80 -> 80，Caddyfile 反向代理 candidate-ces:9090
```

Caddy 的 recipe 健康检查使用容器内 `caddy version`，不依赖候选上游。

## 2. 插件安装

B 清空旧候选容器后，在 CES 中登记为 `B-163-98`（test 类型），执行
`install-components`。

第一次 apply_plan 的远端监督进程结果：

```text
state: completed
docker-engine    keep      29.9.2
docker-compose   keep      5.6.0
postgresql       installed 16.15.0（container postgres-test）
caddy            installed 2.10.2（container caddy）
```

宿主侧 Job 当时报 `command_timeout`，但远端容器与监督进程结果均为完成；随后
重新执行 `install-components` 成功（检查完成，无缺失软件）。

## 3. 发现并修复的问题

detect 操作不是通过 root 监督进程执行，而是以 SSH 登录用户 `ubuntu` 运行。
初始 `test.sh` 直接调用 `docker`，该用户没有 docker 组权限，导致巡检把已安装的
PostgreSQL/Caddy 判为 `missing`。

修复：`test.sh` 的 `docker()` 在普通用户下失败时回退到 `sudo -n docker`，
与 `stack.sh` 一致。重建插件并重启 CES 后：

```text
服务器状态：normal
software_state：ready
无 reasons
```

## 4. 当前状态

```text
ces-test-postgres-test-1  Up (healthy)
ces-test-caddy-1          Up，0.0.0.0:80 -> 80
GET http://43.163.113.98/ → 502（candidate-ces 尚不存在，属预期）
```

## 5. 未完成

- 构建 Agent 仍是手工安装，`test` 类型还没有 agent 软件/recipe。
- 候选尚未加入 `ces-test_default` 网络，Caddy 仍返回 502。
- 候选部署脚本仍使用独立 `ces-candidate` 网络和容器 80 端口，需要改为经 Caddy。
- 测试数据库/Caddy 与候选部署、构建 Job 的整合尚未验证。

## 6. 下一步

1. 增加 `onedev-build-agent` 类型与 bootstrap token。
2. 候选容器加入 `ces-test_default`，改由 Caddy 80 入口。
3. 更新候选部署 Job 和报告。
