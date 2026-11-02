export interface PageLabel {
  (): string
  group?: string
  groupLabel?: string
  placement?: 'nav' | 'footer'
}

/** Group fields ride on the label. The slot ledger keeps `label` and drops other register fields. */
export function pageLabel(text: string | (() => string), place: { group: string; groupLabel: string; placement: 'footer' }): PageLabel {
  const label: PageLabel = () => typeof text === 'function' ? text() : text
  label.group = place.group
  label.groupLabel = place.groupLabel
  label.placement = place.placement
  return label
}
