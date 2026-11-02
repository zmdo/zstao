---
name: dsh-plugin
description: >-
  Writes and reviews DeepSeek Harness Cordis plugins for this console: package
  manifests, cordis.patch.yml, host apply, client slots, and the harness code
  and lifecycle rules. Use when adding or changing a dsh plugin, a console page
  plugin, a bundle patch, a client slot, or when the user mentions 插件规范,
  Cordis, or a dsh plugin.
---

# dsh 插件规范

源码在 `tmp/deepseek-harness`，提交 `1517a4db`，对应运行版本 `0.2.1-alpha.5`。不要改这棵检出。本文件和检出冲突时，以检出为准，去读下面点名的文件，不要凭记忆补 API。

本规范从这些文件改写而来，去掉了只在 Harness 仓库内部使用的安装器和覆盖率门禁。清单用的 locale 和图标仍然要做：

- `packages/preset/agent-preset/skills/cordis-plugin-development/`
- `packages/preset/agent-preset/skills/cordis-composition-reference/SKILL.md`
- `.agents/skills/cordis-styling-nitpicking/SKILL.md`
- `.agents/skills/dsh-error-handling/SKILL.md`
- `AGENTS.md` 的 Conventions
- `docs/cordis-tutorial/01-first-plugin.md`、`02-lifecycle-and-effects.md`

## 插件是什么

一个插件是导出 `apply` 的 ESM 模块。Cordis 加载后调用 `apply(ctx)`。插件只描述自己贡献的东西，不写框架启动代码。配置项拼不出模块时，加载器记一条日志，进程不一定退出；`apply` 抛错则该插件加载失败。

三种写法里，用函数：

```ts
export const inject = ['slots']

export function apply(ctx: Context): void {}
```

需要对外提供服务时再用 Service 子类。对象形式只在 `ctx.plugin({ apply(ctx) {} })` 这种代码挂载里使用。

## 包

本仓库是 Smart Management Platform（SMP）的基座。基座和以后装上来的栏目都是独立的 bundle，不放进 Harness 的 pnpm workspace。

- `"type": "module"`。包名 `@smp/console-<栏目>`。`"private": true`。
- `engines.dsh` 钉在 `0.2.1-alpha.5`。
- `dsh.bundle.patch` 指向 `./cordis.patch.yml`。
- 有页面时再声明 `dsh.client.platform: web`，并导出 `./client`。
- `exports` 至少有 `.`、`./client`（有页面时）、`./package.json`。运行入口是构建后的 `lib/`，不要把 `src` 当运行入口。
- 宿主依赖写在 `inject` 数组里，等服务出现再执行 `apply`。客户端同理，页面插件写 `inject = ['slots']`。
- React 使用 `dsh` 页面里的那一份。客户端构建把 `react` 和 `react/jsx-runtime` 标成 external，不要再打进一份。
- 浏览器产物用模块加载器登记，`id` 等于包名：

```js
window.__ModuleLoader__.load({ id: '@smp/console-quant', factory: (require) => { /* CJS 体 */ } })
```

- 非基线的运行时依赖写进 `dsh.client.external`。`.css` 按文本打进包。
- 每个插件都有 `locale/en.json`、`locale/zh.json` 和包内的 `icon.svg`，并导出 `./locale/*.json` 和 `./icon`。清单标题用 `meta.title`，说明用 `meta.description`。中文是日常看到的语言。英文标题用目录名，说明写成完整句子。缺了会退回包名和默认图标。图标用 SVG、PNG、JPEG 或 WebP，不超过 256 KiB，不使用指向包外的路径。控制台插件不进插件市场，这两样仍然要有，插件管理器不启动插件也会显示它们。

## 补丁

`cordis.patch.yml` 是一层补丁，不是完整应用配置。

```yaml
- insert:
    - id: smp-quant
      name: '@smp/console-quant'
```

