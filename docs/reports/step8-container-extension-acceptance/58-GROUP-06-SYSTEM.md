# 58 GROUP-06：系统组不可删除

- 用例：GROUP-06 系统组
- 结果：通过
- 测试时间：2026-10-21 05:35 CST
- 系统组：`数据库组`

## 重置

- 删除控制台服务器和任务
- 系统组仍由测试插件提供

## 请求

```text
DELETE /console-api/server-groups/a63c4865-af75-444f-a1a4-0a0901ec57fc
```

## 结果

```json
HTTP 403
{
  "code": "system_group_protected",
  "detail": "系统分组不可删除"
}
```

系统组仍在列表中。

## 结论

系统组删除被明确拒绝，提示正确。
