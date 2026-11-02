# 自演进三类服务器与首次演进设计

- 状态：设计草案，未实施
- 日期：2026-10-25
- 分支：`ces/self-evolution`
- 范围：自演进插件的 A／B／C 三类服务器类型、安装脚本、账号与仓库初始化、P1 首次演进
- 关联：
  - [自演进三阶段实施方案](README.md)
  - [自演进服务器与基础设施方案](../ces-self-evolution-infrastructure/README.md)
  - [内网域名与 Docker 网络方案](../ces-self-evolution-infrastructure/INTERNAL_DNS_AND_NETWORKS.md)
  - [OneDev 初始化与 Agent 自动接入验证](../ces-self-evolution-infrastructure/ONEDEV_BOOTSTRAP_VERIFICATION.md)
  - [方案问题清单](issues.md)

本文把“三类服务器”从类型名称落成可实现的软件清单、脚本规范和首次演进步骤。文中凡标“**待验证**”的字段或接口，必须在 OneDev `16.9.7` 实例上核对后才能写进实现；本文不表示这些能力已经存在。

## 0. 结论摘要

```text
A 基础设施服务器：Docker + Compose + PostgreSQL + OneDev + CoreDNS + Caddy + 发布 Agent
B 测试服务器：    Docker + Compose + Buildx + PostgreSQL（测试）+ Caddy + 构建 Agent
C 生产服务器：    Docker + Compose + PostgreSQL（生产）+ Caddy + 部署接收端
```

- 插件只负责**宿主软件**；CES 自身版本由流水线按 digest 部署，不作为插件软件管理。
- Agent 使用**裸机安装 + Remote Shell Executor**，作业直接在宿主执行，构建与部署脚本可以使用宿主 Docker。
- 所有 Job 显式写 `jobExecutor`，禁止依赖 OneDev 的自动发现执行器。
- 跨主机引导凭据只有两项：B 的 OneDev Agent Token、C 的 A 部署公钥。其余凭据各主机自生成。
- P1 首次演进只涉及 A、B：本机改代码 → 推送 → B 构建 → B 部署候选 → 用户验收；C 不参与。

## 1. 设计决定

| 编号 | 决定 | 理由 |
| --- | --- | --- |
| D1 | 插件管宿主软件，流水线管 CES 版本 | 生产替换必须在 C 停止时仍可执行，不能依赖 C 上的插件界面；digest 目标也不适合按版本列举候选 |
| D2 | A、B 使用裸机 Agent；C 不装 Agent | 构建和候选部署需要使用宿主 Docker/Buildx；A 的发布任务需要宿主 SSH 私钥；C 只作为 SSH 部署目标 |
| D3 | 使用 Remote Shell Executor，而非 Docker Executor | 作业直接使用宿主 `docker`／`docker compose`／`ssh`，避免作业容器访问宿主 Docker 和挂载凭据的复杂度 |
| D4 | 每个 Job 显式 `jobExecutor`，按项目与 Job 名限定 | 防止重型构建落到 A，或发布任务落到 B |
| D5 | 三类类型各自使用独立脚本与目录 | A/B/C 的服务名、持久目录和 secret 完全不同，共用一份脚本只会堆条件分支 |
| D6 | 凭据只在宿主文件系统，不进 payload、Git、日志 | 沿用“密钥不进入 Git、审计和 AI 上下文”的不变量 |
| D7 | 测试与生产共用同一镜像 digest | 沿用跨阶段不变量；候选部署与生产发布都按 digest |
| D8 | 内网域名 + 内部 CA | 沿用 `.internal` 方案；证书信任在 P1 就绪，不推迟到阶段三 |

## 2. 三类服务器的软件清单

### 2.1 A：基础设施服务器

| 软件键 | 产品与版本 | 形态 | 数据目录 | 监听 | 健康检查 |
| --- | --- | --- | --- | --- | --- |
| `container-runtime/docker-engine` | Docker Engine，版本部署时核定 | 宿主包（apt） | `/var/lib/docker` | unix socket | `docker info` |
| `container-runtime/docker-compose` | Compose v2 插件 | 宿主包（apt） | — | — | `docker compose version` |
| `self-evolution/postgresql` | PostgreSQL `16.15` | Compose 服务 `postgres` | `/srv/ces-infra/postgres` | `127.0.0.1:5432` | `pg_isready -U onedev -d onedev` |
| `self-evolution/onedev` | OneDev `16.9.7` | Compose 服务 `onedev` | `/srv/ces-infra/onedev` | `127.0.0.1:6610` | `GET /~api/server/ready` 返回 `true` |
| `self-evolution/coredns` | CoreDNS `1.12.0` | Compose 服务 `coredns` | `/srv/ces-infra/coredns` | `<私网 IP>:53` | `dig @<私网 IP> dev.ces.internal` |
| `self-evolution/caddy` | Caddy `2.10.2` | Compose 服务 `caddy` | `/srv/ces-infra/caddy` | `80/443` | `GET https://dev.ces.internal/` |
| `self-evolution/onedev-deploy-agent` | OneDev Agent，随服务端配套版本 | 宿主服务（裸机） | `/srv/ces-infra/agent` | 无入站 | Agent 在线 + 进程存活 |

宿主前置条件（不由插件安装，`detect` 报 `unknown`）：

```text
Java 17+（Agent 运行）
Git 2.11.1+
OpenSSH client（发布任务 SSH 到 C）
Python 3（远端操作监督进程）
curl、openssl、sudo -n
```

### 2.2 B：测试服务器

| 软件键 | 产品与版本 | 形态 | 数据目录 | 监听 | 健康检查 |
| --- | --- | --- | --- | --- | --- |
| `container-runtime/docker-engine` | Docker Engine | 宿主包 | `/var/lib/docker` | unix socket | `docker info` |
| `container-runtime/docker-compose` | Compose v2 | 宿主包 | — | — | `docker compose version` |
| `container-runtime/docker-buildx` | Buildx 插件 | 宿主包 | — | — | `docker buildx version` |
| `self-evolution/postgresql` | PostgreSQL `16.15` | Compose 服务 `postgres-test` | `/srv/ces-test/postgres` | 仅 Compose 网络 | `pg_isready -U ces -d ces_test` |
| `self-evolution/caddy` | Caddy `2.10.2` | Compose 服务 `caddy` | `/srv/ces-test/caddy` | `80/443` | `GET https://test.ces.internal/` |
| `self-evolution/onedev-build-agent` | OneDev Agent，随服务端配套版本 | 宿主服务 | `/srv/ces-test/agent` | 无入站 | Agent 在线 + 进程存活 |

