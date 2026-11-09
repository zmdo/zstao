# 实施记录与接入说明

日期：2026-11-09。代码已实现并完成本地验证；尚未将此次变更部署到业务服务器，也未使用真实 TCR 账号做线上拉取验收。

## 已实现

- 应用服务器显式依赖并等待 `containerRuntime`；容器扩展按 Docker 软件要求匹配，应用服务器共享容器面板、查询、设置、巡检。
- `project-repositories` 提供 `registryCredentials` 宿主服务。专用拉取配置保存在 `$DSH_HOME/registry-pull-credentials.json`，密码使用现有 `secrets` 服务加密；旧 `image-registry.json` 不迁移、不自动分发。
- 拉取配置采用串行写入、`expectedRevision` 冲突检测、临时文件、fsync 和原子 rename；留空保留密码，停用清除平台密文。TCR API 配置变化不影响拉取版本。
- 服务器管理增加通用 `registerConfigurationOperation`、`enqueueConfiguration`、`configurationTask` 宿主契约。配置任务使用现有 `server_jobs` 队列、SSH 指纹验证、租约和所有权检查；不把秘密送入安装配方或 supervisor 的请求日志。
- 应用服务器插件管理关联、准备任务和定期对账。首次请求才建立关联；相同版本仍检查远端文件，但不再次读取密码或执行 login。排队期间发生轮换时，执行阶段读取最新配置。
- 启动及每 30 秒对账补排同步，连接失败保留失败状态并在退避后重试。查询状态直接对照当前凭据版本。Registry 改变、仓库范围不再覆盖关联、停用、解除关联或类型改变时排队清理；恢复关联需要控制台明确操作。
- 远端配置目录固定为 `/var/lib/ces/docker-config/platform-pull`。目录 700、配置 600；凭据版本、配置校验和和代次可核对。登录成功才切换 `current`，随后删除旧代次。修复损坏配置时使用新的代次目录。
- 凭据准备、清理、受管 pull/deploy 与现有安装 supervisor 共用 `/var/lib/smp-server-management/lock`。远端水位包含全局配置任务序号及该任务 fence，拒绝旧任务；失去数据库租约的任务不能回写成功。
- 安装在目标机的 `/usr/local/sbin/ces-registry` 仅接受 pull/deploy 及原部署结果查询；准备和清理由 CES 的受管 SSH bootstrap 执行。密码只经 SSH stdin 传入 `docker login --password-stdin`，不会出现在命令参数、任务快照或返回值中。
- `.onedev-buildspec.yml` 的 release 调用 `scripts/deploy-managed-image.mjs`：准备、等待、提交受管部署任务、等待结果。CES 在同一服务器队列中经已有 SSH 连接校验回执、按 digest 拉取并调用原发布程序。过期回执/损坏配置只重新准备一次；认证失败仅在版本或配置代次已更新时重试。网络、镜像不存在、仓库拒绝访问不触发重复登录。
- 已核对仓库内 `deploy/ces-runtime.sh`。它继承 `DOCKER_CONFIG`；受管包装器传入 `CES_PREPARED_IMAGE` 后直接使用刚拉取的镜像。修复原脚本在条件函数中拉取失败仍可能继续删除容器的问题。
- 镜像仓库设置页面分别显示 TCR API 配置、专用拉取配置版本、关联服务器状态和受管任务记录的最近镜像拉取结果；可创建、撤销受限的发布调用凭证。

没有新增构建服务器、常驻 Agent 或流水线引擎。build、candidate 和 rollback 的原有编排保持原样；这些未接入的新凭据入口不能被当作本次受管拉取的验收证据。

## 接口

控制台会话接口：

| 方法与路径 | 用途 |
| --- | --- |
| `GET/POST /console-api/project-management/image-registry/pull-credentials` | 查询完整性/版本、保存或停用；POST 必须带 `expectedRevision`，不返回密码 |
| `GET /console-api/application-registry/targets` | 可选应用服务器 |
| `GET /console-api/application-registry/bindings` | 关联、同步状态和最近镜像拉取结果 |
| `POST /console-api/application-registry/bindings/{serverId}` | `{ "active": false }` 解除并清理；true 明确恢复 |
| `GET/POST /console-api/application-registry/clients` | 列出调用方，或创建指定服务器和仓库范围的令牌；明文仅创建时返回 |
| `DELETE /console-api/application-registry/clients/{id}` | 撤销调用令牌；不撤销云侧账号 |

CI 接口只接受 `Authorization: Bearer <token>`，不接受控制台 cookie。数据库仅保存令牌 SHA-256；一个调用方只能准备、部署授权目标及查询自己的请求。

```http
POST /console-api/application-registry/prepare
Content-Type: application/json
Authorization: Bearer <OneDev 保存的调用令牌>

{
  "serverId": "<CES 中的服务器 UUID>",
  "credentialId": "platform-pull",
  "image": "ccr.ccs.tencentyun.com/namespace/repository@sha256:<64 位摘要>",
  "requestId": "<本次请求的唯一标识>"
}
```

