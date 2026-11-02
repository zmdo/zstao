import type { GroupLabel } from './contract.ts'

/** The extension only supplies the group switch; native controls keep dsh's locale. */
export function groupCopy(active: string) {
  return active === 'zh'
    ? { group: '工作区组', general: '默认组', unassigned: '未归属' }
    : { group: 'Workspace group', general: 'Default Group', unassigned: 'Unassigned' }
}

/** Labels supplied by a plugin remain literal unless it supplies translations. */
export function localizedGroupLabel(group: GroupLabel, active: string): string {
  return group.labelI18n?.[active === 'zh' ? 'zh' : 'en'] ?? group.label
}