B 上不属于插件软件的构建输入：

```text
CES 镜像构建上下文：仓库 + Dockerfile + 锁文件，由 Job 检出
构建基础镜像：node:22-bookworm（或核定版本），按 digest 固定
Playwright 镜像：与包版本匹配，按 digest 固定
候选 CES：按 digest 运行的 Compose 栈，由 candidate Job 部署
```

### 2.3 C：生产服务器

| 软件键 | 产品与版本 | 形态 | 数据目录 | 监听 | 健康检查 |
| --- | --- | --- | --- | --- | --- |
| `container-runtime/docker-engine` | Docker Engine | 宿主包 | `/var/lib/docker` | unix socket | `docker info` |
| `container-runtime/docker-compose` | Compose v2 | 宿主包 | — | — | `docker compose version` |
| `self-evolution/postgresql` | PostgreSQL `16.15` | Compose 服务 `postgres-prod` | `/srv/ces-prod/postgres` | 仅 Compose 网络 | `pg_isready -U ces -d ces` |
| `self-evolution/caddy` | Caddy `2.10.2` | Compose 服务 `caddy` | `/srv/ces-prod/caddy` | `80/443` | `GET https://prod.ces.internal/` |
| `self-evolution/ces-host` | 部署接收端基线 `1.0.0` | 宿主用户与目录 | `/srv/ces-prod` | `22`（宿主 sshd，仅 A 可连） | 用户、sudo 包装器、目录、`authorized_keys` 均存在 |

C 上由流水线或运维流程管理、不在本类型内的内容：

```text
CES 正式容器：由发布脚本按 digest 运行
生产数据库表结构与数据：由迁移和备份恢复管理
backup：pg_dump/restic 定时任务，按基础设施方案 §8 实现
```

`ces-host` 的版本只表示**部署接收端契约版本**，不是 CES 版本；CES 当前版本记录在 `/srv/ces-prod/runtime/current.json`，由发布脚本维护。

### 2.4 版本固定

| 组件 | 固定值 | 说明 |
| --- | --- | --- |
| OneDev | `16.9.7` | 服务端、Agent、TOD 记录为一套兼容组合；Agent 由服务端自动更新，不假定与服务端镜像标签相同 |
| PostgreSQL | `16.15` | A/B/C 相同主版本；镜像按 digest 固定 |
| Caddy | `2.10.2` | 三台相同版本 |
| CoreDNS | `1.12.0` | 第一版仅 A 单实例 |
| dsh 基线 | `0.2.1-alpha.5` | CES 镜像内固定；插件 `engines.dsh` 已钉住 |
| Docker/Compose/Buildx | 部署时核定 | 在部署清单登记具体版本 |

镜像引用统一写成 `名称:标签@sha256:摘要`。Compose 与 Job 中使用 digest，不以浮动 `latest` 决定版本。

### 2.5 不纳入插件管理的软件

```text
OneDev 自身升级：独立于 CES 发布，手工/单独任务执行
CES 运行镜像：由流水线构建与发布，插件不按版本管理
构建基础镜像、浏览器镜像：属于构建输入，随仓库或部署清单固定
模型服务：外部 API，凭据在 C 的 dsh profile，不进 Git
Docker 引擎/Compose/Buildx：由 container-runtime 插件管理，本插件只引用
```

## 3. 类型与 recipe 定义

### 3.1 软件、recipe、类型的对应

```text
software                          recipe（按角色）                  type
docker-engine                     docker-engine-apt                 A/B/C
docker-compose                    docker-compose-apt                A/B/C
docker-buildx                     docker-buildx-apt                 B
postgresql                        postgresql-infra-docker           A
postgresql                        postgresql-test-docker            B
postgresql                        postgresql-prod-docker            C
onedev                            onedev-infra-docker               A
coredns                           coredns-infra-docker              A
caddy                             caddy-infra-docker                A
caddy                             caddy-test-docker                 B
caddy                             caddy-prod-docker                 C
onedev-deploy-agent               onedev-deploy-agent-infra         A
onedev-build-agent                onedev-build-agent-test           B
ces-host                          ces-host-bootstrap                C
```

同一软件用不同 recipe 区分角色，是因为路径、服务名、监听和凭据来源不同；软件身份仍是同一个产品，版本规则共享。

### 3.2 类型定义草案

