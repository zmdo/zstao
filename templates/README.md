# 模板

模板只含占位符，不含真实内容。新建文件用脚本填充，不要手工复制。

| 模板 | 用于 | 新建方式 |
| --- | --- | --- |
| [task.md](task.md) | 常规工作项 | `powershell -File scripts/New-WorkItem.ps1 -Title "..."` |
| [decision.md](decision.md) | 需要留痕的决策 | `powershell -File scripts/New-WorkItem.ps1 -Title "..." -Type decision` |

## 约定

- 占位符统一写成 `{{变量名}}`。
- 模板里的章节顺序就是填写顺序；用不到的章节删掉，不要留空。
- 修改模板前，先在 `work/` 里记一笔原因。
