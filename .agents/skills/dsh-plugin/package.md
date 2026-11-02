# 包清单和补丁

来源：`cordis-plugin-development/references/host-plugin.md`、`ui-plugin.md`，以及 `cordis-composition-reference`。下面是本项目要交出去的形态。

## 宿主加客户端

```json
{
  "name": "@smp/console-quant",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "装到基座上的栏目：数字货币",
  "main": "./lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": ["lib/index.js", "lib/client.js", "cordis.patch.yml", "locale/*.json", "icon.svg"],
  "engines": { "dsh": "0.2.1-alpha.5" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web" }
  }
}
```

只有宿主、没有页面时，去掉 `./client`、`dsh.client` 和 `lib/client.js`。`locale` 和 `./icon` 仍然保留。

`src/index.ts`：

```ts
export const inject = ['webServer']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/console-api/example', handler }))
}
```

`src/client.tsx`：

```tsx
export const inject = ['slots']

export function apply(ctx: { slots: Slots }): void {
  ctx.slots.inject('console.page', () => ctx.slots.register({
    name: 'console.page',
    key: 'quant-markets',
  }, MarketView))
}
```

客户端构建：`format: 'cjs'`，`platform: 'browser'`，`jsx: 'automatic'`，external 为 `react` 和 `react/jsx-runtime`，banner/footer 包住 `window.__ModuleLoader__.load`，`id` 用包名。宿主构建：`format: 'esm'`，`platform: 'node'`。

## 补丁方言

一层补丁是若干映射：

| 写法 | 作用 |
| --- | --- |
| `insert: [行]` | 追加行。若带 `id` 且该行是 `group: true`，则追加进该组的 `config` |
| 有 `id`、没有 `insert` | 覆盖该 `id` 的已有行。给出的字段替换原字段 |
| 没有非空 `id` 的非 insert 项 | 被警告并跳过 |

行的字段：`id`、`name`（包名或相对补丁文件的路径）、可选 `config`、`disabled`、`inject`、`intercept`、`isolate`。

- `group: true` 且 `name: cordis:group` 时，`config` 是嵌套的插件列表。
- `disabled` 可以是布尔、null，或在每次挂载时对 Loader 上下文求值的 `!!js`。
- `!!js` 出现在 `config` 里时，等该行声明的注入就绪后，对着该插件的 `ctx` 求值。
- `isolate` 把服务名映射为 `true` 或 realm 标签。范围决定贡献和事件能看见谁；`isolate` 决定服务实例。

覆盖已有行时，`name` 为真表示核对原插件名，不是改名。`config` 不会深合并。