```ts
const owner = '@smp/console-self-evolution'
const runtime = '@smp/console-container-runtime'
const ubuntu2404 = [{ family: 'builtin/ubuntu', versions: { kind: 'release' as const, version: '24.04' }, architectures: ['x86_64', 'aarch64'] }]
const docker = `${runtime}/docker-engine`
const compose = `${runtime}/docker-compose`
const buildx = `${runtime}/docker-buildx`

const postgresql = `${owner}/postgresql`
const onedev = `${owner}/onedev`
const coredns = `${owner}/coredns`
const caddy = `${owner}/caddy`
const deployAgent = `${owner}/onedev-deploy-agent`
const buildAgent = `${owner}/onedev-build-agent`
const cesHost = `${owner}/ces-host`

export const selfEvolutionDefinitions: DefinitionBundle = {
  contractVersion: 2,
  owner,
  software: [
    { key: 'postgresql', name: { zh: 'PostgreSQL', en: 'PostgreSQL' }, versions: 'semver-stable' },
    { key: 'onedev', name: { zh: 'OneDev', en: 'OneDev' }, versions: 'semver-stable' },
    { key: 'coredns', name: { zh: 'CoreDNS', en: 'CoreDNS' }, versions: 'semver-stable' },
    { key: 'caddy', name: { zh: 'Caddy', en: 'Caddy' }, versions: 'semver-stable' },
    { key: 'onedev-deploy-agent', name: { zh: 'OneDev 发布 Agent', en: 'OneDev deploy agent' }, versions: 'semver-stable' },
    { key: 'onedev-build-agent', name: { zh: 'OneDev 构建 Agent', en: 'OneDev build agent' }, versions: 'semver-stable' },
    { key: 'ces-host', name: { zh: 'CES 部署接收端', en: 'CES deploy target' }, versions: 'semver-stable' },
  ],
  recipes: [
    // postgresql-infra-docker / postgresql-test-docker / postgresql-prod-docker
    // onedev-infra-docker / coredns-infra-docker
    // caddy-infra-docker / caddy-test-docker / caddy-prod-docker
    // onedev-deploy-agent-infra / onedev-build-agent-test / ces-host-bootstrap
  ],
  types: [
    {
      key: 'infrastructure',
      name: { zh: '自演进基础设施服务器', en: 'Self-evolution infrastructure server' },
      supportedOs: { kind: 'explicit', selectors: ubuntu2404 },
      requirements: [
        { software: docker, versions: { kind: 'any' }, recipes: [`${runtime}/docker-engine-apt`] },
        { software: compose, versions: { kind: 'any' }, recipes: [`${runtime}/docker-compose-apt`] },
        { software: postgresql, versions: { kind: 'any' }, recipes: [`${owner}/postgresql-infra-docker`] },
        { software: onedev, versions: { kind: 'exact', version: '16.9.7' }, recipes: [`${owner}/onedev-infra-docker`] },
        { software: coredns, versions: { kind: 'any' }, recipes: [`${owner}/coredns-infra-docker`] },
        { software: caddy, versions: { kind: 'any' }, recipes: [`${owner}/caddy-infra-docker`] },
        { software: deployAgent, versions: { kind: 'any' }, recipes: [`${owner}/onedev-deploy-agent-infra`] },
      ],
    },
    {
      key: 'test',
      name: { zh: '自演进测试服务器', en: 'Self-evolution test server' },
      supportedOs: { kind: 'explicit', selectors: ubuntu2404 },
      requirements: [
        { software: docker, versions: { kind: 'any' }, recipes: [`${runtime}/docker-engine-apt`] },
        { software: compose, versions: { kind: 'any' }, recipes: [`${runtime}/docker-compose-apt`] },
        { software: buildx, versions: { kind: 'any' }, recipes: [`${runtime}/docker-buildx-apt`] },
        { software: postgresql, versions: { kind: 'any' }, recipes: [`${owner}/postgresql-test-docker`] },
        { software: caddy, versions: { kind: 'any' }, recipes: [`${owner}/caddy-test-docker`] },
        { software: buildAgent, versions: { kind: 'any' }, recipes: [`${owner}/onedev-build-agent-test`] },
      ],
    },
    {
      key: 'host',
      name: { zh: '自演进宿主服务器', en: 'Self-evolution host server' },
      supportedOs: { kind: 'explicit', selectors: ubuntu2404 },
      requirements: [
        { software: docker, versions: { kind: 'any' }, recipes: [`${runtime}/docker-engine-apt`] },
        { software: compose, versions: { kind: 'any' }, recipes: [`${runtime}/docker-compose-apt`] },
        { software: postgresql, versions: { kind: 'any' }, recipes: [`${owner}/postgresql-prod-docker`] },
        { software: caddy, versions: { kind: 'any' }, recipes: [`${owner}/caddy-prod-docker`] },
        { software: cesHost, versions: { kind: 'exact', version: '1.0.0' }, recipes: [`${owner}/ces-host-bootstrap`] },
      ],
    },
  ],
}
```

`docker-buildx` 与 `docker-buildx-apt` 目前尚不存在，建议加到 `container-runtime` 插件，保持 Docker 家族软件身份集中。若暂不扩展该插件，可先在本插件定义，但后续应迁回。

### 3.3 依赖关系

```text
docker-engine ──> docker-compose ──> postgresql ──> onedev ──> onedev-deploy-agent
      │                                  │              │
      ├──> docker-buildx                 │              └──> onedev-build-agent
      ├──> coredns                       ├──> caddy（各角色）
      └──> caddy                         └──> ces-host
```

执行器规划器会按 recipe 的 `requires` 展开依赖；类型 `requirements` 只声明该类型需要哪些软件与 recipe。`test`／`host` 的 `requirements` 不再为空。

### 3.4 脚本文件

```text
plugins/self-evolution/scripts/
  infrastructure.sh   postgresql-infra / onedev / coredns / caddy-infra / deploy-agent
  test.sh             postgresql-test / caddy-test / build-agent
  host.sh             postgresql-prod / caddy-prod / ces-host
```

三个脚本各自自包含。脚本通过 `sh -c` 在目标机执行，不能假设仓库文件已存在，也不应互相 `source`。重复的公共函数（读写 secret、compose、health）在每个脚本内保留一份，避免部署时还需要额外的分发步骤。

## 4. 安装脚本规范

### 4.1 执行契约

远端监督进程以 root 运行，`sh -c <脚本正文>`，stdin 是单个 JSON，stdout 必须是单个 JSON。脚本必须遵守：

```text
工作目录未知：所有路径使用绝对路径
环境变量不保证：不依赖 PATH 之外的变量，显式设置 PATH
root 权限：无需 sudo -n；不要修改宿主全局配置
超时：每个操作 ≤ 900 秒（ScriptDefinition.timeoutMs）
输出：≤ 1 MiB；stdout 只放 JSON，日志写文件或 stderr
敏感信息：不写 argv、不写日志、不写 payload
```

### 4.2 脚本骨架

```sh
#!/bin/sh
set -eu
input=$(mktemp)
trap 'rm -f "$input"' EXIT
cat > "$input"
exec python3 - "$input" <<'PY'
import base64, json, os, subprocess, sys, time, urllib.error, urllib.request
from pathlib import Path

request = json.load(open(sys.argv[1]))       # 只用于输入数据
operation = request['operation']
software = request['software']
os.umask(0o077)

BASE = Path('/srv/ces-infra')               # test.sh 改为 /srv/ces-test，host.sh 改为 /srv/ces-prod
RUNTIME = BASE / 'runtime'
SECRETS = BASE / 'secrets'
COMPOSE = RUNTIME / 'compose.yml'

def run(args, check=True, input_text=None):
    result = subprocess.run(args, text=True, input=input_text,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if check and result.returncode:
        raise RuntimeError(result.stderr[-800:])
    return result

def docker(args, check=True):
    return run(['docker'] + args, check=check)

def write(path, content, mode=0o600):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not (path.exists() and path.read_text(errors='ignore') == content):
        path.write_text(content)
    os.chmod(path, mode)

def secret(path):
    path = Path(path)
    if not path.exists() or not path.read_text().strip():
        write(path, subprocess.check_output(['openssl', 'rand', '-hex', '24'], text=True).strip() + '\n')
    return path.read_text().strip()

# http() 只用于 A 的 infrastructure.sh；test.sh 读取 B 的引导 token，host.sh 不调用 OneDev API

def http(url, method='GET', body=None, timeout=15):
    password = (SECRETS / 'onedev-admin-password').read_text().strip()
    token = base64.b64encode(('admin:' + password).encode()).decode()
    headers = {'Authorization': 'Basic ' + token}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response.read().decode()

def compose(*args, check=True):
    return docker(['compose', '-f', str(COMPOSE), '--env-file', str(RUNTIME / '.env')] + list(args), check=check)
PY
```

