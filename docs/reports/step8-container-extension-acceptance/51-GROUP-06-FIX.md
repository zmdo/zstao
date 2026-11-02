# 51 GROUP-06 回测：非空分组错误提示

- 用例：GROUP-06
- 结果：通过
- 测试时间：2026-10-21 04:45 CST
- 用户组：`delete-test-3`

## 修复

删除非空用户组时不再复用 `type_change_requires_preflight`，改为：

```json
{
  "code": "group_not_empty",
  "detail": "该分组仍包含服务器，请先移出或改类型后再删除。"
}
```

## 步骤

1. 创建用户组 `delete-test-3`。
2. 通过 move 计划把 `ui-test` 移入该组。
3. 删除该组。

## 结果

```json
HTTP 409
{
  "code": "group_not_empty",
  "params": {},
  "detail": "该分组仍包含服务器，请先移出或改类型后再删除。"
}
```

## 结论

非空用户组仍然被拒绝删除，但错误码和提示现在准确表达原因。
