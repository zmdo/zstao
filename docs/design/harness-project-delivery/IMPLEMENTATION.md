# 实施与验收记录

- 日期：2026-11-10，Asia/Shanghai。
- 实现分支：`codex/harness-project-delivery`。
- CES 运行代码：`cb6eaf6cb7b799bfafb7a613d321f1b8e314d58d`。后续文档与 Skill 指导更新不改变该镜像中的插件代码。
- 范围：P0 环境准备、P1 构建工具、P2 模板、P3 实际 Harness 会话交付。P4 体验增强不包含在首版。
- 没有新增服务器、部署数据库表、凭据版本表或独立部署插件。原应用服务器类型与 TCR 凭据注入流程保留。

## 1. 已上线的内容

| 内容 | 结果 |
| --- | --- |
| 构建执行环境 | 在现有主 OneDev 主机运行 `ces-build-agent`，固定 Agent 镜像 digest；Remote Shell Executor `ces-build-test` 并发 1，仅匹配 `ces-platform`、`harness-delivery-test` 的 `build` Job |
| 构建端凭据 | `/srv/ces-build/docker-config` 权限 700，配置文件 600，Agent 只读挂载；真实推送成功；Buildx 使用独立临时状态目录 |
| CES 命令环境 | 已发布镜像包含 Git、OpenSSH/ssh-keyscan、rsync、CA；重建后实际检查命令存在；现有 OneDev SSH 身份可检出、提交和推送 |
| OneDev 工具 | 新增 `list_jobs`、`run_job`、`get_build_artifact`；构建筛选在上游执行并返回分页信息；读运行中日志达到本次读取时限时返回已读取快照 |
| 镜像查询 | `get_tag` 分页查询，达到查询预算时明确报告未查完 |
| 交付 Skill | 已通过现有目录导入并启用 `project-delivery`，后续指引更新同步到安装目录；模板包括 Dockerfile、构建规范、Compose、项目配置和部署运行时 |
| 部署运行时 | 固定 digest 与配置快照、后台进程、全程应用锁、有限日志、状态记录、重复请求复用、陈旧进程检查、显式回滚 |
| 权限 | 构建和服务器工具沿用宿主现有权限；仅独立验收会话临时采用完全访问模式，验收完成后恢复为 `workspace-write`，未修改全局默认值 |

Agent 配置和首次接入步骤见 [部署说明](../../../deploy/onedev-build-agent/README.md)。普通项目配置示例见 [Skill 与模板](../../../skills/project-delivery/README.md)。

## 2. CES 更新

OneDev 项目 `ces-platform` 的构建 ID **6**、项目内编号 **4** 成功，产物 commit 与运行代码一致。部署使用：

```text
ccr.ccs.tencentyun.com/zstao/ces-integration@sha256:6086af5e340c21083f6823c348927849d125af4b4aa8527ae1ecc0f87c8342e4
```

先拉取成功，再更新 `/opt/ces/docker-compose.yml` 的镜像引用，仅重建 `ces` 服务。原配置和更新回执保存在 CES 主机的 `/opt/ces/backups/harness-delivery-20261110/`，原镜像保留为 `ces:pre-harness-delivery-20261110`。数据库、挂载目录、端口与代理配置沿用原值。没有数据库迁移。

更新后容器为 `healthy`，控制台 HTTPS 登录与 Harness RPC 正常，实际会话使用了新增工具动作。不要用仓库旧 `deploy/ces-runtime.sh` 恢复本次 CES 更新；其历史目标与本次 Compose 路径不同。需要恢复时使用上述备份 Compose 和保留镜像，仅操作 CES 服务。

## 3. 真实代码到部署链路

验收采用已登记的应用服务器 **B-163-98**，服务器 ID `0e250228-7477-45a4-aa5a-0946aae44b3d`。测试应用独占 `/srv/apps/harness-delivery-test`、Compose 项目 `ces-harness-delivery-test` 和端口 `18082`。现有 `80`、`18080`、`18081` 应用保持运行。