关键规则：**输入变量固定叫 `request`，HTTP 函数叫 `http`，不得再定义名为 `request` 的函数**。这是问题清单 SE-PHASE-008 的修复形态；现有 `stack.sh` 第 9 行与第 119 行的同名覆盖必须消除。

### 4.3 操作实现

每个脚本按同一模式实现六个操作：

| 操作 | 输入 | 输出要求 |
| --- | --- | --- |
| `detect` | `operation, os, software, recipe, recipeRevision, effectiveVersions` | `{operation:'detect', result: SoftwareObservation}`；失败返回 `state:'unknown'`，退出码 0 |
| `list-candidates` | 加 `installed` | `{operation, candidates:[Candidate]}`；候选含 `version`、`targetIdentity`、`packages`、`channel` |
| `resolve` | 加 `target`、`installed` | `{operation, change, additionalRequirements: []}`；`before` 必须与 `installed` 完全一致 |
| `execute` | 加 `operationId`、`planDigest`、`change` | `{operation, state, changes:[...]}`，state 为 `completed` 或 `failed`；失败也返回 JSON |
| `verify` | 同 execute | `{operation, result, healthy}`；`result.targetIdentity` 必须等于目标 |
| `recover` | 同 execute | `{operation, state:'unknown', changes:[], code:'use_host_operation_record'}` |

`resolve` 不再自己调用 `detect` 猜状态，直接用宿主传入的 `installed`；`execute` 先核对当前状态与 `change.before` 一致，不一致按漂移失败处理。

### 4.4 幂等与 targetIdentity

```text
postgresql       targetIdentity = postgres:16.15@sha256:<digest>
onedev           targetIdentity = 1dev/server:16.9.7@sha256:<digest>
coredns          targetIdentity = coredns/coredns:1.12.0@sha256:<digest>
caddy            targetIdentity = caddy:2.10.2@sha256:<digest>
deploy-agent     targetIdentity = onedev-agent:ces-deploy-agent
build-agent      targetIdentity = onedev-agent:ces-build-agent
ces-host         targetIdentity = ces-host:1.0.0
```

`detect` 对容器类软件读取运行中容器的镜像摘要（`docker inspect` 的 `.Image` 与 `RepoDigests`），对 Agent 读取本地配置中的名称与版本，对 `ces-host` 校验目录、用户、sudo 包装器和 authorized_keys。

`execute` 只有在目标身份一致且健康时才允许直接返回完成；否则生成文件、启动服务、等待健康。重复执行同一目标必须是 no-op。

### 4.5 目录、权限与凭据生成

```text
/srv/ces-infra           750 root:cesdeploy
  runtime/               700 root      compose.yml, .env, Caddyfile, Corefile, zones/
  secrets/               700 root      onedev-admin-password, db-password
  onedev/                700 1000      OneDev 数据
  postgres/              700 999       PostgreSQL 数据
  caddy/                 700           Caddy 数据与内部 CA
  coredns/               700           zone 与配置
  agent/                 700 cesdeploy Agent 工作目录与 conf
    secrets/             700 cesdeploy deploy-key, onedev-agent-token
  logs/                  700 root
```

所有 secret 用 `openssl rand -hex 24` 生成，文件 `600`，目录 `700`，不输出到 stdout。已存在的 secret 不覆盖；需要轮换时走单独流程。

`test.sh` 对应 `/srv/ces-test`（750 root:cesagent），`host.sh` 对应 `/srv/ces-prod`（750 root:cesdeploy）。基线目录必须可被 Agent 用户穿过（750）。

B 的构建/候选 Job 以 `cesagent` 运行，因此 B 的 `runtime/` 对 `cesagent` 只读（750，文件 640），`state/` 可写（770），`bin/` 可执行（755）；A、C 的 `runtime/`、`secrets/` 仍为 700 root，Agent 用户只能进入自己的 `agent/` 目录。

### 4.6 Compose 约定

```text
项目名：ces-infra / ces-test / ces-prod
镜像：repo:tag@sha256:digest
重启策略：unless-stopped
端口：只绑定 127.0.0.1 或私网 IP
数据库密码：通过 compose secrets 或 --env-file 注入，不写进 compose.yml 明文
健康检查：每个服务都有 healthcheck 或脚本内探测
数据卷：宿主绝对路径，便于备份与保留策略
```

### 4.7 错误码与恢复

```text
detect 失败：state=unknown，code=detection_failed（附 detail ≤ 500 字符）
execute 失败：state=failed，code=installation_failed，changes 记录已发生的变化
recover：state=unknown，code=use_host_operation_record；由宿主任务记录恢复
```

不把 stderr 里的凭据写进 `detail`；不把异常堆栈直接回传。宿主已有远端操作日志时，以日志为准判断继续、恢复或结束。

### 4.8 锁与并发

- 远端监督进程已用 flock 串行化同一主机的插件操作；脚本不需要再抢全局锁。
- 脚本内部对 compose 项目加锁，防止流水线 Job 与插件操作同时修改同一栈：

```python
import fcntl

lock = open(BASE / 'runtime' / 'stack.lock', 'w')
try:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    raise RuntimeError('busy')   # 映射为 state=failed, code=busy
```

- C 的生产替换锁由发布脚本 `/srv/ces-prod/runtime/deploy.lock` 负责，粒度到发布 ID。

### 4.9 脚本验证

在声称“完成”前至少要有：

```text
1. 语法：sh -n、python3 -m py_compile（提取 heredoc 后）
2. 名称绑定：resolve 与 execute 分支各跑一次 fixture，确认 request 仍是 dict
3. 操作矩阵：detect missing/installed/unknown、resolve install/upgrade/keep、execute 幂等、verify 健康/不健康
4. 插件路径：通过注册后的 recipe 实际执行一次，而不是只跑独立 Compose 脚本
5. 流水线路径：真实 Job 执行记录（提交、buildspec 版本、构建 ID、执行器、日志、结果）
```

第 1、2 项是 SE-PHASE-008 的关闭证据；第 4、5 项是 SE-PHASE-002 的证据分级要求。

## 5. 账号、密钥与仓库初始化

### 5.1 凭据清单

