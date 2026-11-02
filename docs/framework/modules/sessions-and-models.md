# 会话、档案与模型设置

核对基线：`ces/develop`，`f2b8d86`，2026-10-20。

## 会话持久化

`session-persistence` 实现 Harness 的 `SessionPersistence`，把会话 header、revision、事件数量和按序事件存入 `console_session`／`console_session_event`。

通过 `session/event` 接收实时事件，`WriterQueue` 排序写入，`session/flush` 排空，`session/disposed` 释放句柄；插件退出时等待所有写句柄和日志关闭。bundle patch 禁用原 JSONL backend，避免重复服务与双写。

这里存的是会话 JSON 数据，不是把整个会话正文用 `secrets` 自动加密。Fernet 服务只保护显式调用它的字段。

## 工作区登记

`workspace-storage` 将宿主 storage 的 workspace 域映射到 PostgreSQL KV 后端。归档／置顶、工作区与会话的关联通过宿主 registry／storage 契约保持；工作区组只增加归属层，不替代整个 registry。

旧 JSON 导入仅在 `console_storage_unit` 中没有该 unit 的版本记录时尝试；仅清空其 record／global 数据而保留 unit 行，不会触发重导入。发生“清了数据库但旧工作区又出现”时先区分清理范围，再检查导入源、宿主内存和客户端状态，见[存储专题](../data/storage-and-migrations.md)。

## 档案页面

位于 Harness 的“档案”页面，数据来自客户端会话目录和工作区列表；按标题或会话 ID、日期、归档状态和工作区筛选，在客户端分页，并展示当前工作区组名称。

打开未归档会话走宿主页面动作；恢复归档走 workspace API。删除是专门的宿主路由 `POST /console-api/sessions/delete`：先校验归档／运行状态，释放仍存在的会话和代理，再删事件与 header，解除工作区关联并清归档标记。没有归档的会话不能直接走删除。

这不是 SQL 全文检索。工作区组的消息搜索另经 sessionQuery 对当前组的 user／assistant 消息搜索，不要把两者接口和搜索范围混在一起。

## 模型与凭据

模型页面通过宿主 remote llm/settings/credentials 管理 Harness 的可配置模型服务。`settings-models` 宿主监听设置、提供者和 credential reference 变化，排队同步到 `console_model_profiles`。

该表保存 provider、设置路径、配置镜像、引用、可解析凭据的密文和 revision。权威来源仍是 Harness；直接修改镜像表不是受支持的模型配置入口，下次同步可被覆盖。

同步函数取得连接并在 finally 释放；`store.ts` 的 `replaceModelProfiles()` 自行执行 BEGIN／COMMIT／ROLLBACK。其旧注释称事务由调用方持有，与函数体不一致；交接以实际 SQL 为准，不能把它当作服务器管理中不拥有事务的 repository。

当前同步 effect 卸载会停止后续排队和监听，但清理函数没有显式等待已经进入的 `syncModels()`。这是静态核对到的生命周期边界，不能据此承诺所有进行中同步在卸载返回前都已完成；进一步改造需要专门验证。

## Harness 设置与插件清单

`harness-settings` 在平台设置内承载宿主的 `settings.section` 与通用子项，宿主 `apply` 为空。`plugin-inventory` 读取 Harness 全局 Loader inventory，展示状态、元数据、预设归属和分页，不提供启停写接口。

“已安装／包能解析”“条目 enabled”“fiber active”“被某预设使用”是不同维度，排查时不能只看一列。

源码：[会话宿主](../../../plugins/session-persistence/src/index.ts)、[KV 后端](../../../plugins/workspace-storage/src/backend.ts)、[档案](../../../plugins/sessions/src/pages/ArchivePage.tsx)、[删除流程](../../../plugins/sessions/src/remove.ts)、[模型同步](../../../plugins/settings-models/src/index.ts)、[模型镜像](../../../plugins/settings-models/src/store.ts)、[插件视图投影](../../../plugins/plugin-inventory/src/rows.ts)。
