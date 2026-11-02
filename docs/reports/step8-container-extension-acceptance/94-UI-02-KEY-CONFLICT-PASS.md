# 94 UI-02：扩展键冲突提示

- 用例：UI-02 扩展键冲突
- 结果：通过
- 测试时间：2026-10-21 11:15 CST

## 方法

客户端插件再次注册容器面板完整键：

```text
@smp/console-server-containers/containers
```

使用不同优先级让注册成为 shadowed 条目，而不是同优先级直接拒绝。

## 结果

容器面板显示：

```text
The extension has duplicate registrations and was stopped.
```

没有静默覆盖，也没有继续渲染其中一个。

## 修复

`ExtensionHost` 改为读取原始槽条目并按键计数：

```ts
slots.entries?.(slot).filter(entry => entry.options.key === entryKey)
```

数量大于 1 时显示 `extensionConflict`。

## 结论

扩展键冲突会明确提示并停止该面板。

已勾选“扩展键冲突显示冲突提示”。