| 文件 | 主机 | 权限 | 生成方式 | 使用方 | 备份/轮换 |
| --- | --- | --- | --- | --- | --- |
| `secrets/onedev-admin-password` | A | 600 root | `openssl rand -hex 24` | OneDev 初始化、管理 API | 随 A 备份；UI 轮换后更新文件 |
| `runtime/.env`（DB 密码） | A | 600 root | 同上 | PostgreSQL、OneDev | 随 A 备份 |
| `agent/secrets/deploy-key` / `.pub` | A | 600/644 cesdeploy | `ssh-keygen -t ed25519 -N ''` | 发布 Agent SSH 到 C | 私钥随 A 备份；OneDev 容器不挂载 |
| `agent/secrets/onedev-agent-token`（A） | A | 600 cesdeploy | API 生成 | A 的发布 Agent | 一次性；丢失重建 |
| `agent/secrets/onedev-agent-token`（B） | B | 600 cesagent | **引导输入**（A 创建后下发） | B 的构建 Agent | 一次性；丢失重建 |
| `secrets/authorized_keys` | C | 600 root | **引导输入**（A 公钥） | sshd | 随 C 备份 |
| `secrets/db-password` | B/C | 600 root | `openssl rand` | PostgreSQL/CES | 随各主机备份 |
| Caddy 内部 CA 私钥 | A/B/C | 600 | Caddy 自动生成 | Caddy | 随 Caddy 数据卷备份 |
| 模型 API key | C | dsh profile | 运维注入 | CES | 不进 Git/备份明文 |

### 5.2 两个跨主机引导输入

```text
B 的 OneDev Agent Token：
  在 A 上用管理员凭据创建，写入 A 的 secret，
  再通过 A→B 的受限 SSH（或一次人工拷贝）放到 B 的
  /srv/ces-test/agent/secrets/onedev-agent-token（600 cesagent）。

C 的 authorized_keys：
  在 A 上生成部署密钥对，把公钥通过一次引导
  放到 C 的 /srv/ces-prod/secrets/authorized_keys（600 root）。
```

这两项是安装顺序里唯一的“先有鸡还是先有蛋”问题。P1 可以人工完成；P2/P3 若要由 A 的引导任务自动下发，需要为 A 增加一把可登录 B 的引导密钥（或复用部署密钥并对 B 的账户限制命令），同时在[网络方案](../ces-self-evolution-infrastructure/INTERNAL_DNS_AND_NETWORKS.md)中增加 A→B 的受限 SSH 条目，并在 P3 的清理范围外保存引导材料。不要为了提高自动化把管理员密码复制到 B/C。

### 5.3 OneDev 管理员初始化

Compose 中写入：

```yaml
environment:
  initial_user: admin
  initial_password_file: /run/secrets/onedev-admin-password
  initial_email: admin@example.com
  initial_server_url: https://dev.ces.internal
secrets:
  - onedev-admin-password
```

要点：

- `initial_*` 只对空数据目录生效。已有 OneDev 数据时不会覆盖管理员；重跑不得依赖它改密码。
- `initial_server_url` 必须是 Agent 和构建容器能访问的地址，不能写 `localhost`。B 的 Agent 通过 `https://dev.ces.internal` 访问，需信任内部 CA。
- 管理员密码文件 `600 root`，不写进 compose 的 `environment` 明文，不进 Git。

### 5.4 OneDev 项目初始化

已核对的接口（OneDev 16.9.7）：

```text
GET  /~api/server/ready                 → true
GET  /~api/projects/ids/CES             → 项目 id；不存在时 404
POST /~api/projects                     → 返回项目 id
项目字段：name, key, description, codeManagement, packManagement,
          issueManagement, wikiManagement, gitPackConfig, codeIndexingSetting
```

`issueManagement` 默认为 `true`，创建时必须显式设为 `false`；`codeManagement` 与 `packManagement` 设为 `true`。

```python
def wait_ready():
    for _ in range(120):
        try:
            if http('http://127.0.0.1:6610/~api/server/ready').strip() == 'true':
                return
        except Exception:
            pass
        time.sleep(2)
    raise RuntimeError('onedev_not_ready')

def ensure_project():
    wait_ready()
    try:
        http('http://127.0.0.1:6610/~api/projects/ids/CES')
        return
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
    body = {
        'name': 'CES',
        'key': 'CES',
        'description': 'CES self evolution repository',
        'codeManagement': True,
        'packManagement': True,
        'issueManagement': False,
        'wikiManagement': False,
        'gitPackConfig': {},
        'codeIndexingSetting': {},
    }
    http('http://127.0.0.1:6610/~api/projects', 'POST', body)
    http('http://127.0.0.1:6610/~api/projects/ids/CES')  # 后置校验
```

不要用“等待 90 次再创建”的写法：先等 readiness，再 GET 一次，404 才 POST，最后再 GET 校验。当前工作区的 `stack.sh` 还存在同名函数覆盖问题，不能直接沿用。

### 5.5 初始提交与 buildspec

推荐把初始仓库（含 `.onedev-buildspec.yml`）作为**引导材料**保存在 A/B/C 清理范围之外，通过 Git 推送导入，而不是用 API 逐文件写入。

下面的 `INITIAL_SHA` 和 `/srv/ces-infra/bootstrap/repo` 是引导材料中的实际提交与工作副本占位；URL 已带用户名，askpass 只返回密码。

```sh
askpass=$(mktemp)
chmod 700 "$askpass"
printf '#!/bin/sh\nprintf "%s\\n" "$ONEDEV_ADMIN_PASSWORD"\n' > "$askpass"
trap 'rm -f "$askpass"' EXIT

export GIT_ASKPASS="$askpass"
export GIT_TERMINAL_PROMPT=0
export ONEDEV_ADMIN_PASSWORD="$(cat /srv/ces-infra/secrets/onedev-admin-password)"

git -C /srv/ces-infra/bootstrap/repo push \
  "http://admin@127.0.0.1:6610/CES.git" \
  "$INITIAL_SHA:refs/heads/main"
```

要点：

- 密码只通过环境变量和 askpass 进入 Git 进程，不出现在 URL、argv 或日志。CI/自动化长期推送应改用 OneDev 访问令牌，而不是管理员密码。
- 先检查远端是否已有 `main`：已存在且 SHA 相同时跳过；SHA 不同时失败，不覆盖。
- 默认分支：OneDev 在首次推送后通常会选用已推送分支；**待验证** 16.9.7 是否自动设为 `main`，以及是否可通过项目设置 API 显式设置。若不能，记录为一次性 UI 步骤。
- `.onedev-buildspec.yml` 随初始提交进入仓库，不通过 API 写入；这样构建规范与代码同版本。

### 5.6 Agent Token 与 Agent 上线

已核对的接口：

