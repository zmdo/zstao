# 脚本

只放能独立运行、可重复执行的小工具。要求：Windows PowerShell 5.1+ 或 PowerShell 7+，无交互，失败返回非 0 退出码。

下面的示例用 `powershell`；装了 PowerShell 7 的话，把 `powershell` 换成 `pwsh` 即可。

## New-WorkItem.ps1

从模板新建工作项。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `-Title` | 是 | 工作项标题，用于生成文件名 |
| `-Type` | 否 | `task`（默认）或 `decision` |
| `-Date` | 否 | 归属日期，默认今天 |

```powershell
powershell -File scripts/New-WorkItem.ps1 -Title "把子代理评审接进日常流程"
powershell -File scripts/New-WorkItem.ps1 -Title "采用 trunk-based 分支模型" -Type decision
```

输出新建文件的相对路径。同名文件已存在时自动追加序号，不会覆盖已有内容。

## 约定

- 不写死绝对路径，一律从 `$PSScriptRoot` 推导仓库根目录。
- 参数带 `[CmdletBinding()]` 与注释式帮助。
- 不在脚本里保存任何凭据。
- 新增脚本后，在本文件补一段用法说明。
