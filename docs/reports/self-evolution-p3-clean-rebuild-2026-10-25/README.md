# P3 清空重建与发布恢复（2026-10-25）

- 状态：C 清空后由插件重建，release Job 恢复生产；B 的 build agent 已上线
- A：`43.128.69.189`
- B：`43.163.113.98`
- C：`43.153.204.197`

## 1. B 的 build agent 完成

SSH 恢复后重新执行 `install-components`：

```text
preflight ced68bf6... succeeded
apply     d4ddfe3f... succeeded
onedev.agent：active
OneDev：ces-build-agent online（token id 3）
B：status=normal，software_state=ready
```

旧的手工 agent 记录仍在 OneDev 中显示为离线（token id 2），当前在线的是
token id 3。

随后 push `ce9a9d5` 触发 build #17：

```text
#17 SUCCESSFUL  agent 3
checkout  1.0s
image   365.0s
artifact  0.5s
digest: sha256:5c4b63713669b8ecbc63ca6864b0db33cd5542b817adc76e5bd38b6a7910dddf
```

## 2. release / rollback Job

新增 `rollback` Job 和参数 `release`：

```text
release  #18 SUCCESSFUL  digest 5c4b6371...（build 17）
rollback #19 SUCCESSFUL  回到 a789ed9f...（build 11）
```

回滚后 C 的 `current.json`：

```text
image: a789ed9f...
previous: 5c4b6371...
```

## 3. C 清空

在 C 上删除：

```text
prod-ces、ces-prod-caddy-1、ces-prod-postgres-prod-1
/srv/ces-prod
/usr/local/sbin/ces-runtime
/etc/sudoers.d/cesdeploy
cesdeploy 用户
```

保留 Docker Engine / Docker Compose 作为基础运行时。

## 4. 插件重建

重新放置 bootstrap：

```text
/srv/ces-prod/secrets/authorized_keys
/srv/ces-prod/bootstrap/ces-runtime.sh
```

执行 `install-components`：

```text
preflight 4ed45bbb... succeeded
apply     6f954700... succeeded
```

结果：

```text
ces-prod-postgres-prod-1  Up (healthy)
ces-prod-caddy-1          Up，0.0.0.0:80 -> 80
cesdeploy                 已创建
/usr/local/sbin/ces-runtime 已安装
C：software_state=ready
```

这次 `ces-host` 也由插件 execute 完成，不再需要手工补执行。

## 5. 发布恢复

```text
release #20 SUCCESSFUL
digest a789ed9f...（build 11）
```

验证：

```text
prod-ces 镜像：sha256:a789ed9f...
current.json previous: 空（清空后首次发布）
PostgreSQL：36 条迁移，1 个账号
http://43.153.204.197/ → 303 /login
admin/changeme → 200 {"ok":true}
```

## 6. 当前状态

```text
A OneDev：  http://43.128.69.189/   → 200
B 测试：    http://43.163.113.98/   → candidate-ces、Caddy、PostgreSQL Up
B agent：   active / online
C 生产：    http://43.153.204.197/  → 303 /login
```

## 7. 未完成

- 备份与数据恢复没有演练；本次重建后是空库重新迁移。
- 发布审批/用户验收记录尚未形成。
- 旧的手工 build agent 记录仍显示离线。
- B 的候选仍使用较早的 candidate-ces 容器，未重新验证最新 build-17 镜像。

## 8. 下一步

1. 重新用 build-17 digest 部署 B 候选并验证 80。
2. 做一次备份/恢复演练。
3. 形成正式用户验收记录。
4. 清理 OneDev 中重复/离线的 agent 记录。

## 9. 后续补充

- B 候选已用 build-17 digest 重新部署：

```text
digest: sha256:5c4b6371...
candidate-ces：Up
http://43.163.113.98/ → 303 /login
admin/changeme → 200
ces_test：36 条迁移，1 个账号
```

- C 已增加备份/恢复命令并完成演练，见
  `docs/reports/self-evolution-backup-restore-2026-10-25/`。
