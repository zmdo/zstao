# OneDev 构建与候选部署（2026-10-25）

- 状态：镜像构建 Job 与候选部署 Job 已跑通；未推送镜像仓库，未做生产发布
- 源码提交：`69a7161`
- A：`43.128.69.189`（OneDev 16.9.7）
- B：`43.163.113.98`（Agent `ces-build-agent`，执行器 `ces-build-test`）

## 1. 镜像构建 Job

buildspec 的 `build` Job：

```text
CheckoutStep
CommandStep:
  docker build --network=host -t ces-candidate:build-@build_number@ \
    -f docker/Dockerfile .
  docker image inspect --format '{{.Id}}' ... > image.json
PublishArtifactStep: image.json
BranchUpdateTrigger: main
```

构建记录：

```text
#3 SUCCESSFUL  commit 69a7161c  agent 1
  checkout  0.7s
  image   190.7s
  artifact  0.7s
```

结果：

```text
image: ces-candidate:build-3
id:    sha256:24d85562e964951b2ab94408079565e93229904c146d1f61b2d1528c23c96b11
```

镜像在 B 的 Agent 工作区构建，包含 dsh 0.2.1-alpha.5、插件和候选 profile。

## 2. 候选部署 Job

新增 `.onedev-buildspec.yml` 的 `candidate` Job 和
`scripts/deploy-candidate.sh`。通过：

```text
POST /~api/job-runs
{
  "@type": "JobRunOnCommit",
  "projectId": 1,
  "commitHash": "69a7161c...",
  "refName": "refs/heads/main",
  "jobName": "candidate",
  "params": { "image": ["ces-candidate:build-3"] },
  "reason": "P1 candidate deployment from build 3"
}
```

触发记录：

```text
#4 SUCCESSFUL  agent 1
  checkout 0.9s
  deploy  11.4s
```

部署脚本在 B 上：

```text
创建/复用 ces-candidate 网络
创建/复用 ces-candidate-pg（postgres:16.15）
删除旧 ces-candidate-ces
按指定镜像启动新容器，80 -> 9090
等待 HTTP 200/303，失败打印日志
```

## 3. 清空后的重新部署

为满足测试前清理的要求，删除候选容器和数据库卷后再次重建，确认：

```text
容器：ces-candidate-ces，镜像 ces-candidate:build-3
      image id sha256:24d85562e964...
      port 0.0.0.0:80 -> 9090
数据库：console_schema_migrations 36 条
accounts：admin 1 条
登录：POST /console-api/auth/login → 200 {"ok":true}
会话：GET /console-api/auth/me → authenticated=true
```

候选入口：`http://43.163.113.98/`（303 到 `/login`）。

## 4. 未完成

- 没有推送镜像到 OneDev 内置 registry；当前用 B 本地镜像 ID，不是 registry digest。
- 候选直接使用容器 80 端口，没有 Caddy/TLS。
- 没有生产发布、回滚和 P2 的恢复演练。
- 还没有把 `test` 类型/`test.sh` 纳入插件安装路径。
- 用户验收仍是待确认项；本次通过 API 验证登录与页面入口。

## 5. 下一步

1. 配置 OneDev 内置 registry，推送并记录不可变 digest。
2. 候选部署使用 digest，而不是本地镜像标签。
3. 加 Caddy 测试入口（仍映射 80）。
4. 实现 `test` 类型和 `test.sh`，再进入 P1 用户验收。
