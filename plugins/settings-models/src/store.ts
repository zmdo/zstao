import type { ModelProfileRecord } from './profiles.ts'

export interface Queryable {
  query(sql: string, params?: readonly unknown[]): Promise<unknown>
}

/** A profile plus the encrypted credential, when one could be read. */
export interface StoredModelProfile extends ModelProfileRecord {
  credentialCiphertext: string | null
}

/**
 * Replace the mirrored model table with this set.
 * The caller holds the transaction. An empty set removes every row.
 */
export async function replaceModelProfiles(client: Queryable, rows: readonly StoredModelProfile[]): Promise<void> {
  await client.query('begin')
  try {
    await client.query(
      'delete from console_model_profiles where provider <> all($1::text[])',
      [rows.map(row => row.provider)],
    )
    for (const row of rows) {
      await client.query(
        `insert into console_model_profiles (
           provider, settings_ns, settings_path, display_name, config,
           credential_ref, credential_ciphertext, revision, updated_at
         ) values ($1, $2, $3::jsonb, $4, $5::jsonb, $6, $7, $8, now())
         on conflict (provider) do update set
           settings_ns = excluded.settings_ns,
           settings_path = excluded.settings_path,
           display_name = excluded.display_name,
           config = excluded.config,
           credential_ref = excluded.credential_ref,
           credential_ciphertext = excluded.credential_ciphertext,
           revision = excluded.revision,
           updated_at = now()`,
        [
          row.provider,
          row.settingsNs,
          JSON.stringify(row.settingsPath),
          row.displayName,
          row.config === undefined ? null : JSON.stringify(row.config),
          row.credentialRef ?? null,
          row.credentialCiphertext,
          row.revision,
        ],
      )
    }
    await client.query('commit')
  } catch (cause) {
    try {
      await client.query('rollback')
    } catch (error) {
      // The original failure is the one to throw. The connection may already be dead.
      void error
    }
    throw cause
  }
}
