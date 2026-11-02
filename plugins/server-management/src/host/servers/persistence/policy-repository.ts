import { type SoftwarePolicy } from '../../../shared/policies.ts'
import { type Db } from '../../database/connection.ts'

export async function readPolicies(db: Db, id: string): Promise<SoftwarePolicy[]> {
  return (
    await db.query<SoftwarePolicy>(
      'select software_key,restriction,detect_updates from server_software_policies where server_id=$1 order by software_key',
      [id],
    )
  ).rows
}
export async function writePolicies(db: Db, id: string, policies: readonly SoftwarePolicy[]): Promise<void> {
  await db.query<never>(
    'delete from server_software_policies where server_id=$1 and not (software_key=any($2::text[]))',
    [id, policies.map((p) => p.software_key)],
  )
  for (const p of policies)
    await db.query<never>(
      `insert into server_software_policies(server_id,software_key,restriction,detect_updates,next_check_at)
 values($1,$2,$3,$4,case when $4 then now() end)
 on conflict(server_id,software_key) do update set restriction=excluded.restriction,detect_updates=excluded.detect_updates,
 policy_revision=server_software_policies.policy_revision+case when server_software_policies.restriction is distinct from excluded.restriction or server_software_policies.detect_updates<>excluded.detect_updates then 1 else 0 end,
 next_check_at=case when not excluded.detect_updates then null when server_software_policies.restriction is distinct from excluded.restriction or not server_software_policies.detect_updates then now() else server_software_policies.next_check_at end,
 check_snapshot=case when server_software_policies.restriction is distinct from excluded.restriction then null else server_software_policies.check_snapshot end,updated_at=now()`,
      [id, p.software_key, JSON.stringify(p.restriction), p.detect_updates],
    )
}
