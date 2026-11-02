# 67 PLUG-01／UI-02：插件组件错误隔离

- 用例：PLUG-01 错误隔离、UI-02 错误边界
- 结果：阻塞（测试插件导致控制台启动失败）
- 测试时间：2026-10-21 07:50 CST

## 尝试

创建临时插件：

- 类型 `@smp/throw-plugin/crash`
- 客户端面板组件渲染时抛错

加载插件并重启控制台。

## 结果

控制台没有启动成功，日志显示插件等待服务：

```text
Plugins waiting for services (1):
Plugin      Missing services
client-hmr  clientModules
```

`/login` 不可用。

说明测试插件在宿主启动阶段就破坏了整个控制台，没有进入单个扩展面板的错误边界。

## 处理

- 从 profile 移除测试插件
- 重启控制台
- 确认恢复正常

恢复后公共类型：

```json
[
  "builtin/vacant",
  "@smp/console-server-containers/container",
  "@smp/console-server-extension-fixture/database",
  "@smp/test-group-plugin/report"
]
```

## 结论

本轮没有验证：

- 一个插件组件报错不影响另一个
- 扩展组件异常错误边界

反而发现：测试插件配置/加载错误可以阻止控制台启动。需要另建一个能正常加载、仅在渲染时抛错的插件，或直接测试现有扩展错误边界。

未勾选任何相关清单项。
