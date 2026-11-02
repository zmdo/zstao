# 遥控器控制台（remote-console）

本仓库是 Smart Management Platform（SMP）的基座。本文描述基座上的控制台：页面和登记都在 `dsh` 插件里，外面只留数据库、协议客户端和第三方 API。

状态：待评审。本文描述插件和构建方式，不贴实现。基座里已经有的插件以仓库代码为准。

运行版本钉在 `dsh` `0.2.1-alpha.5`。插件写法以 `.agents/skills/dsh-plugin/` 为准。

## 1. 背景

策略控制台现在拆成四段：浏览器里的栏目插件、Python 网站后台、Python 运维服务、PostgreSQL。页面点一个按钮，网站后台往 `ops_jobs` 插一行，运维服务再把这行领走，通过 SSH、加密库或交易所接口把结果写回同一张库。两边用内部令牌互相认证，数据库还拆了 `web_api` 和 `ops` 两个账号。

这样拆，是为了让网站进程崩溃时不要带走正在执行的 SSH。控制台本身不跑策略。策略容器在登记过的服务器上，由那台机器上的 Docker 按重启策略继续跑。控制台崩溃只影响这一次点击和这一页的显示。

因此控制台不需要自己的后台进程，也不需要和第二套进程做隔离。它是遥控器：页面、登记、原来运维服务里的动作，都放进同一个 `dsh` 进程的插件。外面只留数据库、插件进程里用到的协议客户端，以及第三方 API。

`smp` 里 `docs/design/dsh-smp-plugin-inventory/` 描述的是上一步：页面已经嵌进 `dsh`，接口仍转到网站后台。那一步到此为止。本文替换「把网站后台改写成 TypeScript、继续调用运维服务」的打算。

## 2. 目标

- 浏览器打开的是 `dsh web`，本进程默认听 `9090`，地址是 `http://127.0.0.1:9090/`。原来 `8080` 上的网站、接口和运维进程已关闭。栏目划分保持现在的壳、仪表盘、数字货币、资金账户、服务器管理、平台设置。
- 每个栏目插件带上自己的宿主端。宿主端直接读写现有 PostgreSQL，并在需要时调用交易所 API 或 SSH。
- 原来运维服务做的事改由服务器管理插件承担：连接测试、安装组件、巡检、采指标、终端。
- `dsh` 崩溃后重启即可。数据库里的登记还在，远端容器还在。重启前没做完的 SSH 记为失败，由人再点一次。

## 3. 非目标

- 不把交易所、模型、Docker 引擎写进这个仓库。模型仍由 `dsh` 自己的接口去调。交易所通过它们的 HTTP API 调用。
- 不新增消息队列、缓存或第二套任务进程。`ops_jobs` 只作为一次动作的状态记录，供页面查看。
- 不改现有表的含义，也不在本文里重做登记模型。
- 不实现运维服务里尚未实现的策略动作（`deploy`、`start`、`stop`、`restart`、`logs`）。交易策略页保持现在的空面板。
- 不把控制台插件发布到插件市场。
- 不做多用户和公开访问。登录仍是库里的那一个账户。

## 4. 已定决策

| 事项 | 决定 |
| --- | --- |
| 进程 | 只有 `dsh`。网站后台、运维服务、单独的迁移容器都不再运行 |
| 数据 | 插件通过 Cordis 服务拿到同一个连接池，直接读写 PostgreSQL |
| 密钥 | 加密密钥放在存储插件的配置里。SSH 私钥、交易所凭证、钱包助记词、卡号只以密文入库 |
| 运维动作 | 服务器管理插件在自己的 effect 里执行。HTTP 请求只写入任务行并返回，不等待 SSH 结束 |
| 第三方 API | 行情和余额由数字货币插件调用交易所 API。Harness 的模型调用仍走 `dsh` |
| 协议客户端 | SSH、密文、助记词派生是插件依赖的库，在 `dsh` 进程内调用，不另起服务 |
| 接口 | 浏览器走插件登记的 `/console-api`、`/login`、`/mcp`。`/api` 仍属于 `dsh` |
| 登录 | 壳插件签发 `smp_session`。没有会话时打开 `/login` |
| 端口 | 本进程默认 `9090`。原来的 `8080` 控制台已关闭 |
| 崩溃 | 重启 `dsh`。启动时把上次留下的 `running` 任务标为失败 |

## 5. 组成

