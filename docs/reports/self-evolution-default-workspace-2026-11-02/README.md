# “演进开发”默认工作区挂载 CES 代码（2026-11-02）

## 1. 实际默认路径

插件 `evolution-dev` 的组目录是：

```text
.smp/evolution-dev
```

实际 home 是 `/root`，所以默认工作区是：

```text
/root/.smp/evolution-dev/default-workspace
```

不是 `/dsh-home/...`。workspace-groups 使用 `homedir()`，不是 `DSH_HOME`。

## 2. 实现方式

在 B/C 的宿主机准备可写代码目录：

```text
/srv/evolution/ces
```

从 OneDev 克隆：

```text
http://43.128.69.189/CES.git
```

然后重启 `plan-a-ces`，增加 bind mount：

```text
-v /srv/evolution/ces:/root/.smp/evolution-dev/default-workspace
```

这样组的默认工作区内容就是 CES 代码。

代码目录 chown 为 `root:root`，因为容器内会话以 root 运行，避免
git 报 `dubious ownership`。

## 3. 运行时镜像需要 git

原镜像只有构建阶段的 git，运行阶段没有。已在 Dockerfile 的 runtime
阶段安装：

```text
git ca-certificates
```

重建并推送镜像：

```text
digest: sha256:ab68867226b6d8f7a9847852fbdadb169c75fc3bb72769c244bf9c9707ae8b5d
```

B/C 都已切到该镜像。

## 4. Git 配置

仓库远端：

```text
origin http://43.128.69.189/CES.git
```

凭证文件：

```text
/srv/evolution/ces/.git/credentials
```

容器内路径：

```text
/root/.smp/evolution-dev/default-workspace/.git/credentials
```

git 配置：

```text
credential.helper=store --file=/root/.smp/evolution-dev/default-workspace/.git/credentials
user.name=CES Evolution
user.email=ces-evolution@example.com
```

凭证文件权限 600，不进入工作区，不会被提交。

## 5. 查看分支与状态

进入默认工作区后：

```bash
pwd
git branch --show-current
git status -sb
git remote -v
git log --oneline -1
```

当前 B/C 都是：

```text
main
## main...origin/main
8dfa947 Install git in the runtime image
```

## 6. 提交与推送

在默认对话中直接执行：

```bash
git status
git add <files>
git commit -m "your message"
git push origin HEAD:main
```

如果不想直接推 main，可以：

```bash
git switch -c feature/xxx
git push -u origin HEAD
```

## 7. 推送验证

验证远端分支：

```bash
git ls-remote origin refs/heads/main
git rev-parse HEAD
```

两边的 commit 应一致。

本次用临时分支 `verify/evolution-dev-1793605995` 做了实际验证：

```text
commit: 8f2f7b7 Verify evolution dev push
push: [new branch] verify/evolution-dev-1793605995
ls-remote: 8f2f7b7... refs/heads/verify/evolution-dev-1793605995
```

随后已删除临时远端分支和本地分支，主分支保持 clean。

## 8. 注意

- 凭证文件是明文 admin 密码，仅适合测试环境；正式环境应使用 OneDev access token。
- 默认工作区是容器内挂载点，代码实际在宿主机 `/srv/evolution/ces`。
- 如果容器重建，挂载参数必须保留，否则默认工作区会回到空目录。
- 如果组/数据库重建，默认工作区归属会重新创建，但挂载路径不变。
