# 81 PLUG-01：单个插件加载失败不影响其他插件

- 用例：PLUG-01 错误隔离
- 结果：通过（插件加载失败隔离）
- 测试时间：2026-10-21 09:55 CST

## 尝试

加载一个注册非法扩展键的测试插件。

## 结果

控制台启动日志：

```text
dsh: warning: 1 entry did not activate
smp-conflict-plugin (@smp/conflict-plugin): ServerError: extension_definition_invalid
```

控制台仍然启动，`/login` 返回 200。

容器插件类型和扩展继续可用。

## 结论

单个测试插件激活失败不会阻止控制台启动，也不会卸载容器插件。

这验证的是插件加载失败隔离，不是组件渲染错误隔离。

## 未覆盖

- 组件渲染抛错只影响当前面板
- 扩展键冲突的 UI 提示
