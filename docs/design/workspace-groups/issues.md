# 工作区组问题清单

状态：保留修复前的问题与原因记录，实施结果在对应小节补充；整体方案和验收范围见 `solution.md`。对应实现是 `@smp/console-workspace-groups`。运行版本是 `dsh` `0.2.1-alpha.5`。官方界面在 `tmp/deepseek-harness`，这里只引用，不修改。

## 1. 切换工作区组时弹出「搜索会话名称」

现象：切换工作区组后，侧栏标题右侧的搜索框会展开，占位文字是「搜索会话名称」。它应该只在点击搜索按钮时展开。

原因：搜索框的展开状态挂在工作区浏览器组件上，搜索次数挂在更外层、不会随组件拆掉的快捷键状态上。关掉搜索只把展开状态设回关闭，不把次数清零。

- 展开只有两条路。点搜索区域会把展开状态设为真；搜索按钮和快捷键 `session.search` 会把 `searchRequest` 加一。见 `tmp/deepseek-harness/packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx` 的搜索点击，以及同目录 `shortcuts.ts` 里的 `search()`。
- 浏览器每次挂载都会跑一段效果：只要 `searchRequest` 不是 0，就再次展开搜索并聚焦输入框。次数从 0 变成 1 之后，以后每次重新挂载都会再展开。
- 切换工作区组会换掉主会话。会话头槽 `conversation.header` 的范围是 `session-maybe`（`tmp/deepseek-harness/packages/client/ui-conversation/src/client/apply.ts`）。头槽里的壳会重建 `.smp-chat-side`，工作区浏览器通过 portal 挂在这个节点上，于是跟着重新挂载。
- 页面上核对过：这一页还没开过搜索时，切换组不会弹出搜索。开过一次并关掉之后，再切换组，侧栏节点被换掉，搜索框重新展开。展开后，本插件用 `:has([class*="sectionLabelHidden"])` 把工作区组下拉框藏起来，所以搜索一开，组切换也不见了。

## 2. 切换工作区组不记得上次打开的会话

现象：切到另一个工作区组，再切回来，打开的不是离开前那条会话，而是一条新的空白会话。

原因：本组只记住工作区，切换时固定去打开那个工作区里的空白会话。

- 关注表 `workspace_group_focus` 只有 `group_id` 和 `workspace_id`，没有会话编号。见 `plugins/database/migrations/0010_workspace_groups.sql`。
- `rememberFocus` 在主会话变化时，只把该会话所属的工作区编号提交上去。见 `plugins/workspace-groups/src/client.tsx`。
- `enter` 用这个工作区编号调用 `uiWorkspace.openWorkspace`。`openWorkspace` 的第三个参数默认是空对象，于是走进 `connectBlank`，再走进 `createInWorkspace`。那里只复用 `summary.blank` 为真、且目录与该工作区一致的会话；已经有消息的会话被跳过。没有空白会话时就新建一条。见 `tmp/deepseek-harness/packages/client/ui-workspace/src/client/navigation.ts` 的 `connectBlank` 与 `createInWorkspace`。
- 这和现在的设计第 7 节一致：进入是打开该工作区里已有的空白会话，没有就新建。所以这不是切换时把会话编号弄丢，而是从一开始就没有记会话编号。

会话界面里的工作区芯片选中另一项时，走的也是 `openWorkspace`（`tmp/deepseek-harness/packages/client/ui-conversation/src/client/apply.ts` 的 `selectWorkspace`），同样不会打开目标工作区里上次那条会话。

## 3. 不同工作区组不能使用同一个工作区名

现象：在工作区组 A 里把一个工作区改成某个名字之后，工作区组 B 里不能再把别的工作区改成同一个名字。界面提示「已存在名为“…”的工作区。」

原因：重名检查对着全部工作区，不看工作区组。侧栏把别的组藏起来，并没有把它们从检查名单里拿掉。

