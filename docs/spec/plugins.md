# 插件目录与包

本仓库是 Smart Management Platform（SMP）的基座。本文件规定插件的目录和包怎么放。已经在基座里的插件，和以后装到基座上的栏目，用同一套规则。插件行为、生命周期和补丁方言以 `.agents/skills/dsh-plugin/` 为准。要做哪些插件、各自负责什么，以 `docs/design/remote-console/design.md` 为准。

运行版本是 `dsh` `0.2.1-alpha.5`。

## 仓库

```
plugins/
  database/
  session-persistence/
  workspace-storage/
  install/
  frame/
  plugin-inventory/
  harness-settings/
  settings-models/
  encryption-key/
  sessions/
  dashboard/
  quant/
  accounts/
  server-management/
  settings/
packages/
  console-kit/
scripts/
  build-plugin.mjs
```

`dashboard`、`quant`、`accounts`、`server-management`、`settings` 还没有目录，是以后装到基座上的栏目。上面其余目录已经在基座里。

根上有一份 `package.json`，只用来把这些包放进本仓库的 workspace，本身不是插件，没有 `cordis.patch.yml`。workspace 包含 `plugins/*` 和 `packages/*`。全仓库一份 lockfile，放在根上。插件目录里不再各放一份。

这些包不写进 Harness 的 workspace。`tmp/deepseek-harness` 只作对照，不放控制台源码。

## 插件

一个栏目一个包。目录名是包名去掉 `@smp/console-` 的那一段。`dashboard`、`quant`、`accounts`、`server-management`、`settings` 还没有放进基座。

| 目录 | 包名 | 补丁 `id` | 页面 |
| --- | --- | --- | --- |
| `plugins/database` | `@smp/console-database` | `smp-database` | 无 |
| `plugins/session-persistence` | `@smp/console-session-persistence` | `smp-session-persistence` | 无 |
| `plugins/workspace-storage` | `@smp/console-workspace-storage` | `smp-workspace-storage` | 无 |
| `plugins/install` | `@smp/console-install` | `smp-install` | 无 |
| `plugins/frame` | `@smp/console-frame` | `smp-frame` | 有 |
| `plugins/plugin-inventory` | `@smp/console-plugin-inventory` | `smp-plugin-inventory` | 有 |
| `plugins/dashboard` | `@smp/console-dashboard` | `smp-dashboard` | 有 |
| `plugins/quant` | `@smp/console-quant` | `smp-quant` | 有 |
| `plugins/accounts` | `@smp/console-accounts` | `smp-accounts` | 有 |
| `plugins/server-management` | `@smp/console-server-management` | `smp-server-management` | 有 |
| `plugins/settings` | `@smp/console-settings` | `smp-settings` | 有 |
| `plugins/harness-settings` | `@smp/console-harness-settings` | `smp-harness-settings` | 有 |
| `plugins/settings-models` | `@smp/console-settings-models` | `smp-settings-models` | 有 |
| `plugins/encryption-key` | `@smp/console-encryption-key` | `smp-encryption-key` | 有 |
| `plugins/sessions` | `@smp/console-sessions` | `smp-sessions` | 有 |

有页面的插件：

```
plugins/server-management/
  package.json
  cordis.patch.yml
  icon.svg
  locale/en.json
  locale/zh.json
  src/index.ts
  src/client.tsx
  src/pages/
  test/
  lib/
```

`src/index.ts` 是宿主，导出 `inject` 和 `apply`。`src/client.tsx` 是客户端，同样导出这两个名字。简单插件的页面组件可放在 `src/pages/`；较大的插件可按 `src/client/<业务>/` 组织，公共契约放 `src/shared/`，宿主基础能力放 `src/host/`。服务器管理的实际边界见 [结构整理记录](../design/server-management/refactor-sm.md)。包内用相对路径，一个包里 `.ts` 后缀用或不用，跟该包已有文件保持一致。

`package.json` 至少包含：

- `"private": true`，`"type": "module"`
- `"description"` 作为没有 locale 时的退路
- `"main": "./lib/index.js"`
- `exports` 有 `.`、`./client`、`./package.json`、`./locale/*.json`、`./icon`
- `files` 列出 `lib/index.js`、`lib/client.js`、`cordis.patch.yml`、`locale/*.json`、`icon.svg`
- `engines.dsh` 为 `0.2.1-alpha.5`
- `dsh.bundle.patch` 为 `./cordis.patch.yml`
- `dsh.client.platform` 为 `web`

补丁只追加自己这一行，`name` 用包名：

```yaml
- insert:
    - id: smp-server-management
      name: '@smp/console-server-management'
```

没有页面的插件去掉 `src/client.tsx`、`exports` 里的 `./client`、`files` 里的 `lib/client.js`、`dsh.client`。`locale` 和 `icon.svg` 仍在。存储插件的 SQL 放在 `plugins/database/migrations/`。组件脚本不放进任何插件目录，由服务器管理插件的配置指向仓库外面的那个目录。

## 清单

插件管理器不启动插件就会读这两样。每个插件，包括没有页面的存储插件，都要有。

`locale/en.json` 和 `locale/zh.json` 都写 `meta.title` 和 `meta.description`。中文是自己使用时看到的文字。英文标题用目录名。说明写成完整句子，避免界面语言是英文时退回包名。