独立 Harness 会话 `session-7f466554-7ea5-4e8e-af38-3a3c08f4229a`，标题“Harness 交付流程验收”，使用线上 `standard` 预设与现有模型，实际完成：

1. 读取安装的 Skill、确认目标服务器，使用平台 Git 身份通过 SSH 检出 `harness-delivery-test`。
2. 将响应版本从 1 修改为 2，同步部署运行时的中断保护；执行 Node 语法检查，提交并推送 OneDev `main`。
3. 调用 `platform_onedev list_jobs/list_builds/run_job`，以完整 ref 和 SHA 启动构建；跟踪成功并读取 `get_build_artifact`。
4. 从该 commit 导出 Git 快照，调用 `platform_server_rsync` 传输，通过 `platform_server_exec` 检查远端 Python 语法并启动部署。
5. 查询发布到 `succeeded`；核对镜像身份、TCR 标签摘要和服务器健康响应 `version=2`。进度保存在会话工作区 `.ces/delivery/`。

| 项目 | 版本 1 基线 | Harness 交付的版本 2 |
| --- | --- | --- |
| OneDev 项目 | `harness-delivery-test`，ID 4 | 同左 |
| commit | `705d842c576be48ef660888de31984e864dd688a` | `d10431ac4d9d25f67c95e0c12bbb5b988cd90698` |
| buildId / 编号 | 4 / 2 | 7 / 3 |
| 发布 ID | `verify-001` | `ai-verify-002` |
| 结果 | `succeeded`，版本 1 | `succeeded`，版本 2 |

两个版本均来自 `ccr.ccs.tencentyun.com/zstao/ces-deploy-test`：

```text
版本 1 digest: sha256:7eceacb6ea40f3e6c49418a003c5a7581aa896956b2a7fa76df0b074295a8e4c
版本 2 digest: sha256:1ac2c9baaeced4d0eeb1228d9be39657cb54b6bc95cc3dbf506e266387acacf4
```

内部健康地址 `http://127.0.0.1:18082/health` 返回 HTTP 200。公网 `http://43.163.113.98:18082/health` 从外部测试超时，因此本次不宣称公网访问可用，也未修改防火墙、安全组或域名。

## 4. 幂等、会话恢复与回滚

- 在实际 Harness 会话重复 `run_job`，返回 `reused=true` 并复用成功的 buildId 7；重复 `start ai-verify-002` 返回原发布记录，不重建容器。
- Harness 启动 `ai-rollback-003`，指向成功基线 `verify-001`。在工具返回 `starting` 后，通过宿主会话取消接口中断当前回合。
- 中断后独立查询服务器：后台进程继续完成，发布为 `succeeded`，健康响应为 `version=1`，证明任务不依赖当前会话或 SSH 连接存活。
- 恢复原 Harness 会话，先查询已有构建和发布真实状态，再将 `ai-restore-004` 指向 `ai-verify-002` 恢复版本 2；最终已成功恢复版本 2。

验收回执：

| 检查 | 结果 |
| --- | --- |
| 重复构建 | `reused=true`、buildId 7；再次查询该 SHA 只有一条构建 |
| 重复发布 | 原 startedAt/pid 不变；容器 ID `b3c82840f0b9`、启动时间和 RestartCount 均未变化 |
| 中断回滚 | `ai-rollback-003` 于 17:28:56 完成，恢复会话查询同一发布，健康为版本 1 |
| 恢复新版 | `ai-restore-004` 于 17:29:46 完成，`current.json` 指向此发布，健康为版本 2 |
| 运行范围 | 4 条发布记录保留；其他应用与 PostgreSQL 容器继续运行 |
| 会话权限 | 验收后已恢复 `workspace-write` |

完整非敏感回执保存在 CES 会话工作区 `/srv/workspaces/harness-delivery-verification/.ces/delivery/resume-verification.json`。平台会话事件记录包含 `run_job`、rsync、远程执行与中断/恢复过程，服务器发布状态提供独立证据。

