# 插件注册、必要软件准备计划与任务执行：实施记录

状态：2026-10-19 已接入运行代码。本轮完成 A2 中现有 Linux 必要软件初装所需的执行基础；不是完整升级管理，也不是设计附件中所有扩展能力均已实现。设计终态仍见 [data-model.md](data-model.md)。

## 本轮已实现

- `serverManagement.registerDefinitions()` 原子登记软件、配方、类型、系统分组。旧 `registerGroup()` 已移除。定义来源与调用插件的 Loader 条目／Cordis 名称核对；提供者卸载先拒绝新租用，再等待正在使用它及其依赖的任务释放。缓存名称只用于展示，不授权执行。
- 软件键为 `builtin/<key>` 或 `<插件包名>/<key>`，不再把分组当成软件身份。类型支持条件必要项、配方优先序和系统默认类型；脚本在注册时读入，内容、版本规则、适配器及依赖参与执行修订，名称翻译不参与。
- 稳定软件版本支持任意、完整固定版本、系列、最低版本、含端点区间；范围用于类型／配方解析。登记和编辑页面的用户收紧范围交互仍留在 C 阶段。
- 检查任务只读。登记／编辑保存安装选择，或点击补齐必要软件，会先执行只读准备，再保存独立安装计划及执行任务。普通连接检查与周期巡检不夹带安装。
- 初装计划冻结产品版本、原始包版本（含 epoch 和发行修订）、依赖包、软件原状、系统、配置／定义修订及摘要。未知状态、已有软件不符合要求、依赖需替换等情况会停止，不借安装开关授权升级或替换。
- 新迁移 `0014_server_execution.sql` 引入 `server_change_plans/server_change_targets/server_jobs/server_job_steps` 并删除空的 `ops_jobs`。若发现旧任务数据就停止迁移，保留现有分组、密钥和其他模块数据。
- 数据库领取使用服务器锁、唯一约束、60 秒租约和递增执行令牌；每 15 秒续租，过期写入者不能更新结果。同一准备任务重启后不会重复创建计划。
- Linux 远端由独立进程执行，使用 root 所有的 `/var/lib/smp-server-management`、整台主机锁、操作 ID 和逐软件结果记录。SSH 断开不意味着安装失败；重复操作 ID 不会再次执行。确认远端从未启动时任务失败并释放执行权；未能确定远端结果时保留恢复状态及服务器执行权，不自动重试。
- 初装计划当前只允许在创建后 15 分钟内开始。错过窗口不补执行；已开始的安装继续收尾。后续用户预约窗口及批量暂停交互在 D 阶段。
- 详情任务列表展示恢复状态、已知软件结果及依赖变更。删除服务器保留任务与计划历史身份。数据库服务撤回等待依赖插件最后写入后再关闭连接池。

## 当前插件接入方式

以下是可运行的最小系统分组贡献，继承空置／普通两类。插件包名需与 Loader 条目一致；代码方式挂载时使用相同的 Cordis `name`。

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = '@example/compute'
export const inject = ['serverManagement']

