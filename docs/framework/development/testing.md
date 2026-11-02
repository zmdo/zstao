# 测试与验证

核对基线：`ces/develop`，`f2b8d86`，2026-10-20。本次交接文档以静态核对为主，不把之前的通过数量写成新的运行结果。

## 仓库入口

在仓库根目录：

```sh
npm ci
npm run test
npm run build
```

具体模块可使用 workspace：

```sh
npm run test --workspace=@smp/console-server-management
npm run build --workspace=@smp/console-server-management
npm run test --workspace=@smp/console-workspace-groups
npm run build --workspace=@smp/console-frame
git diff --check
```

测试由 `node --test` 直接执行 TypeScript，运行环境必须支持这些源码和模块语法。根 package 没有固定 Node engines 或统一 typecheck script，不能臆造一个已经存在的 `npm run typecheck`。新增或记录类型检查时写清实际工具、声明文件和参数；esbuild 成功不能代替严格类型检查。

## 数据库测试的三种入口

| 环境变量 | 使用者 | 重要区别 |
| --- | --- | --- |
| `SMP_TEST_DATABASE_URL` | 服务器管理集成测试 | 创建随机隔离 schema，结束后清理；需要测试账户具备相应权限 |
| `SMP_TEST_PROFILE` | 工作区组 service 测试 | 从测试 profile 的 patch 读取数据库配置，再创建隔离 schema |
| `DATABASE_URL` | database 迁移测试 | 直接操作指定连接的迁移记账表；不是所有测试都自动隔离 schema |

没有对应环境时相关测试会跳过。提供环境前确认测试连接的范围，尤其不要把 database 测试误认为与服务器管理一样天然隔离。日志和交接记录不写连接串或 profile 内容。

## 验证分层

| 变化 | 主要验证 |
| --- | --- |
| 纯规则与格式 | 版本、OS、状态聚合、查询参数、路径归属等纯函数测试 |
| 注册与生命周期 | 真实 Cordis 注册／卸载、迟到连接、依赖租约和最终写入 |
| 数据库与并发 | 隔离 schema、迁移拒绝条件、条件提交、领取／fence、读快照 |
| 远端执行 | 本地 SSH／包管理器替身及临时目录监督器，不安装宿主软件 |
| UI | 浏览器核对导航、标题、语言、分页、表单、弹窗和资源清理 |
| 公开插件契约 | 独立贡献者使用公开入口，不靠修改核心注册表才能通过 |

默认测试并不等于真实服务器验收。实际安装／升级是有远端副作用的独立验证，不能为了证明页面布局顺手触发。

## 已有架构约束

服务器管理测试检查 client/shared 对宿主的隔离、运行时依赖循环、SQL 归属、repository 事务所有权、DB rows 与 DTO 分离、配方／定义解析的独立性。重构时应维护这些边界，不能为移动文件直接删除检查。

## 结果记录

记录提交、执行命令、环境类型、通过／失败／跳过、是否触发真实远端操作及未覆盖项。文档中某次历史“107 项通过”不能证明当前提交已经跑过；新增测试以后数量自然变化。

只修改 Markdown 时检查链接、代码块、状态一致性和空白字符即可；无需为此执行数据库迁移、清空会话或重跑软件安装测试。

源码：[架构测试](../../../plugins/server-management/test/architecture.test.ts)、[数据库迁移测试](../../../plugins/database/test/migrate.test.ts)、[工作区组测试](../../../plugins/workspace-groups/test/service.test.ts)。
