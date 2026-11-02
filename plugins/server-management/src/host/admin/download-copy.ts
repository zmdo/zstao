import { format, serverCopy } from '../../shared/i18n.ts'

export interface LocaleSettingsReader {
  describe(options: { redactSecrets: boolean }): { ns: string; value: unknown }[]
}

export function localePreference(settings: LocaleSettingsReader | undefined): string | undefined {
  const value = settings?.describe({ redactSecrets: true }).find(item => item.ns === 'locale')?.value
  if (!value || typeof value !== 'object') return undefined
  const preference = (value as { preference?: unknown }).preference
  return typeof preference === 'string' ? preference : undefined
}

export function downloadLocale(preference: string | undefined, acceptLanguage = ''): 'zh' | 'en' {
  const language = (tag: string) => tag.toLowerCase().split('-')[0]
  if (preference) return language(preference) === 'zh' ? 'zh' : 'en'
  const requested = acceptLanguage.split(',').map(part => {
    const [tag = '', ...parameters] = part.trim().split(';')
    const quality = parameters.find(item => item.trim().startsWith('q='))
    return { tag: language(tag), quality: quality === undefined ? 1 : Number(quality.trim().slice(2)) }
  }).filter(item => item.quality > 0 && item.quality <= 1).sort((a, b) => b.quality - a.quality)
  return requested.find(item => item.tag === 'zh' || item.tag === 'en')?.tag === 'zh' ? 'zh' : 'en'
}

function escape(value: string) {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export function keyDownloadPage(locale: 'zh' | 'en', key: { name: string; fingerprint: string; servers?: { name: string; host: string }[] }, token: string, nonce: string): string {
  const copy = serverCopy(locale).adminApproval
  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(copy.downloadTitle)}</title>
<style nonce="${escape(nonce)}">:root{color-scheme:light dark}body{font:16px/1.7 system-ui,sans-serif;margin:0;padding:32px}main{max-width:640px;margin:8vh auto}h1{font-size:24px}p{overflow-wrap:anywhere}form{display:flex;align-items:center;gap:24px;margin-top:32px}button{font:inherit;padding:8px 16px;cursor:pointer}a{color:inherit}</style></head>
<body><main><h1>${escape(copy.downloadTitle)}</h1><p>${escape(format(copy.downloadBody, { name: key.name, fingerprint: key.fingerprint }))}</p>
<p>${escape(format(copy.referencedServers, { servers: key.servers?.map(server => `${server.name} (${server.host})`).join(locale === 'zh' ? '；' : '; ') || copy.none }))}</p>
<form method="post"><input type="hidden" name="token" value="${escape(token)}"><button type="submit">${escape(copy.downloadConfirm)}</button><a href="/">${escape(copy.downloadCancel)}</a></form>
</main></body></html>`
}