| 插件 | 中文标题 | 中文说明 | 英文标题 |
| --- | --- | --- | --- |
| 数据库 | 数据库 | 数据库连接和密文 | database |
| 会话存储 | 会话存储 | 将会话写入数据库 | session-persistence |
| 工作区存储 | 工作区存储 | 把工作区登记写入数据库 | workspace-storage |
| 安装 | 安装 | 第一次启动时填写数据库地址和加密密钥 | install |
| 控制台 | 控制台 | 侧栏、登录和 Harness | frame |
| 插件 | 插件 | 查看系统与所有会话共用的插件 | plugin-inventory |
| 仪表盘 | 仪表盘 | 总览 | dashboard |
| 数字货币 | 数字货币 | 行情、交易所和交易策略 | quant |
| 资金账户 | 资金账户 | 钱包和虚拟信用卡 | accounts |
| 服务器管理 | 服务器管理 | 服务器、密钥和终端 | server-management |
| 平台设置 | 平台设置 | 安全和 MCP | settings |
| Harness 设置 | Harness 设置 | 把已登记的 Harness 设置栏目列在平台设置里 | harness-settings |
| 模型 | 模型 | 把 Harness 的模型配置同步到数据库 | settings-models |
| 加密密钥 | 加密密钥 | 查看和更换加密密钥 | encryption-key |
| 档案 | 档案 | 按标题、会话编号、日期、状态和工作区查找会话，分页后恢复或删除已归档的会话 | sessions |

`icon.svg` 放在包根，由 `"./icon": "./icon.svg"` 导出。每个插件一张，彼此分得开。格式可以是 SVG、PNG、JPEG 或 WebP，不超过 256 KiB，文件留在包内，不使用绝对路径、网址或指向包外的符号链接。

`packages/console-kit` 不是插件，没有 locale，也没有图标。

`lib/` 是构建产物，不手改，不提交。交给 `dsh` 之前先构建。

## 控制台页面导航

控制台壳声明根级 keyed 槽 `console.page`，页面按唯一 `key` 登记。页面 label 可附带 `group`、`groupLabel` 和 `navigation` 元数据；同组默认在顶部显示页面 Tab，选择 `navigation: 'sidebar'` 时改为侧栏分组下的子入口。

主侧栏菜单按钮悬浮时仅变为主题蓝色，背景保持原状态，包括当前选中背景。侧栏收起时，悬浮分组图标会在右侧显示该组当前可见页面的浮层，跟随插件注册、工作区组可见性和语言变化；无子页面的独立入口仍直接导航。鼠标可从图标移入浮层，离开两者后关闭，点击浮层选项进入页面并保持侧栏收起。浮层适配窗口边界，支持方向键进入和选择、Escape 关闭，以及点击外部关闭；卸载时清理浮层、计时器与监听。

壳同时声明根级 keyed 槽 `console.page-navigation`，渲染在页面最顶部导航栏中，与 `console.page` 使用同一个页面 key。需要专属导航的插件可向该槽登记自己的导航组件，接收 `openConsole` 回调；选中状态由该插件单次 `apply` 创建的状态持有，并与页面内容共用。不登记时使用壳的统一页面 Tab：普通分组展示同组页面，`navigation: 'sidebar'` 分组仅展示当前页面的选中 Tab，其他页面继续通过侧栏切换。插件卸载时导航随槽登记一同清理。

## 共享库

`packages/console-kit` 的包名是 `@smp/console-kit`。它提供面板组件和浏览器里的请求函数。没有 `apply`，没有 `cordis.patch.yml`，没有 `engines.dsh`。

插件用包名依赖它。客户端构建把它打进该插件的 `lib/client.js`。宿主不从这里取数据库或会话。库本身不保存可变状态。

跨包只用包名。不使用指向另一个目录源码的相对路径。

## 构建

`scripts/build-plugin.mjs` 是唯一的构建脚本。在插件目录里执行，读该目录的 `package.json`，把产物写到该目录的 `lib/`。每个插件的 `"build"` 调用它。

宿主构建为 ESM，`platform: node`。客户端构建为 CJS，`platform: browser`，`jsx: automatic`。`react` 和 `react/jsx-runtime` 标为 external。`.css` 按文本打进包。浏览器产物包在 `window.__ModuleLoader__.load` 里，`id` 等于该插件的包名。

## 测试

每个插件的测试放在该插件的 `test/`，不放进 `src/`。`src/` 只作为构建输入。`test/` 不出现在 `files` 里，也不进入 `lib/`。

文件名是 `test/<名字>.test.ts`。用 `node:test` 和 `node:assert/strict`。从测试引用源码时用指向 `src/` 的相对路径。在插件目录里执行：

```sh
node --test test/**/*.test.ts
```

测纯函数、`apply` 登记的路由和 effect 的清理，以及存储插件对真实 PostgreSQL 的迁移和读写。没有 `DATABASE_URL` 时跳过数据库测试。SSH 和交易所不进默认测试；解析和状态变化在进程里测，连接换成这次测试提供的实现。

页面组件和 Cordis 本身不在这套测试里。不使用 Harness 的覆盖率门禁和会话快照。

## 配置与状态

会随部署变化的地址、间隔、密钥和组件目录写成该插件的 `Config`。缺了必填项就加载失败。

连接池、加密密钥、当前栏目、会话校验结果，放在某次 `apply` 拥有的状态里，或放在会随组件卸载消失的 React 树里。不放在模块顶层。