- `insert` 追加行。行的 `id` 在这一层里唯一。`name` 是包名。
- 带 `id` 且没有 `insert` 的项是覆盖已有行。`config` 整段替换，要保留的字段必须重写。
- 只在插件 `config` 和行的 `disabled` 里使用 `!!js`。禁止 `!js`。其他字段写字面量。
- 列表顺序不保证谁先执行。先后依赖 `inject`，不依赖补丁里的位置。
- 相对路径的 `name` 相对补丁文件解析。控制台插件用包名。

## 宿主

宿主 `apply` 跑在 `dsh` 进程里。空宿主导出空的 `apply`。

- 路由、监听、定时器和子进程都在 `apply` 里用 `ctx.effect()` 或 `ctx.on()` 登记，返回清理函数。`webServer.register` 的返回值就是清理函数，放进 effect。
- 精确路由优先于兜底路由。同一条精确路由重复登记会抛错。
- 控制台接口用 `/console-api` 和 `/mcp`。`/api` 属于 `dsh` 自己的 RPC。
- 需要的服务写进 `inject`，例如壳使用 `['connection', 'webServer']`。
- 配置随部署变化的值做成经过校验的 `Config`，不要在插件里写死会变的地址、间隔和密钥。协议常量和安全边界保持常量。
- 配错就失败：缺了必填项时在加载或第一次用到时抛错，不要静默跳过。

## 客户端

页面挂到已有槽上，不替换文档根，不往 `document.body` 再挂一个应用。

- 用 `ctx.slots.inject(槽名, () => ctx.slots.register(...))`。`inject` 会等到槽被声明。槽还不存在时直接 `register` 会抛错。
- 有键的槽必须带 `options.key`。相同的键加相同优先级会抛错。
- 壳声明 `console.page`。栏目插件只往这个槽登记自己的页面，不占用 `sidebar`。
- 侧栏是单人座位，只有壳以优先级 `-100` 登记。`conversation` 留给 `dsh` 会话。点「Harness」时 `selectPanel(null)`。
- 工厂函数本身不要产生副作用。样式、定时器和监听放进 `apply` 的 effect，或放进会随组件卸载消失的 React 树。
- 选槽时读该槽的 props 和 options。不要去读另一个插件的 DOM 来猜位置。

## 代码

写插件和它的直接依赖时遵守这些。仓库级的覆盖率、快照和双语文档门禁只约束 Harness 自己，不在本项目执行。

- ESM。跨包用包名，包内相对导入带 `.ts` 后缀与否跟该包已有文件保持一致。
- 登记都是 effect。`register()` 返回清理函数。
- 模块级可变单例、`getInstance()`、靠加载顺序活着的缓存，都要改成 Cordis 服务或某次 `apply` 拥有的状态。不可变常量和纯函数可以留在模块顶层。
- 对闭合联合用 `switch`，结尾 `assertNever`。可扩展联合走写明的 default。
- Waterfall 监听必须调用 `next()`，否则链被截断。
- 同一进程里类型已经保证的值，不要再做运行时校验，也不要写 `as unknown`。校验留在配置、持久化、队列、模型或工具 JSON、以及进程和网络边界。
- 预期失败用带判别字段的类型，保留 cause。不要靠解析错误文案来分支。空的 `catch` 要写出绑定名和原因，`try` 里只放一条语句。
- 注释只写本地看不出来的契约：失败、时序、所有权、调用前提。不复述代码。
- 文件使用 LF，末尾恰好一个换行。

生命周期的三条禁止项和清理顺序见 [lifecycle.md](lifecycle.md)。补丁字段和包清单的完整片段见 [package.md](package.md)。

## 读源码的顺序

1. 本技能和同目录的两份参考。
2. 检出里对应技能的 `references/`，只读当前问题用到的那一篇。
3. 已安装包的 `lib/types/**/*.d.ts`。源码在 `tmp/deepseek-harness/packages/<group>/<name>/src`。
4. `docs/cordis-tutorial/` 对应章节，以及 `docs/cordis-primer.md`。
