# 方案 A：代码打进镜像并从 OneDev registry 拉取（2026-11-02）

## 1. 目标

验证方案 A：

```text
源码 → Docker 镜像（含 /app 代码）
     → push 到 OneDev registry
     → 删除本地镜像
     → 按 digest 从 registry 拉回
     → 用该镜像启动 CES
```

不把代码"push 到 Docker"；代码在镜像文件系统里，Git 历史仍在 OneDev。

## 2. 清空 B

在 `43.163.113.98` 上删除：

```text
所有容器
所有 Docker 网络
/srv/ces-test
onedev.agent 服务
```

保留 Docker Engine / Compose 作为基础运行时。

## 3. 源码与构建

从 OneDev 克隆：

```text
http://43.128.69.189/CES.git
commit ce9a9d5
```

构建：

```text
43.128.69.189/ces/ces-candidate:plan-a
```

镜像内验证：

```text
test -f /app/package.json
test -f /app/plugins/self-evolution/src/index.ts
→ code-in-image
```

## 4. 推送与拉回

推送到 OneDev registry：

```text
digest: sha256:03519feed8d04bb54a7ce5f24209411018fe32e233da047afffae0c5d60313d2
```

然后删除本地 tag，按 digest 拉回：

```text
Digest: sha256:03519feed8d04bb54a7ce5f24209411018fe32e233da047afffae0c5d60313d2
Status: Downloaded newer image
```

说明镜像确实来自 OneDev registry，而不是本地缓存。

## 5. 启动

B 上创建：

```text
plan-a-pg   postgres:16.15，库 ces
plan-a-ces  从 registry digest 启动，80 -> 9090
```

环境文件包含：

```text
DATABASE_URL=postgresql://ces:***@plan-a-pg:5432/ces
ENCRYPTION_KEY=***
SESSION_SECRET=***
INITIAL_PASSWORD=changeme
TRUSTED_HOST=43.163.113.98
```

验证：

```text
http://43.163.113.98/ → 303 /login
admin/changeme → 200 {"ok":true}
/console-api/auth/me → authenticated=true
ces：36 条迁移，1 个账号
```

## 6. 结论

- 代码确实被打进了应用镜像。
- 镜像可以推送到 OneDev registry。
- 删除本地镜像后可以按 digest 从 OneDev 拉回。
- 拉回的镜像可以独立启动 CES 并完成迁移和登录。

## 7. 边界

- 本次没有从该镜像"安装 OneDev 自身"；OneDev 仍在 A，镜像是 CES 应用镜像。
- 源码来自 OneDev 的 `ce9a9d5`，不是 GitHub 上最新的 `53ca011`。
- B 当前没有测试 Caddy/build agent，只有 `plan-a-ces` 和 `plan-a-pg`，80 直接由容器占用。
- 这是测试环境验证，registry 仍使用 HTTP 和管理员凭据。
