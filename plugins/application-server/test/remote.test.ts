import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
test('remote helper: generations, fencing, recovery, scope, lock, errors and cleanup', async () => {
  await promisify(execFile)('python3', [fileURLToPath(new URL('./remote_registry_test.py', import.meta.url))], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
})
