import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { Pool } from 'pg'
import { apply } from '../../database/src/index.ts'

test(
  'database withdrawal waits for dependent final writes before closing the pool',
  { skip: !process.env.SMP_TEST_DATABASE_URL },
  async (t) => {
    const admin = new Pool({ connectionString: process.env.SMP_TEST_DATABASE_URL }),
      schema = `lifecycle_${randomUUID().replaceAll('-', '')}`
    await admin.query(`create schema ${schema}`)
    t.after(async () => {
      await admin.query(`drop schema ${schema} cascade`)
      await admin.end()
    })
    const url = new URL(process.env.SMP_TEST_DATABASE_URL!)
    url.searchParams.set('options', `-c search_path=${schema}`)
    const root = new Context(),
      provider = root.plugin(
        { name: 'test-database', apply },
        { databaseUrl: url.toString(), encryptionKey: Buffer.alloc(32, 1).toString('base64url') },
      )
    await provider
    let wrote = false
    const consumer = root.plugin({
      inject: ['database', 'secrets'],
      apply(ctx: Context) {
        ctx.effect(() => async () => {
          await new Promise((resolve) => setTimeout(resolve, 20))
          assert.equal((await ctx.database.pool.query('select 1 as value')).rows[0].value, 1)
          wrote = true
        })
      },
    })
    await consumer
    await provider.dispose()
    assert.equal(wrote, true)
    await consumer.dispose()
  },
)
