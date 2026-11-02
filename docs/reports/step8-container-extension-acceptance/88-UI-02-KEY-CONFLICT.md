# 88 UI-02：扩展键冲突

- 结果：阻塞
- 测试时间：2026-10-21 10:15 CST

## 尝试

加载一个只注册客户端组件的插件，再次注册容器面板完整键：

```text
@smp/console-server-containers/containers
```

打开容器服务器面板。

## 结果

面板正常显示容器表格，没有冲突提示：

```text
Containers
Name Image Status Ports
...
```

说明重复的客户端注册没有进入槽条目，无法制造 `entries.length > 1` 的冲突状态。

## 结论

扩展键冲突 UI 仍未验证。仍然是新测试插件客户端注册不进入槽的问题，不是产品冲突逻辑的结论。

未勾选。
