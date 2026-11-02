import { registerServerPanel, registerSettingsSection, type ExtensionSlotOwner, type SlotService } from '@smp/console-server-management/client-api'

const owner = '@smp/console-server-extension-fixture'

function DatabasePanel(props: ExtensionSlotOwner) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>数据库管理</h2>
      </div>
      <div className="panel-body">
        <p>{props.server.name} · {props.server.type_key}</p>
        <p>数据库扩展示例面板已加载。</p>
      </div>
    </section>
  )
}

function DatabaseSettings(props: ExtensionSlotOwner) {
  const value = (props.settings?.value ?? {}) as { collect?: boolean }
  return (
    <label className="smp-server-auto-install">
      <input
        type="checkbox"
        checked={value.collect === true}
        onChange={(event) => props.settings?.onChange({ collect: event.target.checked })}
      />{' '}
      采集数据库状态
    </label>
  )
}

function DatabaseExecution(props: ExtensionSlotOwner) {
  const value = (props.settings?.value ?? {}) as { mode?: string }
  return (
    <label className="field">
      执行模式
      <select
        value={value.mode ?? 'observe'}
        onChange={(event) => props.settings?.onChange({ mode: event.target.value })}
      >
        <option value="observe">仅观察</option>
        <option value="enforce">执行前复核</option>
      </select>
    </label>
  )
}

interface ClientCtx {
  slots: SlotService
}

export const inject = ['slots']

export function apply(ctx: ClientCtx): void {
  registerServerPanel(ctx, `${owner}/database-panel`, DatabasePanel)
  registerSettingsSection(ctx, `${owner}/database-settings`, DatabaseSettings)
  registerSettingsSection(ctx, `${owner}/database-execution`, DatabaseExecution)
}
