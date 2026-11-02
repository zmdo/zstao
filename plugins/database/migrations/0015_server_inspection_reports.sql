-- Keep execution records for recovery/audit; task history shows hourly reports instead.
CREATE TABLE server_inspection_reports (
  server_identity uuid NOT NULL,
  hour_start timestamptz NOT NULL,
  succeeded integer NOT NULL DEFAULT 0 CHECK (succeeded >= 0),
  failed integer NOT NULL DEFAULT 0 CHECK (failed >= 0),
  last_checked_at timestamptz NOT NULL,
  PRIMARY KEY (server_identity, hour_start)
);

INSERT INTO server_inspection_reports(server_identity,hour_start,succeeded,failed,last_checked_at)
SELECT server_identity,date_trunc('hour',finished_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
  count(*) FILTER (WHERE state='succeeded'),count(*) FILTER (WHERE state IN ('failed','blocked')),max(finished_at)
FROM server_jobs
WHERE purpose='inspect' AND request_snapshot->>'action'='inspect'
  AND request_snapshot->>'prepare' IS DISTINCT FROM 'true'
  AND state IN ('succeeded','failed','blocked')
GROUP BY server_identity,date_trunc('hour',finished_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

CREATE INDEX server_jobs_visible_history ON server_jobs(server_identity,created_at DESC,id DESC)
WHERE NOT (purpose='inspect' AND request_snapshot->>'action'='inspect'
  AND request_snapshot->>'prepare' IS DISTINCT FROM 'true') OR state IN ('failed','blocked');
