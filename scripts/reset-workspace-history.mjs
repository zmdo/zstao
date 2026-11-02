import { readFile, readdir, unlink } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { Pool } from 'pg'
import { parse } from 'yaml'
import { normalizeDatabaseUrl } from '../plugins/database/src/url.ts'

const profileIndex = process.argv.indexOf('--profile')
if (profileIndex < 0 || !process.argv.includes('--reset')) throw new Error('Use --profile <test-profile-directory> --reset after stopping this profile.')
const profile = resolve(process.argv[profileIndex + 1])
const portIndex = process.argv.indexOf('--port')
const port = portIndex < 0 ? 9090 : Number(process.argv[portIndex + 1])
let online = false
try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) }); online = true } catch (_cause) { /* The stopped test server must refuse connections. */ }
if (online) throw new Error(`Stop the test instance on port ${port} before resetting history.`)
const patch = parse(await readFile(join(profile, 'cordis.patch.yml'), 'utf8'))
const url = patch.find(row => row.id === 'smp-database')?.config?.databaseUrl
if (typeof url !== 'string') throw new Error('The test profile does not have database settings.')
const pool = new Pool({ connectionString: normalizeDatabaseUrl(url) })
const names = ['console_session_event', 'console_session', 'workspace_group_focus', 'workspace_group_members', 'workspace_group_directories', 'workspace_group_sessions', 'workspace_group_session']
const client = await pool.connect()
try {
  await client.query('begin')
  const before = {}
  const after = {}
  for (const name of names) {
    const present = (await client.query('select to_regclass($1) as name', [name])).rows[0].name
    if (!present) continue
    before[name] = Number((await client.query(`select count(*) as count from ${name}`)).rows[0].count)
    await client.query(`delete from ${name}`)
    after[name] = Number((await client.query(`select count(*) as count from ${name}`)).rows[0].count)
  }
  for (const table of ['console_storage_record', 'console_storage_global']) {
    before[table] = Number((await client.query(`select count(*) as count from ${table} where unit_name = 'workspace'`)).rows[0].count)
    await client.query(`delete from ${table} where unit_name = 'workspace'`)
    after[table] = Number((await client.query(`select count(*) as count from ${table} where unit_name = 'workspace'`)).rows[0].count)
  }
  await client.query('commit')
  console.log(JSON.stringify({ profile, before, after }, null, 2))
} catch (cause) { await client.query('rollback'); throw cause } finally { client.release(); await pool.end() }
const dshHome = resolve(profile, '../..')
const legacy = join(dshHome, 'storages', 'workspace.json')
try { await unlink(legacy); console.log('Removed the test workspace JSON import source.') } catch (cause) { if (cause.code !== 'ENOENT') throw cause }
const sessionDirectory = join(dshHome, 'sessions')
try {
  const files = await readdir(sessionDirectory)
  for (const file of files) if (file.endsWith('.jsonl')) await unlink(join(sessionDirectory, file))
  console.log('Cleared legacy JSONL files in the test session directory.')
} catch (cause) { if (cause.code !== 'ENOENT') throw cause }
console.log('Browser session/workspace state must also be cleared before browser acceptance tests.')
