# P2 首次生产发布与回滚（2026-10-25）

- 状态：A 发布 Agent、release Job、C 生产发布和回滚均已验证
- A：`43.128.69.189`
- C：`43.153.204.197`
- 生产入口：`http://43.153.204.197/`

## 1. A 发布 Agent

```text
agent: ces-deploy-agent
token: id 5
状态：online
用户：cesagent
目录：/srv/ces-infra/agent
```

安装时发现 `/srv/ces-infra` 为 `root:root 700`，`cesagent` 无法穿过目录执行
Agent，systemd 报 `203/EXEC`。改为 `root:cesagent 750` 后服务正常连接。

A 上的部署私钥：

```text
/srv/ces-infra/agent/secrets/deploy-key  (600 cesagent)
```

C 的 `cesdeploy` 已授权该公钥，并允许：

```text
cesdeploy ALL=(root) NOPASSWD: /usr/local/sbin/ces-runtime
```

## 2. OneDev 执行器

```text
name: ces-production-deploy
type: RemoteShellExecutor
agentQuery: "Name" is "ces-deploy-agent"
jobMatch: "Project" is "CES" and "Job" is "release"
concurrency: 1
```

release Job：

```text
checkout
ssh -i deploy-key -l cesdeploy 43.153.204.197 \
  "sudo -n /usr/local/sbin/ces-runtime install --digest '@param:digest@'"
```

最初命令中 `cesdeploy@43.153.204.197` 的字面 `@` 被 OneDev 当成插值变量，
改为 `ssh -l cesdeploy 43.153.204.197` 后通过。

## 3. 发布记录

第一次发布：

```text
build #15 SUCCESSFUL  commit 5ada249
step-0 checkout   0.9s
step-1 deploy    37.4s
digest: sha256:a789ed9fccc1afec5fbece97dc4b13ee70cfee57167358ff6391a5a247e9906f
```

为验证回滚，再发布旧 digest：

```text
build #16 SUCCESSFUL
digest: sha256:6ba0dc1ef8104fd2b8d6d4535d86187971274694de737ccd0338a426428a7a05
deploy: 147.2s（拉取旧镜像）
```

然后从 A 的 Agent 执行回滚：

```text
ssh -l cesdeploy 43.153.204.197 \
  "sudo -n /usr/local/sbin/ces-runtime rollback --release \
   43.128.69.189-ces-ces-candidate-sha256-a789ed9f..."
```

结果：

```text
deployed 43.128.69.189/ces/ces-candidate@sha256:a789ed9f...
```

## 4. 回滚后状态

```text
prod-ces 镜像：sha256:a789ed9f...（build-11 digest）
current.json：
  image: a789ed9f...
  previous: 6ba0dc1e...
  release: ...a789ed9f...
Caddy：0.0.0.0:80 -> 80
PostgreSQL：ces_prod（实际 compose 项目 ces-prod），36 条迁移，1 个账号
HTTP：303 /login
登录：admin/changeme → 200 {"ok":true}
```

## 5. 未完成

- 发布审批/用户验收记录尚未形成。
- rollback 目前是手工命令，不是独立 OneDev Job。
- C 的 `ces-runtime` 还没有并发保护之外的失败恢复演练。
- B 的 build agent recipe 仍受 SSH 认证超时阻塞。
- P3 干净重建未开始。

## 6. 下一步

1. 增加独立 rollback Job/参数。
2. 记录一次用户验收。
3. 处理 B 的 SSH 和 build agent 安装。
4. 做 P3：清空 C 后重建并恢复。
