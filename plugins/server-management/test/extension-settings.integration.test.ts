import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { Pool } from 'pg'
import type { Db } from '../src/host/database/connection.ts'
import { extensionSettings, saveExtensionSettings } from '../src/host/extensions/settings.ts'
import { applyExtensionSettingsPlan, planExtensionSettings } from '../src/host/extensions/settings-plan.ts'

import { DefinitionRegistry } from '../src/host/definitions/registry.ts'
import { builtinCatalog } from '../src/host/definitions/catalog.ts'
import { ServerExtensionRegistry } from '../src/host/extensions/registry.ts'
import { lockSettingsServer } from '../src/host/extensions/persistence/settings-repository.ts'

test(
  'extension settings use revisioned conditional writes',
  { skip: !process.env.SMP_TEST_DATABASE_URL, timeout: 30_000 },
  async () => {
    const admin = new Pool({ connectionString: process.env.SMP_TEST_DATABASE_URL })
    const schema = `extension_settings_${randomUUID().replaceAll('-', '')}`
    await admin.query(`create schema ${schema}`)
    const pool = new Pool({
      connectionString: process.env.SMP_TEST_DATABASE_URL,
      options: `-c search_path=${schema}`,
    })
    const db = pool as unknown as Db
    const definitions = new DefinitionRegistry(db, builtinCatalog())
    const extensions = new ServerExtensionRegistry(definitions)
    const metadata = { contractVersion: 1 as const, owner: '@test/ext', settings: [{
      key: 'database-settings', revision: '1', name: { zh: '配置', en: 'Settings' }, affectsExecution: true,
    }] }
    let accepts = true
    const runtime = { settings: { 'database-settings': { defaults: { collect: true }, validate(value: unknown) {
      if (!accepts) throw new Error('new validator rejects old value')
      return value as { collect: boolean }
    } } } }
    let registration = extensions.registerExtensions(metadata, {}, runtime)
    await registration.ready
    try {
      for (const name of [
        '0010_server_management.sql',
        '0012_server_types.sql',
        '0013_server_observations.sql',
        '0014_server_execution.sql',
        '0015_server_inspection_reports.sql',
        '0016_server_version_policies.sql',
        '0017_server_extension_settings.sql',
        '0018_server_extension_setting_plans.sql',
        '0019_server_extension_observations.sql',
      ])
        await pool.query(await readFile(new URL(`../../database/migrations/${name}`, import.meta.url), 'utf8'))
      const serverId = randomUUID()
      await pool.query(
        `insert into servers(id,name,host,ssh_port,ssh_user,auth_method,secret_ciphertext,region,type_key,type_snapshot,type_revision,declared_os)
         values($1,$2,$3,22,'test','password','cipher','','builtin/vacant','{}','','{"kind":"custom","text":"test"}')`,
        [serverId, 'test', `host-${serverId}`],
      )
      assert.equal(await extensionSettings(db, serverId, '@test/ext', 'database-settings'), undefined)
      const first = await saveExtensionSettings(db, {
        serverId,
        owner: '@test/ext',
        section: 'database-settings',
        value: { collect: true },
        expectedRevision: '0',
      })
      assert.equal(first?.revision, '1')
      const second = await saveExtensionSettings(db, {
        serverId,
        owner: '@test/ext',
        section: 'database-settings',
        value: { collect: false },
        expectedRevision: '1',
      })
      assert.equal(second?.revision, '2')
      assert.equal(
        await saveExtensionSettings(db, {
          serverId,
          owner: '@test/ext',
          section: 'database-settings',
          value: { collect: true },
          expectedRevision: '1',
        }),
        undefined,
      )
      assert.deepEqual((await extensionSettings(db, serverId, '@test/ext', 'database-settings'))?.value, {
        collect: false,
      })
      const plan = await planExtensionSettings(db, {
        serverId,
        owner: '@test/ext',
        section: 'database-settings',
        value: { collect: true },
        expectedRevision: '2',
      }, extensions)
      const applied = await applyExtensionSettingsPlan(db, {
        serverId,
        owner: '@test/ext',
        section: 'database-settings',
        planId: plan.id,
        digest: plan.digest,
      }, extensions)
      assert.equal(applied.revision, '3')
      await assert.rejects(
        applyExtensionSettingsPlan(db, {
          serverId,
          owner: '@test/ext',
          section: 'database-settings',
          planId: plan.id,
          digest: plan.digest,
        }, extensions),
        { code: 'extension_plan_not_pending' },
      )
      await assert.rejects(
        planExtensionSettings(db, {
          serverId,
          owner: '@test/ext',
          section: 'database-settings',
          value: { collect: false },
          expectedRevision: '2',
        }, extensions),
        { code: 'extension_settings_conflict' },
      )
      const input = { serverId, owner: '@test/ext', section: 'database-settings', value: { collect: false }, expectedRevision: '3' }
      const old = await planExtensionSettings(db, input, extensions)
      await registration.dispose()
      registration = extensions.registerExtensions(metadata, {}, runtime)
      await registration.ready
      const applyOld = () => applyExtensionSettingsPlan(db, { ...input, planId: old.id, digest: old.digest }, extensions)
      accepts = false
      await assert.rejects(applyOld(), /new validator rejects/)
      accepts = true
      await registration.dispose()
      metadata.settings[0]!.revision = '2'
      registration = extensions.registerExtensions(metadata, {}, runtime)
      await registration.ready
      await assert.rejects(applyOld(), { code: 'extension_plan_invalid' })
      await registration.dispose()
      metadata.settings[0]!.revision = '1'
      registration = extensions.registerExtensions(metadata, {}, runtime)
      await registration.ready
      // Identical provider restart preserves the pending confirmation.
      assert.equal((await applyOld()).revision, '4')
      const next = await planExtensionSettings(db, { ...input, expectedRevision: '4' }, extensions)
      await pool.query('update servers set config_revision=config_revision+1 where id=$1', [serverId])
      await assert.rejects(applyExtensionSettingsPlan(db, { ...input, planId: next.id, digest: next.digest }, extensions), { code: 'extension_plan_invalid' })
      // Parent locking also serializes a first settings insert against an inspection commit.
      const blocker = await pool.connect()
      await blocker.query('begin')
      await lockSettingsServer(blocker as unknown as Db, serverId)
      let written = false
      const writing = saveExtensionSettings(db, { ...input, section: 'first-insert', expectedRevision: '0' }).then((value) => { written = true; return value })
      await new Promise((resolve) => setTimeout(resolve, 40))
      assert.equal(written, false)
      await blocker.query('commit')
      blocker.release()
      assert.equal((await writing)?.revision, '1')
    } finally {
      await extensions.close()
      await definitions.close()
      await pool.end()
      await admin.query(`drop schema ${schema} cascade`)
      await admin.end()
    }
  },
)