```text
POST /~api/agent-tokens            → 返回 token id
GET  /~api/agent-tokens/{id}       → 返回 value（token 明文）
GET  /~api/agent-tokens/{id}/agent → 返回 Agent，含 online 字段
DELETE /~api/agent-tokens/{id}     → 删除
```

A 的发布 Agent：

```python
token_id = http('http://127.0.0.1:6610/~api/agent-tokens', 'POST').strip()
token = json.loads(http(f'http://127.0.0.1:6610/~api/agent-tokens/{token_id}'))['value']
write(BASE / 'agent' / 'secrets' / 'onedev-agent-token', token + '\n')
```

B 的构建 Agent 读取引导输入文件，不调用管理 API，也不持有管理员密码。

Agent 安装步骤（A/B 相同，仅参数不同）：

```text
1. 解压 Agent 分发包到 /srv/ces-*/agent
2. 写 conf/agent.properties：
     serverUrl=https://dev.ces.internal
     agentTokenFile=/srv/ces-*/agent/secrets/onedev-agent-token
     agentName=ces-deploy-agent | ces-build-agent
3. 设置所有者为运行 Agent 的专用用户，目录 700，文件 600
4. 在 bin/agent.sh 中设置 RUN_AS_USER（默认服务以 root 运行），
   再执行 bin/agent.sh install
5. 用 GET /~api/agent-tokens/{id}/agent 确认 online:true
```

分发包的自动下载地址尚未核实，**待验证**；第一版可把分发包作为引导材料放在主机上。Agent 会随 OneDev 服务端自动更新，插件只负责首次安装与 token 配置。

### 5.7 Job Executor

在 A 的 OneDev 中创建两个 Remote Shell Executor：

| 名称 | 类型 | Agent 选择器 | 适用 Job | 并发 |
| --- | --- | --- | --- | --- |
| `ces-build-test` | Remote Shell Executor | `"Name" is "ces-build-agent"` | `"Project" is "CES" and ("Job" is "build" or "Job" is "candidate")` | 1 |
| `ces-production-deploy` | Remote Shell Executor | `"Name" is "ces-deploy-agent"` | `"Project" is "CES" and "Job" is "release"` | 1 |

- 每个 Job 显式写 `jobExecutor`。没有配置执行器时 OneDev 会自动发现，自动发现可能把构建放到 A 或把发布放到 B，必须避免。
- 适用 Job 限制对 Shell Executor 是必要的：否则任何 Job 都可能拿到宿主权限。
- A 的部署私钥归 Agent 运行用户所有，OneDev 容器不挂载该目录；`ces-production-deploy` 只允许 `release` Job，普通构建无法通过该执行器读取私钥。
- 已核对的 REST：`GET/POST /~api/settings/job-executors`。请求体是 `JobExecutor` 列表，具体多态 JSON 形状**待验证**：建议先在 UI 创建一次，用 GET 抓取实际 JSON，作为幂等种子；自动化配置必须在 P1 前完成并验证。

权限边界：

```text
B 的 cesagent：属于 docker 组，能操作宿主 Docker/Buildx；可读写 state/，只读 runtime/。
               这等价于构建主机的 root 信任边界，只允许构建与候选部署 Job 使用。
A 的 cesdeploy：不加入 docker 组；只读自己的 agent/secrets（部署私钥）；只通过 SSH 操作 C。
C 的 cesdeploy：不加入 docker 组；只能通过 sudo 运行 /usr/local/sbin/ces-runtime 白名单包装器。
```

### 5.8 C 的部署接收端

```text
用户：cesdeploy（系统用户，无密码，shell 受限）
ces-host 把 secrets/authorized_keys 安装为 ~cesdeploy/.ssh/authorized_keys（600 cesdeploy）
主目录：/srv/ces-prod
目录：runtime/ data/ secrets/ bin/ backups/，均 700
authorized_keys：from="<A 私网 IP>",no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc <A 公钥>
sudoers：cesdeploy ALL=(root) NOPASSWD: /usr/local/sbin/ces-runtime
```

`/usr/local/sbin/ces-runtime` 是白名单包装器，只接受：

```text
install --digest sha256:<64 位十六进制>
verify
rollback --release <id>
```

不接受任意命令、不直接授权 `docker`。包装器内部：

```text
1. 校验参数与 digest 格式
2. 获取 /srv/ces-prod/runtime/deploy.lock（flock）
3. 以 digest 作为默认 release id，记录状态到 runtime/releases/<id>.json
4. 需要时先备份数据库（pg_dump 一致性导出）
5. 用 compose 按 digest 替换 CES 容器
6. 健康检查：HTTP 200 + 登录页/核心接口 + 数据库连接
7. 成功写 current.json；失败按迁移兼容性回滚或保留维护状态
```

发布脚本的源码在仓库 `deploy/` 下，C 首次引导时安装到 `/srv/ces-prod/bin`（root 所有，755）；脚本升级是独立操作，需在发布记录中保存校验和，不与镜像替换混在同一次发布中。这样 A 在 C 停止时仍能完成发布、检查或恢复。

### 5.9 内部 CA 与信任分发

- Caddy 在 A/B/C 各自生成内部 CA（`tls internal`），私钥留在 Caddy 数据卷，权限 600。
- 导出根证书：`docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt`。
- 分发到：
  - 浏览器／运维机信任库；
  - B 的 Docker daemon（`/etc/docker/certs.d/dev.ces.internal/ca.crt`，用于拉取镜像）；
  - B 的 JVM truststore（Agent 访问 `https://dev.ces.internal`）；
  - Playwright/Chromium 的信任配置（或测试时显式忽略，但不能作为唯一手段）。
- 根证书轮换需要同步更新以上位置；CA 私钥丢失会导致所有内部 TLS 重新签发。

## 6. P1 首次演进

实施顺序（P1 只做到第 5 步；第 6 步属于 P2）：

```text
1. 安装 A 类型：Docker/Compose、PostgreSQL、OneDev、CoreDNS、Caddy
2. 初始化 OneDev：管理员、CES 项目、初始提交（含 buildspec）
3. 安装 A 发布 Agent，创建 token，配置 ces-production-deploy 执行器
4. 安装 B 类型；下发构建 Agent token；配置 ces-build-test 执行器
5. 跑 P1：改代码 → 推送 → build → candidate → 用户验收
6. 安装 C 类型与部署接收端；接入 release Job（P2）
```

### 6.1 进入条件

