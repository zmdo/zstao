# 74 TASK-03：时间范围筛选

- 用例：TASK-03 时间范围
- 结果：通过（API）
- 测试时间：2026-10-21 09:10 CST
- 对象：`keyword-test`

## 请求

最近 10 分钟：

```text
GET /server-jobs?server_id=<id>&from=...&to=...&page_size=10
```

结果：

```json
{"total": 5, "items": 5}
```

未来 1 小时：

```json
{"total": 0, "items": 0}
```

## 结论

时间范围筛选 API 正常。

## 组合覆盖

至此已验证：

- 类型筛选（UI）
- 状态筛选（UI）
- 关键词筛选（API）
- 时间范围筛选（API）
- 分页和每页数量
