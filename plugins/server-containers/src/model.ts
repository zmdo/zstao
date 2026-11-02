export type Container = {
  container_id: string
  name: string
  image: string
  status: string
  ports: string
}

export type ContainerSnapshot = {
  rows: Container[]
  status: 'succeeded' | 'failed' | null
  checked_at: string | null
  last_success_at: string | null
  error: { params?: { detail?: string } } | null
}

export function parseContainers(raw: string): { containers: Container[] } {
  const ids = new Set<string>()
  const containers = raw.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const value: unknown = JSON.parse(line)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid container record')
    const row = value as Record<string, unknown>
    if (typeof row.ID !== 'string' || !row.ID.trim() || ids.has(row.ID)) throw new Error('Missing or duplicate container ID')
    for (const key of ['Names', 'Image', 'Status', 'Ports'])
      if (typeof row[key] !== 'string') throw new Error(`Invalid container field: ${key}`)
    ids.add(row.ID)
    return { container_id: row.ID, name: row.Names as string, image: row.Image as string, status: row.Status as string, ports: row.Ports as string }
  })
  return { containers }
}