```text
A：类型安装完成；OneDev 16.9.7 ready；CES 项目已创建；初始提交与 buildspec 已导入
A：发布 Agent 在线，Executor ces-production-deploy 已配置
B：类型安装完成；构建 Agent 在线（token 已下发），Executor ces-build-test 已配置
B：Docker/Buildx/Compose 可用；测试 PostgreSQL 与 Caddy 可用
本机：能解析并访问 https://dev.ces.internal；持有推送凭据
C：P1 不要求
```

### 6.2 镜像与构建约定

CES 镜像必须能从干净提交构建，不依赖本机忽略目录或 `file:../../tmp/...` 依赖（对应基础设施方案 §9）。最低要求：

```text
Dockerfile 使用固定 digest 的基础镜像
锁文件（package-lock.json）随仓库提交，构建使用 npm ci
构建阶段完成插件与客户端资源构建；运行阶段只带运行依赖
镜像标签包含提交与构建号；镜像 label 写入 revision、version、build
迁移文件随镜像发布；启动时执行迁移
```

构建在 B 的 Job 中执行；不在 A 或本机构建生产镜像。

### 6.3 buildspec 草案

以下是结构草案。`version: 54` 与 `jobExecutor` 字段已按 16.9.7 核对；具体步骤字段（尤其参数、触发器、artifact）需要在实例上用 TOD／构建规范校验后定稿。

```yaml
version: 54
jobs:
- name: build
  jobExecutor: ces-build-test
  steps:
  - type: CheckoutStep
    name: checkout
    cloneCredential:
      type: HttpCredential
      accessTokenSecret: onedev-job-token
  - type: CommandStep
    name: test
    runInContainer: true
    image: node:22-bookworm@sha256:<固定摘要>
    interpreter:
      type: PosixInterpreter
      shell: bash
      commands: |
        set -euo pipefail
        npm ci
        npm test
        npm run build
    condition: SUCCESSFUL
  - type: CommandStep
    name: image
    runInContainer: false
    interpreter:
      type: PosixInterpreter
      shell: bash
      commands: |
        set -euo pipefail
        # REGISTRY_USER / REGISTRY_PASSWORD 由 Job Secret 注入，变量名按执行器配置调整
        echo "$REGISTRY_PASSWORD" | docker login registry.ces.internal -u "$REGISTRY_USER" --password-stdin
        image=registry.ces.internal/ces
        tag="$image:candidate-@commit_hash@"
        docker buildx build --pull --push --platform linux/amd64 \
          --label org.opencontainers.image.revision=@commit_hash@ \
          --label org.opencontainers.image.version=@build_number@ \
          -t "$tag" .
        digest=$(docker buildx imagetools inspect --format '{{json .Manifest.Digest}}' "$tag" | tr -d '"')
        printf '{"commit":"%s","build":"%s","image":"%s","digest":"%s"}\n' \
          "@commit_hash@" "@build_number@" "$tag" "$digest" > build-info.json
    condition: SUCCESSFUL
  - type: PublishArtifactStep
    name: build info
    artifacts: build-info.json
    condition: SUCCESSFUL

- name: candidate
  jobExecutor: ces-build-test
  paramSpecs:
  - type: TextParam
    name: digest
    description: 要部署的候选镜像 digest（sha256:...）
  steps:
  - type: CommandStep
    name: deploy candidate
    runInContainer: false
    interpreter:
      type: PosixInterpreter
      shell: bash
      commands: |
        set -euo pipefail
        /srv/ces-test/bin/ces-candidate deploy "@param:digest@"
        /srv/ces-test/bin/ces-candidate verify
    condition: SUCCESSFUL

- name: release
  jobExecutor: ces-production-deploy
  paramSpecs:
  - type: TextParam
    name: digest
    description: 用户已验收的镜像 digest
  steps:
  - type: CommandStep
    name: release
    runInContainer: false
    interpreter:
      type: PosixInterpreter
      shell: bash
      commands: |
        set -euo pipefail
        ssh -o BatchMode=yes -o StrictHostKeyChecking=yes \
          cesdeploy@prod.ces.internal \
          "sudo -n /usr/local/sbin/ces-runtime install --digest @param:digest@"
    condition: SUCCESSFUL
```

`/srv/ces-test/bin/ces-candidate` 由 `test.sh` 安装（也可由仓库 `deploy/` 随候选环境分发），至少支持：

```text
deploy <digest>   拉取指定 digest，写 compose 覆盖文件，启动候选栈，等待健康
verify            检查 HTTP 200、数据库连接和核心接口；失败返回非零
rollback          恢复上一候选的 compose 与镜像
```

脚本对 `/srv/ces-test/state/candidate.lock` 加锁，把当前与上一候选记录在 `/srv/ces-test/state/candidate.json`；失败时恢复上一候选，不把新候选标为可验收。

说明：

- `build` 与 `candidate` 分成两个 Job，是为了让候选部署可以由用户或 CES 对指定 digest 重跑，而不是每次重新构建。
- `candidate` 的 `digest` 参数来自 build 的结果；P1 第一版可以由人工从 build 日志/artifact 复制。后续再接入 Build Promotion 或自动参数传递。
- `release` 在 P1 只作为占位与演练目标，正式使用在 P2；执行器已经分离，避免把发布权限给 B。
- 凭据通过 OneDev Job Secret 注入（`onedev-job-token`、registry 凭据、模型 key），不要写进 buildspec。
- Buildx 安全默认值：16.9.7 要求使用的 Docker 执行器显式启用相关选项；本项目使用 Shell Executor + 宿主 Buildx，需在 B 的部署文档中记录开启方式并验证。
- `test` 步骤用 Node 容器运行，避免在 B 宿主安装 Node.js；若改为宿主执行，必须把 Node.js/npm 加入 B 的前置条件并记录版本。

### 6.4 首次演进步骤

```text
1. 本机在分支上做最小改动（例如版本号或 README），提交并推送：
     git push onedev HEAD:main

2. OneDev 收到提交，build Job 在 B 执行：
   - 记录提交 SHA、buildspec 版本、build 编号
   - 测试与构建通过
   - 推送候选镜像，得到 digest D1
   - 产物 build-info.json 含 commit/build/image/digest

3. 在 OneDev 运行 candidate Job，参数 digest=D1：
   - B 拉取 D1，替换候选 Compose 栈
   - 健康检查与冒烟测试通过
   - 记录候选 URL 与结果

4. 用户访问 https://test.ces.internal 验收：
   - 登录、核心插件、会话、工作区、本次改动
   - 记录验收对应的 digest D1

5. 验收通过后进入 P2；P1 到此结束，不发布到 C。
```

### 6.5 证据模板

