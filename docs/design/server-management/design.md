# 服务器管理（server-management）

状态：已在基座里。本文记录这个插件怎么做；和 `plugins/server-management` 不一致时以代码为准。和 `docs/design/remote-console/design.md` 冲突时，以本文为准。

本文保留早期基础能力的设计说明。当前 `ces/develop` 的改造进度、数据库结构问题及后续顺序见 [database-redesign.md](database-redesign.md#6-当前改造进度与下一步)，新的字段与插件契约见 [data-model.md](data-model.md)；新增需求不因本文的「已在基座里」状态而视为已经实现。

运行版本钉在 `dsh` `0.2.1-alpha.5`。插件写法以 `.agents/skills/dsh-plugin/` 为准。

## 1. 要解决的事

`smp` 里的服务器管理现在拆在三处。浏览器页面在栏目插件里，宿主是空的。登记、分组、密钥和任务查询在网站后台。SSH、巡检、采指标和终端在另一个运维进程里。网站后台往 `ops_jobs` 插一行，运维进程把它领走。

控制台是遥控器。这些动作放进本进程的一个插件。页面点按钮只写入任务行并返回。远端机器上的容器仍由那台机器的 Docker 管理。

## 2. 结论

| 事项 | 决定 |
| --- | --- |
| 插件 | `@smp/console-server-management`，目录 `plugins/server-management`，补丁 `id` 为 `smp-server-management` |
| 中文标题 | 服务器管理 |
| 英文标题 | `server-management` |
| 侧栏 | 一组，组名「服务器管理」。两个页签：「服务器」、「密钥」 |
| 页内 | 「服务器」里切换列表、登记、详情、终端。这四屏不各占一个侧栏入口 |
| 数据 | 直接读写已有的 `servers`、`server_groups`、`ssh_keys`、`server_containers`、`ops_jobs` |
| 密文 | 私钥和口令经 `secrets` 入库。列表不返回原文 |
| 动作 | 只执行已经实现的 `test_connection`、`install_components`、`inspect` |
| 入队 | 已登记服务器上的按钮只插入 `ops_jobs` 并返回。同一台服务器同时只有一个 `running` |
| 登记前测试 | `POST /console-api/servers/test-connection` 当场试连，不写任务行。当时还没有服务器行 |
| 巡检 | 对可达服务器每 30 秒插入一条 `inspect`。间隔可配置 |
| 采指标 | 单独的 effect，默认每 1 秒采样 CPU、内存和磁盘，写回 `servers`，不进任务表 |
| 终端 | `registerUpgrade` 只接受精确路径。路径是 `/console-api/servers/terminal`，编号在查询参数 `id` |
| 重启 | 启动时把仍为 `running` 的任务标为失败，摘录写明进程已重启。不接回上一次的 SSH |
| 旧控制台 | `8080` 上的网站、接口和运维进程已关闭。任务循环、巡检和采指标由本插件执行 |
| 这一步不做 | 不实现 `deploy`、`start`、`stop`、`restart`、`logs`。不接交易所。不登记 `/mcp` |

## 3. 插件

包名 `@smp/console-server-management`。有 locale、图标和客户端。

`locale/zh.json` 的 `meta.title` 是「服务器管理」。说明写成完整句子：登记服务器和密钥，并执行连接测试、巡检、采指标和终端。`locale/en.json` 的 `meta.title` 是 `server-management`，说明同样是完整句子。

宿主 `inject` 为 `['webServer', 'database', 'secrets', 'consoleSession']`。客户端 `inject` 为 `['slots', 'locale']`。

补丁只追加自己这一行：

```yaml
- insert:
    - id: smp-server-management
      name: '@smp/console-server-management'
```

配置经过校验，缺了必填项就加载失败：

| 配置 | 含义 |
| --- | --- |
| `componentsDir` | 组件目录。里面是现有的 `component.json`、`detect.sh`、`install.sh`。目录不存在时加载失败。脚本不放进插件目录 |
| `inspectIntervalSeconds` | 巡检间隔，默认 30 |
| `metricsIntervalSeconds` | 采指标间隔，默认 1 |
| `sshReadyTimeoutSeconds` | 从建立连接到认证成功的总等待上限，默认 30 秒；整数，范围 1～300 秒。登记测试、系统识别、后台任务、指标采集和终端共用 |

web profile 的 bundle 列表加上这个包。

## 4. 页面

客户端只登记 `console.page`。组是 `server-management`，组标题「服务器管理」，放在侧栏主体里，不放底部。

| 页签 | `key` | 顺序 | 里面有什么 |
| --- | --- | --- | --- |
| 服务器 | `servers` | 0 | 列表、登记、详情、终端 |
| 密钥 | `ssh-keys` | 1 | 密钥列表和添加 |

组图标用最早的那一页，也就是「服务器」。

服务器页采用和 Harness 设置相同的左右布局。左侧是分组侧栏，包含「全部服务器」、已建分组和「未分组」，显示每组的服务器数量；「新建分组」、创建表单和删除分组都放在侧栏。右侧列表标题是「服务器实例」，只显示选中分组的服务器；选中「全部服务器」时显示全部。删掉分组时，组里的服务器回到未分组，分组名「未分组」不能被创建。

服务器实例模块填满页面剩余高度，不随行数增长。表格内部滚动，表头和底部分页栏保持可见。先按分组和搜索条件筛选，再分页，默认每页 10 台，可选 20 或 50 台。切换分组、搜索和调整每页数量时回到第一页；返回列表时保留筛选条件和页码。列表每秒重新拉取，好让采指标的数字动起来，刷新不重置当前页；当前页超出结果范围时回退到最后一页。

表头右上角保留搜索和登记服务器。可以搜索名称、地址、用户、区域和分组名。当前实现的列表字段较多；后续精简字段、统一状态，以及「是否安装必要软件」的展示目标见 [server-instances-list.md](server-instances-list.md)。选中具体分组后登记服务器，表单默认使用该分组。

登记和编辑按 [认证测试与系统识别流程](registration-identification.md) 展示两个信息框：「服务器认证信息」包含地址、端口、用户和认证，底部可测试连接；通过后启用「服务器系统信息」框底部的绿色「识别系统信息」。系统识别只读取并填充操作系统、版本、架构与当前类型必要软件的实际版本。名称、分组、区域放在框外，类型在系统框内按系统筛选。地址可填写内网／公网 IP 或可解析域名，地址与端口同排、用户独占一行。选中已有密钥时隐藏新密钥输入，保存只使用所选密钥；测试和识别也支持已有密钥。系统仍可手动填写并先保存，未验证信息不能授权软件变更。区域留空时保留现有自动查询行为。

详情显示主机指纹、组件状态和容器清单。按钮是「测试连接」、「立即刷新」、「编辑」、「删除」，缺组件时还有「安装必要组件」。删除只去掉登记，不关闭那台机器上已经在跑的容器。还没测试过时，容器区写「尚未测试连接」。在线但还没有成功巡检时，写明在线后每 30 秒自动刷新。

终端开在详情进来的这一屏里。浏览器把按键和窗口大小交给升级连接，把主机输出画出来。调整大小的消息是 JSON，`type` 为 `resize`，列数限制在 20 到 300，行数限制在 5 到 120。

密钥页标题是「服务器密钥」。列出名称、指纹、引用它的服务器数量和创建时间。可以搜索名称和指纹。添加时填写名称并粘贴 PEM。正在被服务器引用的密钥不能删。

样式挂在壳的 `.smp-console` 上，沿用 `panel`、`panel-head`、`mark`。

栏目、页签和现有页面响应平台中英语言切换，其他语言回退英文；文案统一放在插件 `locale/{zh,en}.json`，日期显式按平台语言格式化。切换语言保留当前分组、搜索、分页和未提交表单，已显示的结构化错误及提示同步翻译。用户登记的数据、远端命令输出和任务摘录保留原文。后续类型、系统分组和升级管理见 [group-types-and-i18n.md](group-types-and-i18n.md)。

## 5. 路由

浏览器路径把原来的 `/api` 换成 `/console-api`。应答形状保持现在的网站后台。集合和 `test-connection` 用精确路径。带编号的路径用前缀 `/console-api/servers`、`/console-api/server-groups`、`/console-api/ssh-keys`、`/console-api/ops-jobs`，由插件自己拆。登记时不带结尾斜杠。精确路径先匹配，所以 `test-connection` 不会被服务器前缀吞掉。登记接口没有 `:id` 模板。

除登录外，这些路由都先调用 `consoleSession.read`。没有会话时返回 401。插件不自己解析 cookie。

接口错误返回稳定 `code` 和必要 `params`，页面按当前语言翻译；兼容字段 `detail` 保留默认中文说明，不用其文本判断错误类型。登记前连接测试返回 `ok: false` 时也携带同样的错误字段。

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| `GET` | `/console-api/servers` | 服务器列表。不含私钥和口令 |
| `POST` | `/console-api/servers/test-connection` | 当场试连尚未保存的登录信息。不写 `ops_jobs` |
| `POST` | `/console-api/servers` | 登记一台服务器 |
| `GET` | `/console-api/servers/{id}` | 详情，带最近一次巡检看到的容器 |
| `PATCH` | `/console-api/servers/{id}` | 修改登记。连接信息或所选组件变了，并且开着自动安装时，再插入一条 `test_connection` |
| `DELETE` | `/console-api/servers/{id}` | 删除登记 |
| `POST` | `/console-api/servers/{id}/test` | 插入 `test_connection` |
| `POST` | `/console-api/servers/{id}/inspect` | 插入 `inspect` |
| `POST` | `/console-api/servers/{id}/install-components` | 插入 `install_components` |
| `GET` | `/console-api/servers/{id}/containers` | 当前容器清单 |
| `GET` | `/console-api/server-groups` | 分组 |
| `POST` | `/console-api/server-groups` | 新建分组。重名返回 409 |
| `DELETE` | `/console-api/server-groups/{id}` | 删除分组，服务器留在未分组 |
| `GET` | `/console-api/ssh-keys` | 密钥列表。只有名称、指纹、引用数和创建时间 |
| `POST` | `/console-api/ssh-keys` | 保存一把私钥，返回指纹 |
| `DELETE` | `/console-api/ssh-keys/{id}` | 没有服务器引用时才删除 |
| `GET` | `/console-api/components` | 读组件目录，返回编号、名称、摘要和依赖 |
| `GET` | `/console-api/ops-jobs/{id}` | 一条任务的状态和摘录 |
| 升级 | `/console-api/servers/terminal?id={id}` | 终端。套接字关闭或插件卸载时断开 SSH |

同一台服务器、同一种动作已经有 `queued` 或 `running` 时，再点一次返回那一行，不另插。

编号不是 UUID，或行不存在，返回 404。

## 6. 任务

三个动作的行为和现在的运维进程相同：

| 动作 | 行为 |
| --- | --- |
| `test_connection` | SSH 登录。开了自动安装时，按登记的组件安装。成功后钉住主机密钥指纹，并接着排一次巡检 |
| `install_components` | SSH 登录，安装组件目录里的全部组件 |
| `inspect` | SSH 读取容器清单，用这次结果覆盖该服务器的 `server_containers` |

其它 `action` 一旦被领到，标为失败，摘录写明这种任务还没有实现。

领任务时跳过已经有 `running` 任务的服务器。不同服务器可以同时执行。SSH 调用放在 effect 里，不另起进程。

`apply` 一开始先把状态仍是 `running` 的行改成 `failed`，`finished_at` 写上现在，摘录写明进程已重启。`queued` 留着，启动后可以继续领。

巡检 effect 只看 `reachability` 为 `online`、并且距 `last_checked_at` 已超过间隔的服务器。这台服务器已经有排队或执行中的 `inspect` 时不再插入。

采指标对每台已登记服务器保持一条 SSH，按间隔采样 CPU、内存和根分区磁盘。连接断开后隔几秒再连，不把可达状态改成离线。离线只由登录失败和巡检失败写入。

清理函数返回前要等已经开始的 SSH 和终端断开。

私钥和口令解不开时，这次任务失败，该服务器记为离线。密文是用原来运维进程那把 Fernet 密钥加密的。本进程 `secrets` 必须是同一把，否则已有登录信息解不开，也不会自动重加密。

主机指纹已经钉住、而对端指纹变了，任务失败，不改写指纹。

## 7. 表

这五张表已经在本进程使用的库里。迁移放在 `plugins/database/migrations/`，用「没有才建」，不重复授权 `web_api` 和 `ops`。已有行保留。

| 表 | 插件怎么用 |
| --- | --- |
| `servers` | 登记、可达状态、主机指纹、组件选择、CPU、内存、磁盘 |
| `server_groups` | 分组。删分组时 `group_id` 置空 |
| `ssh_keys` | 名称、指纹、私钥密文。指纹唯一 |
| `server_containers` | 一次巡检的容器清单。下次成功巡检整机覆盖 |
| `ops_jobs` | 一次动作的状态。页面轮询这一行 |

`ops_jobs.action` 上现有的检查仍允许 `deploy`、`start`、`stop`、`restart`、`logs`。插件不提供入口，领到了就标失败。

## 8. 测试

用 `node:test`。不连真实 SSH。

- 同一种动作已在排队或执行时，再次入队返回原行。
- 一台服务器已有 `running` 时，不再领它的下一条。
- 启动时把 `running` 标为失败，`queued` 不动。
- 组件目录缺失时配置不通过。
- 密钥仍被引用时拒绝删除。
- 列表和详情的 JSON 里没有私钥和口令。
