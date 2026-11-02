# 78 UI-02：错误边界客户端加载诊断

- 用例：UI-02 错误边界
- 结果：阻塞
- 测试时间：2026-10-21 09:35 CST

## 诊断

浏览器资源列表包含：

```text
@/plugins/??...@smp/throw-plugin/client.js...
```

说明客户端模块被请求。

宿主扩展目录包含：

```json
["panel:@smp/throw-plugin/crash"]
```

但点击面板时仍显示：

```text
The extension component is not loaded.
```

浏览器控制台同时出现：

```text
ERR_CONNECTION_REFUSED
api/remote.mux failed
ERR_INCOMPLETE_CHUNKED_ENCODING
```

这些是控制台重启后的连接错误，可能影响客户端模块注册完成。

## 结论

仍无法判断：

- 错误边界是否存在
- 组件异常是否只影响单个面板
- 是否影响其他插件

未勾选相关项。

## 下一步

- 在控制台完全稳定、无连接错误后重新加载测试插件
- 或直接查看模块加载器返回值和客户端 apply 是否执行
