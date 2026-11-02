import en from '../../locale/en.json' with { type: 'json' }
import zh from '../../locale/zh.json' with { type: 'json' }
import type { LocalizedText } from './contracts/common.ts'
import { ServerError, parseError, type ErrorCode, type MessageParams } from './errors.ts'
import type { StatusReason } from './server-status.ts'
import type { VersionRule } from './versions.ts'
export interface LocaleFace {
  getSnapshot(): { active: string }
  subscribe(listener: () => void): () => void
}

export function serverCopy(active: string) {
  return active === 'zh' ? zh : en
}

export function format(template: string, params: MessageParams): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => String(params[key] ?? match))
}

export function errorText(active: string, code: ErrorCode, params: MessageParams = {}): string {
  const message = format(serverCopy(active).errors[code], params)
  return typeof params.detail === 'string' && params.detail !== '' ? `${message} ${params.detail}` : message
}

export function errorPayload(error: ServerError) {
  return { code: error.code, params: error.params, detail: errorText('zh', error.code, error.params) }
}

export function errorDetail(error: unknown, fallback = ''): string {
  return error instanceof ServerError
    ? errorText('zh', error.code, error.params)
    : error instanceof Error
      ? error.message
      : fallback
}

export function localized(text: LocalizedText, active: string): string {
  return active === 'zh' ? text.zh : text.en
}

export function formatDate(value: string | null, active: string): string {
  if (value === null || value === '') return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(active === 'zh' ? 'zh-CN' : 'en-US')
}

export function enumLabel(labels: Readonly<Record<string, string>>, value: string): string {
  return Object.hasOwn(labels, value) ? labels[value]! : value
}

export function statusReason(active: string, reason: StatusReason): string {
  const parameters = { ...reason.parameters }
  if (parameters.software)
    parameters.software = parameters[active === 'zh' ? 'softwareZh' : 'softwareEn'] ?? parameters.software
  return format(serverCopy(active).statusReasons[reason.code], parameters).trim()
}

export function versionRequirement(active: string, rule?: VersionRule): string {
  const copy = serverCopy(active).ui
  if (!rule) return copy.versionUnspecified
  switch (rule.kind) {
    case 'any':
      return copy.versionAny
    case 'exact':
      return format(copy.versionExact, { version: rule.version })
    case 'series':
      return format(copy.versionSeries, { version: rule.prefix })
    case 'minimum':
      return format(copy.versionMinimum, { version: rule.version })
    case 'range': {
      // A partial upper bound includes its whole version series.
      const maximum = /^\d+(?:\.\d+)?$/.test(rule.maximum)
        ? rule.maximum + '.x'.repeat(3 - rule.maximum.split('.').length)
        : rule.maximum
      return format(copy.versionRange, { minimum: rule.minimum, maximum })
    }
  }
  return assertNever(rule)
}

function assertNever(value: never): never {
  throw new Error(`Unexpected version rule: ${JSON.stringify(value)}`)
}

export function componentText(
  active: string,
  component: {
    id: string
    name: string
    summary: string
    name_i18n?: LocalizedText
    summary_i18n?: LocalizedText
  },
) {
  if (component.name_i18n !== undefined)
    return {
      name: localized(component.name_i18n, active),
      summary:
        component.summary_i18n === undefined ? component.summary : localized(component.summary_i18n, active),
    }
  // Legacy component IDs remain translatable in persisted task errors.
  const labels = serverCopy(active).components
  return Object.hasOwn(labels, component.id) ? labels[component.id as keyof typeof labels] : component
}

export function componentName(active: string, id: string): string {
  return componentText(active, { id, name: id, summary: '' }).name
}

export function groupName(active: string, group: { name: string; name_i18n?: LocalizedText | null }): string {
  return group.name_i18n == null ? group.name : localized(group.name_i18n, active)
}

export function displayError(active: string, error: ServerError | null): string {
  if (error === null) return ''
  const params = { ...error.params }
  if (error.code === 'component_dependency') {
    if (typeof params.component === 'string') params.component = componentName(active, params.component)
    if (typeof params.dependency === 'string') params.dependency = componentName(active, params.dependency)
  }
  return errorText(active, error.code, params)
}

export function displayJobError(active: string, error: unknown): string {
  return typeof error === 'string' ? error : displayError(active, parseError(error))
}
