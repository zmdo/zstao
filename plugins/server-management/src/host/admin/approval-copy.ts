import type { LocalizedText, ServerTypeView } from '../../shared/definitions.ts'
import type { PreparedPlan, ChangeSelection } from '../../shared/changes.ts'
import type { DeclaredOs } from '../../shared/operating-system-types.ts'
import type { SoftwarePolicy } from '../../shared/policies.ts'
import { enumLabel, format, localized, serverCopy, versionRequirement } from '../../shared/i18n.ts'
import type { GroupRow } from '../groups/persistence/rows.ts'
import type { AdminDeps, Input } from './model.ts'
import { AdminError } from './model.ts'
import { approvalGroups, approvalServer } from './persistence/repository.ts'

interface PlanPreview {
  id: string
  request_snapshot: { selection: ChangeSelection }
  targets: { server_snapshot: { name: string; host: string }; target_snapshot?: PreparedPlan }[]
}
interface Preview {
  before?: Input | null
  parameters?: Input
  filter?: Input
  maximum_records?: number
  new_fingerprint?: string
  old_fingerprint?: string
  phase?: string
  policy?: { archive_directory: string }
  cutoff?: string
  count?: number
}
export interface ApprovalLabels {
  groups: Pick<GroupRow, 'id' | 'name' | 'name_i18n'>[]
  types: readonly ServerTypeView[]
  software: { software_key: string; name_i18n: LocalizedText }[]
  server?: { name: string; host: string }
}

/** Resolve display names on the host; the approved identifiers and snapshots remain authoritative. */
export async function describeApproval(
  deps: Pick<AdminDeps, 'db' | 'definitions' | 'catalog'>,
  tool: string, action: string, target: string, value: unknown,
): Promise<LocalizedText> {
  const preview = value as Preview, before = preview.before ?? {}, parameters = preview.parameters ?? {}
  const selection = (before.request_snapshot as PlanPreview['request_snapshot'] | undefined)?.selection
  const ids = [...new Set([before.group_id, parameters.target_group, selection?.binding?.groupId]
    .filter((id): id is string => typeof id === 'string'))]
  const groups = ids.length ? (await approvalGroups(deps.db, ids)).rows : []
  const types = [...deps.definitions.publicCatalog(), ...groups.flatMap(group => deps.definitions.view(group).types)]
  const labels: ApprovalLabels = {
    groups, types, software: [...deps.catalog, ...types.flatMap(type => type.software)],
  }
  if (typeof preview.filter?.server_id === 'string')
    labels.server = (await approvalServer(deps.db, preview.filter.server_id)).rows[0]
  return {
    zh: approvalText('zh', tool, action, target, preview, labels),
    en: approvalText('en', tool, action, target, preview, labels),
  }
}