```mermaid
flowchart LR
  subgraph dsh [dsh 进程]
    Shell[壳]
    Columns[栏目插件]
    Store[存储插件]
    Shell --> Store
    Columns --> Store
  end

  DB[(PostgreSQL)]
  EX[交易所 API]
  Hosts[登记过的服务器]

  Store --> DB
  Columns --> EX
  Columns -->|SSH| Hosts
```

插件只通过三类东西碰到进程外面：

| 种类 | 这一版用什么 | 谁去连 |
| --- | --- | --- |
| 数据库 | 现有 PostgreSQL | 存储插件持有连接池，栏目插件注入后自己写 SQL |
| 协议客户端 | SSH 库、密文库、助记词派生 | 用到它的那个栏目插件，调用发生在 effect 里 |
| 第三方 API | 交易所的 HTTP API；模型由 `dsh` 调 | 数字货币插件；Harness 不经过控制台插件 |

存储插件不提供 HTTP，也不是原来的网站后台。它存在，是因为连接池和加密密钥必须有一个所有者：栏目插件卸载时先停掉自己的请求、定时器和 SSH，然后再关池子。

## 6. 插件

包都放在本仓库，每个插件一个目录，不放进 Harness 的 workspace。共享的面板组件做成库 `@smp/console-kit`，由各插件的客户端构建打进去。这个库没有 `apply`，不进补丁。

| 插件 | 页面 | 宿主端 |
| --- | --- | --- |
| `@smp/console-database` | 无 | 连接池、密文、启动时迁移。提供 `database` 和 `secrets` |
| `@smp/console-session-persistence` | 无 | 实现 `sessionPersistence`，把会话日志写入 PostgreSQL，并停用 jsonl 后端 |
| `@smp/console-workspace-storage` | 无 | 提供 `postgres` 存储后端，只把 `workspace` 域指到数据库 |
| `@smp/console-install` | 无 | 新的 profile 里启动一次，写入数据库地址和加密密钥，并留下 `install-complete`。标记还在时不再出现 |
| `@smp/console-encryption-key` | 数据 | 在平台设置里查看和更换加密密钥。写入补丁，并让当前进程改用新密钥 |
| `@smp/console-sessions` | 档案 | 列出会话，按标题、会话编号、日期、状态和工作区查找。列表分页。未归档的可以打开，已归档的可以恢复或彻底删除 |
| `@smp/console-frame` | 侧栏、登录页、安全、Harness | 签发和校验 `smp_session`，登记 `/login` 和安全 |
| `@smp/console-harness-settings` | Harness | 无。列出已登记的栏目，并自己登记通用栏目 |
| `@smp/console-settings-models` | 模型 | 把模型配置写回 Harness，并把去掉密钥的配置同步进数据库 |
| `@smp/console-plugin-inventory` | 插件 | 列出全局插件 |
| `@smp/console-dashboard` | 仪表盘 | 空。有数字可显示时再直接读库 |
| `@smp/console-quant` | 概览、行情、交易所、交易策略 | 交易所账户；调用交易所 API 取余额和行情 |
| `@smp/console-accounts` | 钱包、钱包详情、虚拟信用卡 | 这些表的读写；进程内派生地址 |
| `@smp/console-server-management` | 服务器、详情、登记、终端、密钥 | 服务器、分组、密钥、容器清单、任务、巡检、采指标、组件安装、终端 |
| `@smp/console-settings` | MCP | MCP 开关和 `/mcp` |

栏目插件只往壳声明的 `console.page` 登记页面，并带上 `label` 和 `order`。同一 `group` 的页面合成侧栏的一项，顶部页签用各页自己的 `label`。没写 `group` 的页面单独成为一项。`placement: 'footer'` 的组固定在侧栏底部。壳自己登记「平台设置」里的「安全」和「通用」，放在底部。「Harness」由 `@smp/console-harness-settings` 登记到同一组。其他栏目不在壳里写死。侧栏仍由壳以优先级 `-100` 占用，并停用 harness 自带的 `ui-sidebar`。那条侧栏一旦出现，Harness 自带的设置弹层会声明 `settings.section`，和 Harness 设置抢同一个槽位。`conversation` 留给 `dsh` 会话，点「Harness」时 `selectPanel(null)`。槽位只留下 `label` 和 `order`，所以组名、组的标题和位置附在 `label` 函数上。

跨栏目的读取走数据库，不走另一个插件的 HTTP。例如 MCP 要列出服务器时，设置插件读 `servers` 表，不请求服务器管理插件的路由。

### 6.1 存储

`inject` 为空。配置至少包括数据库地址和加密密钥，缺了就加载失败。

