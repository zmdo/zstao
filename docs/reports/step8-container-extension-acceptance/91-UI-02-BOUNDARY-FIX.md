# 91 UI-02：错误边界重置修复

- 用例：UI-02 错误边界
- 结果：代码已修，复测仍无法触发
- 测试时间：2026-10-21 10:25 CST

## 修复

`ExtensionBoundary` 增加 `resetKey`：

```tsx
componentDidUpdate(prev) {
  if (this.state.failed && prev.resetKey !== this.props.resetKey)
    this.setState({ failed: false })
}
```

`ExtensionHost` 传入 `resetKey={props.entry}`，切换扩展入口时重置错误状态。

## 复测

在容器面板注入崩溃开关，打开面板：

```text
The extension component is not loaded.
```

仍是“组件未加载”，不是“组件加载失败”。

切走再回来也没有恢复。

## 结论

错误边界的重置代码已加入，但当前崩溃注入测试没有真正进入组件渲染，无法验证修复效果。

需要先解决测试组件没有进入槽的问题。
