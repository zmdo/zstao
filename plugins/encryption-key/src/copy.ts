/** Data tab text. Anything other than Chinese uses English. */
export function dataCopy(active: string) {
  if (active === 'zh') {
    return {
      title: '加密配置',
      key: '加密密钥',
      show: '显示',
      hide: '隐藏',
      generate: '生成',
      save: '保存',
      saved: '已保存',
      warning: '更换后，已经用旧密钥加密的内容解不开。',
      loadFailed: '密钥没有读到',
      saveFailed: '没有保存',
    }
  }
  return {
    title: 'Encryption',
    key: 'Encryption key',
    show: 'Show',
    hide: 'Hide',
    generate: 'Generate',
    save: 'Save',
    saved: 'Saved',
    warning: 'Text already encrypted with the previous key cannot be opened.',
    loadFailed: 'The key could not be read',
    saveFailed: 'Not saved',
  }
}

export function dataTabLabel(active: string): string {
  return active === 'zh' ? '数据' : 'Data'
}