export async function apply(ctx: Context) {
  const registration = ctx.serverManagement.registerDefinitions({
    contractVersion: 2,
    owner: '@example/compute',
    groups: [{ key: 'compute', name: { zh: '计算节点', en: 'Compute nodes' } }],
  })
  await registration.ready
  // 卸载自动等待 dispose；需要提前撤回时调用 registration.dispose()。
}
```

自定义软件需分别声明 `software`、`recipes`、`types`，分组 `types` 使用完整键。配方 `detect/listCandidates/resolve/execute/verify/recover` 使用脚本路径、解释器、超时和输出限制；缺少变更能力时可只提供检测。声明可安装时必须提供完整解析、执行、验证与恢复入口。实际类型见 `plugins/server-management/src/shared/contracts.ts`，协议通过 stdin JSON 传参，stdout 为单个结构化 JSON，不把输入拼接成命令。执行期间不强杀正在运行的包管理器；失去结果时进入恢复。

当前初装执行器只接受 `keep/install`。`resolve` 可以冻结系统包依赖到 `payload`，但不能新增类型未声明的软件身份：非空 `additionalRequirements` 暂时拒绝，递归软件扩展待后续。`operatingSystems` 扩展、自定义系统身份探测与 PowerShell 软件配方仍明确返回“不支持”，没有用空实现伪装支持；Windows Server 仍可登记为空置服务器。

## 内置 Docker／Compose 安装边界

旧的外部 `componentsDir` 和无约束 `install.sh` 已退出运行路径。内置配方随插件构建，支持既定 Ubuntu／Debian 系统范围；远端需要 Python 3、apt，以及 root 或无交互 sudo。

只使用服务器已经配置并可读取的软件源。Docker 从可用的 `docker-ce`／`docker.io` 中解析，Compose 从 `docker-compose-plugin`／`docker-compose-v2` 中解析。没有候选、索引过旧或包不可取得时停止；本轮不擅自增加源、导入密钥、执行全机更新或改用户组。特别是某些系统默认源没有 Compose v2，登记为普通服务器并不保证立即可安装。

解析保留精确包身份与 SHA-256。执行前重新模拟依赖；真正交给 dpkg 前再用 apt hook 核对包清单、版本、架构和校验和，拒绝计划外包。已有依赖需要变化、卸载或额外配置时要求另行确认。包安装结束后核对运行版本、健康情况和计划中的依赖版本；失败保留已知实际改变。

产品版本与发行包版本分别保存和验证。Ubuntu 的 Compose 可能直接报告完整包版本（如 `2.40.3+ds1-0ubuntu1~24.04.1`）；运行版本只接受与已安装包对应的完整版本、去除发行修订的上游版本，或其产品版本 `2.40.3`，不能用任意前缀匹配掩盖不同版本或不同构建。计划中的原始包版本和依赖仍需逐项精确一致。Docker 的只读健康／版本检查先使用 SSH 用户，失败时仅尝试已有的无交互 `sudo -n docker` 权限；不能因此修改用户组、套接字权限或授予新的权限。两种权限均不可用时保留检测失败。

远端任务的原始字符串错误直接展示；结构化宿主错误按当前语言翻译，不能把原始错误误解析成通用「请求没有完成」。已安装但验证误报的情况通过新版只读检查重新确认当前状态，不重写历史失败任务，也不自动重放原安装计划。

依据：[Debian apt-get 手册](https://manpages.debian.org/bookworm/apt/apt-get.8.en.html) 的精确版本、模拟及包动作说明；[Python fcntl 文档](https://docs.python.org/3/library/fcntl.html) 的文件锁行为。模拟本身不锁定系统，所以仍需执行前和包安装前复核。

## 验证与后续

已用隔离 PostgreSQL schema 验证原子登记、贡献者生命周期、跨提供者租用、配置漂移、检查／安装分离、计划冻结、并发领取、过期令牌、恢复期间禁止配置变更以及删除后保留历史。远端监督进程在临时目录中实际运行，验证断开连接、重复操作、逐软件结果和中途失败；apt 测试使用命令替身，没有在真实服务器执行安装。

2026-10-19 修复 Ubuntu Compose 发行版本误判及任务错误展示后，服务器管理 65 项测试、类型检查和全量构建通过。新增回归覆盖完整发行版本、上游版本和产品版本的对应关系，拒绝不同产品版本／不同构建／预发布版本，原计划包修订漂移仍验证失败；无交互 sudo 的成功和拒绝分支均不改变权限。对授权测试服务器按原始失败计划只读复验，Docker `29.1.3` 和 Compose `2.40.3` 均通过精确包与依赖验证；新版接口巡检成功，当前必要软件状态为「已满足」。没有重装软件、修改用户组或改写历史任务。当时容器巡检仍仅使用 SSH 用户自身的 Docker 访问权限；这一边界随后按下节修正。

### 2026-10-20：容器巡检权限一致性

用户报告连接测试失败，原因是普通 SSH 用户不能读取 `/var/run/docker.sock`。必要软件配方已经支持已有无交互 sudo，但可选容器巡检未复用这一权限，导致软件健康检测可通过、容器查询却失败。

容器巡检先检查 Docker 命令是否存在，再以 SSH 用户读取 Docker 版本；失败时尝试固定的 `sudo -n docker version` 只读命令。选择成功后，本轮 Compose 版本和 `docker ps` 全部使用相同权限，不在后续单项失败时切换到另一个用户的 Docker 上下文。两种权限均不可用时，保留普通用户错误及 sudo 拒绝／超时信息，继续记录真实检测失败。

此路径不修改用户组、socket 权限或 sudo 配置，不输入 sudo 口令，不安装、启动、停止或重启容器。Docker 不存在仍属于不适用；Compose 缺失不阻止可选容器清单读取。旧失败任务保留，通过新的只读连接测试／巡检更新当前观察。

新增回归验证直接访问、整轮 sudo 读取、sudo 拒绝和超时、后续清单错误不切换上下文，以及隔离 PostgreSQL 中成功观察与错误任务的落库行为。

验证：服务器管理 78 项测试（无跳过）、类型检查和 CES 全量构建通过。已在用户报告的测试服务器只读实测，普通读取失败后使用现有无交互 sudo 成功取得 Docker `29.1.3`、Compose `2.40.3+ds1-0ubuntu1~24.04.1` 和空容器清单。更新本地 9090 实例后，通过正常控制台连接测试接口创建的新任务成功，当前容器观察为 `ready`、SSH 在线、必要软件已满足；没有重放安装任务或改写旧失败记录。

后续仍需补齐自定义系统／Windows 配方和动态软件依赖等扩展边界；B 阶段已完成 [八列列表、统一状态及后端分页](server-instances-list.md#7-b-阶段实施记录2026-10-19)；C、D 阶段已接入版本策略、移动预检／替换确认、只读升级检测、独立升级管理 Tab 与批量维护计划，见 [C、D 实施记录](versions-moves-and-upgrades.md)。人工解除未知远端操作仍未开放。