返回 202 和 `taskId`。使用 `GET /console-api/application-registry/requests/{requestId}` 轮询，成功后读取 `result.receipt`：`serverId`、`credentialId`、`revision`、`configRevision`、`generation`。参数冲突的重复 requestId 被拒绝；过期成功结果不可重新当作有效准备结果。

`POST /console-api/application-registry/requests/{requestId}/deploy` 提交受管部署（JSON 空对象即可）；`GET` 同一路径查询部署任务。服务器、镜像、准备回执取自已授权的原请求，调用方不能替换为任意 Shell 命令。重复提交返回原任务；部署后由受管任务保存实际结果。

### 对原方案的并发修正

实现时发现“CES 准备完成 → OneDev 独立 SSH 发布”之间存在数据库服务器配置变更窗口，仅凭远端版本文件无法得知平台刚刚变更的配置。因此最终采用 **OneDev 编排，CES 受管队列执行 SSH 发布**：部署任务从领取至拉取、替换、健康检查完成一直持有服务器任务租约，并在执行前检查服务器配置修订和凭据回执。这不增加构建服务器或 Agent，镜像仍由目标机直接从 TCR 下载。

远端部署使用不含秘密的 operation journal。SSH 返回丢失时进入恢复，只查询原操作结果；发现锁仍被占用则继续等待，确认结果未知时明确失败，不盲目重放安装。远端子进程继承互斥锁，控制进程退出不会让仍在执行的发布失去互斥。

## 部署前配置

1. 正常升级 CES，并应用数据库迁移 `0047_registry_pull_credentials.sql`。该迁移增加通用配置任务类型、单调序列以及关联、调用方、请求记录表。
2. 目标机已有 Docker、Python 3，CES 登记的 SSH 账号能够无交互执行受管 root 配置操作。CES 首次准备会安装 `ces-registry`；没有新建服务器或安装 OneDev Agent 的要求。
3. 将此版本的 `deploy/ces-runtime.sh` 按既有发布方式安装到目标机 `/usr/local/sbin/ces-runtime`，保持 root 所有、普通部署账号不可改写。生产目录、网络、环境文件仍由该既有运行程序配置。
4. CES 登记的管理账号需要执行 `/usr/local/sbin/ces-registry` 的权限（root 或相应免密 sudo）；它与准备配置所用的受管 SSH 身份相同。OneDev release 不再需要另持部署 SSH 私钥。原 rollback 入口保留既有权限配置。
5. 在镜像仓库设置中保存 TCR 侧确实只允许拉取的账号，明确仓库范围。专用拉取密码由用户在 TCR 更新后保存到 CES；CES 不会自行重置腾讯云密码。
6. 创建限定应用服务器和完整仓库范围的发布调用凭证，存入 OneDev 项目 secret `ces-registry-prepare`。配置项目 properties：`ces-url`（HTTPS）、`ces-server-id`（CES UUID）。参数仍为 `digest`。
7. 发布执行器需要 Node.js 22+，并能通过 HTTPS 访问 CES。CES 使用登记时确认的 SSH 主机指纹连接服务器。现有执行器名称不代表有额外物理构建服务器，必须使用实际已配置可用的执行器。

OneDev 的环境变量和 `@secret:...@`/`@property:...@` 使用其正式语法，参见[任务变量](https://docs.onedev.io/appendix/job-variables)与[CommandStep](https://github.com/theonedev/onedev/blob/main/server-core/src/main/java/io/onedev/server/buildspec/step/CommandStep.java)。参数和令牌通过步骤环境变量传入，不拼接进 Shell 命令。

## 验证与边界

本次验证结果：相关 5 个工作区合计 **176 项测试通过，0 失败、0 跳过**；其中远端 Python 测试包含 7 个场景。临时 PostgreSQL 中全部 49 个迁移执行成功，重复运行新增迁移数为 0。全工作区构建、相关类型检查和打包文件检查通过。

本地验证包括：

- 真实临时 PostgreSQL 中执行迁移并验证准备请求、令牌范围、队列互斥、租约过期恢复、旧 worker 拒绝回写、v2 排队期间更新至 v3、离线补同步、Registry 改变、解除关联和删除服务器后的未确认清理记录。
- 临时目录与 Docker 替身执行远端 Python：首次/重复、配置缺失与损坏、失败密码保留旧配置、旧序号/fence 拒绝、同一锁、范围限制、认证/网络分类及清理。
- 真实 Shell 执行发布脚本、替换 Docker/Curl：拉取失败不删除旧容器；准备成功的 digest 不再次 pull。
- CI 客户端检查 HTTPS、Bearer、回执等待、有界重试和非认证错误不重注入；React 设置表单检查 expectedRevision、空密码保留和保存后清空输入。
- 工作区回归、类型检查与构建。执行结果由本次交付说明记录；本地替身测试不等于真实 TCR 验收。

尚需在目标环境配置上述账号、令牌、SSH 入口及运行程序，并对无目标镜像的服务器做一次真实 TCR 拉取和轮换验收。本次没有修改这些线上资源。

第一版仍为单个 CES 写入进程。加密配置文件与数据库没有跨存储事务，以启动/周期对账及发布前事实核对补偿；不支持把多个写入实例同时指向同一配置文件。服务器删除后的离线清理保留未确认状态；本地删除不能替代 TCR 侧撤销账号权限。
