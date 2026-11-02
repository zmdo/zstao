# 演进开发 Git 代理与备灾配置实现（2026-11-02）

## 1. 实现范围

在现有 `@smp/console-workspace-group-evolution-dev` 插件中增加：

```text
Harness 设置 → 演进开发 section
Git 配置 API
单 git 工具
仅 evolution-dev 工作区组可用
OneDev token / 备灾 SSH key 加密保存
```

没有拆成 `git_status`、`git_diff` 等专用工具。

## 2. 设置接口

```text
GET  /console-api/evolution-dev/git/config
PUT  /console-api/evolution-dev/git/config
POST /console-api/evolution-dev/git/test
```

配置字段：

```text
enabled
workdir
remotes:
  role: onedev | backup
  name
  url
  username
  authType: https_token | https_password | ssh_key | ssh_agent
  secret（写入后不回显）
  passphrase
  pushMode: mirror | all_tags | branches
```

secret 使用 `ctx.secrets` 加密保存；GET 只返回 `hasSecret`。

## 3. Git 工具

注册名：

```text
git
```

参数：

```text
args: string[]   # 不含 git 本身
```

示例：

```text
git status
git branch --show-current
git remote -v
git push origin HEAD:main
git push backup --mirror
git ls-remote backup
```

授权：

```text
注册时 groupForSession(session) == evolution-dev
每次调用重新检查
离开组撤销工具
```

凭证按 remote 注入：

- OneDev HTTPS 使用 askpass，凭据来自加密配置；
- backup SSH 使用临时私钥和按 host 的 ssh_config；
- 未知 host 不注入；
- 工具输出会替换已配置 secret。

## 4. 本次配置

OneDev access token：

```text
id: 1
name: evolution-dev-git
project: CES
role: Code Writer
```

不再使用 admin 密码。

备灾 remote（第四台服务器 OneDev）：

```text
role: backup
url: http://43.128.72.83/CES-BACKUP.git
username: admin
authType: https_token
pushMode: mirror
```

第四台服务器 `43.128.72.83` 已清空并重建 OneDev，项目 `CES-BACKUP`。
真实 mirror push 和 clone 恢复见：

[第四台服务器异地备灾验证](../self-evolution-offsite-backup-2026-11-02/README.md)

## 5. 部署

镜像：

```text
43.128.69.189/ces/ces-candidate@sha256:f706fe7e8c0cc44962559cff2944ae2c81bdae166a23790448edaf4c57b16a
```

B/C 都使用该镜像。

B 保留开发工作区挂载：

```text
/srv/evolution/ces -> /root/.smp/evolution-dev/default-workspace
```

C 作为生产实例：

- 不再挂载开发工作区；
- `enabled=false`，Git 工具在配置上关闭。

明文凭证已移除：

```text
B/C：/srv/evolution/ces/.git/credentials 不存在
B/C：credential.helper 未设置
```

## 6. 验证

B：

```text
OneDev test: ok，main = 1d4f270
backup test: ok，refs/heads/main = 8dfa947
```

C：

```text
OneDev test: ok
backup test: ok
enabled=false
```

登录：

```text
B/C admin/changeme → 200
```

镜像内包含：

```text
/app/plugins/evolution-workspace-group/lib/client.js
```

设置 section 已注册到 Harness 设置。

## 7. 已知限制

- 还没有在真实的 evolution-dev 会话里点击并调用 `git` 工具；API 测试连接和工具
  使用同一套 runner/凭据逻辑，但会话级工具调用仍需 UI 验收。
- Harness 设置 section 已打包并通过客户端构建，但没有做浏览器手工点击截图。
- 备灾已改为第四台服务器上的 OneDev，并完成真实 push/clone；但仍是手工 mirror，
  没有定时任务。
- B 工作区代码仍停在 8dfa947，OneDev 已到 1d4f270；需要在默认对话里通过 git 工具
  执行 `git pull`。
- 备灾镜像使用个人 `smp.pem` 作为测试 SSH key；正式环境应使用专用部署 key。
- 管理员 token 目前是项目 Code Writer，不是 admin；但 config API 本身只校验登录，
  单用户环境可接受。

## 8. 下一步

1. 在 evolution-dev 默认会话中实际调用 `git status`、`git pull`、`git push` 验证。
2. 在设置页手工保存/测试一次并截图。
3. 把 backup URL 改为真正异地仓库。
4. 更新 B 工作区到 OneDev 最新 commit。
