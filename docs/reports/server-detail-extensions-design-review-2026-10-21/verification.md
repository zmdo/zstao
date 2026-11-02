# 验证记录与证据边界

## 1. 评估基线

- 仓库：smp-dsh
- 分支：`ces/detail-extensions`
- 提交：`610497f5f8e3572d5611dc233397285a1230adcc`
- 开始评估时工作区干净，分支与已知 origin 跟踪分支一致。
- 本地运行环境：Node.js v25.8.1、Python 3.9.6。
- 本轮只读源码和验收资料，运行本地测试及内存替身复现，新增本评估目录。
- 未访问测试服务器，未调用产品写接口，未重启程序，未修改 profile 或数据库；数据库集成测试显式跳过。

## 2. 采用的关键验收证据

| 文件 | 本轮用途 |
| --- | --- |
| [97-FINAL-REPORT](../step8-container-extension-acceptance/97-FINAL-REPORT.md) | 完成状态、13 项历史产品问题的修复总结、两项已知限制 |
| [00-INDEX](../step8-container-extension-acceptance/00-INDEX.md) | 定位关键回测及识别索引正文漂移 |
| [checklist](../step8-container-extension-acceptance/checklist.md) | 实际计数为 167 个 [x]、0 个未勾选项 |
| [96-PROCESS-CLEANUP](../step8-container-extension-acceptance/96-PROCESS-CLEANUP.md) | 验收环境清理记录；不据此再次执行清理 |
| [21-SW-01-FULL](../step8-container-extension-acceptance/21-SW-01-FULL.md) | 首次安装、Docker 组权限、新 SSH 会话和面板完整链路 |
| [25-PLUG-02](../step8-container-extension-acceptance/25-PLUG-02.md) | 插件卸载／重载后类型与登记保留；记录通过修改 profile 并重启验证 |
| [40-CFG-02](../step8-container-extension-acceptance/40-CFG-02.md) | 执行型配置计划、摘要、revision 和拒绝重复应用 |
| [41-CFG-04](../step8-container-extension-acceptance/41-CFG-04.md) | 计划生成后插件保持卸载、类型改为不适用的旧计划拒绝 |
| [89-SW-06-LATE](../step8-container-extension-acceptance/89-SW-06-LATE.md) | 取消后的迟到结果隔离；远端仍可能完成安装 |
| [95-PLUG-01-ISOLATION-PASS](../step8-container-extension-acceptance/95-PLUG-01-ISOLATION-PASS.md) | 一个插件组件异常不影响另一插件面板 |

这些证据支持“原清单已完成”。例如报告 41 不能进一步证明“同键重载后旧配置计划必然失效”，报告 25 的重启验证也不能覆盖同进程在途巡检的热重载窗口。

## 3. 本轮实际执行的自动化测试

从仓库根目录运行：

```sh
env -u SMP_TEST_DATABASE_URL npm run test --workspace=@smp/console-server-management
npm run test --workspace=@smp/console-server-containers
```

| 套件 | 总数 | 通过 | 失败 | 跳过 | 退出状态 |
| --- | ---: | ---: | ---: | ---: | ---: |
| server-management | 80 | 71 | 5 | 4 | 1 |
| server-containers | 10 | 10 | 0 | 0 | 0 |
| 合计 | 90 | 81 | 5 | 4 | — |

核心测试耗时约 11 秒，容器配方测试约 1.4 秒。未输出覆盖率，因此不能据此给出代码覆盖率百分比。

通过的测试包括核心 5 项架构约束、Cordis 注册与卸载、公共类型、脚本快照、版本策略、远端执行结果、终端资源释放、SSH 超时分类等。架构测试内部使用 esbuild 的 `write: false`；本轮没有重新生成产品 lib 产物。

### 5 个失败的定位

均位于 `plugins/server-management/test/extension-fixture.test.ts`：

| 起始行 | 用例 | 实际失败 |
| ---: | --- | --- |
| 103 | 执行扩展巡检并保存观察 | 缺少 request_snapshot，读取 source 抛 TypeError |
| 174 | 关闭采集后跳过脚本 | 同上 |
| 214 | 执行期间提供者卸载后不发布成功 | 同上 |
| 258 | 执行期间配置 revision 改变后拒绝成功 | 同上 |
| 305 | 失去 fence 后禁止发布 | 期待 job_lease_lost，实际为同一 TypeError |

典型堆栈：

```text
TypeError: Cannot read properties of undefined (reading 'source')
  at runExtensionInspections (.../src/host/extensions/inspect.ts:26:47)
  at TestContext.<anonymous> (.../test/extension-fixture.test.ts:159:25)
```

4 个跳过用例分别涉及数据库生命周期、扩展配置条件写、服务器表重建与任务历史／巡检聚合。为遵守本轮仅评估、不改现有数据的范围，没有提供专用数据库连接；“跳过”不等于“通过”。