回滚只恢复镜像和当次 Compose/运行时快照，不回滚数据库、持久化数据或外部环境文件。本次测试应用没有数据库迁移。

## 5. 实测发现并修复的问题

1. **只读凭据目录导致 Buildx 失败。** 最初测试构建 ID 3 失败；为构建脚本设置独立临时 `BUILDX_CONFIG`，随后构建 ID 4 成功。
2. **旧发布任务阻止构建。** OneDev 16.9.7 会验证整个规范；旧 Job 引用未配置的执行器，即使只触发 build 也会失败。原规范已归档到 `deploy/legacy/ces-onedev-buildspec.yml`，活动规范只保留 build。
3. **Debian 官方源在当前主机下载过慢。** CES 构建 ID 5 主动取消；增加可配置镜像站、下载超时和有限重试，使用当前腾讯云主机实测可达的源后构建 ID 6 成功。
4. **运行中的构建日志是持续流。** 到本次读取截止时间时返回已读取内容，便于分次查看，而不是把有进展的构建误报为日志读取失败。
5. **部署进程中断后不能盲目提交新发布。** 增加 `active.json`，陈旧运行记录返回 `needs_verification`，后续发布拒绝继续覆盖未确认的结果。
6. **实际会话的命令与策略约束。** CES 未安装 Python/curl；Python 运行时在应用服务器检查和执行，本机 HTTP 检查可用 Node fetch。rsync 的 `--delete` 被现有策略拒绝，改用独立快照目录和 `rsync -az` 即可完成，不放开平台策略。相关指引已补入 Skill。

## 6. 验证覆盖与保留边界

已通过的本地检查：项目仓库插件 26 项 Node 测试、部署运行时 4 项 Python 测试、插件类型检查、全工作区构建、shell 语法及 Git 差异检查。真实 CES 镜像的 OneDev 构建也执行了工作区编译。

自动测试覆盖上游筛选与分页、超过首个标签页、重复构建复用、固定提交、授权拒绝、提交结果不确定、产物状态/路径/体积/摘要校验、后台部署与锁、重复发布冲突、拉取失败保留当前版本、回滚和陈旧进程保护。故障分支使用受控模拟，不等于在生产注入网络故障或错误凭据。

本次真实部署耗时约 13 秒；已验证 SSH 返回后继续执行以及会话中断后的恢复，未在线上人为制造超过 120 秒的拉取、主机重启或凭据轮换故障。当前凭据的真实推送与拉取已验证，密码更新后的重新注入沿用现有应用服务器流程，本次未轮换密码。

首版限制：

- `list_jobs` 为固定提交 YAML 解析；imports、旧自定义 YAML 标签、SecretParam 与隐式动态参数不自动触发。OneDev 提交时仍负责最终合法性校验。
- 构建查找预算与标签查找预算耗尽时明确报错或返回下一页，不把未查完当不存在；线上没有制造数百条构建或标签，分页边界由自动测试覆盖。
- 相同参数的失败构建也会被复用，修复后提交新 SHA。取消/重跑动作及相应页面按钮属于 P4。
- 模板面向单项目、单环境、单台 Linux 服务器，运行时需要 Python 3.9+、Docker Compose、SSH/sudo 与已准备的环境文件。Compose 更新允许短暂中断。
- 发布快照保存项目配置、Compose 和运行时文件；复杂 Compose 引用其他配置、绑定挂载或多文件组合时需要扩展项目模板，不能直接套用示例。
- 新项目需确认执行器匹配、镜像仓库推送权限、服务器、目录、端口和环境文件，不会自动开放所有项目或 Job。
- 容器面板兼容、集中应用清单和部署历史页面未纳入首版。

历史只读检查保持在 [ONLINE_VERIFICATION.md](ONLINE_VERIFICATION.md)，不将实施后的状态倒写为历史已验证。
