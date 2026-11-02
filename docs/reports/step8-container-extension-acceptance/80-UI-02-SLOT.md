# 80 UI-02：错误边界插槽注册诊断

- 结果：阻塞
- 测试时间：2026-10-21 09:45 CST

## 证据

客户端模块已加载，`apply` 已执行（控制台输出 `THROW_APPLY`）。

槽条目实际只有：

```json
[
  "@smp/console-server-containers/containers",
  "@smp/console-server-extension-fixture/database-panel"
]
```

测试插件注册的：

```text
@smp/throw-plugin/crash
```

没有进入槽条目，因此面板显示“扩展组件未加载”。

## 结论

错误边界未触发，因为组件没有注册到槽，不是组件渲染抛错。

需要继续定位 `ctx.slots.inject` 没有登记测试面板的原因。
