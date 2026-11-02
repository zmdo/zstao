export type LocalizedText = Readonly<{ zh: string; en: string }>

export type DefinitionKey = string // builtin/<key> 或 <插件包名>/<局部键>

export type Revision = string // 宿主计算的内容摘要，不能由页面或插件自报代替

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json }
