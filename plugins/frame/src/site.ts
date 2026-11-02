export const DEFAULT_TITLE = 'Cyber Evolving System'
export const TITLE_LIMIT = 80
export const ICON_LIMIT = 256 * 1024

export interface StoredSite {
  title: string
  icon: string
}

export interface SiteView {
  title: string
  icon: string
}

export type SiteDraft =
  | { ok: true; title: string; icon: string }
  | { ok: false; error: 'title' | 'icon' }

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: StoredSite[] }>
}

const ICON_DATA = /^data:image\/(png|jpeg|webp|svg\+xml)(?:;charset=utf-8)?;base64,([A-Za-z0-9+/]+={0,2})$/

/** What the page shows. An empty stored title is the control system name. */
export function siteView(stored: StoredSite | undefined): SiteView {
  const title = stored?.title.trim() ?? ''
  return {
    title: title === '' ? DEFAULT_TITLE : title,
    icon: stored?.icon ?? '',
  }
}

function iconBytes(value: string): number | undefined {
  const match = ICON_DATA.exec(value)
  if (match === null) return undefined
  const payload = match[2] ?? ''
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return Math.floor(payload.length * 3 / 4) - padding
}

/** Empty title and icon mean the control-system defaults. The stored title omits that default. */
export function siteDraft(input: { title: string; icon: string }): SiteDraft {
  const title = input.title.trim()
  if (title.length > TITLE_LIMIT) return { ok: false, error: 'title' }
  const icon = input.icon.trim()
  if (icon !== '') {
    const bytes = iconBytes(icon)
    if (bytes === undefined || bytes < 1 || bytes > ICON_LIMIT) return { ok: false, error: 'icon' }
  }
  return { ok: true, title: title === DEFAULT_TITLE ? '' : title, icon }
}

export async function loadSite(db: Queryable): Promise<StoredSite> {
  const result = await db.query('select title, icon from console_site where id = true')
  const row = result.rows[0]
  return { title: row?.title ?? '', icon: row?.icon ?? '' }
}

export async function saveSite(db: Queryable, title: string, icon: string): Promise<void> {
  await db.query(
    `insert into console_site (id, title, icon) values (true, $1, $2)
     on conflict (id) do update set title = excluded.title, icon = excluded.icon`,
    [title, icon],
  )
}
