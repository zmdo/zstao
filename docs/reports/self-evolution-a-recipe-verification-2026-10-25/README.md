# A 测试服务器 recipe 路径验证（2026-10-25）

- 状态：脚本级、插件路径与网站 API 验证通过；B/C 与构建流水线未验证
- 代码基线：`ces/self-evolution`，`b4ddc7f`
- 验证对象：`plugins/self-evolution/scripts/stack.sh`
- 测试服务器：`43.128.69.189`（`ubuntu`，Ubuntu 24.04.4，Docker 29.1.3，Compose 2.40.3）

## 1. 范围

本次只验证 recipe 脚本在真实 A 主机上的 `detect`、`resolve`、`execute` 和幂等行为，不经过 CES 插件注册与网站，不涉及 B/C。

服务器上原有的 `onedev-verify` 验证栈已停止（数据保留在 `/srv/onedev-verify`），新增 `/srv/ces-infra`。

## 2. 结果

### 2.1 OneDev

```text
detect（安装前）: {"state":"missing"}
resolve:          action=install, payload={service:onedev,image:1dev/server:16.9.7}
execute:          {"state":"completed","changes":[{container,onedev}]}
detect（安装后）: installed 16.9.7 healthy=true
GET /~api/server/ready: true
GET /~api/projects/ids/CES: 1
GET /: 200
第二次 execute: {"state":"completed","changes":[]}
容器 ID 与 StartedAt 前后一致
```

### 2.2 PostgreSQL

```text
detect: installed 16.15.0 healthy=true
```

PostgreSQL 由 OneDev 的 Compose 依赖启动，未单独执行安装。

### 2.3 Caddy

```text
detect（安装前）: {"state":"missing"}
execute:          {"state":"completed","changes":[{container,caddy}]}
detect（安装后）: installed 2.10.2 healthy=true
GET http://127.0.0.1:8080/: 200（反向代理 OneDev）
第二次 execute: {"state":"completed","changes":[]}
```

## 3. 结论

- 名称覆盖修复后，`resolve` 和 `execute` 在真实主机上可执行，安装、健康检查、项目创建和幂等行为符合预期。
- 当前仍是 **手动脚本调用**，不是通过 CES 插件注册后的安装路径；SE-PHASE-008 只能部分关闭。
- 未覆盖：插件路径、网站登记、B/C 类型、CoreDNS/发布 Agent（当前类型尚未包含）。

## 4. 未完成与阻塞

CES 本地网站已启动（`http://127.0.0.1:9090`），数据库和登录可用；但 CES 到测试服务器的 SSH 在 2026-10-25 06:40 左右开始被对端关闭/超时：

```text
SSH 连接建立后，SSH banner 交换前被关闭
同一时段所有四台测试机均如此
同一来源 IP 的 GitHub SSH 也被代理关闭
```

在 SSH 恢复前，无法通过网站登记服务器或执行插件安装。下一步：

1. 确认测试机 SSH 是否对当前来源 IP 做了临时封禁或安全组变更。
2. 恢复后通过 CES API/页面登记 A，并运行 `install-components`。
3. 记录插件路径的 operationId、计划、执行日志和结果。

## 5. 插件路径尝试（2026-10-25 06:45）

- 删除旧的 `test-69-189`（container 类型）记录，重新登记为 `A-69-189`：
  `@smp/console-self-evolution/infrastructure`，自演进组，密钥 `smp-test-key`。
- 触发 `POST /console-api/servers/:id/install-components`，Job `474ff765-2246-4ce7-88d1-47799b05f3c3`。
- 结果：`failed`，`ssh_handshake_timeout`（30 秒）：
  “网络连接已建立，但 SSH 握手超时”。
- 同一时段对四台测试机的直接 SSH 也出现 banner 前关闭/超时；判断来源出口 IP 触发了目标 sshd 的限流或临时封禁。
- 为避免 CES 周期任务继续触发，已停止本地 CES 进程。

在 SSH 恢复前，插件路径、网站登记后的安装和 B/C 类型均未验证。恢复后需要：

1. 用一次 `ControlMaster` 连接建立长连接，后续操作复用，避免重复握手。
2. 通过 `PATCH /console-api/servers/:id` 更新连接参数，或重新登记。
3. 重新触发 `install-components`，记录计划、Job 步骤、远端日志和最终软件状态。

## 6. 07:20 更新

- 四台测试机的 22 端口原始 TCP 连接均拿不到 SSH banner；直接 SSH 超时。
- 曾在 A 上尝试 `sudo systemctl restart ssh` 以清除来源惩罚，命令挂起；之后无法建立新连接。该操作可能是当前症状的一部分，需通过云控制台确认 sshd 状态。
- 本地 CES 已停止，避免周期任务继续重试 SSH；Colima 与本地 PostgreSQL 仍在运行。
- 需要的恢复动作：通过云控制台检查/启动 `ssh` 服务，确认安全组仍允许当前出口 IP 访问 22 端口；恢复后重新建立长连接继续插件路径验证。

## 7. 插件路径与网站 API 验证（07:25-07:29）

SSH 恢复后，用 CES 网站后端登记并安装 A，未再手动执行 recipe。

### 7.1 登记

- 删除旧的 container 类型记录，创建 `A-69-189`：
  `@smp/console-self-evolution/infrastructure`，自演进组，`smp-test-key`。
- 服务器详情：`software_state=ready`，`status=normal`，无阻塞原因。

### 7.2 安装 Job

```text
5eaacbbe-b08a-46b4-baf8-d713221378a7  install_components  succeeded  preflight
64f9e136-4b2e-48bc-993c-343d4f3aec9f  install_components  succeeded  已完成安装并验证
da39d35a-1ced-4a8e-9efd-da9ce54911ed  install_components  succeeded  再次 preflight
314eba12-c32d-4d48-9daf-c12ef1ba73d4  install_components  succeeded  幂等检查
```

`64f9e136` 的 `apply_plan` 结果逐步为：

```text
docker-engine  after installed 29.1.3     changes []
postgresql     after installed 16.15.0    changes [container postgres]
onedev         after installed 16.9.7     changes [container onedev]
caddy          after installed 2.10.2     changes [container caddy]
```

### 7.3 结果

```text
容器：ces-infra-postgres-1 healthy，onedev/caddy Up
OneDev：/~api/server/ready = true
项目：GET /~api/projects/ids/CES = 1
网站：服务器状态 normal，software_state ready
幂等：再次 install_components 后容器 ID 与 StartedAt 不变
```

插件路径与手动脚本路径使用同一个 `stack.sh`，因此同时验证了名称覆盖修复在插件执行链中生效。

### 7.4 未覆盖

- B/C 类型与跨主机 Agent/Executor。
- 初始提交、`.onedev-buildspec.yml`、build/candidate 流水线。
- 浏览器页面的人工点击验收；本次通过网站后端 API 检查状态与任务。
