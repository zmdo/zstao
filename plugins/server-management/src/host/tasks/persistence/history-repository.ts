import { type Db } from '../../database/connection.ts'
import { type TaskQuery } from '../query.ts'
import type { TaskHistoryPageRow } from './rows.ts'

export async function taskHistory(db: Db, query: TaskQuery) {
  const pattern = query.query ? `%${query.query.replace(/[\\%_]/g, '\\$&')}%` : null
  // One statement gives the count and page a consistent snapshot while tasks finish.
  const result = await db.query<TaskHistoryPageRow>(
    `with entries as (
      select id::text,coalesce(request_snapshot->>'action',purpose) as action,state as status,phase,
        result,output_excerpt,created_at,started_at,finished_at
      from server_jobs where server_identity=$1
        and not (purpose='detect_updates' and request_snapshot->>'automatic'='true' and state='succeeded')
        and (not (purpose='inspect' and request_snapshot->>'action'='inspect'
          and coalesce(request_snapshot->>'source','scheduled')='scheduled'
          and request_snapshot->>'prepare' is distinct from 'true') or state in ('failed','blocked'))
      union all
      select 'inspection:'||server_identity||':'||extract(epoch from hour_start)::bigint,
        'inspection_report',case when failed>0 then 'failed' else 'succeeded' end,'finished',
        jsonb_build_object('summary','inspection_report','hour_start',hour_start,'hour_end',hour_start+interval '1 hour',
          'succeeded',succeeded,'failed',failed,'last_checked_at',last_checked_at),
        '',hour_start+interval '1 hour',hour_start,last_checked_at
      from server_inspection_reports where server_identity=$1 and succeeded>0 and hour_start+interval '1 hour'<=now()
    ), filtered as (
      select * from entries where ($2::text is null or concat_ws(' ',id,action,status,output_excerpt,result::text) ilike $2)
        and ($3='' or action=$3) and ($4='' or status=$4)
        and ($5::timestamptz is null or created_at >= $5) and ($6::timestamptz is null or created_at < $6)
    ), bounds as (
      select count(*)::int as total,greatest(1,least($7,ceil(count(*)::numeric/$8)::int)) as page from filtered
    )
    select total,page,$8::int as page_size,coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id desc)
      from (select * from filtered order by created_at desc,id desc limit $8 offset (bounds.page-1)*$8) p),'[]'::jsonb) as items
    from bounds`,
    [query.serverId, pattern, query.action, query.status, query.from, query.to, query.page, query.pageSize],
  )
  return result.rows[0]
}