`apply` 里打开连接池、准备密文工具、执行尚未应用的 SQL 迁移，再用 `provide` 交出 `database` 和 `secrets`。这两项放在 effect 的最后发布，卸载时先撤回服务，再关池子。

表结构沿用 `smp` 里已经迁移到头的 PostgreSQL。本插件的迁移从该状态往后加，不在插件启动时重放 Python Alembic。会话日志表也由这里的迁移创建。`@smp/console-session-persistence` 注入 `database` 后实现 `sessionPersistence`，事件只追加进这些表。补丁停用 `session-persistence-jsonl`，新会话不再写 jsonl。

### 6.2 壳

宿主 `inject` 为 `['connection', 'webServer', 'database']`。

- `/login` 仍是单独页面。已有 `smp_session` 时转到 `/`。
- 用 `database` 核对 `accounts`。空表时用配置里的初始用户名和密码插入一行；没配初始密码且表是空的，加载失败。
- 替换现在壳里为了询问网站后台而拉起的子进程，以及进程内那份会话缓存。一次校验用完即丢，不在模块顶层留缓存。
- 没有会话时，索引门禁把浏览器送到 `/login`，并清掉 `dsh` 发给浏览器的登录 cookie。有会话时放行页面，Harness 连接沿用现在的换票方式。启动 token 仍留在进程里。
- 「安全」在壳里：修改用户名、密码和两步验证。改密码时用同一套口令把钱包助记词重新加密。用户名改掉后重新签发 `smp_session`。

客户端 `inject` 为 `['slots']`，另外使用 `layout`、`sessions`、`uiWorkspace`、`workspaces`、`locale`、`theme`。当前选中的页面是这次 `apply` 里的状态，键来自已登记的 `console.page`，不放在模块级变量上。壳登记的页面键是 `settings` 和 `general`，都在底部的「平台设置」里。`settings` 的页签是「安全」。`general` 的页签是「通用」，语言调用 `locale.setLocale`，外观调用 `theme.setTheme`。网站标题和图标写在 `console_site`，并显示在侧栏和登录页。标题留空时使用 Cyber Evolving System。图标留空时使用控制中枢图标。配置页里的图标是 100×100，点击它打开文件选择。「安全」里的「保存用户名」和改密码的「保存」同样只在内容有改动时可以点。「通用」页的「网站」里可以选择登录后初始面板。选项是已登记的页面；一个栏目有多个子页时，每个子页单独一条，写成「栏目 / 子页」。没保存过时进入 Harness 的「会话」。这一项写在 `console_site.landing_page`。同一张表单还可以选择侧边栏初始状态，展开或收起，没保存过时收起，写在 `console_site.sidebar_collapsed`。标题、图标和这两项一起由「保存」写入，没有改动时按钮不可点。「菜单」的「新建分组」和「模型」的「添加」在各自标题栏右侧。新建后出现「未命名分组 N」，名称处于编辑中；对号保存，叉号取消。除「未分组」外，分组可以改名、删除和拖动排序。补丁把 `ui-sidebar` 标为停用。

### 6.2.1 Harness 设置

`@smp/console-harness-settings` 只有客户端。壳的主面板声明 `console.settings-host`，这一项一直挂着，并在这里声明 `settings.section`。这一项自己登记 `general` 这一栏，并声明 `settings.general.item`。画行时跳过 `language` 和 `appearance`，这两项在壳的「通用」页签里；也跳过 `models`，这一栏由模型页签画出。其余 Harness 设置插件继续把自己的栏目登记到 `settings.section`，保存仍走它们原来的配置。补丁停用 `ui-settings-general`，否则那一栏也会声明 `settings.general.item`。这个插件不声明 `sidebar.settings`，因此不会把 Harness 那块带遮罩的设置弹层挂进来。

### 6.2.2 模型

`@smp/console-settings-models` 往同一组 `platform` 登记页签「模型」，排在「Harness」前面。它不声明 `settings.section`。这一页的表开始是空的，由用户添加。添加时可以选已有提供商，也可以输入一个新的；同时勾选这个提供商支持的模型。列仍是提供商、API 地址、API 协议（OpenAI、Anthropic）、API Key。地址、协议和模型写回 Harness 设置，密钥走原来的凭据接口。宿主监听 `settings/document-updated`、`llm/adapters-updated` 和 `credentials/reference-updated`。事件之后重读模型目录和去掉密钥字段的设置，把供应商、接入地址、模型名和配置档写入 `console_model_profiles`。API 密钥按引用名再读，加密后放进同一行。Harness 的文件仍是调用时读取的那一份。

### 6.2.3 插件

