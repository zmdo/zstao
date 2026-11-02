# 会话远程命令（session-shell）

状态：待实现。本文记录会话如何看见服务器，以及如何在可操作的服务器上自行执行命令。和 `plugins/server-management` 不一致时，实现前以本文为准，实现后以代码为准。页面、登记、巡检、采指标和浏览器终端仍以 [design.md](design.md) 为准。创建分组、移动服务器和修改名称见 [session-catalog.md](session-catalog.md)。

运行版本钉在 `dsh` `0.2.1-alpha.5`。插件写法以 `.agents/skills/dsh-plugin/` 为准。

## 1. 要解决的事

服务器管理里已经有登记、密钥和 SSH。Harness 会话看不到这些行，也登录不了这些机器。

要在「服务器」页上分开两项权限。可视的机器出现在会话能读到的列表里。可操作的机器才允许会话连接 shell，由模型自己编写命令。dsh 用这台机器已经保存的登录方式连上去。模型不提交登录口令，也拿不到控制台里保存的私钥和口令。

列表里写明这个登录用户有没有 root 或 sudo。命令在远端的 shell 里运行，不限制命令内容。命令打印出来的文字，包括它读到的密钥，会进入这条会话，并在以后的请求里再次发给模型。

## 2. 结论

| 事项 | 决定 |
| --- | --- |
| 插件 | 仍是 `@smp/console-server-management`。不另建插件 |
| 宿主 | `inject` 加上 `tools`。工具用 `ctx.tools.register` 登记 |
| 权限 | `servers.session_access`：`none`、`visible`、`operate`。默认 `none` |
| 可视 | `visible` 和 `operate` 都出现在 `server_list`。只有 `visible` 时不能执行命令 |
| 可操作 | `operate` 才能调用 `server_shell`。可操作包含可视 |
| 登录权限 | `servers.login_privilege`：`root`、`sudo`、`sudo_password`、`none`、`unknown`。默认 `unknown`。列表把这一项交给模型 |
| 工具 | `server_list` 列出可视的服务器。`server_shell` 在可操作的那一台执行模型写的命令 |
| 登录 | 每次调用单独 SSH，跑完断开。用该行已有的私钥或口令，解密只在进程内 |
| 命令 | 远端执行 `bash -s`，命令正文从标准输入送入。不拼进 SSH 命令行 |
| 工作目录 | 每次都是一次新的 shell。上一条命令的目录和变量不保留 |
| 密钥 | 工具的说明、参数和结果里不放私钥、口令或密文。命令自己打印出来的内容原样返回 |
| 已有会话 | 改成不可视不改这条会话的日志，也不改压缩摘要。新的调用直接拒绝 |
| 任务表 | 不往 `ops_jobs` 插行。不占用「同一台服务器同时只有一个 running」 |
| 浏览器终端 | 仍走 `/console-api/servers/terminal`，仍要 `smp_session`。模型和这条连接无关 |
| 这一步不做 | 不登记 `/mcp`。不用 `dsh-ssh` 把整个会话搬到远端。不做命令白名单、输出过滤、第二个系统用户。不擦除已经写进会话的文字。不把超长输出写进工作区 |

## 3. 页面

两项都放在现有的「服务器」页，不新增侧栏入口。

登记和编辑里是「可视」和「可操作」。勾上可操作时，可视同时打开。取消可视时，可操作一起取消。只取消可操作时，机器仍可视。列表上写出当前是未开放、可视还是可操作。

详情里：

| 状态 | 文字 |
| --- | --- |
| `none` | 未对会话开放 |
| `visible` | 可视 |
| `operate` 且已有主机指纹 | 可操作 |
| `operate` 但还没有主机指纹 | 可操作，尚未测试连接，会话暂时不能登录 |

同一页写出登录权限：root、免密 sudo、sudo 需要口令、无 sudo，或尚未探测。

保存只写 `session_access`。打开可操作不代替连接测试，也不主动去登录。

`GET` 和 `PATCH /console-api/servers` 的应答里带上 `session_access` 和 `login_privilege`。应答里仍然没有私钥和口令。

## 4. 工具

两个工具在插件加载时登记，所有会话都能看见工具本身。一台机器出不出现、命令跑不跑，在每次调用时读 `session_access`。

工具说明里写明 `loginPrivilege` 的五个值：`root` 是登录用户就是 root；`sudo` 是可以免密 sudo；`sudo_password` 是有 sudo 但需要口令，会话不能交互输入口令；`none` 不是 root 也不能 sudo；`unknown` 是还没有探测过。

`server_list` 没有参数。返回 `visible` 和 `operate` 的行，按名称排序。每行包含：

| 字段 | 内容 |
| --- | --- |
| `id` | 服务器编号 |
| `name` | 名称 |
| `address` | 登记的 `host`；可以是内网 IP、公网 IP 或可解析的域名 |
| `sshPort` | 端口 |
| `sshUser` | 登录用户 |
| `access` | `visible` 或 `operate` |
| `loginPrivilege` | 上一节的五个值之一 |
| `groupId` | 分组编号。未分组时为空 |
| `groupName` | 分组名。未分组时为空 |
| `reachability` | 可达状态 |
| `region` | 区域，空则省略 |
| `dockerVersion` | 有则带上 |
| `containers` | 最近一次巡检的容器：名称、镜像、状态。没有巡检过就是空数组 |

没有可视服务器时返回空数组。

`server_shell` 的参数：

