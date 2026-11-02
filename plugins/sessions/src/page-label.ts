export interface PageLabel {
  (): string
  group?: string
  groupLabel?: string
}

/** Group fields ride on the label. The slot ledger keeps `label` and drops other register fields. */
export function pageLabel(text: () => string, place: { group: string; groupLabel: string }): PageLabel {
  const label: PageLabel = () => text()
  label.group = place.group
  label.groupLabel = place.groupLabel
  return label
}