- 浏览器里，确认按钮在 `workspaces.some(...)` 发现另一个工作区的 `title` 相同就停用，并显示 `conflict.named`。`workspaces` 是完整快照。见 `tmp/deepseek-harness/packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx` 的 `renameDuplicate`。
- 宿主再查一遍。`WorkspaceCommands.rename` 在注册表的 `list()` 里发现同名就抛 `workspace/name-conflict`，名单同样是全部工作区。见 `tmp/dsh-cli/node_modules/@deepseek-ai/dsh-api-workspace-controller/lib/index.js`。
- 本插件只给不属于当前组的段落加上 `hidden`。重名比较读的是快照里的标题，不读这段是否隐藏。

创建工作区时没有这道同名限制。同名冲突只发生在重命名。

## 4. 一个目录不能同时成为两个组的工作区

现象：在工作区组 A 里打开某个目录作为工作区之后，在工作区组 B 里再选同一个目录，不能成为 B 的工作区。

原因有两层，两层都把「一个目录」收成一条工作区。

- Harness 用目录的真实路径当作工作区身份。同一路径再创建，返回原来的那条，不新建。宿主 `WorkspaceCommands.create` 先 `resolveByPath`，有结果就返回 `created: false`。路径说明写在 `tmp/dsh-cli/node_modules/@deepseek-ai/dsh-workspace/lib/index.js` 开头：唯一性是规范化路径的字符串相等。
- 本插件规定一个工作区只属于一个组。`claimWorkspace` 发现它已经属于别的组时返回「这个目录已经属于「…」」，不改归属。见 `plugins/workspace-groups/src/rules.ts`。
- 侧栏添加之后，`claimAll` 只给还没有归属行的工作区补当前组。已经有归属的请求结果被丢掉，所以拒绝原因不会出现在界面上。该工作区的段落在 B 里被 `hidden` 藏住，因为成员行仍指向 A。

这和设计第 6 节「路径已经属于别的组时，保持原组」一致。组 B 看不到它，是因为没有第二条工作区记录，也没有把原记录挪到 B。

## 5. 会话里的工作区下拉框能选到其他组

2026-10-19 实施结果：已保留官方 `WorkspacePicker` / `WorkspacePickFlow` 的组件与菜单样式，通过适配登记提供当前会话所属组的工作区投影；不再把全局列表直接交给选择器。鼠标与键盘读取同一份项目数据，选中后关闭原菜单，再调用组内工作区导航；添加目录调用带固定目标组的本项目接口。未归属、归属未就绪、工作区消失、旧菜单和跨组选择均有校验。官方目录流通过独立子槽别名复用，避免重复声明原子槽。

验证：工作区组测试共 40 项通过，其中新增 9 项覆盖选择器范围、目标组固定、旧菜单、重复提交及原槽声明的重载和卸载。浏览器分别验证普通组与临时组的项目范围、鼠标选择、键盘 Enter 选择及选择后的导航。测试前已再次清空该实例的会话、工作区与归属历史。系统原生目录窗口的最终确认未做自动化操作；添加归属校验与目标组固定通过控制逻辑和宿主集成测试验证。

以下为修复前的现象与原因：

现象：在工作区组 A 的会话里，输入区旁边的工作区芯片能列出并选中其他组的工作区。

原因：这个菜单用的是完整工作区快照，没有任何组过滤。

- 菜单在 `WorkspacePickFlow`。有工作区时，每一项来自 `workspaceSnapshot.items`，标签用 `workspaceDisplayTitle`。见 `tmp/deepseek-harness/packages/client/ui-workspace/src/client/WorkspacePicker.tsx`。
- 会话空态把这个菜单挂在 `conversation.hero.workspace`。选中后调用 `selectWorkspace`，也就是第 2 条的 `openWorkspace`。见 `tmp/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx` 的 `onPick`，以及同包 `apply.ts` 里的 `selectWorkspace`。
- 两个组的默认工作区存储标题都是 `default-workspace`，菜单里都会显示成「默认工作区」。名单不过滤时，这两项靠名字分不开。
- 侧栏当前组不会跟着这次选择改。`GroupStore` 只在第一次拿到快照时用会话所属的组设定侧栏；之后侧栏停在人手选的那一组。于是可能出现：会话已经进了另一组的工作区，侧栏仍显示原来的组，并把刚选中的工作区藏起来。

