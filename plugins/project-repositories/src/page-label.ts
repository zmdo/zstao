export interface PageLabel {
  (): string
  group?: string
  groupLabel?: string
  placement?: 'nav' | 'footer'
  navigation?: 'tabs' | 'sidebar'
  icon?: string
}

export function pageLabel(
  text: () => string,
  place: {
    group: string
    groupLabel: string
    placement?: 'nav' | 'footer'
    navigation?: 'tabs' | 'sidebar'
    icon?: string
  },
): PageLabel {
  const label: PageLabel = () => text()
  label.group = place.group
  label.groupLabel = place.groupLabel
  if (place.placement !== undefined) label.placement = place.placement
  if (place.navigation !== undefined) label.navigation = place.navigation
  if (place.icon !== undefined) label.icon = place.icon
  return label
}
