# 第四台服务器异地备灾验证（2026-11-02）

## 1. 服务器

使用第四台空闲服务器：

```text
43.128.72.83
```

清空旧容器、网络、镜像和 `/srv/ces-infra` 后重建。

## 2. 重建的备灾 OneDev

组件：

```text
OneDev 16.9.7
PostgreSQL 16.15
Caddy 2.10.2
```

入口：

```text
http://43.128.72.83/ → 200
```

新项目：

```text
name: CES-BACKUP
path: CES-BACKUP
project id: 2
```

备灾 token：

```text
name: ces-backup-token
project: CES-BACKUP
role: Code Writer
```

注意：第一次创建的项目路径被 OneDev 生成成了带空格的 `CES Backup`，
Git URL 不可用；重新创建了 path 为 `CES-BACKUP` 的项目，并给 token 增加授权。

## 3. B 的备灾配置

在 B 的“演进开发”设置中，backup remote 改为：

```text
name: D-备灾
url: http://43.128.72.83/CES-BACKUP.git
username: admin
authType: https_token
pushMode: mirror
```

`POST /console-api/evolution-dev/git/test role=backup` 返回：

```text
ok: true
code: 0
```

## 4. 实际镜像推送与恢复

从 B 的 `/tmp/ces-src`（commit `1d4f270`）推送：

```text
git push --force http://admin:***@43.128.72.83/CES-BACKUP.git HEAD:refs/heads/main
```

D 的 OneDev 仓库：

```text
refs/heads/main = 1d4f270
```

从 D 克隆恢复：

```text
git clone http://43.128.72.83/CES-BACKUP.git
commit = 1d4f270
```

这说明不是只测试 `ls-remote`，而是完成了真实的远端推送和恢复克隆。

## 5. 当前限制

- 备灾的是 Git 仓库内容，不包含 OneDev 的 issue、PR、构建、registry 和数据库。
- B 的默认工作区代码仍为 `8dfa947`，本次用 `/tmp/ces-src` 的 `1d4f270` 做镜像；
  默认对话需要先通过 git 工具 `git pull`。
- C 是生产实例，Git 工具仍处于 `enabled=false`，没有配置开发工作区。
- 还没有定时自动 mirror；本次是手工推送。

## 6. 验证结论

```text
异地服务器重建 OneDev     通过
备灾项目创建              通过
备灾 token 授权           通过
B 配置 test 连接          通过
真实 mirror push          通过
从备灾仓库 clone 恢复     通过
```
