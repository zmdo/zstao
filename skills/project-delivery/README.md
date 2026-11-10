# Harness 项目交付 Skill

`SKILL.md` 是会话执行说明，`templates/` 是首次接入项目时的参考文件。将整个 `project-delivery` 目录打包后，通过 CES 的 Harness 技能目录导入并启用。

部署脚本需要目标 Linux 服务器具备 Python 3.9+、Docker/Compose 和专用 TCR 拉取配置。以可读取配置并运行 Docker 的账户执行，通常通过平台 SSH 工具调用 `sudo -n sh deploy/runtime.sh`。

```sh
sh deploy/runtime.sh start --root /srv/apps/demo --release release-001 \
  --request request.json --snapshot /srv/apps/demo/incoming/commit-sha
sh deploy/runtime.sh status --root /srv/apps/demo --release release-001
sh deploy/runtime.sh logs --root /srv/apps/demo --release release-001 --offset 0
sh deploy/runtime.sh rollback --root /srv/apps/demo --release rollback-002 --from-release release-001
```

`start` 在拉取、Compose 更新或健康检查完成前返回；必须查询状态。`succeeded`、`failed` 是终态，`needs_verification` 需要核对服务器现状。拉取失败不会更新应用；更新后的验收失败不会自动回滚，按项目已授权的策略显式执行回滚。

同一应用只能有一个后台部署；同一发布 ID 的重复请求不会重新执行。每个发布保存请求、配置与脚本快照、上一成功发布、状态和日志。`current.json` 只在成功验收后更新。

Compose 使用 `CES_IMAGE` 和 `APP_ENV_FILE`，由运行时从已验证的请求和配置注入。首版不支持固定 `container_name`，以 Compose 项目名隔离应用。附属服务的镜像应提前准备，运行时使用 `--no-build --pull never` 启动 Compose，不在应用服务器构建镜像。数据库与外部配置的恢复由项目单独定义。

运行部署契约测试：

```sh
python3 -m unittest discover -s skills/project-delivery/tests -v
```
