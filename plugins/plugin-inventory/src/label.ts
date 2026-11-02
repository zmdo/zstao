/** Platform-tab text. Anything other than Chinese uses English. */
export function pluginsTabLabel(active: string): string {
  return active === 'zh' ? '插件' : 'Plugins'
}
