# 排查与交接操作

核对基线：`ces/develop`，`f2b8d86`，2026-10-20。先确认当前提交、profile 和现象，再选择下列路径。

## 常见现象

| 现象 | 优先核对 | 入口 |
| --- | --- | --- |
| 页面打不开／像旧版本 | 实际端口、占用进程、checkout、profile、客户端是否构建、浏览器缓存 | [启动](configuration-and-startup.md) |
| 循环进入安装页 | 安装标记、数据库可达、database 加载失败和 patch 重载结果 | install `index.ts/files.ts` |
| 有安装成功结果但无法登录 | `accounts` 旧表是否存在、空表是否配置初始密码、frame 是否 active | frame `account.ts` |
| 修改密码报数据库错误 | 旧 `wallets` 表与其密文格式，而不只是账户表 | frame `security.ts` |
| 登录后 Harness 页面连接失败 | 控制台会话与宿主 connection 分开检查，避免误删另一层 cookie | frame `gate.ts/index.ts` |
| 插件一直 pending | 宿主／客户端各自缺哪个 `inject` 服务；包存在不代表依赖已提供 | [插件地图](../architecture/plugin-map.md) |
| 页面名称未随语言变化 | locale 是否订阅、label 是否动态求值、打开的实例是否一致 | [客户端](../development/client-ui.md) |
| 跨组选择相同目录失败 | 真实路径归属、符号链接、冲突返回的 owner 信息 | [工作区组](../modules/workspace-groups.md) |
| 已保存密钥连接超时 | 控制机到目标的 TCP／SSH 阶段、用户／端口、超时和指纹，不能只归因于密钥读取 | server-management `host/remote/ssh.ts` |
| Docker 权限不足导致巡检失败 | 只读直接权限、既有 `sudo -n`、同轮 Docker 上下文 | [执行专题](../modules/server-management/execution-and-upgrades.md) |
| 任务长期 recovering | 远端操作日志、租约、当前连接和实际步骤；不要新建操作 ID 重跑 | 同上 |
| 手动巡检排队／成功但任务列表没有单条 | 当前按 action／prepare 过滤，未区分手动与周期；用接受响应中的任务 ID 查询，成功再进入小时统计 | [任务接口](../modules/server-management/http-api.md) |
| 列表显示正常但有容器失败报告 | 当前状态聚合主要看连接、系统、必要软件和任务阶段；容器扫描不是现有状态原因的一部分 | [数据查询](../modules/server-management/data-and-query.md) |
| 类型／插件不可用 | 提供者是否 active、显式分组引用与类型租约、缓存只是展示 | [定义](../modules/server-management/definitions-and-recipes.md) |

## 只读检查顺序

1. `git status`、当前 branch／commit，与运行目录是否一致。
2. profile 加载了哪些包，是否构建，host/client 的失败或 pending 原因。
3. 相应 migration 是否记账；schema 是否与代码匹配。不要直接修改记账记录使破坏性迁移重跑。
4. 对服务器问题查看任务与步骤结果、当前观察时间和修订，再判断网络、定义漂移还是执行未知。
5. 根据代码入口复现最小路径；仅“刷新 UI”不能证明后端任务没有执行。

## 历史测试数据重置

仓库有 `scripts/reset-workspace-history.mjs`。它要求 `--profile <测试 profile 目录> --reset`，删除该 profile 数据库中的会话、工作区组归属／焦点和 workspace KV record／global 数据，并清理对应旧 JSON／JSONL 文件。它保留 `console_storage_unit` 元数据，因此清空 KV 内容本身不会触发 JSON 重导入，见[导入条件](../data/storage-and-migrations.md)。

脚本仅尝试请求 `http://127.0.0.1:<port>/`：端口来自 `--port`，默认 9090，不从 profile 自动识别。请求成功会拒绝清理；请求失败仍可能是超时或其他网络错误，不能据此证明所有相关进程已停止。运行前需自行核对实际实例与端口。

该脚本不是常规启动流程，也不是服务器管理重置工具；它不会为了你选择了新分支而自动运行。浏览器内存／存储仍需单独处理。脚本从 profile 读取 URL，不能把“路径名带 test”当作数据库天然隔离的证明。

此次交接整理未执行重置。以后确需清理时先明确数据库、文件和浏览器各自范围，不能把早期允许删除测试会话扩展成删除服务器或其他业务记录。

## 运行状态记录

交接报告应区分：源码已修改、构建完成、profile 已加载、数据库已迁移、页面已刷新、真实远端动作已完成。每项有实际证据再记为完成；本目录不保存瞬时 PID 或登录信息。

源码：[重置脚本](../../../scripts/reset-workspace-history.mjs)、[服务器任务入口](../../../plugins/server-management/src/host/execution/runtime.ts)、[安装](../../../plugins/install/src/index.ts)、[frame](../../../plugins/frame/src/index.ts)。
