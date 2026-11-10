# Harness 项目交付线上核验记录

- 本文件为实施前的只读快照；后续变更与验证见[实施记录](IMPLEMENTATION.md)。
- 核验日期：2026-11-10（Asia/Shanghai）。
- 范围：CES、主 OneDev、B-163-98 和 test-72-83 两台已登记应用服务器。
- 方法：SSH 只读命令、已登录的 CES 查询接口、OneDev REST 查询接口，并与本地源码对照。
- 本次未修改代码或线上配置，未安装软件、触发构建、登录 Docker、推送/拉取镜像或部署。控制台登录仅用于读取受保护接口。
- 本文件不保存原始清单中的密码、令牌、私钥、Cookie 或 Docker 认证内容。

## 1. 已确认的状态

| 对象 | 实测结果 |
| --- | --- |
| CES | 容器健康，运行镜像 ID 与清单一致；控制台可登录，项目、流水线、工具和镜像查询接口可用。未独立确认运行镜像对应的 Git commit |
| CES 命令环境 | `bash`、`dsh` 可用；`git`、`ssh`、`rsync` 未找到。缺少 Git/SSH 会阻塞所设计的 Git 提交推送路径；rsync 工具源码直接启动 `ssh-keyscan` 和 `rsync`，注册成功不代表可执行 |
| 全局工具目录 | 共 22 个工具，包括 OneDev、镜像查询、服务器执行和文件传输。目录未列出基础 Shell/文件编辑工具，但包已安装；仍须在实际开发会话核验作用域和可用性，不能据此断言所有会话都缺少这些工具 |
| Skill 目录 | 只有已启用的 `harness-catalog-demo`，没有 `project-delivery` |
| 主 OneDev | 运行 16.9.7，ready 接口正常；宿主机运行 OneDev 和 PostgreSQL 两个容器；Agent 查询为空 |
| 执行器 | 只有 `ces-demo`，类型为 `ServerShellExecutor`，已启用，并发 1，匹配条件为 `"Job" is "demo"` |
| Docker 构建环境 | OneDev 容器有 Docker CLI；没有 `/var/run/docker.sock`，未配置 `DOCKER_HOST`；实际 `docker info` 退出码为 1 |
| 项目与流水线 | 项目 `ces-platform`（ID 1），默认分支 `main`；主分支包含 `build/candidate/release/rollback`，使用尚未配置的 `ces-build-test` 和 `ces-production-deploy` |
| 已有构建 | 查询到构建 ID 2、编号 2、Job `demo`，状态 SUCCESSFUL。该版本的任务执行 echo/sleep 演示命令，不构建 Docker 镜像，也不输出 `image.json` |
| 旧发布前提 | 主 OneDev 宿主机上未找到 `/srv/ces-infra/agent/secrets/deploy-key`。仓库旧发布任务引用该路径并指向旧部署目标；未验证其端到端可用性 |
| TCR 管理查询 | 仓库与标签查询成功，返回 `zstao/ces-deploy-test` 和 `zstao/ces-integration`；测试仓库 `v1` 的 digest 可读取 |
| 应用服务器 | 两台均可 SSH 连接，CES 状态正常，Docker、Compose、rsync 可用；TCR 配置目录由 root 持有且权限为 700，`config.json` 权限为 600 |
| 已有测试应用 | B-163-98 上测试容器运行，本机访问 18081 端口返回 HTTP 200；这是已有应用的检查结果，不是本次新发布验收 |

版本定位：OneDev 主分支核验时为 `bd49e49c06d67fa3613cd737cabb7ecbb8df18f9`，历史 demo 构建提交为 `b6153caf7f2729e56e3ac54c5123da258e9d57e8`。它们用于区分当前流水线定义和历史成功记录，不表示 CES 正在运行其中任一版本。

## 2. 线上工具动作

`platform_onedev` 当前动作：

```text
list_projects, get_project, list_branches, list_tags, list_commits,
get_tree, get_file, list_builds, get_build, get_build_logs, create_project
```

尚无方案中的 `list_jobs`、`run_job`、`get_build_artifact`。

`platform_image_registry` 当前动作是 `list_repositories`、`list_tags`、`get_tag`。本地源码的 `get_tag` 只在前 100 个标签中查找；本次线上仓库标签数量不足以覆盖该边界，分页修复仍按方案实施和测试。

## 3. 结论与未验证项

现有仓库管理、流水线查询、镜像查询、服务器准备与 TCR 自动注入可以保留。阻塞完整交付的首要问题是正式构建执行器未配置，以及 CES 缺少 Git/OpenSSH/rsync。环境依赖属于运行镜像和 OneDev 配置工作，不需要新增独立部署插件或数据库表。

以下项目不能由本次只读检查得出通过结论，需在实施时验证：

- 实际 Harness 开发会话中的文件编辑、Shell、Git 认证及提交推送。
- 通过平台工具完成文件传输和远程命令执行；本次人工 SSH 连通不能替代工具验收。
- 正式 Job 的 Docker 构建、TCR 推送权限、`image.json` 产物发布与读取。
- 应用服务器当前凭据的实际镜像拉取权限，包括密码更新后重新注入和拉取。
- 按 digest 发布、健康与版本验收、长任务跟踪、会话恢复和回滚。

实施安排见[主方案 P0 与后续阶段](README.md#10-实施顺序)。以上状态是核验当日快照，执行变更前应再次核对对应目标和配置。
