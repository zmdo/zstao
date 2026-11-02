# 自演进 A/B/C 验收汇总（2026-10-25）

## 1. 入口

| 角色 | 地址 | 当前结果 |
| --- | --- | --- |
| A OneDev | http://43.128.69.189/ | 200 |
| B 候选 | http://43.163.113.98/ | 303 /login，登录 200 |
| C 生产 | http://43.153.204.197/ | 303 /login，登录 200 |

B/C 初始账号：`admin` / `changeme`，首次登录后应修改。

## 2. 已完成

### 类型与安装

- `infrastructure`：OneDev、PostgreSQL、Caddy。
- `test`：Docker、Compose、PostgreSQL（ces_test）、Caddy、OneDev build agent。
- `host`：Docker、Compose、PostgreSQL（ces）、Caddy、CES 部署接收端。

B 的 build agent 为在线 `ces-build-agent`（token id 3）；A 的发布 agent 为
在线 `ces-deploy-agent`（token id 5）。

### 构建与候选

```text
build #17 SUCCESSFUL  digest 5c4b6371...
candidate #21 SUCCESSFUL
B candidate-ces：digest 5c4b6371...
B ces_test：36 条迁移，1 个账号
```

### 发布与回滚

```text
release  #15 SUCCESSFUL  a789ed9f...
release  #18 SUCCESSFUL  5c4b6371...（build 17）
rollback #19 SUCCESSFUL  回到 a789ed9f...
```

独立 rollback Job：

```text
POST /~api/job-runs  jobName=rollback  params.release=<release id>
```

### 清空重建

清空 C 的 `/srv/ces-prod`、容器、用户和 wrapper 后，由 `host` 类型重新安装，
再执行 release #20 恢复生产：

```text
C：software_state=ready
prod-ces：a789ed9f...
ces：36 条迁移，1 个账号
```

### 备份/恢复

```text
backup：/srv/ces-prod/backups/ces-20261025T120139Z.sql
探针表 restore_probe(1, 'p3-backup')
DROP 后 restore，查询恢复为 1|p3-backup
恢复后登录 200
```

## 3. 验收报告索引

- [A recipe 验证](../self-evolution-a-recipe-verification-2026-10-25/README.md)
- [B build agent](../self-evolution-b-build-agent-2026-10-25/README.md)
- [干净构建](../self-evolution-clean-build-2026-10-25/README.md)
- [候选镜像](../self-evolution-candidate-image-2026-10-25/README.md)
- [流水线与候选](../self-evolution-pipeline-candidate-2026-10-25/README.md)
- [registry 与 digest](../self-evolution-registry-digest-2026-10-25/README.md)
- [test 类型](../self-evolution-test-type-2026-10-25/README.md)
- [候选经 Caddy](../self-evolution-candidate-caddy-2026-10-25/README.md)
- [build agent 类型](../self-evolution-build-agent-type-2026-10-25/README.md)
- [host 类型](../self-evolution-host-type-2026-10-25/README.md)
- [P2 发布/回滚](../self-evolution-p2-release-2026-10-25/README.md)
- [P3 清空重建](../self-evolution-p3-clean-rebuild-2026-10-25/README.md)
- [备份/恢复演练](../self-evolution-backup-restore-2026-10-25/README.md)

## 4. 待确认

- 浏览器人工验收：请打开 B/C 入口，确认登录页、登录后页面和关键操作。
- OneDev 中仍有一条旧的离线 `ces-build-agent` 记录（token id 2）；当前使用 token id 3。
- 备份仍是 C 本机逻辑备份，不是异地或 PITR。
- 发布审批和用户签收没有正式记录。

## 5. 结论

A/B/C 三种服务器类型、构建、候选、发布、回滚、清空重建和逻辑备份/恢复均
已有可复现记录。剩余主要是人工浏览器确认、清理旧 agent 记录，以及备份异地化。
