# 安装页（smp-install）

状态：已在基座里。本文记录这个插件怎么做；和 `plugins/install` 不一致时以代码为准。

运行版本钉在 `dsh` `0.2.1-alpha.5`。插件写法以 `.agents/skills/dsh-plugin/` 为准。栏目划分仍以 `docs/design/remote-console/design.md` 为准。安装插件是 Smart Management Platform（SMP）基座的一部分。

## 1. 要解决的事

数据库地址和加密密钥写在 web profile 的 `cordis.patch.yml` 里，属 `smp-database` 这一行的 `config`。存储插件启动时就要读到这两项，壳又要等 `database` 服务出现才加载。新环境还没有这两项时，壳不会出现。

安装页在登录之前就能改数据库地址，并且不校验 `smp_session`。这个窗口只在第一次安装时打开。完成后关掉，避免有人把控制台指到另一套数据库。

关掉的依据是 profile 目录里的标记文件，不是补丁里的地址。地址被清空、补丁被换成空文件，标记还在，安装页仍然不出现。

## 2. 结论

| 事项 | 决定 |
| --- | --- |
| 放在哪 | 新插件 `@smp/console-install`，目录 `plugins/install`。不写进壳，也不写进存储插件 |
| 锁 | profile 目录下的 `install-complete`。文件可以是空的，里面不写地址和密钥 |
| 默认 | 新的 profile 目录没有这个文件，插件补丁也不写 `disabled`，所以会加载 |
| 已经能连上 | 不显示表单。写上标记，并在补丁里给 `smp-install` 写上 `disabled: true` |
| 需要填写 | 两项有缺，或库连不上，且没有标记文件。提交成功后才写地址、密钥、标记和 `disabled: true` |
| 以后 | 标记还在就不显示安装页。补丁被清空也一样 |
| 再开一次 | 删掉 `install-complete`，并删掉补丁里的 `disabled: true`，而且地址缺失或连不上，然后重启。只删标记时插件仍被禁用，安装页不会出现 |
| 新环境 | 整个 profile 目录换掉后没有标记，安装页会再出现 |
| 页面 | 宿主直接返回的独立 HTML，和登录页同一类。不登记 `console.page` |
| 密钥 | 填回原来的那一把。换一把能连上库，已有密文解不开 |
| 这一步不做 | 不把 Harness 设置或 `.credentials.yaml` 从库里恢复出来。不卸载这个包 |

## 3. 插件

包名 `@smp/console-install`，补丁 `id` 为 `smp-install`。有 locale 和图标。没有客户端包：安装页在宿主里拼好，壳的槽位当时还不存在。

`inject` 为 `['webServer', 'profileContext']`。不注入 `database`、`secrets` 或 `configEditor`。设置编辑器只能改已经在运行的插件；缺配置时存储插件处于失败状态，那条路走不通。

web profile 的 bundle 列表加上这个包。插件补丁只追加自己这一行，不带 `disabled`。

`install-complete` 放在 `profileContext.dir` 下，和 `cordis.patch.yml` 并列。加载器看到补丁里 `smp-install` 的 `disabled: true` 时不调用 `apply`。标记文件仍是权威：补丁里的禁用行丢了，只要标记还在，`apply` 也不登记安装路由。

存储插件的行为不变：两项缺了，它自己加载失败，不发布 `database`。壳的 `inject` 保持 `['connection', 'webServer', 'database']`。

## 4. 启动时怎么分支

`apply` 先看 `install-complete`。

标记已在：不替换索引门禁，不登记 `/install`。补丁里还没有 `smp-install` 的 `disabled: true` 时，只把它写进文件，不重载。当前这次 `apply` 已经不会登记路由；下一次启动由加载器跳过。不读、不改数据库地址。地址这时是空的，重载会让仍失败的存储插件被当成新的失败，还可能把标记删掉。

标记不在，且 `databaseUrl` 和 `encryptionKey` 都是非空字符串，并且用它们能连上库：不显示安装页。写上标记和 `disabled: true`，不重载。壳已经在这一轮加载，重载会把正在用的进程再停一次。下一次启动不再进入 `apply`。

标记不在，且两项有缺或连不上：显示安装页。密钥格式不对或库拒绝连接时，不写标记，也不写 `disabled: true`。这是这一次部署里唯一可以改正地址的窗口。

## 5. 页面和路由

需要人填写时登记：

页头显示网站默认名 Cyber Evolving System 和控制中枢图标，表单标题仍是「安装」。浏览器标签和图标用同一套默认值。

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| `GET`、`HEAD` | `/install` | 返回安装页。数据库分成地址、端口、数据库、用户名和密码，放在「数据库配置」里。加密密钥放在「加密配置」里，可以生成一把新的。底部「安装」一开始不能点 |
| `POST` | `/console-api/install/probe` | 只试连数据库，不写入。连上之后页面才允许点「安装」 |
| `POST` | `/console-api/install` | 校验并写入，成功后让存储插件加载，写上标记并禁用本插件 |

