# 候选 CES 镜像与 80 端口候选环境（2026-10-25）

- 状态：候选镜像构建并启动成功；尚未由流水线构建/部署
- B：`43.163.113.98`（Ubuntu 24.04，2 vCPU / 2 GiB，Docker 29.9.2，BuildKit）
- 镜像：`ces-candidate:local`
  - image id `sha256:c44cf985919d8408d8fb57c1fc8e5d7676d9206005e10bf5616e91ae0b996ac1`
  - 大小约 1.9 GB
- 源码：`097f940` + 入口修复 `ccc4a7a`

## 1. 构建

在 B 的 `/home/ubuntu/ces-src` 执行：

```text
DOCKER_BUILDKIT=1 docker build --network=host \
  -t ces-candidate:local -f docker/Dockerfile .
```

镜像内容：

```text
node:22-bookworm-slim
/app：仓库构建产物 + 插件 lib + node_modules
/opt/dsh：dsh 0.2.1-alpha.5（npm 全局安装，Linux amd64）
/dsh-home/profiles/web：profile 与已安装的 @smp/* 插件
入口：/app/docker/entrypoint.sh
```

镜像构建时使用 `registry.npmmirror.com`。本地 macOS 上直接复制宿主 dsh 树会缺少
Linux 原生 addon，因此改为在 B 的 Linux 环境内构建。

## 2. 运行

```text
docker network ces-candidate
ces-candidate-pg：postgres:16.15，库/用户 smp
ces-candidate-ces：ces-candidate:local，端口 80 -> 9090
DATABASE_URL=postgresql://smp:smp_dev@ces-candidate-pg:5432/smp
ENCRYPTION_KEY、SESSION_SECRET、INITIAL_PASSWORD 由运行环境注入
```

dsh 拒绝 `--host 0.0.0.0`，入口脚本改为绑定容器自身 IP；可选
`TRUSTED_HOST` 用于反向代理/公网 Host。

## 3. 验证

```text
http://43.163.113.98/ → 303 /login
POST /console-api/auth/login（admin/changeme）→ 200 {"ok":true}
GET  /console-api/auth/me → authenticated=true
GET  /console-api/server-groups → 自演进组存在
GET  /console-api/site → title=Cyber Evolving System
accounts 表 → admin，totp_enabled=false
```

新库由镜像启动时的迁移创建，包含 `accounts`、`wallets` 以及全部插件表。

## 4. 未完成

- 不是由 OneDev build Job 构建/推送；没有镜像 digest 的流水线记录。
- 没有候选 Caddy/TLS；直接使用容器 80 端口。
- 没有从 A 的发布流程部署，也没有回滚。
- 还没有把候选地址暴露为正式 P1 “用户验收”记录。

## 5. 下一步

1. 把镜像构建写进 buildspec，记录构建号和镜像 digest。
2. 用 OneDev 的内置 registry 推送候选镜像。
3. 候选部署改为流水线 Job（B 上 compose），保留 80 端口入口。
4. 再补 `test` 类型与 `test.sh`，然后进入 P1 验收。
