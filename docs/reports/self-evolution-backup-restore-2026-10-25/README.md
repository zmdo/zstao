# C 生产备份与恢复演练（2026-10-25）

- 状态：逻辑备份、删除验证、恢复和登录验证均通过
- C：`43.153.204.197`
- 生产库：`ces`（容器 `ces-prod-postgres-prod-1`）

## 1. ces-runtime 新增命令

```text
ces-runtime backup
ces-runtime restore --file <path>
```

实现：

```text
backup：pg_dump -U ces --clean --if-exists ces > /srv/ces-prod/backups/ces-<UTC>.sql
restore：停止 prod-ces
         psql -U ces -d ces < 备份文件
         启动 prod-ces
         等待 Caddy 80 返回 200/303
```

备份文件权限 600。

## 2. 演练步骤

1. 在 `ces` 库创建探针表：

```sql
create table restore_probe(id int primary key, note text);
insert into restore_probe values (1, 'p3-backup');
```

2. 备份：

```text
/srv/ces-prod/backups/ces-20261025T120139Z.sql
```

3. 删除探针表：

```text
DROP TABLE
```

4. 恢复：

```text
restored /srv/ces-prod/backups/ces-20261025T120139Z.sql
```

5. 校验：

```text
1|p3-backup
```

6. 清理探针表，再次验证生产：

```text
http://43.153.204.197/ → 303 /login
admin/changeme → 200 {"ok":true}
```

## 3. 边界

- 这是逻辑备份/恢复，不是 WAL 归档或 PITR。
- 恢复期间 `prod-ces` 会短暂停止，Caddy 返回 502。
- 备份文件在 C 本机，尚未异地保存。
- 没有验证大规模数据或长时间恢复。

## 4. 下一步

1. 定期备份/异地副本。
2. 如需 RPO/RTO，增加 WAL 归档和恢复演练。
3. 把备份时间/结果纳入发布或运维记录。
