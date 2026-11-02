# 32 SW-04 回测：失败恢复上限

- 用例：SW-04 失败路径
- 结果：阻塞
- 测试时间：2026-10-21 02:35 CST

## 修复

- 新增 `server_jobs.recovery_attempts`。
- 每次进入 `recovering` 递增。
- 第二次恢复仍失败时结束任务为 `failed`，不再无限 `recovering`。

## 本轮复测尝试

为了不动 sudoers：

1. 在 `43.163.113.98` 创建 `smp-noexec`：
   - 属于 docker 组
   - 无 sudo
   - Docker 29.1.3
2. 以该用户登记服务器。
3. 创建批量升级到 Docker 29.9.1。

## 阻塞原因

预检阶段就失败，没有进入执行：

- `term-test`：`plan_conflict`
- `batch-fail`：
  ```json
  {"code":"recipe_protocol","detail":"E: Packages need to be removed but remove is disabled."}
  ```

两个问题：

1. 29.1.3 的 Ubuntu `docker.io` 升级到 Docker CE 29.9.1 需要移除旧包，配方预检拒绝。
2. 另一台目标存在旧计划冲突，需要重新预检。

## 结论

恢复上限代码已加入，但本轮没有制造出“预检成功、执行失败”的条件，因此未获得回测证据。

## 下一步

- 重置两台目标并重新巡检，消除 `plan_conflict`。
- 让无 sudo 用户对应的服务器安装 **同包名** 的 Docker CE 旧版本，再升级到同包名新版本，避免替换包导致预检失败。
- 或者增加可控测试钩子，在远端执行阶段注入失败。