`@smp/console-plugin-inventory` 往同一组登记页签「插件」。它读 `pluginInventory.list()`，只列出全局 Loader 条目：名称、说明和启停状态。列表分页，每页可以选 10、20 或 50 条，也可以直接跳到某一页，并按启停状态筛选。点一行展开模块名、条目标识、启用、运行阶段和预设。会话插件仍留在「Harness」的「内置插件」里。这一页不改启用状态。

### 6.2.4 数据

`@smp/console-encryption-key` 往同一组登记页签「数据」。页面读出存储插件配置里的加密密钥，默认不显示明文，点按钮才看得到。可以改，也可以生成一把新的。密钥没有改动时「保存」不可点。保存时写回 `smp-database` 的 `encryptionKey`，并让当前进程的 `secrets` 改用这一把。已经用旧密钥加密的内容解不开。数据库地址不在这一页改。

### 6.2.5 档案

`@smp/console-sessions` 登记 Harness 的页签「档案」。列表来自会话目录，归档标记来自工作区登记。搜索只比较标题或会话编号，由一个选择框决定比哪一个。还可以按更新时间的起止日期、使用中或已归档、以及工作区来缩小列表。会话编号在第一列，过长时省略，鼠标停在上面能看到完整编号，旁边的图标可以把它复制出去。同一行还写出标题、工作区、更新时间，以及是否在跑、是否空白、是否已置顶、是否从别的会话分出来，这些都写在同一行里。列表分页，每页可以选 10、20 或 50 条，也可以直接跳到某一页。未归档的会话点开后回到「会话」并选中它。已归档的可以恢复，也可以彻底删除：先卸掉还留在进程里的代理，再删掉 PostgreSQL 里的会话日志，然后从工作区账上摘掉并清掉归档标记。没有归档的会话不能删。聊天正文不在这一页搜。

### 6.3 服务器管理

做法以 `docs/design/server-management/design.md` 为准。

这个插件承接现在的运维服务。宿主 `inject` 为 `['webServer', 'database', 'secrets', 'consoleSession']`。

页面触发的动作只插入 `ops_jobs` 并返回。同一台服务器同时只执行一个动作，这个限制写在该插件的 effect 里。执行的动作只有现在已经实现的三种：

| 动作 | 行为 |
| --- | --- |
| `test_connection` | SSH 登录，按登记项安装所选组件，钉住主机密钥指纹 |
| `install_components` | SSH 登录，按组件目录安装全部已选组件 |
| `inspect` | SSH 执行容器清单命令，覆盖 `server_containers` |

组件目录由配置给出，内容仍是现在的 `component.json`、`detect.sh`、`install.sh`。目录不存在时加载失败。

另外两个 effect：

- 巡检定时器。对可达服务器按配置间隔插入 `inspect`。默认间隔保持 30 秒。
- 采指标。对已登记服务器采样 CPU、内存和磁盘，写回 `servers`。默认间隔保持 1 秒。

终端用 `webServer.registerUpgrade` 登记精确路径 `/console-api/servers/terminal`，服务器编号放在查询参数里。套接字关闭或插件卸载时断开 SSH。HTTP 与升级都先校验 `smp_session`。

`dsh` 启动时，把状态仍为 `running` 的任务标为失败，摘录写明进程已重启。不尝试接回上一次的 SSH。

### 6.4 资金账户

宿主 `inject` 为 `['webServer', 'database', 'secrets']`。

钱包、派生账户、地址和虚拟信用卡的读写留在这个插件。助记词派生调用库函数，不再单独跑 `wallet-deriver` 进程。助记词、卡号和 CVV 经 `secrets` 加密后入库，列表接口不返回原文。

### 6.5 数字货币

宿主 `inject` 为 `['webServer', 'database', 'secrets']`。

交易所账户写入 `exchange_accounts`。刷新余额和解行情时，插件解密凭证并调用该交易所的 HTTP API，把结果写回同一行。凭证不进日志，响应不回传密钥。

概览和交易策略仍是空面板。策略的部署不在本插件里补做。

### 6.6 平台设置

宿主 `inject` 为 `['webServer', 'database', 'consoleSession']`。

「安全」属于壳，已经在「平台设置」里。这个插件只负责 MCP：读写 `mcp_settings`，并登记 `/mcp`。页面登记到同一组 `platform`，页签是「MCP」，因此仍出现在侧栏底部的「平台设置」中。令牌只在生成时返回一次，库里存哈希。`/mcp` 按该行的开关决定是否读出服务器、钱包和信用卡。

