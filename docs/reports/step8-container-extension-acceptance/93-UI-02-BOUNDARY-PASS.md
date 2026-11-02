# 93 UI-02：扩展组件异常错误边界

- 用例：UI-02 错误边界
- 结果：通过（错误提示）
- 测试时间：2026-10-21 10:35 CST

## 根因

框架的槽错误边界会捕获组件异常并从槽条目中移除该贡献。

`ExtensionHost` 只看到 entries 从有变无，于是显示“组件未加载”，没有区分“从未注册”和“注册后崩溃”。

## 修复

记录当前 entry 是否曾经出现：

- 从未出现 → `extensionUnavailable`
- 曾经出现后消失 → `extensionLoadFailed`

## 复测

在容器面板首次挂载时注入崩溃：

```text
The extension component failed to load.
```

不再是：

```text
The extension component is not loaded.
```

刷新页面后容器面板恢复显示表格。

## 说明

同一会话内切走再回来不会自动恢复，因为框架已经移除了该槽条目；刷新后恢复。

## 清单

已勾选“扩展组件异常显示错误边界”。

## 未覆盖

- 同会话内自动恢复
- 一个插件崩溃不影响另一个插件
