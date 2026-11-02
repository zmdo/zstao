# 20 SW-01 修复：固定 SSH 用户并验证 Docker 组权限

- 日期：2026-10-21
- 分支：`ces/detail-extensions`；修复基于 `a0bc2df`，本轮尚未提交。
- 对象：用户本轮指定的 `ubuntu@43.128.69.189`。
- 结果：用户组处理的代码修复、自动化测试和实机定向回归通过。SW-01 完整首次安装尚未重新验收，步骤 8 保持进行中。

## 1. 证据与原因边界

[报告 19](19-SW-01-DIAGNOSTIC.md) 操作的是另一台服务器 `43.128.72.83`，在 SSH 握手阶段超时，没有执行到配方。因此不能用该报告证明用户组处理失败的具体原因。[报告 18](18-SW-01-VALIDATION.md) 证明了“计划完成但用户没有 Docker 权限”，但没有足够日志区分当时使用了旧脚本、组成员枚举异常还是 `usermod` 失败。

当前代码中可以确定的缺陷：

1. `add_docker_group()` 枚举 `sudo` 组全部成员。这既不能代表登记的 SSH 用户，也会给其他管理员添加 Docker 权限；通过 sudoers 单独授权的用户可能被遗漏。
2. 配方在 root 监督进程中执行，不能用执行时的 UID 推断原 SSH 用户。
3. `usermod` 失败只写临时日志，异常没有向上返回，安装仍可能显示完成；校验也没有核对目标账户的成员关系。
4. 远端执行器丢弃配方返回的 `code`、`detail`，任务只保留通用的 `execution_failed` 或 `verification_failed`。

修复这些已证实的代码缺陷，不把未复现的历史原因写成已确认结论。

## 2. 修复行为

### 容器插件配方

源码：[recipe.sh](../../../plugins/server-containers/scripts/recipe.sh)。

- 在以 SSH 用户执行的 `resolve` 阶段读取系统账户，固定 `{ name, uid }` 到 `payload.dockerUser`。
- 计划增加中英文配置影响说明，明确需要加入 Docker 组的账户以及新 SSH 会话生效的条件。
- 在 root 执行阶段校验用户名与 UID；账户变更或缺少预检身份时，在包变更前失败，要求重新预检。
- Docker 安装后仅对该账户执行 `usermod -aG docker -- <user>`；不再枚举 `sudo` 组。
- 同时识别主组和附加组。root 登录无需加组；已经在组内时不重复修改；Compose 配方不处理用户组。
- 命令失败，或者命令返回成功但成员关系未生效，均报告失败；保留此次包安装已经发生的事实。
- 验证阶段再次检查固定账户的 Docker 组成员关系。已有 SSH 重连验证流程保持不变。
- 删除 `/tmp/smp-docker-group.log` 写入，诊断随任务结果持久化。

### 核心任务执行器

源码：[supervisor.ts](../../../plugins/server-management/src/host/remote/supervisor.ts)、[recipes.ts](../../../plugins/server-management/src/shared/contracts/recipes.ts)。

- 远端任务保留配方的错误码和详细原因，继续限制错误长度。
- 部分软件变更已经发生时，任务失败仍保留 `changes` 和实际软件观察；不宣称远端包已回滚。
- 不改变任务锁、恢复及避免重复执行的规则。

边界：本次没有新增“修复已安装服务器权限”的 UI 操作。配方自身支持已有目标版本时仅补齐成员关系；核心对已满足目标的步骤仍跳过执行并校验，`keep` 步骤也不会自动修改用户组。旧计划的配方和身份快照不会被静默替换，重测必须生成新预检计划。

## 3. 自动化验证

| 验证 | 结果 | 主要覆盖 |
| --- | --- | --- |
| 容器配方测试 | 10 项通过，无跳过 | SSH 用户固定、只修改该用户、sudoers 用户、root、主组、Compose 隔离、账户漂移、命令失败、无效成功、重复执行、部分变更记录 |
| 远端监督进程测试 | 3 项通过，无跳过 | 执行错误详情、目标已满足时的权限校验失败、配置变更进入持久化结果 |
| 既有插件注册、脚本加载、策略测试 | 7 项通过，无跳过 | 插件目录、脚本快照及策略回归 |
| 两个插件构建 | 通过 | 核心与容器插件均可生成运行产物 |

配方测试执行实际的 `recipe.sh`，仅替换操作系统账户和包管理子进程边界；测试不会修改开发机账户或安装软件。监督进程测试执行生产 `worker()`，使用临时目录保存结果，不运行需要 root 的入口。

```sh
npm run test --workspace=@smp/console-server-containers
node --test plugins/server-management/test/remote-supervisor.test.ts plugins/server-management/test/container-plugin.test.ts plugins/server-management/test/script-loading.test.ts plugins/server-management/test/policies.test.ts
npm run build --workspace=@smp/console-server-management --workspace=@smp/console-server-containers
```

测试文件：[recipe.test.ts](../../../plugins/server-containers/test/recipe.test.ts)、[remote-supervisor.test.ts](../../../plugins/server-management/test/remote-supervisor.test.ts)。

## 4. 实机定向回归

初始只读检查发现新测试机的 `ubuntu` 已经属于 `docker` 组，直接执行 `docker ps` 成功，不能声称它初始就复现了旧问题。

在没有活动软件任务的前提下，按监督进程的目录校验与 `flock` 规则占用远端任务锁。第一次尝试因锁文件尚不存在而在修改前退出；第二次按生产规则创建目录／锁后完成以下验证：

1. 记录 Docker 包版本和 `docker` 组成员；原成员只有 `ubuntu`。
2. 暂时执行 `gpasswd -d ubuntu docker`，新用户进程执行 `docker ps` 确实出现 `permission denied`。
3. 以现有精确包版本构造专项验证输入，调用修复后的真实配方 `execute`。本次只验证成员关系补齐，不经过 UI 创建首次安装计划。
4. 配方完成，返回且仅返回以下变更：

   ```json
   {"kind":"group-membership","group":"docker","user":"ubuntu","uid":1000}
   ```

5. `verify` 返回 `healthy: true`；再次执行返回 `changes: []`。
6. 新建 SSH 连接确认 `id` 包含 `988(docker)`，直接执行 `docker ps` 返回 0。
7. 前后 Docker 均为 `29.9.1`，包标识均为 `docker-ce=5:29.9.1-1~ubuntu.24.04~noble`；未执行 apt 安装／卸载，组成员恢复为原值。验证脚本也设置了失败时恢复成员关系的清理路径。

本轮没有操作报告 19 的旧服务器，没有清空历史任务、重建登记或删除容器。现场原始验证输出保存在本地忽略文件 `tmp/docker-group-verification.json`。

## 5. 本地程序加载与剩余验收

- 在确认无 `queued`、`claimed`、`running`、`recovering` 任务后重新启动本地控制台，继续使用原 profile 和端口 `9090`。
- 类型目录及目标服务器扩展目录接口返回 200。运行时 Docker／Compose 组件修订与当前构建加载相同脚本所产生的修订一致，确认已加载本次配方。
- 仍需使用新预检计划，完成“缺失 Docker → 安装 Docker／Compose → 新 SSH 会话 → 容器面板”的完整 SW-01 回归。不能以本次保持软件版本不变的用户组专项验证代替该验收。
- 批量升级、扩展生命周期、并发、取消和终端等其他步骤 8 项目，继续以对应报告和验收清单为准。