```text
需求/任务：
提交 SHA：
buildspec 版本：
OneDev build 编号：
执行器：ces-build-test
镜像：registry.ces.internal/ces:candidate-<sha>
digest：sha256:...
B 部署时间与健康检查结果：
冒烟/自动化测试结果：
用户验收时间与结论：
验收绑定的 digest：
失败与重试记录：
```

同一份记录同时写入 OneDev build 报告和项目文档；只把“Job 成功”当作构建证据不够，必须能对应到具体 digest 和部署结果。

### 6.6 失败处理

```text
构建失败：不产生候选；修复后重新提交，旧验收不适用
候选部署失败：ces-candidate 保留上一候选镜像与 Compose 版本，记录失败
健康检查失败：同上，不上报为可验收
验收后代码变化：生成新 digest，重新验收
```

### 6.7 P1 退出清单

```text
本机推送 → OneDev 收到提交
build 成功，测试通过，镜像推送并记录 digest
candidate 成功，B 按同一 digest 运行候选
用户可访问测试地址并完成验收
提交、构建、digest、部署、测试、验收记录可追溯
插件安装路径与流水线路径分别有验证记录
```

## 7. 与问题清单的对应

| 问题 | 本文的处理 | 仍未关闭的部分 |
| --- | --- | --- |
| SE-PHASE-002 | 给出“定义／实现／独立脚本／插件路径／真实 Job”五级证据口径 | 实际验证记录 |
| SE-PHASE-003 | 明确 P1 前置只到“最小 build 与候选”，release 在 P2 | 原方案 §2/§3/§6/§7 需按此表改写 |
| SE-PHASE-004 | 固定 A 发布 Agent、B 构建 Agent，C 无 Agent；执行器显式 | 网络方案需增加 A→B 引导 SSH 条目并统一入口矩阵 |
| SE-PHASE-008 | 固定名称绑定规则并给出脚本骨架与验证项 | 实际修复提交 |
| SE-PHASE-001 | 明确联网依赖清单与固定版本 | 依赖来源、digest、模型配置的实际核对 |
| SE-PHASE-005 | release 设计包含锁、备份、健康检查和恢复入口 | P2 演练与数据库兼容性验证 |
| SE-PHASE-006 | 验收主体仍是用户，AI 只做检查与请求 | 文档措辞统一 |
| SE-PHASE-007 | 引导材料与清理范围分离 | P3 清理清单、引导脚本、恢复步骤 |

## 8. 待验证与待决定

| 项 | 影响 | 验证方式 |
| --- | --- | --- |
| OneDev 默认分支是否随首次推送设置、能否通过 API 设置 | 初始导入的可重复性 | 在 16.9.7 实例上推送后 GET/UI 核对 |
| `POST /~api/settings/job-executors` 的多态 JSON 形状 | 执行器自动配置 | UI 创建后 GET 抓取，按实际 JSON 播种 |
| Agent 分发包下载地址与自动安装方式 | Agent 安装自动化 | 从 16.9.7 实例获取实际命令/URL |
| 内部 CA 在 Java、Docker、Playwright 的信任配置 | 构建与 Agent 连接 | 在 B 上逐项验证 |
| `accounts`/`wallets` 基线的空库建表 | C/B 新环境可用性 | 用既有基线或补齐迁移后验证 |
| CES 镜像内容与 dsh 依赖来源 | 干净构建 | 空缓存构建一次并记录 |
| Buildx 在 16.9.7 Shell Executor 上的启用方式 | 镜像构建 | 在 B 上跑一次最小 build |
| OneDev 变量名（commit/build）与 `@param:` 插值语法 | buildspec 草案的可执行性 | 用 TOD 校验并跑一次最小 build |
| A→B 引导 SSH 的网络放行 | token 下发、P3 引导 | 网络方案与防火墙核对 |
| C 的 `authorized_keys` 引导方式 | 首次发布 | P1.5/P2 演练 |
| 备份工具与恢复点粒度 | P2/P3 恢复 | 按基础设施方案 §8 选定并演练 |

## 附录 A：主机目录

```text
A /srv/ces-infra
  runtime/{compose.yml,.env,Caddyfile,Corefile,zones}
  secrets/{onedev-admin-password,db-password}
  agent/{conf,work,secrets/{deploy-key,deploy-key.pub,onedev-agent-token}}
  onedev/ postgres/ caddy/ coredns/ logs/ bootstrap/

B /srv/ces-test
  runtime/{compose.yml,.env,Caddyfile}     750 root:cesagent
  state/{candidate.json,candidate.lock}    770 root:cesagent
  secrets/db-password
  agent/{conf,work,secrets/onedev-agent-token}
  postgres/ caddy/ logs/ bin/{ces-candidate} bootstrap/

C /srv/ces-prod
  runtime/{compose.yml,.env,Caddyfile,current.json,deploy.lock,releases/}
  secrets/{authorized_keys,db-password}
  postgres/ caddy/ data/ bin/{ces-runtime} backups/ logs/
```

## 附录 B：已核对接口速查

```text
OneDev 16.9.7 buildspec：version: 54；Job 字段 jobExecutor
Job Executor REST：GET/POST /~api/settings/job-executors
项目：GET /~api/projects/ids/{path}；POST /~api/projects；字段见 §5.4
Agent Token：POST /~api/agent-tokens；GET /~api/agent-tokens/{id}；
             GET /~api/agent-tokens/{id}/agent
Agent 安装：conf/agent.properties 的 serverUrl、agentTokenFile、agentName；
             bin/agent.sh install
执行器：Remote Shell Executor；Agent Selector 表达式如 `"Name" is "ces-build-agent"`
```

## 附录 C：参考资料

- [OneDev 16.9.7 发布](https://github.com/theonedev/onedev/releases/tag/v16.9.7)
- [OneDev Agent 管理](https://docs.onedev.io/administration-guide/agent-management)
- [OneDev Build Farm with Agents](https://docs.onedev.io/tutorials/cicd/agent-farm)
- [OneDev Plain Old Build](https://docs.onedev.io/tutorials/cicd/plain-old-build)
- [OneDev 项目 REST 源码](https://github.com/theonedev/onedev/blob/v16.9.7/server-core/src/main/java/io/onedev/server/rest/resource/ProjectResource.java)
- [OneDev Job 执行器字段](https://github.com/theonedev/onedev/blob/v16.9.7/server-core/src/main/java/io/onedev/server/buildspec/job/Job.java)
- [OneDev 设置 REST](https://github.com/theonedev/onedev/blob/v16.9.7/server-core/src/main/java/io/onedev/server/rest/resource/SettingResource.java)
