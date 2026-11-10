import type { ServerTypeView } from '../../shared/definitions.ts'
import type { DefinitionRegistry } from '../definitions/registry.ts'
import type { SshSession } from '../remote/ssh.ts'

export async function setupType(
  definitions: DefinitionRegistry,
  session: SshSession,
  server: { id: string; ssh_user: string; type_snapshot?: ServerTypeView },
  target: ServerTypeView,
  guard: () => Promise<void>,
): Promise<void> {
  const context = { serverId: server.id, sshUser: server.ssh_user, exec: session.exec.bind(session), guard }
  await definitions.setupType(target, { ...context, operation: 'prepare' })
  const previous = server.type_snapshot
  if (previous && previous.key !== target.key) await definitions.setupType(previous, { ...context, operation: 'remove' })
}
