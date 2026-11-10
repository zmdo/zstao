# OneDev 构建执行环境

在现有 OneDev 主机运行一个 Agent，初始并发 1。`compose.yml` 是可复用配置；不要与已经运行的 `ces-build-agent` 重复启动。现有容器来自首次引导，迁移为 Compose 管理时需先确认没有运行中的任务。

在主机准备 `/srv/ces-build/work`、`/srv/ces-build/docker-config` 和权限为 600 的 `/srv/ces-build/agent.env`。环境文件包含 `serverUrl`、`agentToken`，值由当前 OneDev 实例生成和提供，不提交到仓库。需要镜像加速时设置 `ONEDEV_AGENT_IMAGE` 为已验证的镜像引用；实际部署应固定 digest。

通过 `docker --config /srv/ces-build/docker-config login --password-stdin` 为构建账号配置目标 TCR 仓库的推送权限。目录权限为 700、配置文件为 600。容器只读挂载凭据目录，构建脚本通过独立的 `BUILDX_CONFIG` 临时目录保存 Buildx 状态。

在 OneDev 配置 Remote Shell Executor：

| 字段 | 配置 |
| --- | --- |
| Name | `ces-build-test` |
| Agent Selector | `"Name" is "ces-build-agent"` |
| Applicable Jobs | `("Project" is "ces-platform" or "Project" is "harness-delivery-test") and "Job" is "build"` |
| Concurrency | `1` |

首次接入其他项目时将其加入执行器匹配范围，并配置对应推送仓库。不要通过放开所有 Job 来恢复旧 CES `candidate/release/rollback`。

OneDev 16.9.7 会校验整个构建规范，即使只运行 `build`，不存在的旧发布执行器也会阻止提交。活动 `.onedev-buildspec.yml` 因此只保留构建；旧任务保存在 `deploy/legacy/ces-onedev-buildspec.yml` 供迁移参考，不是可直接执行的部署配置。

CES 构建脚本支持环境变量 `DOCKER_CONFIG`、`CCR_REGISTRY`、`CES_NODE_IMAGE` 和 `CES_DEBIAN_MIRROR`。默认凭据目录为 `/srv/ces-build/docker-config`；`CES_NODE_IMAGE` 可指定当前构建网络能访问的 Node 24 镜像。`CES_DEBIAN_MIRROR` 是 Debian 镜像站主机名，CES 的 OneDev Job 默认使用已在当前主机验证的腾讯云镜像站；本地 Docker 构建仍默认官方源。普通项目使用 Skill 中的构建模板，显式配置 `IMAGE_REPOSITORY`。

验收须在实际 Job 中完成 Git 检出、`docker info`、镜像构建、推送和 `image.json` 发布。Agent 在线或镜像命令存在不能替代实际构建。
