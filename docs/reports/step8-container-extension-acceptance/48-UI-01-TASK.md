# 48 UI-01：任务列表只滚表格

- 用例：UI-01 任务列表
- 结果：通过
- 测试时间：2026-10-21 04:30 CST
- 对象：`ui-test`

## 数据

为任务列表生成 18 条任务记录，页面显示 10 条。

## 证据

- 表格滚动容器：
  ```json
  {"scrollHeight": 589, "clientHeight": 359}
  ```
- 任务面板：
  ```json
  {"scrollHeight": 687, "clientHeight": 687}
  ```
- 页面：
  ```json
  {"clientHeight": 900, "scrollHeight": 900}
  ```
- 表格行数：10

## 结论

任务列表内容超出时只滚动表格区域；面板和页面没有出现外层滚动条。
