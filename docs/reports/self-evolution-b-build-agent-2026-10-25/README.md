# B 构建 Agent 与最小流水线验证（2026-10-25）

- 状态：B 构建 Agent、执行器和最小 Job 已跑通；B 类型插件、测试数据库、候选部署未验证
- A：`43.128.69.189`（OneDev 16.9.7，经 Caddy 暴露到 80）
- B：`43.163.113.98`（Ubuntu 24.04，2 vCPU / 2 GiB，Docker 29.9.2，Buildx 0.38.0）

## 1. 测试前状态

B 上没有 CES 容器和 `/srv/ces-test` 软件栈；Docker、Compose、Buildx 已由镜像预装。本次新增：

```text
OpenJDK 17.0.20.1
用户 cesagent（docker 组）
/srv/ces-test/agent、/srv/ces-test/secrets
OneDev Agent 3.3.12（从 A 的 /~downloads/agent.tar.gz 获取）
```

## 2. A 的对外入口

OneDev 原本只绑定 `127.0.0.1:6610`。为让 B 访问，把 Caddy 端口映射从
`127.0.0.1:8080:80` 改为 `80:80`，并把 OneDev 系统设置 `serverUrl` 从
`http://onedev:6610` 改为 `http://43.128.69.189`。

```text
http://43.128.69.189/ → 200
B → A:80 → 200
```

## 3. Agent

```text
token id: 2
agentName: ces-build-agent
serverUrl: http://43.128.69.189
agentTokenFile: /srv/ces-test/secrets/onedev-agent-token
service: onedev.agent.service（active）
online: true（GET /~api/agent-tokens/2/agent）
```

## 4. 执行器

通过 `POST /~api/settings/job-executors` 创建：

```json
[{
  "@type": "RemoteShellExecutor",
  "name": "ces-build-test",
  "enabled": true,
  "agentQuery": "\"Name\" is \"ces-build-agent\"",
  "jobMatch": "\"Project\" is \"CES\" and (\"Job\" is \"build\" or \"Job\" is \"candidate\")",
  "concurrency": 1
}]
```

## 5. 流水线

仓库首次推送到 OneDev `CES` 项目（`main`），buildspec 为最小探测 Job：

```text
checkout（DefaultCredential）
→ uname -a
→ git log -1
→ docker version
→ docker buildx version
```

构建记录：

```text
#1  FAILED    c3e5436e  agent 1  checkout 失败
    原因：OneDev serverUrl 仍是 http://onedev:6610，B 无法解析/访问
#2  SUCCESSFUL dcd1850d agent 1  step-0 926ms，step-1 2719ms
    原因修复：serverUrl 改为 http://43.128.69.189，Caddy 80 反代
```

构建 #2 的 workDir 为 `/srv/ces-test/agent/work/temp/onedev-build-1-2-1/work`，
两步均为 `SUCCESSFUL`，提交原因为 `Branch 'main' is updated`。

## 6. 结论

- B 的构建 Agent、OneDev 执行器、Git 检出和宿主 Docker/Buildx 访问已跑通。
- 构建确实落在 B（agent 1），不是 A 的自动发现执行器。
- 仍未验证：B 类型插件安装、测试 PostgreSQL、Caddy/80 入口、CES 镜像构建、候选部署、用户验收。
- B 目前是手工准备，不是通过 CES `test` 类型安装；下一步需要补 `test.sh` 与类型定义。

## 7. 下一步

1. 修复仓库的 `file:../../tmp/...` 依赖，让干净检出可 `npm ci`。
2. 增加 Dockerfile 与真实 build Job。
3. 实现 `test` 类型与 `test.sh`（测试 PostgreSQL、Caddy、构建 Agent）。
4. 候选部署到 B，并把候选入口转发到 80 供用户验收。