| 参数 | 约束 |
| --- | --- |
| `server` | 必填。`server_list` 给出的编号 |
| `command` | 必填。模型要执行的 shell 命令，非空 |
| `timeoutMs` | 可选。默认 30000，最大 120000 |

结果是退出码、标准输出和标准错误。退出码不是 0 时，这次工具调用仍然成功，由模型自己看退出码。标准输出或标准错误超过 32768 个 Unicode 码点时，保留开头 24576 个和末尾 8192 个，并标明被截断。截掉的部分不另存文件。

调用在这些情况下失败，失败文字里不带私钥和口令：

| 情况 | 结果 |
| --- | --- |
| 编号不存在，或 `session_access` 不是 `operate` | 拒绝。不连接。只可视时说明这台服务器不能执行命令 |
| 还没有主机指纹 | 拒绝。不连接 |
| 这台服务器上已有 4 条会话命令在跑 | 拒绝 |
| 主机指纹和钉住的不一致 | 失败，不改写指纹 |
| 解密或登录失败 | 失败 |
| 超过 `timeoutMs` | 关掉这次 SSH，命令记为超时 |

`execute` 观察取消信号。会话取消时关掉这次 SSH，不等远端命令自己结束。

## 5. 登录

连接复用服务器管理已有的 SSH 客户端。主机指纹已经钉住才允许模型连上来，规则和 `test_connection` 相同：对端指纹变了就失败，不接受新指纹。

私钥和口令只在建立连接时解密。工具结果、错误文字和日志摘录都不写入这两份原文。

模型写的命令作为 `bash -s` 的标准输入。dsh 不检查命令内容，也不改写命令。

一条命令从连接到断开都在这次工具调用里完成。不保留 shell，不和浏览器终端共用通道，也不和采指标那条连接共用通道。

取消可操作时，已经开始的那一条跑到结束或超时。之后的 `server_shell` 拒绝这台机器。取消可视后，`server_list` 也不再返回它。

## 6. 登录用户的 root 和 sudo

探测由插件在 `test_connection` 成功和 `inspect` 成功之后做，不由模型发起。先执行 `id -u`。结果是 `0` 时记为 `root`，不再试 sudo。否则执行 `sudo -n true`：

| 结果 | `login_privilege` |
| --- | --- |
| 退出码 0 | `sudo` |
| 标准错误表明 sudo 需要口令 | `sudo_password` |
| 不在 sudoers 里，或没有 sudo | `none` |

探测失败时，这次连接测试或巡检仍然按原来的结果算成功，`login_privilege` 记为 `unknown`。探测的原始输出不交给模型，也不写进任务摘录。模型只在 `server_list` 里看到枚举值。

还没有成功探测过的机器保持 `unknown`。

## 7. 会话里已经出现过的内容

改成不可视只停止新的列出和登录。这条会话的日志仍会在下次请求里发给模型，压缩摘要里已经写进的名称、地址和命令输出也还在。

模型要不再看到一台机器，需要同时满足两件事：`session_access` 是 `none`，并且使用一条从未接收过这台机器的新会话。本文不改会话日志，也不改压缩。

控制台保存的私钥和口令不进入上述文字。命令在机器上读到并打印出来的密钥会进入，这是自行执行命令的结果。

## 8. 表

当前无服务器数据、无发布部署，允许破坏兼容性，后续纳入 [数据库重构设计](database-redesign.md)。以下 SQL 仅表达权限枚举与默认值，不要求迁移旧记录；最终字段归属应区分登记权限配置和实际登录权限探测结果。

```sql
alter table servers add column if not exists session_access varchar(16) not null default 'none';
alter table servers add column if not exists login_privilege varchar(16) not null default 'unknown';
alter table servers drop constraint if exists ck_servers_session_access;
alter table servers add constraint ck_servers_session_access
  check (session_access in ('none', 'visible', 'operate'));
alter table servers drop constraint if exists ck_servers_login_privilege;
alter table servers add constraint ck_servers_login_privilege
  check (login_privilege in ('root', 'sudo', 'sudo_password', 'none', 'unknown'));
```

## 9. 测试

用 `node:test`。不连真实 SSH。

- 列表含 `visible` 和 `operate`，不含 `none`。每行带 `access` 和 `loginPrivilege`。JSON 里没有私钥、口令和密文。
- `none`、`visible` 或编号不存在时，`server_shell` 在连接前拒绝。`visible` 的拒绝文字说明不能执行命令。
- 没有主机指纹时拒绝。
- 指纹不符时拒绝，并且不把新指纹写回。
- `id -u` 为 0 时记为 `root`，且不再执行 sudo。
- `sudo -n true` 成功时记为 `sudo`。标准错误表明需要口令时记为 `sudo_password`。不能 sudo 时记为 `none`。
- 探测失败不把连接测试或巡检改成失败，权限记为 `unknown`。探测输出不出现在任务摘录里。
- 命令的标准输出、标准错误和退出码按远端结果返回。退出码不是 0 时工具调用仍成功。
- 超长输出被截断，截掉的部分不写文件。
- 超时后连接被关掉。
- 同一台服务器已有 4 条命令在跑时，第 5 条拒绝。
- 现有服务器接口的 JSON 仍不带私钥和口令，并带上 `session_access` 和 `login_privilege`。
- 把权限改成 `operate` 时，保存结果是 `operate`。从 `operate` 改成不可视时，保存结果是 `none`，不会留下可操作。
