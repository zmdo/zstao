# 干净检出构建与候选镜像骨架（2026-10-25）

- 状态：干净检出构建已验证；候选镜像构建未完成
- 代码基线：`ces/self-evolution`，`0d2a3ea`

## 1. 干净检出构建

三处 `file:../../tmp/dsh-cli/node_modules/@deepseek-ai/...` 依赖改为
npm 上的 `0.2.1-alpha.5`，并重新生成 `package-lock.json`。

在不含 `tmp/`、`node_modules/`、`.git` 的副本 `/tmp/ces-clean-build` 中：

```text
npm ci             成功
npm run build      成功（全部 workspace）
self-evolution tests 4/4 通过
node_modules/@deepseek-ai/dsh-session
                   npm 真实包，不再是指向 tmp 的链接
```

提交：`0055fd9 Build from a clean checkout without tmp dependencies`

## 2. 新库基线

新增 `plugins/database/migrations/0020_accounts.sql`，创建：

```text
accounts(id, username, password_hash, totp_enabled, totp_secret,
         totp_pending_secret, created_at)
wallets(id, ciphertext, created_at)
```

在空的 PostgreSQL 16.15 数据库上直接执行成功，`\dt` 可见两张表。
尚未通过 database 插件迁移 runner 在全新 CES 启动中验证。

## 3. 候选镜像骨架

新增：

```text
docker/Dockerfile
docker/entrypoint.sh
docker/render-profile.mjs
docker/profile/package.json
docker/profile/cordis.yml
.dockerignore
```

设计为 Node 22 + 全局 dsh `0.2.1-alpha.5` + `/app` 构建产物 +
`/dsh-home/profiles/web` 配置；运行时注入 `DATABASE_URL`、
`ENCRYPTION_KEY`、`SESSION_SECRET`、`INITIAL_PASSWORD`。

构建尝试结果：

```text
npm install -g @deepseek-ai/dsh@0.2.1-alpha.5
```

在 Docker 构建中多次遇到 npm registry `ECONNRESET`，包括切换到
npmmirror 后仍有部分包重试；构建未完成，未生成可用镜像。

## 4. 未验证

- 候选镜像启动、登录、迁移和新库初始化。
- B 上的镜像构建、候选部署、80 端口候选入口。
- `test` 类型与 `test.sh`。

## 5. 下一步

1. 用可重复的 registry/缓存方案完成镜像构建。
2. 在本地运行候选镜像，验证登录和基础页面。
3. 将 buildspec 扩展为镜像构建 Job，构建并推送 digest。
4. 在 B 部署候选并转发到 80。
