import * as queries from './persistence/repository.ts'
import { randomUUID } from 'node:crypto'
import { transaction } from '../database/transaction.ts'
import { lockCatalog } from '../groups/persistence/catalog-lock.ts'
import { connectSsh, type SshSession } from '../remote/ssh.ts'
import { serverSecret } from '../servers/persistence/credential-repository.ts'
import { digest } from '../recipes/canonical.ts'
import { approve } from './approval.ts'
import { audit, finish, serverSnapshot, keySnapshot } from './persistence/repository.ts'
import { generateKey, keyFingerprint, publicKey } from './keys.ts'
import {
  fields,
  text,
  uuid,
  revision,
  AdminError,
  type AdminDeps,
  type AdminContext,
  type Input,
} from './model.ts'

// Update exactly one key while preserving authorized_keys restrictions and unrelated lines.
export const AUTHORIZED_KEYS_SCRIPT = String.raw`import json,os,sys,stat,fcntl,tempfile,re,shlex
p=json.load(sys.stdin)
directory=os.path.expanduser('~/.ssh')
path=os.path.join(directory,'authorized_keys')
lockpath=os.path.join(directory,'.smp-key-rotation.lock')
lockfd=os.open(lockpath,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
with os.fdopen(lockfd,'r+') as lock:
 if not stat.S_ISREG(os.fstat(lock.fileno()).st_mode) or os.fstat(lock.fileno()).st_uid!=os.getuid(): raise Exception('lock ownership mismatch')
 fcntl.flock(lock,fcntl.LOCK_EX)
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd) as f:
  st=os.fstat(f.fileno())
  if not stat.S_ISREG(st.st_mode) or st.st_uid!=os.getuid(): raise Exception('ownership mismatch')
  original=f.read()
 lines=original.splitlines()
 old=p['old'].split()[:2]; new=p['new'].split()[:2]
 def matches(line,key):
  if not line.strip() or line.lstrip().startswith('#'): return None
  parts=shlex.split(line)
  if not (parts[:2]==key or parts[1:3]==key): return None
  found=list(re.finditer(r'(^|\s)'+re.escape(key[0])+r'\s+'+re.escape(key[1])+r'(?=\s|$)',line))
  if len(found)!=1: raise Exception('ambiguous key line')
  return found[0]
 olds=[(i,matches(line,old)) for i,line in enumerate(lines) if matches(line,old)]
 news=[i for i,line in enumerate(lines) if matches(line,new)]
 if p['mode']=='add':
  if len(olds)!=1: raise Exception('old key is missing or ambiguous')
  if not news:
   i,m=olds[0]
   lines.append(lines[i][:m.start()]+(' ' if m.start()>0 else '')+' '.join(new)+' smp-key:'+p['key_id'])
 elif p['mode']=='remove':
  if len(news)!=1: raise Exception('new key is missing or ambiguous')
  if len(olds)>1: raise Exception('old key ambiguous')
  lines=[line for i,line in enumerate(lines) if i not in [x[0] for x in olds]]
 else: raise Exception('invalid mode')
 content='\n'.join(lines)+'\n'
 if content!=original:
  tempfd,tempname=tempfile.mkstemp(prefix='.smp-authorized-keys-',dir=directory)
  try:
   with os.fdopen(tempfd,'w') as target:
    os.fchmod(target.fileno(),stat.S_IMODE(st.st_mode))
    target.write(content);target.flush();os.fsync(target.fileno())
   current=os.stat(path,follow_symlinks=False)
   if (current.st_ino,current.st_mtime_ns,current.st_size)!=(st.st_ino,st.st_mtime_ns,st.st_size): raise Exception('file changed')
   os.replace(tempname,path)
   dirfd=os.open(directory,os.O_RDONLY|os.O_DIRECTORY)
   try: os.fsync(dirfd)
   finally: os.close(dirfd)
  finally:
   if os.path.exists(tempname): os.unlink(tempname)
print('ok')`
const quote = (v: string) => "'" + v.replaceAll("'", "'\\''") + "'"
interface Rotation {
  id: string
  server_id: string
  old_key_id: string
  new_key_id: string
  state: string
  config_revision: string
  audit_id: string
}
export async function rotateKey(deps: AdminDeps, ctx: AdminContext, input: Input) {
  fields(input, ['server', 'key_id', 'expected_config_revision', 'operation_id'])
  const server = uuid(input.server),
    oldId = uuid(input.key_id),
    expected = revision(input.expected_config_revision)
  const previous =
    input.operation_id === undefined
      ? null
      : (await queries.readRotation<Rotation>(deps.db, [uuid(input.operation_id)])).rows[0]
  if (input.operation_id !== undefined && !previous) throw new AdminError('rotation_not_found')
  if (previous && (previous.server_id !== server || previous.old_key_id !== oldId))
    throw new AdminError('rotation_target_changed')
  if (previous?.state === 'completed') return { operation_id: previous.id, state: 'completed' }
  if (previous?.state === 'failed') throw new AdminError('rotation_failed')
  const before = await serverSnapshot(deps.db, server)
  if (String(before.config_revision) !== expected) throw new AdminError('server_revision_conflict')
  if (!before.host_fingerprint) throw new AdminError('fingerprint_missing')
  if (before.auth_method !== 'private_key') throw new AdminError('key_reference_changed')
  if (!previous && before.ssh_key_id !== oldId) throw new AdminError('key_reference_changed')
  const pair = previous ? null : generateKey(),
    newId = previous?.new_key_id ?? randomUUID(),
    operationId = previous?.id ?? randomUUID()
  const old = (
    await queries.rotationKey<{ secret_ciphertext: string; fingerprint: string }>(deps.db, [oldId])
  ).rows[0]
  if (!old) throw new AdminError('key_not_found')
  const stored = previous
    ? (
        await queries.rotationKey<{ secret_ciphertext: string; fingerprint: string }>(deps.db, [
          newId,
        ])
      ).rows[0]
    : null
  if (previous && !stored) throw new AdminError('key_not_found')
  const privateKey = pair?.private ?? deps.secrets.decrypt(stored!.secret_ciphertext),
    fingerprint = keyFingerprint(privateKey)
  const actor = await approve(deps, ctx, 'platform_server_key_admin', 'rotate', server, {
    before,
    operation_id: operationId,
    old_key_id: oldId,
    old_fingerprint: old.fingerprint,
    new_key_id: newId,
    new_fingerprint: fingerprint,
    phase: previous?.state ?? 'new',
  })
  // Session advisory lock serializes retries without holding a transaction during SSH.
  const ownership = await deps.db.connect()
  let acquired = false
  let auditId = previous?.audit_id ?? '',
    started = false
  const sessions: SshSession[] = []
  const abort = () => {
    for (const session of sessions) session.close()
  }
  ctx.signal.addEventListener('abort', abort, { once: true })
  try {
    acquired = (
      await queries.tryLockRotation<{ locked: boolean }>(ownership, [`rotation/${server}`])
    ).rows[0]!.locked
    if (!acquired) throw new AdminError('server_busy')
    await transaction(deps.db, async (db) => {
      await lockCatalog(db)
      const current = await serverSnapshot(db, server, true)
      if (digest(before) !== digest(current)) throw new AdminError('server_revision_conflict')
      if ((await queries.rotationActiveJobs(db, [server])).rows.length)
        throw new AdminError('server_busy')
      if (ctx.signal.aborted) throw new AdminError('cancelled')
      await keySnapshot(db, oldId, true)
      if (previous) await keySnapshot(db, newId, true)
      if (!previous) {
        auditId = await audit(db, {
          tool: 'platform_server_key_admin',
          action: 'rotate',
          target: server,
          before,
          after: { operation_id: operationId, new_key_id: newId, fingerprint },
          actor,
          context: ctx,
          approval: 'approved',
          status: 'pending',
        })
        await queries.insertRotationKey(db, [
          newId,
          `rotation-${newId}`,
          fingerprint,
          deps.secrets.encrypt(privateKey),
        ])
        await queries.insertRotation(db, [operationId, server, oldId, newId, expected, auditId])
      } else {
        await audit(db, {
          tool: 'platform_server_key_admin',
          action: 'rotate_resume',
          target: server,
          after: { operation_id: operationId },
          actor,
          context: ctx,
          approval: 'approved',
          status: 'succeeded',
        })
      }
    })
    started = true
    const secret = await serverSecret(deps.db, server)
    if (!secret?.host_fingerprint) throw new AdminError('fingerprint_missing')
    const open = async (key: string) => {
      if (ctx.signal.aborted) throw new AdminError('cancelled')
      const session = await (deps.connect ?? connectSsh)({
        host: secret.host,
        port: secret.ssh_port,
        username: secret.ssh_user,
        authMethod: 'private_key',
        secret: key,
        expectedFingerprint: secret.host_fingerprint,
      })
      sessions.push(session)
      if (ctx.signal.aborted) {
        session.close()
        throw new AdminError('cancelled')
      }
      return session
    }
    const oldPublic = publicKey(deps.secrets.decrypt(old.secret_ciphertext)),
      newPublic = publicKey(privateKey)
    const edit = async (session: SshSession, mode: string) => {
      const result = await session.exec('python3 -c ' + quote(AUTHORIZED_KEYS_SCRIPT), 30000, {
        stdin: JSON.stringify({ mode, old: oldPublic, new: newPublic, key_id: newId }),
        outputLimitBytes: 4096,
      })
      if (result.code !== 0 || result.stdout.trim() !== 'ok')
        throw new AdminError('remote_key_update_failed')
    }
    const current = (await queries.currentKeyReference<{ ssh_key_id: string }>(deps.db, [server]))
      .rows[0]!
    if (current.ssh_key_id !== newId) {
      if (current.ssh_key_id !== oldId) throw new AdminError('key_reference_changed')
      const oldSession = await open(deps.secrets.decrypt(old.secret_ciphertext))
      await edit(oldSession, 'add')
      await queries.markRotationDeployed(deps.db, [operationId])
    }
    const next = await open(privateKey)
    await transaction(deps.db, async (db) => {
      await queries.lockRotationServer(db, [server])
      const result = await queries.switchKeyReference(db, [server, newId, oldId, expected])
      if (
        !result.rows.length &&
        (await queries.isKeySwitched(db, [server, newId, expected])).rows.length === 0
      )
        throw new AdminError('server_revision_conflict')
      await queries.markRotationSwitched(db, [operationId])
    })
    await edit(next, 'remove')
    await open(privateKey)
    await transaction(deps.db, async (db) => {
      await queries.completeRotation(db, [operationId])
      await finish(db, auditId, 'succeeded', {
        operation_id: operationId,
        new_key_id: newId,
        state: 'completed',
      })
    })
    return { operation_id: operationId, new_key_id: newId, fingerprint, state: 'completed' }
  } catch (cause) {
    if (started) {
      await queries.markRotationUnknown(deps.db, [operationId])
      await finish(deps.db, auditId, 'failed', {
        operation_id: operationId,
        state: 'unknown',
        code: cause instanceof AdminError ? cause.code : 'rotation_failed',
      })
      return {
        operation_id: operationId,
        state: 'unknown',
        requires_reconciliation: true,
        new_key_id: newId,
      }
    }
    await audit(deps.db, {
      tool: 'platform_server_key_admin',
      action: 'rotate',
      target: server,
      before,
      after: {
        operation_id: operationId,
        code: cause instanceof AdminError ? cause.code : 'rotation_failed',
      },
      status: 'failed',
      actor,
      context: ctx,
      approval: 'approved',
    })
    throw cause
  } finally {
    ctx.signal.removeEventListener('abort', abort)
    abort()
    try {
      if (acquired) await queries.unlockRotation(ownership, [`rotation/${server}`])
    } finally {
      ownership.release()
    }
  }
}
