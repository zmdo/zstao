# 39 SW-04：失败暂停后恢复权限并重试成功

- 用例：SW-04 重试
- 结果：通过
- 测试时间：2026-10-21 03:40 CST
- 环境：3 台服务器，SSH 用户保持 `ubuntu`

## 设置

三台服务器：

- `rs1` 43.128.69.189
- `rs2` 43.128.72.83
- `rs3` 43.163.113.98
- Docker 29.9.1
- Compose 2.27.1
- 目标升级 Compose 5.6.0

## 第一次计划

预检全部 `ready` 后，在**不改 SSH 用户、不改软件版本**的前提下，临时移除三台机器上 `ubuntu` 的 sudo 规则。

执行结果：

- `rs3` 失败
- `rs1`、`rs2` pending
- 计划：`paused`
- 没有无限 recovering

## 恢复权限

通过预置的 root watcher 恢复 `/etc/sudoers` 和 `/etc/sudoers.d/90-cloud-init-users`。

验证：

```text
SUDO_RESTORED
```

服务器登记和配置修订没有变化。

## 重试

- 对暂停计划调用 retry
- 新计划：`5f2d2277-693f-4e6f-9007-b7cf9a01eeab`
- 预检全部 `ready`
- 确认执行

结果：

```json
[
  {"name":"rs1","state":"succeeded"},
  {"name":"rs2","state":"succeeded"},
  {"name":"rs3","state":"succeeded"}
]
```

计划状态：

```text
completed
```

## 结论

完整通过：

1. 预检成功
2. 执行阶段失败
3. 计划暂停
4. pending 目标保持
5. 不改配置地恢复权限
6. 重试生成新计划
7. 三个目标全部成功

注意事项：本次使用了测试机 sudoers 临时修改，测试后已恢复；这不是产品流程。