同时替换 `connection.authorizeIndex`：打开 `/` 时转到 `/install`。壳这时没有加载，索引门禁只有安装插件这一层。

安装页不要求 `smp_session`。进程仍只听 `127.0.0.1:9090`。

提交后的检查，在写入之前做完：

- 加密密钥能解码成 32 字节的 Fernet 密钥。解码规则和存储插件相同。
- 用这个地址连接 PostgreSQL，执行 `select 1`，等待上限 5 秒。

失败时留在安装页，说明是密钥格式不对还是数据库连不上。地址、密钥和连接串不写进日志，也不写进响应。

## 6. 写入和重新加载

人提交并且校验通过时，一次写入三处：

- `smp-database` 的 `config.databaseUrl` 和 `config.encryptionKey`。没有这一行就追加一行，只含 `id` 和 `config`。
- `smp-install` 的 `disabled: true`。这是布尔值，不是会再读地址的表达式。
- profile 目录下的 `install-complete`。

用 YAML 文档编辑补丁，保留其余行和已有的 `!!js`。`sessionSecret`、语言、主题、模型行不动。

人提交的这一条才重载。安装插件先把索引门禁恢复成自己替换之前的那个函数，再调用和设置编辑器相同的 `reconcileProfilePatches`。存储插件重新执行 `apply`，跑迁移，并发布 `database` 和 `secrets`。同一轮重载看到 `disabled: true`，安装插件卸下。不退出进程。只补标记、不改地址的两条路径不重载。

清理函数只有在自己仍握着索引门禁时才交还。成功路径在重载前已经交还，卸下时不再改门禁，避免盖掉壳刚装上的那一层。

重载若失败，把补丁恢复到写入之前，并删掉刚写的 `install-complete`。索引门禁仍回到安装页，响应说明存储插件没有加载起来。

地址本来就能连上、只是补锁的那一条路径不改地址，也不重载。标记留下，下一次启动不再进入 `apply`。

## 7. 和壳的交接

浏览器在收到成功响应后打开 `/`。没有 `smp_session` 时，壳把浏览器送到 `/login`。登录用的仍是库里的账号。会话、工作区、站点标题和菜单由已经在库里的表读出。

这一轮卸下之后，再打开 `/install` 不再是安装表单。下一次启动有标记，也有 `disabled: true`。

标记还在、地址却空了或错了：壳不加载，安装页也不出现。

## 8. 不做什么

- 不改存储插件的配置形状，也不在存储插件里画页面。
- 不因为地址变空、变错或整份补丁被清空而重新打开安装页。
- 不清空数据库，不改 `sessionSecret`，不删 `.credentials.yaml` 和 `workspace.json`。
- 不把模型配置、Harness 设置从数据库写回文件。
- 不把标记写进补丁，也不在标记里放地址或密钥。
- 不卸载包。包留在 bundle 列表里。

## 9. 测试

测试环境可以清掉本地的数据库配置。库里的行保留。填回的地址和密钥与清空前相同。开始测试前，profile 目录里没有 `install-complete`，补丁里也没有 `smp-install` 的 `disabled: true`。

1. 两项都空、且没有标记时启动。打开 `/` 进入安装页。登录页和壳的侧栏不出现。
2. 提交错误密钥，以及一个连不上的地址。仍停在安装页。补丁里没有这两项，目录里也没有 `install-complete`。
3. 提交原来的地址和同一把密钥。浏览器进入登录页。用现有账号登录后，壳出现，默认工作区和已有会话还在。库里的工作区行和会话行仍是提交前的内容。`install-complete` 存在，`smp-install` 为 `disabled: true`。再打开 `/install` 不是安装表单。
4. 停掉进程。删掉 `databaseUrl` 和 `encryptionKey`，保留标记和 `disabled: true`。再启动。打开 `/` 和 `/install` 都不是安装页，壳也不出现。
5. 停掉进程。删掉数据库地址、加密密钥和 `smp-install` 的 `disabled: true`，其余补丁行保留，`install-complete` 也保留。再启动。仍然不是安装页。
6. 把原来的地址和密钥写回补丁，保留标记，再启动。进入登录或壳，不出现安装页。
7. 停掉进程。只删 `install-complete`，保留 `disabled: true` 和地址。再启动。安装页不出现。标记不会重写，因为加载器没有调用 `apply`。
8. 停掉进程。删掉标记和 `disabled: true`，并删掉地址和密钥。再启动。安装页再次出现。

## 10. 实现时同步的文档

`docs/spec/plugins.md` 和 `docs/design/remote-console/design.md` 的插件表加上这一行：安装插件没有栏目页。新的 profile 里它启动一次，把数据库地址和加密密钥写进存储插件的配置，并在 profile 目录写下 `install-complete`。标记还在时，安装页不再出现。
