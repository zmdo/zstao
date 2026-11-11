# 验证记录

日期：2026-11-11。验证对象：本分支的应用服务器插件与 `project-delivery` Skill。未发布 CES 线上版本，未修改线上容器或真实 DNS。

## 自动检查

```sh
npm run test --workspace=@smp/console-application-server
npm run typecheck --workspace=@smp/console-application-server
npm run build --workspace=@smp/console-application-server
npm pack --dry-run --workspace=@smp/console-application-server
python3 -m unittest discover -s skills/project-delivery/tests -v
git diff --check
```

应用服务器 5 个 Node 测试通过（其中新增配方测试调用 8 个 Python 场景，包含默认端口冲突）；原有 TCR 凭据测试保留并通过。部署运行时 4 个测试通过，包含后台任务、重复请求/冲突、失败保持和显式回滚。类型检查及全工作区构建通过，打包清单包含新配方 `scripts/openresty.sh`。

另外使用实际服务器管理的 `prepareOwner/snapshotBundle/DefinitionResolver` 加载两个插件，解析出的应用服务器必要软件为 Docker Engine、Docker Compose、OpenResty，OpenResty 的前置依赖为 Docker Engine，所有脚本加载成功。

## 真实 Docker 检查

环境：本机 Colima Linux Docker daemon，ARM64；使用官方固定 digest 的 OpenResty 镜像。测试运行器提供 Python 和 Docker CLI，挂载本机测试 Docker socket，运行完整 shell JSON 配方。测试副本替换网关容器名、数据目录及两个默认监听端口为随机空闲端口，以隔离本机已有服务；站点和容器在结束后清理。线上将以真实 80/443 验收。

可复现命令（需 Linux Docker daemon；会启动临时测试容器并使用随机监听端口）：

```sh
sh plugins/application-server/test/docker-smoke.sh
```

验证结果：

| 场景 | 结果 |
| --- | --- |
| detect → list-candidates → resolve → execute → verify | 安装成功，核对真实镜像、版本、挂载及配置测试 |
| 默认网关启动 | 默认 HTTP/TLS 监听，HTTP 健康检查通过，未绑定域名的 TLS 握手被拒绝 |
| 相同安装请求重试 | 不重新拉取/创建，不改变容器 ID |
| 已缓存相同 digest 的镜像 | 复用精确本地镜像，重建不要求镜像仓库在线 |
| IP/端口入口 | 实际请求返回测试应用 JSON 和本次发布标记 |
| 两个域名共用一个监听端口 | 按 Host 返回各自发布标记，Host 正确传给上游 |
| 未知域名 | HTTP 返回默认 404，TLS 拒绝握手，不落入已有域名站点 |
| 配置语法错误 | `-t` 拒绝，旧站点继续服务，恢复旧文件后可正常 reload |
| 上游不可达 | 实际入口返回 502，恢复旧配置后恢复 200 |
| 网关容器删除后重建 | 已有配置完整保留，域名入口恢复正常 |

此测试没有创建公网 DNS、签发证书或模拟完整 AI 会话，不能据此声称真实域名/HTTPS 已上线。线上需发布插件、导入更新后的完整 Skill，再为目标服务器补齐必要软件并按实际域名验收。

一次早期复跑在重建阶段失败，当时断言未保留配方错误码，无法确定原因；补充错误输出后的复跑通过。随后增加精确 digest 缓存复用，去掉已有镜像重建时的外部拉取依赖，并重新验证。该记录不将未定位的早期失败归因于某个已证实原因。