## 4. 额外隔离复现

以下复现均直接导入当前生产模块，SQL 通过内存替身捕获，SSH exec 返回预设字符串。没有创建测试服务器或持久化真实数据，也没有修改生产源码。

### V1：同键重载后，新处理器接收旧脚本结果

使用的生产模块：

- `DefinitionRegistry`、`builtinCatalog()`
- `ServerExtensionRegistry`
- `runExtensionInspections()`

复现设置：

1. 定义 owner 为 `@test/design-review` 的巡检扩展，适用于 `builtin/vacant`，不贡献新的服务器类型。
2. 注册旧 runtime；脚本使用现有 `test/fixtures/inspection.sh` 作为可加载路径，实际 SSH 由替身处理。
3. 在替身 `session.exec()` 中先 dispose 旧注册，再用同 owner/key 注册新 runtime，等待 ready 后返回旧脚本输出。
4. 两代 validator 在返回值中附上自己的 generation；commit 把接收到的值记录到内存。
5. job 替身提供 `request_snapshot: {}`，任务所有权检查返回有效，避免 F4 的不完整测试数据干扰。

实际输出：

```json
{
  "probe": "extension-reload-during-inspection",
  "result": [
    {
      "key": "@test/design-review/check",
      "owner": "@test/design-review",
      "status": "succeeded",
      "result": {
        "generation": "new",
        "raw": "result-from-old-script"
      }
    }
  ],
  "observationsWritten": 1,
  "committed": [
    {"generation": "new", "raw": "result-from-old-script"}
  ]
}
```

断言成功证明了此生产函数在给定交错时序下混用了两代处理器。本轮没有模拟完整 Cordis 进程热更新；提供者身份检查、类型 lease 的存在与作用范围另由源码核对，结论限于 F1 所述的扩展注册路径。

### V2：配置在最后检查后变化，旧结果仍成功提交

设置：

1. 注册包含 `settingsKey` 的巡检及其配置处理器。
2. 两次 `readSettings` 均返回 revision 1。
3. SSH 返回 `settings-revision-1-result`。
4. 获取用于 `owned()` 提交事务的数据库连接时，将模拟配置 revision 改为 2；这是“检查完成后、写入前另一个保存完成”的交错点。
5. 捕获观察 INSERT 和插件 commit 次数。

实际输出：

```json
{
  "probe": "setting-change-after-validation-before-commit",
  "currentRevision": "2",
  "settingsReads": 2,
  "result": [
    {
      "key": "@test/design-review/check",
      "owner": "@test/design-review",
      "status": "succeeded",
      "result": {"raw": "settings-revision-1-result"}
    }
  ],
  "observationsWritten": 1,
  "commits": 1
}
```

这证明写入前没有第三次版本核对或等价条件限制。它是确定性的函数级交错验证，不是 PostgreSQL 并发压力测试；真实锁协议的缺口由配置保存及提交源码共同支持。

### V3：执行型配置计划未在应用阶段重验定义

设置：

1. 内存 proposal 为 pending、未过期，owner／section／digest 匹配，expected revision 为 0，计划值为 `{"mode":"legacy"}`。
2. 当前配置 validator 只接受 mode=current，先断言它确实拒绝上述旧值。
3. 调用生产 `applyExtensionSettingsPlan()`；内存 SQL 替身返回该计划和当前无配置行，捕获其最终保存值。

实际输出：

```json
{
  "probe": "settings-plan-has-no-current-definition-validation",
  "currentValidatorRejects": true,
  "result": {"value": {"mode": "legacy"}, "revision": "1"}
}
```

应用函数没有接收／调用当前 validator，也没有持久化的定义修订可比较。HTTP apply 分支只核对存在、适用及 affectsExecution 后进入这个函数。此证据没有声称任意未知 owner 的计划能绕过 HTTP 身份或适用检查。

## 5. 静态发现与尚未重测范围

- F3 的栏目切换迟到响应、F6 的同面板刷新和查询失败依据源码；本轮没有浏览器时序复现，修复时应补交互测试。
- F5 的声明文件与源码依赖、F7 的硬编码中文和核心中的容器样式、F8 的残留及状态冲突，可以从引用文件直接核对。
- 没有重复实机安装、升级、降级、批量失败、SSH 中断或清理；现有结果引用原报告。
- 没有做性能／规模测试，不给出服务器容量承诺。
- 最终报告保留的同会话组件恢复与未单测 Docker 降级限制仍然存在；本轮没有将其扩大解释成整个错误隔离或版本能力失效。

## 6. 如何使用本评估

功能验收状态以报告 97 为当前结论。工程修复以本评估列出的证据、触发条件和验证范围为起点。完成修复后，应追加新提交的回归结果，而不是把本轮失败记录改写成从未发生。
