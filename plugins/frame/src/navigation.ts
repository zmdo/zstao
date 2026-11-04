/** Only console-owned hashes participate in console navigation. */
export function consolePageFromHash(hash: string): string | undefined {
  const page = new URLSearchParams(hash.replace(/^#/, '')).get('console')
  return page && /^[a-z][a-z0-9-]{0,100}$/.test(page) ? page : undefined
}
export function consolePageHash(hash: string, page: string): string {
  if (consolePageFromHash(hash) === page) return hash
  return `#${new URLSearchParams({ console: page })}`
}
