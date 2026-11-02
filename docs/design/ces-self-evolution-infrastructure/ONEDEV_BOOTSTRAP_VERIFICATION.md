# OneDev 初始化与 Agent 自动接入验证

- 日期：2026-10-24
- 分支：`ces/self-evolution`
- 验证方式：独立 Docker Compose 脚本，不使用插件内的 recipe
- 测试服务器：`test-69-189`，`43.128.69.189`，Ubuntu 24.04，Docker 已安装
- OneDev 版本：`16.9.7`

## 1. 结论

已验证可以完全自动化，不需要人工完成 OneDev 首次引导，也不需要直接写 OneDev 数据库。

自动化流程：

```text
生成管理员密码
→ 启动 PostgreSQL
→ 启动 OneDev 并传入 initial_* 环境变量
→ 等待 /~api/server/ready
→ 使用管理员 Basic Auth 创建 Agent Token
→ 读取 Token 值
→ 启动 Agent 容器
→ 验证 Agent 在线
```

## 2. OneDev 源码依据

### 2.1 首次初始化

OneDev `DefaultDataService` 支持以下环境变量：

```text
initial_user
initial_password
initial_password_file
initial_email
initial_server_url
initial_ssh_root_url
```

源码：

- <https://github.com/theonedev/onedev/blob/v16.9.7/server-core/src/main/java/io/onedev/server/data/DefaultDataService.java>

OneDev 自身的 E2E 测试也使用这些变量跳过首次引导：

- <https://github.com/theonedev/onedev/blob/v16.9.7/e2e-test/README.md>

### 2.2 Agent Token API

`AgentTokenResource` 提供：

```text
POST /~api/agent-tokens
GET  /~api/agent-tokens/{id}
DELETE /~api/agent-tokens/{id}
```

源码：

- <https://github.com/theonedev/onedev/blob/v16.9.7/server-core/src/main/java/io/onedev/server/rest/resource/AgentTokenResource.java>

注意：

```text
POST 返回 token id
GET  /{id} 返回包含 value 的 AgentToken
```

### 2.3 API 基础路径

REST 基础路径是：

```text
/~api
```

不是：

```text
/api
```

源码：

- <https://github.com/theonedev/onedev/blob/v16.9.7/server-core/src/main/java/io/onedev/server/rest/ApiHelpJson.java>

### 2.4 Basic Auth

REST API 支持管理员用户名和密码的 Basic Auth：

- <https://github.com/theonedev/onedev/blob/v16.9.7/server-core/src/main/java/io/onedev/server/security/BasicAuthenticationFilter.java>

### 2.5 Agent 启动命令

OneDev 自己的 Agent 添加面板生成的 Docker 命令：

```text
docker run -t \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v $(pwd)/agent/work:/agent/work \
  -e serverUrl=<serverUrl> \
  -e agentToken=<token> \
  -h myagent \
  1dev/agent
```

源码：

- <https://github.com/theonedev/onedev/blob/v16.9.7/server-core/src/main/java/io/onedev/server/web/page/admin/buildsetting/agent/AddAgentPanel.java>

## 3. 验证脚本

脚本位于：

```text
scripts/verify-onedev-bootstrap.sh
```

验证目录：

```text
/srv/onedev-verify
```

Compose 服务：

```text
postgres:16.15
1dev/server:16.9.7
1dev/agent
```

首次初始化环境变量：

```yaml
initial_user: admin
initial_password_file: /run/secrets/onedev-admin-password
initial_email: admin@example.com
initial_server_url: http://onedev:6610
```

管理员密码与 Agent Token 写入：

```text
/srv/onedev-verify/secrets/onedev-admin-password
/srv/onedev-verify/secrets/onedev-agent-token
```

权限：

```text
目录 700
文件 600
```

## 4. 实测结果

### 4.0 执行说明

首次执行脚本时，SSH 连接在拉取 Agent 镜像期间断开；容器继续启动。随后通过 OneDev API 和管理员凭据独立复核了 readiness、Agent Token 和 Agent 在线状态，验证结论不受影响。

### 4.1 OneDev 首次初始化

```text
OneDev version: 16.9.7
GET /~api/server/ready: true
GET /: 200
```

管理员 Basic Auth 登录成功。

### 4.2 Agent Token

```text
POST /~api/agent-tokens
→ token id = 1
```

读取 token：

```text
GET /~api/agent-tokens/1
→ AgentToken.value
```

Token 已写入本机 secret 文件。

### 4.3 Agent 容器

```text
Agent 名称：myagent
Agent 镜像：1dev/agent
Agent online：true
Agent ip：172.18.0.4
Agent os：Linux / amd64
```

最终容器状态：

```text
onedev-verify-postgres-1   Up (healthy)
onedev-verify-onedev-1     Up 127.0.0.1:6610->6610/tcp
onedev-verify-agent-1      Up
```

### 4.4 API 返回示例

```json
{
  "id": 1,
  "name": "myagent",
  "ipAddress": "172.18.0.4",
  "osName": "Linux",
  "osVersion": "6.8.0-138-generic",
  "osArch": "amd64",
  "cpuCount": 2,
  "paused": false,
  "online": true,
  "tokenId": 1
}
```

## 5. 验证中发现的细节

### 5.1 API 路径必须是 `/~api`

如果使用 `/api/agent-tokens`，会得到错误的路径结果。

### 5.2 `POST` 不返回 token 值

`POST /~api/agent-tokens` 只返回数字 id。

必须再执行：

```text
GET /~api/agent-tokens/{id}
```

才能取得 `value`。

### 5.3 `initial_*` 只对空数据目录生效

OneDev 已有数据时会跳过首次初始化。

生产升级/重跑不能依赖这些变量覆盖管理员。

### 5.4 Agent Token 是消耗型凭据

Agent 连接后会进入 in-use 状态。

脚本需要持久化 token，避免重复创建；如果 Agent 离线且 token 丢失，需要重新创建并替换 Agent 环境变量。

### 5.5 `initial_server_url` 必须是 Agent 能访问的地址

本次测试使用：

```text
http://onedev:6610
```

因为 Agent 和 OneDev 在同一个 Compose 网络。

正式环境如果使用 Caddy/域名，需要把该值配置为 Agent 可访问的正式地址，不能只写 `localhost`。

### 5.6 Agent 容器需要 Docker Socket

本次验证使用：

```text
-v /var/run/docker.sock:/var/run/docker.sock
```

这等价于给 Agent 宿主机 Docker 控制能力，生产上需要单独评估和限制。

## 6. 与插件方案的衔接

建议在自演进插件中增加独立的：

```text
onedev-agent
```

软件定义和 recipe。

依赖：

```text
Docker
PostgreSQL
OneDev
```

安装步骤：

```text
OneDev readiness
→ 管理员 Basic Auth
→ POST /~api/agent-tokens
→ GET /~api/agent-tokens/{id}
→ 写 secret
→ 启动 1dev/agent
→ 验证 agent online
```

不要把 Agent Token 写进：

```text
compose.yml
Git
审计正文
AI 上下文
```

## 7. 遗留问题

- 本次验证没有接入 Caddy/正式域名，`initial_server_url` 使用内部服务名。
- 本次验证没有测试 Agent 执行真实构建任务，只验证了在线状态。
- Agent 的 Docker Socket 权限需要单独的安全设计。
- 验证容器保留在测试服务器上供检查，未自动清理。
