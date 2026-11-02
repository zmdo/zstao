import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { Pool } from 'pg'

test('server rebuild refuses existing rows and preserves groups, keys and unrelated tables', {skip:!process.env.SMP_TEST_DATABASE_URL}, async t=>{
  const schema=`server_model_${randomUUID().replaceAll('-','')}`
  const admin=new Pool({connectionString:process.env.SMP_TEST_DATABASE_URL})
  await admin.query(`create schema ${schema}`)
  const db=new Pool({connectionString:process.env.SMP_TEST_DATABASE_URL,options:`-c search_path=${schema}`})
  t.after(async()=>{await db.end();await admin.query(`drop schema ${schema} cascade`);await admin.end()})
  for(const name of ['0010_server_management.sql','0012_server_types.sql']) await db.query(await readFile(new URL(`../../database/migrations/${name}`,import.meta.url),'utf8'))
  const group=randomUUID(),key=randomUUID(),server=randomUUID()
  await db.query("insert into server_groups(id,name) values($1,'preserved group')",[group])
  await db.query("insert into ssh_keys(id,name,fingerprint,secret_ciphertext) values($1,'preserved key','fingerprint','ciphertext')",[key])
  await db.query("create table unrelated_sentinel(value text); insert into unrelated_sentinel values('preserve')")
  await db.query("insert into servers(id,name,intranet_host,ssh_user,auth_method,secret_ciphertext) values($1,'existing','192.0.2.1','test','password','ciphertext')",[server])
  const sql=await readFile(new URL('../../database/migrations/0013_server_observations.sql',import.meta.url),'utf8')
  await assert.rejects(db.query(sql),/requires empty server tables/)
  assert.equal((await db.query('select id from servers')).rows[0].id,server)
  await db.query('delete from servers where id=$1',[server])
  await db.query(sql)
  assert.equal((await db.query('select id from server_groups')).rows[0].id,group)
  assert.equal((await db.query('select id,secret_ciphertext from ssh_keys')).rows[0].secret_ciphertext,'ciphertext')
  assert.equal((await db.query('select value from unrelated_sentinel')).rows[0].value,'preserve')
  assert.equal(Number((await db.query('select count(*) from server_runtime')).rows[0].count),0)
})
