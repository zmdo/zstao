# 客户端、导航、语言与主题

核对基线：`ces/develop`，`f2b8d86`，2026-10-20。

## 当前壳与导航

frame 的 `main` 内容声明 `console.page`、`console.page-navigation` 和 `console.settings-host`。业务页面向已有槽登记，不另起应用根。

| 概念 | 当前行为 |
| --- | --- |
| 页面 key | 唯一、稳定，用于路由状态和槽渲染 |
| 默认同组导航 | 同组页面在顶部以 Tab 展示 |
| `navigation: 'sidebar'` | 在主侧栏分组下展示页面子入口 |
| `placement: 'footer'` | 归入底部区域，例如平台设置 |
| `console.page-navigation` | 同页面 key 的自定义顶部导航；未登记时使用统一 Tab |

分组／导航元数据附在 label 函数上，使用各插件已有 `pageLabel` 辅助方式；当前槽账本不会保留任意自定义 `register` 字段。不要把 `group/visible/serverTypes` 直接塞到 register 顶层然后假设 `entries()` 能读取。

壳通过 slot props 传入 `openConsole` 等导航回调。服务器升级导航与内容共享单次客户端实例创建的 `pageState`，不在两个组件里分别维护当前 Tab。

## 已实现的页面结构

- Harness 提供会话／档案视角；会话区和工作区侧栏继续使用宿主交互。
- 平台设置聚合通用、安全、模型、Harness、插件、数据等注册页面；Harness 内部的设置栏目由 `settings.section` 与 `settings.general.item` 承载。
- 主侧栏“服务器管理”是分组，下有“服务器实例”“服务器密钥”“升级管理”。
- 进入升级管理，页面最顶部显示“升级建议”“升级计划”“执行记录”三个 Tab；内容标题随 Tab 改变。
- 单台服务器详情是带局部侧栏的工作区：服务器详情、任务报告、终端、容器、配置五个面板；侧栏在面板切换时保留。配置面板内分基础配置、软件策略两个栏目，各自保存，配置层在面板切换时保留草稿。

## 侧栏交互

菜单按钮悬浮仅变主题蓝色，背景保持原状态。侧栏收起时悬浮分组图标显示当前可见页面浮层；从图标移入浮层可继续操作，选择页面后仍保持收起。

浮层使用同一 React 树中的 portal 防止被裁切，按窗口边界定位；鼠标离开后短延迟关闭，支持方向键和 Escape、点击外部关闭。菜单来源是已注册且通过工作区组过滤的页面，不是另写一份固定菜单。

相关入口：[pages.ts](../../../plugins/frame/src/pages.ts)、[client.tsx](../../../plugins/frame/src/client.tsx)、[rail-choice.tsx](../../../plugins/frame/src/rail-choice.tsx)。

## 国际化

插件清单的 locale 元数据、页面 UI 的 copy、宿主返回的业务错误是三条路径。只有 `locale/zh.json` 与 `en.json` 的元信息，并不能自动使页面全部国际化。

页面监听当前 `locale`，重新求值标题／copy；服务器业务使用 `shared/i18n.ts`，错误响应字段为 `{ code, params, detail }`。状态原因 DTO 另用 `parameters`，不能与错误的 `params` 混用。插件自定义类型和系统服务器组名称要求双语 `LocalizedText`。工作区组使用 `labelI18n`，这是不同契约。

工作区默认组稳定 ID 仍为 `general`，当前名称为“默认组 / Default Group”；`unassigned` 是“未归属 / Unassigned”。修改翻译不能改 ID、目录归属或历史任务身份。

远端原始错误不是翻译 key；保留可读摘录，不把字符串强行当成结构化错误导致只显示“请求没有完成”。

## 样式与组件

使用 `console-kit` 的 `Panel`／`Surface` 和现有主题变量。server-management 的样式位于 `client/shared/`，构建时作为文本由 effect 安装并卸载。

长表格使用受限布局、横向滚动和现有分页；不要让筛选控件靠临时宽度挤成不规则多行。DOM 监听、ResizeObserver、轮询和样式节点都要清理。

终端层由详情工作区保留：切到其他面板只隐藏，xterm 实例和 WebSocket 继续存活；显示时重新 fit 并 refresh。

源码：[服务器页面登记](../../../plugins/server-management/src/client.tsx)、[Harness 设置槽](../../../plugins/harness-settings/src/client.tsx)、[共享 UI 导出](../../../packages/console-kit/src/index.ts)。
