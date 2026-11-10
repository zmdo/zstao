import { readFile } from 'node:fs/promises'
import type { TypeSetupContext } from '@smp/console-server-management/contracts'
import type { ImageRegistryService } from '@smp/console-project-repositories/contracts'

export async function setupApplicationServer(context: TypeSetupContext, registry: ImageRegistryService): Promise<void> {
  const source = await readFile(new URL('../scripts/login.py', import.meta.url), 'utf8')
  const input = context.operation === 'prepare' ? { operation: 'prepare', ...await registry.pullLogin() } : { operation: 'remove' }
  const program = `import base64;exec(compile(base64.b64decode("${Buffer.from(source).toString('base64')}"),"ces-application-login","exec"))`
  const command = `python3 -c '${program}'`
  await context.guard()
  const result = await context.exec(`if [ "$(id -u)" -eq 0 ]; then ${command}; else sudo -n ${command}; fi`, 150_000, { stdin: JSON.stringify(input), outputLimitBytes: 4096 })
  // The core maps provider failures to a stable, secret-free task error.
  if (result.code !== 0 || result.stdout.trim() !== '{"ok":true}') throw new Error('application_server_setup_failed')
}
