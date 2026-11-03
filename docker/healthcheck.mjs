import { networkInterfaces } from 'node:os'

const addresses = Object.values(networkInterfaces())
  .flat()
  .filter((entry) => entry !== undefined && entry.family === 'IPv4' && !entry.internal)
const address = addresses[0]?.address ?? '127.0.0.1'
try {
  const response = await fetch(`http://${address}:9090/`, { redirect: 'manual' })
  process.exit(response.status >= 200 && response.status < 400 ? 0 : 1)
} catch {
  process.exit(1)
}
