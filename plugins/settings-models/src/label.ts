/** Platform-tab text. Anything other than Chinese uses English. */
export function modelsTabLabel(active: string): string {
  return active === 'zh' ? '模型' : 'Models'
}
