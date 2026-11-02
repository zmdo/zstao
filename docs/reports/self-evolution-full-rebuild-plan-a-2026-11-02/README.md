# A/B/C 全量清空与方案 A 重建（2026-11-02）

## 1. 清空

A/B/C 三台服务器都删除：

```text
所有容器
所有 Docker 网络
所有 Docker 镜像/构建缓存
/srv/ces-infra、/srv/ces-test、/srv/ces-prod
onedev.agent 服务
cesdeploy 用户、sudoers、ces-runtime
```

保留操作系统、SSH 和 Docker Engine。

## 2. A 重建

通过自演进插件的 `infrastructure` 类型重装：

```text
ces-infra-postgres-1  Up (healthy)
ces-infra-onedev-1    Up
ces-infra-caddy-1     Up，0.0.0.0:80 -> 80
```

OneDev 新实例：

```text
项目：CES
project path：CES
项目 ID：1
registry：启用
serverUrl：http://43.128.69.189
```

修复了一个重建问题：`stack.sh` 生成的 Caddy 只映射
`127.0.0.1:8080:80`，已补上 `80:80`，并提交到脚本。

## 3. 代码

本地最新分支：

```text
069eb88 Update lock for evolution group and expose Caddy port 80
```

从 B 克隆 GitHub 后推送到新 OneDev：

```text
http://43.128.69.189/CES.git main
```

OneDev 上的代码与镜像构建使用的代码一致。

## 4. 方案 A 镜像

在 B 上构建：

```text
43.128.69.189/ces/ces-candidate:plan-a-rebuild
```

推送到 OneDev registry：

```text
digest: sha256:530c9bfe14250c12fa40aa594cc2d260fff1b57690bb33d4f28b79af11d65782
```

构建过程中修复了：

- 新增 workspace-group 插件后 `package-lock.json` 未更新，`npm ci` 失败；
- 更新 lock 后重新构建成功；
- OneDev 初始 `serverUrl` 为 `http://onedev:6610`，registry token 地址不可从外部解析，已改为 `http://43.128.69.189`。

## 5. B/C 运行

B 和 C 都从 registry 按 digest 拉取镜像，使用独立 PostgreSQL：

```text
plan-a-ces  80 -> 9090
plan-a-pg   5432（仅容器网络）
```

B：

```text
login 200
workspace groups：
  general / server-ops / evolution-dev（演进开发） / unassigned
```

C：

```text
login 200
workspace groups：
  general / server-ops / evolution-dev（演进开发） / unassigned
```

## 6. 工作区组插件

新增：

```text
plugins/evolution-workspace-group
package: @smp/console-workspace-group-evolution-dev
```

注册：

```text
id: evolution-dev
label: 演进开发
directory: .smp/evolution-dev
order: 30
```

插件的 host 端只依赖 `workspaceGroups.register`，不依赖 UI 手工操作。
镜像 profile 已加入该插件，B/C 重建后组自动出现。

## 7. 当前入口

```text
A OneDev：  http://43.128.69.189/   → 200
B：         http://43.163.113.98/   → 303 /login
C：         http://43.153.204.197/  → 303 /login
```

B/C 账号：`admin` / `changeme`。

## 8. 边界

- 这是方案 A 的最小重建：A 只有 OneDev/PG/Caddy；B/C 只有 Docker + PG + 应用容器。
- 没有恢复 test/host 服务器类型、build agent、release/rollback Job。
- B/C 直接使用容器 80，没有 Caddy。
- A 的 OneDev 仓库是新实例，旧历史没有迁移。
- 浏览器前端仍受跨境网络影响，首次加载较慢。

## 9. 未完成

- 如果需要完整自演进，还要在 B/C 上重新引入 test/host 类型和 Agent。
- 需要给 B/C 增加 TLS/Caddy 或域名。
- 旧 GitHub 历史与 OneDev 新历史现在是同一提交快照，但不是同一个仓库历史。