export function approvalText(
  language: string, tool: string, action: string, target: string, value: unknown,
  labels: ApprovalLabels = { groups: [], types: [], software: [] },
): string {
  const locale = language === 'zh' ? 'zh' : 'en', copy = serverCopy(locale).adminApproval
  const preview = value as Preview, before = preview.before ?? {}, parameters = preview.parameters ?? {}
  const join = (parts: string[]) => parts.join(locale === 'zh' ? '；' : '; ')
  const number = (value: unknown) => new Intl.NumberFormat(locale).format(Number(value))
  const text = (value: unknown) => value === null || value === undefined || value === '' ? copy.notSet : String(value)
  const date = (value: unknown, timezone = 'UTC') => new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(new Date(value as string))
  const software = (key: string, plan?: PreparedPlan) => {
    const entry = plan?.targetType?.software.find(item => item.software_key === key)
      ?? labels.software.find(item => item.software_key === key)
    return entry ? localized(entry.name_i18n, locale) : key
  }
  const group = (id: unknown) => {
    if (id === null || id === undefined) return serverCopy(locale).ui.ungrouped
    const row = labels.groups.find(group => group.id === id)
    return row ? row.name_i18n ? localized(row.name_i18n, locale) : row.name : text(id)
  }
  const type = (key: unknown) => {
    const row = labels.types.find(type => type.key === key)
    return row ? localized(row.name_i18n, locale) : text(key)
  }
  const fieldValue = (key: string, value: unknown, requested = false): string => {
    if (typeof value === 'boolean') return value ? copy.enabled : copy.disabled
    if (key === 'declared_os' && value) {
      const os = value as DeclaredOs
      return os.kind === 'custom' ? os.text : os.name
    }
    if (key === 'ssh_key_id' && value) {
      const key = requested ? before.requested_key as Input : { name: before.key_name, fingerprint: before.key_fingerprint }
      return key?.fingerprint ? `${text(key.name ?? value)} (${text(key.fingerprint)})` : text(value)
    }
    return text(value)
  }
  const change = (field: string, old: string, next: string) => format(copy.change, { field, before: old, after: next })
  const policies = (items: SoftwarePolicy[] = []) => items.length ? join(items.map(item => format(copy.policy, {
    name: software(item.software_key), restriction: versionRequirement(locale, item.restriction),
    detect: item.detect_updates ? copy.enabled : copy.disabled,
  }))) : copy.policyDefault
  const bindingChanges = (binding: ChangeSelection['binding']) => binding ? [
    `${copy.fields.group}: ${group(binding.groupId)}`,
    `${copy.fields.type}: ${type(binding.typeKey)}`,
    `${copy.fields.install_required_software}: ${binding.installMissing ? copy.enabled : copy.disabled}`,
    policies(binding.policies),
  ] : []
  const identity = { name: text(before.name ?? target), host: text(before.host) }
  switch (tool) {
    case 'platform_server_group_admin':
      switch (action) {
        case 'create': return format(copy.groupCreate, { name: text(parameters.name) })
        case 'rename': return format(copy.groupRename, { before: text(before.name), after: text(parameters.name) })
        case 'delete': {
          const members = before.members as { name: string; host: string }[]
          return [format(copy.groupDelete, { name: text(before.name), count: number(members.length) }),
            format(copy.affectedServers, { servers: join(members.map(server => `${server.name} (${server.host})`)) || copy.none }),
          ].join('\n')
        }
      }
      break
    case 'platform_server_key_admin':
      switch (action) {
        case 'create': return format(copy.keyCreate, { name: text(parameters.name) })
        case 'delete': return format(copy.keyDelete, { name: text(before.name), fingerprint: text(before.fingerprint) })
        case 'rotate': return [
          format(preview.phase === 'new' ? copy.keyRotate : copy.rotationResume, identity),
          format(copy.fingerprints, { before: text(preview.old_fingerprint ?? before.key_fingerprint), after: text(preview.new_fingerprint) }),
        ].join('\n')
      }
      break
    case 'platform_server_admin':
      switch (action) {
        case 'delete': return format(copy.serverDelete, identity)
        case 'update': {
          const patch = parameters.patch as Input ?? {}
          const changes = Object.entries(patch).filter(([key, value]) => JSON.stringify(before[key]) !== JSON.stringify(value))
          const result = format(copy.serverUpdate, { ...identity, changes: join(changes.map(([key, value]) =>
            change(enumLabel(copy.fields, key), fieldValue(key, before[key]), fieldValue(key, value, true)))) || copy.noChanges })
          return changes.some(([key]) => ['host', 'ssh_port', 'ssh_user', 'ssh_key_id'].includes(key))
            ? `${result}\n${copy.connectionCheck}` : result
        }
        case 'rebind': return [format(copy.serverRebind, { ...identity,
          changes: join([
            change(copy.fields.group, group(before.group_id), group(parameters.target_group)),
            change(copy.fields.type, type(before.type_key), type(parameters.target_type ?? before.type_key)),
            change(copy.fields.install_required_software, fieldValue('', before.install_required_software), fieldValue('', parameters.install_missing)),
          ]), policies: policies(parameters.software_policies as SoftwarePolicy[]),
        }), copy.planDraft].join('\n')
      }
      break
    case 'platform_server_upgrade_admin': {
      if (action === 'plan') return [format(copy.planCreate, { ...identity,
        versions: join(Object.entries(parameters.versions as Record<string, string>).map(([key, version]) =>
          format(copy.targetVersion, { name: software(key), version }))),
      }), copy.planDraft].join('\n')
      const plan = (value as { before: PlanPreview }).before, item = plan.targets[0]!, prepared = item.target_snapshot
      const params = { ...item.server_snapshot, plan: plan.id }
      if (action === 'cancel') return format(copy.planCancel, params)
      if (action === 'apply') {
        const changes = prepared?.changes ?? []
        const effects = changes.flatMap(item => item.effects.map(effect =>
          `${software(item.software, prepared)}: ${enumLabel(copy.effects, effect.kind)} — ${localized(effect.description, locale)}`))
        if (prepared?.risks?.major) effects.push(copy.major)
        if (prepared?.risks?.replacement || changes.some(item => item.action === 'replace')) effects.push(copy.replacement)
        if (prepared?.risks?.serviceImpact && !changes.some(item => item.effects.length)) effects.push(copy.serviceImpact)
        const timezone = text(parameters.timezone)
        return format(copy.planApply, { ...params, timezone,
          start: date(parameters.start, timezone), end: date(parameters.end, timezone),
          changes: join([...bindingChanges(plan.request_snapshot.selection.binding), ...changes.map(item => format(copy.softwareChange, {
            name: software(item.software, prepared), action: enumLabel(copy.actions, item.action),
            before: item.before.state === 'installed' ? item.before.version : item.before.state === 'missing' ? copy.none : copy.unknown,
            after: item.target?.version ?? (item.before.state === 'installed' ? item.before.version : copy.none),
          }))]) || copy.noSoftwareChanges,
          effects: join([...new Set(effects)]) || copy.noEffects,
        })
      }
      break
    }
    case 'platform_audit_admin':
      if (action === 'export') {
        const filter = preview.filter ?? {}, filters: string[] = []
        for (const key of ['from', 'to', 'server_id', 'kind', 'status', 'session_id', 'tool'] as const) {
          if (filter[key] === undefined) continue
          const value = key === 'from' || key === 'to' ? `${date(filter[key])} (UTC)`
            : key === 'server_id' && labels.server ? `${labels.server.name} (${labels.server.host})`
              : key === 'kind' ? enumLabel(copy.kinds, text(filter[key]))
                : key === 'status' ? enumLabel(copy.statuses, text(filter[key]))
                  : key === 'tool' ? enumLabel(copy.tools, text(filter[key])) : text(filter[key])
          filters.push(`${copy[key]}: ${value}`)
        }
        return format(copy.auditExport, { filters: join(filters) || copy.noFilters, limit: number(preview.maximum_records), minutes: number(10) })
      }
      if (action === 'retention') {
        if (preview.policy) return format(copy.retentionRun, {
          cutoff: date(preview.cutoff), timezone: 'UTC', count: number(preview.count), directory: preview.policy.archive_directory,
        })
        return format(parameters.enabled ? copy.retentionEnable : copy.retentionDisable, {
          days: number(parameters.days), directory: text(parameters.archive_directory),
          nextRun: date(parameters.next_run), timezone: 'UTC', limit: number(10000),
        })
      }
  }
  throw new AdminError('approval_description_unavailable')
}
