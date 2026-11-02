# 63 GROUP-03：公共类型变化不扩充显式系统组

- 用例：GROUP-03 公共类型变化
- 结果：通过
- 测试时间：2026-10-21 06:55 CST

## 变更

在临时分组插件中新增公共类型：

```text
@smp/test-group-plugin/report
```

重新构建并重启控制台。

## 结果

公共类型：

```json
[
  "builtin/vacant",
  "@smp/console-server-containers/container",
  "@smp/console-server-extension-fixture/database",
  "@smp/test-group-plugin/report"
]
```

显式系统组类型：

```json
[
  "@smp/test-group-plugin/database"
]
```

## 结论

新增公共类型出现在公共目录，但不会自动加入显式限定类型的系统组。

系统组只保留声明的 database 类型。