「创建工作区」核对结果：

- 对话框每次打开都从用户主目录列起，调用方不能传入起始目录。见 `tmp/deepseek-harness/packages/client/ui-directory-picker-browse/src/client/DirectoryBrowser.tsx`：「Every open starts fresh at the Host home directory」。所以它不会先打开当前组的绑定目录。这和设计里已经记下的限制相同。
- 选中的路径如果已经是工作区，宿主返回原来的那条（`created: false`），然后 `onPick` 打开它。它不会变成当前组的新工作区，归属检查的拒绝文字也不会显示。这就是第 4 条在这个菜单里的表现。
- 选中的路径如果还不是工作区，宿主用目录名作为标题新建一条。浏览器随后把「还没有归属」的工作区记入侧栏当前选中的组（`claimAll` 用的是 `store.selectedId()`），不是这条会话所属的组。侧栏组和会话组不一致时，新工作区会进到侧栏那一组。
- 新建不检查标题是否与别的组重复。和第 3 条不同，创建本身不会因为同名失败。

## 6. 「未分组」在每个工作区组里都出现

现象：没有挂进任何工作区的会话，会收在侧栏的「未分组」下面。切换工作区组时，这一栏和里面的会话仍然都在。期望是：一条未分组会话只出现在它对应的那一个工作区组的「未分组」里。

原因：官方只有一个全局的「未分组」，本插件的隐藏条件又把这一栏排除在外。会话上没有工作区组编号，现有的归属表也补不上这个对应关系。

- 分组在 `groupByWorkspace`。每个已登记工作区的 `sessionIds` 先被记入账。剩下的会话，只要还看得见，就全部放进同一个桶。这个桶的键是 `UNGROUPED_KEY`，值是空字符串；它没有 `workspaceId`，也没有目录。见 `tmp/deepseek-harness/packages/client/ui-workspace/src/client/tree.ts`。
- 行上的标记因此是 `data-row-key="workspace:"`。本插件只在解析出的工作区编号非空、且不属于当前组时把整段隐藏。空编号不隐藏。见 `plugins/workspace-groups/src/client.tsx` 的 `paint`。所以每个组都会画出同一栏「未分组」。
- 这一栏是一整段，里面是所有未入账会话。按段隐藏只能整栏留下或整栏去掉，不能让 A 组的未分组会话留在 A、B 组的留在 B。要按组显示，得按会话拆开，而不是只藏这一段。
- 一条会话进入这个桶，是因为它不在任何当前工作区的 `sessionIds` 里。工作区从列表移除后，文件夹和会话还在，会话改到「未分组」下。见 `tmp/deepseek-harness/packages/client/ui-workspace/src/client/locales.ts` 的 `delete.desc`。会话头上留下的是 `cwd`，没有组编号。
- 归属表 `workspace_group_members` 只存 `workspace_id` 和 `group_id`，不存目录。工作区记录删除之后，这条成员还在，但没法用目录把会话的 `cwd` 对回去。组的绑定目录只能认出落在该目录里面的 `cwd`。绑定目录以外的工作区本来就允许存在；删掉之后，会话的 `cwd` 既对不上任何现存工作区，也不在任何一个绑定目录下。

当前库里的情况与此相符：10 条会话里有 3 条不在任何现存工作区的 `sessionIds` 中，目录是 `~/Projects/somaor-vla`（两条）和 `~/Projects/somaor-service`。这两个目录不是现存工作区，也不在 `~/.smp/workspaces` 或 `~/.smp/sample-workspaces` 下面。另有两条归属指向已经不在工作区表里的编号，一条在普通组，一条在临时组，行上没有目录，对不上这 3 条会话。所以侧栏无法判断它们该进哪一组，只能跟着那一个全局「未分组」在每一组里都显示。
