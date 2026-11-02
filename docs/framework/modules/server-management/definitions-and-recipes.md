# 类型、系统分组、软件与配方

核对基线：`ces/develop`，`f2b8d86`，2026-10-20。当前运行契约为 `DefinitionBundle.contractVersion: 2`，以源码导出为准，不能复制旧设计附件后直接调用。

## 当前公开注册

宿主注入 `serverManagement`，使用 `registerDefinitions()`。定义包包含 owner，以及可选的软件、配方、类型、系统组；owner 必须与调用插件的 Loader／Cordis 身份一致，不能冒用 `builtin`。

注册返回 `{ ready: Promise<void>, dispose(): Promise<void> }`；公开服务会自动将注册绑定到调用插件的 effect，插件也可调用 dispose 提前撤回。注册时快照定义、读取脚本、验证引用和依赖，在系统组持久化完成后才发布；失败不发布半份定义。

卸载先撤回新租用，再等待直接／间接使用该提供者的任务释放。系统组和名称缓存仍可展示，但缓存不能让新任务绕过提供者不可用状态。

| 定义 | 当前意义 |
| --- | --- |
| `software` | 稳定软件身份、双语名称、版本适配器 |
| `recipes` | 支持 OS、软件依赖、检测和候选／解析／变更脚本 |
| `types` | 支持 OS 与必要软件要求，含版本范围和配方优先序 |
| `groups` | 不可删除的系统服务器组、类型列表和默认类型／按 OS 默认值 |

完整键为 `builtin/<key>` 或 `<插件包名>/<本地键>`。类型、软件和配方身份不应依赖显示名称；软件不以分组为身份。

用户分组、未分组和系统组省略 `types` 时使用公共目录：内置空置和插件贡献的 `publicTypes`（包括正式容器插件）。系统组显式 `types` 完整替换且不得为空；公共类型使用完整类型键，登记默认仍为空置。

## 最小系统组示例

```ts
export const name = '@example/compute'
export const inject = ['serverManagement']

export async function apply(ctx) {
  const registration = ctx.serverManagement.registerDefinitions({
    contractVersion: 2,
    owner: '@example/compute',
    groups: [{ key: 'compute', name: { zh: '计算节点', en: 'Compute nodes' } }],
  })
  await registration.ready
}
```

这是 API 形态示例，完整包还需要 manifest、正式类型导入和 bundle；组默认继承当前公共类型目录。不能把工作区组的 `register()` 与这里的系统服务器组定义混用。

## OS 范围

登记目录包含 Windows Server、Ubuntu、Debian、RHEL、Rocky、AlmaLinux 等系列及“其他”输入。可登记不等于可安装。

当前容器插件 apt 配方允许 Ubuntu 22.04／24.04、Debian 12／13 的 x86_64／aarch64。Windows 可登记为空置；其他系统或文本不能被模糊匹配成 Ubuntu 来授权安装。声明系统与 SSH 探测不符时阻止软件变更。

当前代码显式拒绝自定义 `operatingSystems` 贡献和 PowerShell 软件配方；接口类型中出现字段不表示执行器已支持。软件解析返回非空 `additionalRequirements` 也会被拒绝，递归新增软件身份不是已实现能力。

## 脚本协议与范围

脚本以插件提供的绝对文件路径注册，加载时读取并冻结正文，计算修订。页面不能上传任意命令或脚本路径。输入使用 stdin JSON，stdout 返回对应操作的单个结构化 JSON，宿主校验大小、操作和结果。

操作包括 `detect`、`list-candidates`、`resolve`、`execute`、`verify`、`recover`。声明变更能力需提供完整候选、解析和变更／验证／恢复链，不能只给 install 脚本就绕开计划。

版本规则：`any`、完整版本 `exact`、主／次版本 `series`、`minimum`、含端点 `range`。默认适配器只接受稳定三段产品版本；`27`／`27.3` 表示系列，`27.3.1` 锁定单一版本。用户范围只能进一步收紧类型要求。

产品版本和发行包版本分开保存。例如 Compose 的发行修订不能用任意字符串前缀比对；计划冻结精确包、依赖、来源和校验值，执行与验证再次核对。

## 当前 Docker／Compose

仍由核心 `builtinCatalog()`／`builtinTypes()` 和 apt 脚本提供，不是独立插件。只使用目标机已配置的软件源，不自动添加源、更新整机或修改用户组。

远端依赖 Python 3、apt 和 root／既有无交互 sudo。只读 Docker 检查可使用已具备的 sudo 权限；没有权限时报告真实失败，不改 socket 权限。容器清单同轮固定 Docker 上下文，不能前半段普通用户、后半段失败后偷偷切另一套上下文。

源码：[契约](../../../../plugins/server-management/src/shared/contracts/definitions.ts)、[注册服务](../../../../plugins/server-management/src/host/definitions/service.ts)、[注册器](../../../../plugins/server-management/src/host/definitions/registry.ts)、[能力校验](../../../../plugins/server-management/src/host/definitions/validation.ts)、[OS](../../../../plugins/server-management/src/shared/operating-systems.ts)、[脚本协议](../../../../plugins/server-management/src/host/recipes/protocol.ts)、[版本规则](../../../../plugins/server-management/src/shared/versions.ts)。

2026-10-21 更新：插件接入的公共包入口、配置契约修订与巡检生命周期见[扩展接入](extension-api.md)。