### 6.7 仪表盘

只有客户端。当前没有可汇总的数据，宿主保持空的 `apply`。以后要显示数字时，注入 `database` 直接查询，不为仪表盘再加一层接口。

## 7. 怎么构建

每个插件是独立的 ESM 包，包名 `@smp/console-<栏目>`，`"private": true`，`engines.dsh` 为 `0.2.1-alpha.5`。`dsh.bundle.patch` 指向 `./cordis.patch.yml`。有页面的包再声明 `dsh.client.platform: web`，并导出 `./client`。运行入口是构建后的 `lib/`。

补丁只追加自己这一行：

```yaml
- insert:
    - id: smp-server-management
      name: '@smp/console-server-management'
```

存储插件的 `id` 用 `smp-database`。一行一个 `id`。先后依赖 `inject`，不依赖补丁里的位置。会随部署变化的地址、间隔、密钥和组件目录写成经过校验的 `Config`。

宿主构建为 ESM、`platform: node`。客户端构建为 CJS、`platform: browser`，`react` 和 `react/jsx-runtime` 设为 external，外包一层 `window.__ModuleLoader__.load`，`id` 等于包名。

宿主 `apply` 里，路由、定时器、连接池和 SSH 都放进 `ctx.effect()`。`webServer.register` 的返回值就是清理函数。精确路由优先。清理函数在返回前要等已经开始的 SSH 和终端断开，不能只发出中断就返回。

客户端用 `ctx.slots.inject('console.page', () => ctx.slots.register(...))`，带 `options.key`。工厂函数本身不产生副作用。样式挂在壳的 `.smp-console` 上，沿用 `panel`、`panel-head`、`mark`。

浏览器里的请求仍用现在的路径形状，只是对端换成了本进程里的路由：原来的 `/api/servers` 由服务器管理插件登记为 `/console-api/servers`，其余栏目同样把 `/api` 换成 `/console-api`。`/mcp` 和 `/login` 不带这个前缀。

## 8. 路由归属

| 插件 | 登记的路径 |
| --- | --- |
| 壳 | `/login`、索引门禁、`/console-api/auth/login`、`/console-api/auth/logout`、`/console-api/auth/me`、`/console-api/auth/session`、`/console-api/auth/username`、`/console-api/auth/password`、`/console-api/auth/totp/*` |
| 服务器管理 | `/console-api/servers`、`/console-api/server-groups`、`/console-api/ssh-keys`、`/console-api/components`、`/console-api/ops-jobs/:id`、终端 WebSocket |
| 资金账户 | `/console-api/wallets`、`/console-api/cards` |
| 数字货币 | `/console-api/exchanges`、`/console-api/markets` |
| 平台设置 | `/console-api/mcp`、`/mcp` |
| 档案 | `/console-api/sessions/delete` |

除登录和 `/login`、`/mcp` 外，路由都要求有效的 `smp_session`。壳把校验做成 `database` 之上的函数，栏目插件调用它，不各自解析 cookie 格式。

## 9. 崩溃后还在的东西

| 东西 | `dsh` 重启之后 |
| --- | --- |
| PostgreSQL 里的登记、密文、容器清单、任务历史 | 还在 |
| 远端服务器上的容器 | 还在，由该机器的 Docker 管理 |
| 进行中的 SSH、终端、采指标 | 随进程结束。任务行在下次启动时标为失败 |
| Harness 里的会话 | 在 PostgreSQL 的会话日志表里，重启后还在。不再写入 jsonl |
| 工作区登记 | 在 PostgreSQL 的存储表里。`workspace.json` 只在第一次启动时导入 |

## 10. 构建顺序

1. 存储插件。连上现有库，提供 `database` 和 `secrets`，启动迁移可用。
2. 壳。`/login`、`smp_session` 和安全不再访问网站后台。侧栏按已登记的页面分组；平台设置在底部，通用、安全和模型是其中的页签。Harness 设置接着登记同一组的「Harness」，模型栏目从那里挪到模型页签。
3. 服务器管理插件。把连接测试、巡检、采指标、组件安装和终端从运维服务搬进来，页面仍轮询 `ops_jobs`。
4. 资金账户、数字货币、平台设置。按栏目把对应的读写和外部调用搬进宿主端。
5. 仪表盘维持空宿主。
6. 六个栏目和存储插件都由本进程答完请求。本进程听 `9090`。原来 `8080` 上的网站、接口和运维进程不再启动。

每一步都可以单独对上现有页面：同一条 `/console-api` 路径，先由插件答，应答形状与现在的网站后台一致。
