# OneDev 镜像仓库与 digest 部署（2026-10-25）

- 状态：镜像推送与按 digest 部署已跑通；生产发布和 P2 未开始
- 源码提交：`9bfa969`
- A：`43.128.69.189`（OneDev 16.9.7）
- B：`43.163.113.98`

## 1. 镜像推送

`build` Job 在 B 上构建并推送：

```text
#6 SUCCESSFUL  commit 9bfa969f  agent 1
  checkout   0.6s
  image    370.4s
  artifact   0.1s
```

推送路径：

```text
43.128.69.189/ces/ces-candidate:build-6
digest: sha256:6ba0dc1ef8104fd2b8d6d4535d86187971274694de737ccd0338a426428a7a05
image id: 6ba0dc1ef810
```

实现方式：

- B 的 Docker daemon 将 `43.128.69.189` 配置为 insecure registry（HTTP，防火墙只开放 80）。
- 构建 Job 使用 `/srv/ces-test/docker-config/config.json` 的 Docker 认证配置；
  `docker login` 在 HTTP 端点上会先尝试 HTTPS 并超时，因此直接提供认证配置。
- `scripts/build-image.sh` 负责 build、tag、push 和 digest 解析，buildspec 只保留
  `@build_number@` 插值，避免 shell 中的 `@` 被 OneDev 当作变量。

## 2. 按 digest 部署

触发 `candidate` Job：

```text
POST /~api/job-runs
{
  "@type": "JobRunOnCommit",
  "projectId": 1,
  "commitHash": "9bfa969f...",
  "refName": "refs/heads/main",
  "jobName": "candidate",
  "params": {
    "image": ["43.128.69.189/ces/ces-candidate@sha256:6ba0dc1e..."]
  },
  "reason": "P1 candidate deployment by registry digest"
}
```

结果：

```text
#7 SUCCESSFUL  agent 1
  checkout  0.7s
  deploy   13.5s
```

清空旧候选容器和数据库卷后，再由该 Job 重建：

```text
容器：ces-candidate-ces
配置镜像：43.128.69.189/ces/ces-candidate@sha256:6ba0dc1e...
实际镜像：sha256:6ba0dc1ef810...
端口：0.0.0.0:80 -> 9090
数据库：console_schema_migrations 36 条，accounts 1 条
登录：admin/changeme → 200 {"ok":true}
会话：/console-api/auth/me → authenticated=true
```

候选入口：`http://43.163.113.98/`

## 3. 结论

- B 能构建镜像并推送到 OneDev 内置 registry，得到不可变 digest。
- 候选 Job 能按该 digest 部署，候选和测试使用同一镜像身份。
- 候选数据库是清空后由镜像启动迁移重新创建的。

## 4. 未完成

- 生产发布、回滚、P2 恢复演练未开始。
- 候选入口仍是容器 80，没有 Caddy/TLS。
- registry 认证目前使用管理员凭据文件；后续应改为 Job Token/受限访问令牌。
- `test` 类型与 `test.sh` 尚未实现。
- 用户验收尚未形成正式记录。

## 5. 下一步

1. 用受限 token 替代管理员 registry 凭据。
2. 加 Caddy 测试入口，保留 80 映射。
3. 实现 `test` 类型与候选部署 Job 的集成。
4. 开始 P2：C 类型、发布 Agent、回滚与恢复演练。
