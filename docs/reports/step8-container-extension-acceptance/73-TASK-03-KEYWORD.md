# 73 TASK-03：关键词筛选

- 用例：TASK-03 关键词
- 结果：通过（API）
- 测试时间：2026-10-21 08:55 CST
- 对象：`keyword-test`

## 数据

5 条任务，结果和输出都包含 `alpha`。

## 请求

```text
GET /server-jobs?server_id=<id>&q=alpha&page_size=10
```

## 结果

```json
{"total": 5, "items": 5}
```

关键词匹配结果和输出文本。

## 未覆盖

- 浏览器输入框操作
- 时间范围筛选

## 结论

关键词筛选 API 正常。
