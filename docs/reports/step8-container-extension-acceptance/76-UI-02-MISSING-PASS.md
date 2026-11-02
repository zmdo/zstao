# 76 UI-02：扩展组件缺失占位

- 用例：UI-02 扩展组件缺失
- 结果：通过
- 测试时间：2026-10-21 09:20 CST

## 修正导航

之前自动化点击了错误的旧侧栏选择器，实际页面在 DSH 工作区。

改为点击：

```html
[aria-label="Server management"]
```

## 结果

服务器详情面板选项：

```text
Server details
Task report
Terminal
Configuration
Missing panel
```

点击 `Missing panel` 后：

```text
The extension component is not loaded.
```

## 结论

宿主目录有面板，但客户端没有注册组件时，显示明确的缺失占位，没有导致页面崩溃。

已勾选“扩展组件缺失显示占位”。
