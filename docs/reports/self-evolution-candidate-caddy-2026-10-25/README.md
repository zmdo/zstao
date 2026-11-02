# 候选经测试 Caddy 与测试数据库部署（2026-10-25）

- 状态：候选已接入 `test` 类型的 Caddy 和测试 PostgreSQL；未做生产发布
- 源码：`041f25b`
- B：`43.163.113.98`

## 1. 测试类型网络

`test.sh` 创建的 Compose 项目：

```text
ces-test
  postgres-test  postgres:16.15，库 ces_test，用户 ces
  caddy          caddy:2.10.2，0.0.0.0:80 -> 80
Caddyfile：reverse_proxy candidate-ces:9090
```

候选容器加入 `ces-test_default`，不再映射宿主 80；80 由 Caddy 持有。

## 2. 镜像

测试类型代码合并后的 build #11：

```text
#11 SUCCESSFUL  commit 041f25b9
镜像：43.128.69.189/ces/ces-candidate:build-11
digest：sha256:a789ed9fccc1afec5fbece97dc4b13ee70cfee57167358ff6391a5a247e9906f
```

## 3. 候选部署

```text
#12 candidate SUCCESSFUL（build-6 digest，验证 Caddy 链路）
#13 candidate SUCCESSFUL（build-11 digest，最终状态）
```

最终容器：

```text
candidate-ces
  config image: 43.128.69.189/ces/ces-candidate@sha256:a789ed9f...
  actual image: sha256:a789ed9f...
  network: ces-test_default
  ports: 9090/tcp（不映射宿主）
ces-test-caddy-1      Up，0.0.0.0:80 -> 80
ces-test-postgres-test-1  Up (healthy)
```

验证：

```text
http://43.163.113.98/ → 303 /login
admin/changeme → 200 {"ok":true}
/console-api/auth/me → authenticated=true
ces_test：console_schema_migrations 36 条，accounts 1 条
```

## 4. 发现并修复的问题

候选 Job 以 `cesagent` 运行，最初生成的 `/srv/ces-test/candidate.env`
是 `root:cesagent` 600，agent 无法读取，部署失败：

```text
docker: --env-file: open /srv/ces-test/candidate.env: permission denied
```

修复：`test.sh` 生成该文件后 `chown cesagent:cesagent`；本次也手工修正了已存在的文件。

## 5. 未完成

- 构建 Agent 尚未纳入 `test` 类型 recipe，仍为手工安装。
- 候选部署还不是发布流程的一部分；C 类型、A 发布 Agent、回滚未开始。
- 用户验收没有正式记录。
