-- Upgrade from deployed 0047, or install on a database that never used it.
-- Stop the previous application before upgrading. The migration runner wraps this
-- file and its ledger entry in one transaction; keep the historical 0047 entry.
SET LOCAL lock_timeout = '5s';
LOCK TABLE server_jobs IN ACCESS EXCLUSIVE MODE;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM server_jobs WHERE purpose = 'configure'
      AND request_snapshot->>'operation' IS DISTINCT FROM
        '@smp/console-application-server/registry-credentials'
  ) THEN
    RAISE EXCEPTION 'legacy TCR cleanup refused: unknown configure operation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM server_jobs WHERE purpose = 'configure'
      AND state IN ('claimed', 'running', 'recovering')
  ) THEN
    RAISE EXCEPTION 'legacy TCR cleanup refused: active configure jobs; reconcile remote operations using the previous version first';
  END IF;
END $$;

-- Only the retired TCR operation is removed. Job steps follow their existing FK.
DELETE FROM server_jobs
  WHERE purpose = 'configure'
    AND request_snapshot->>'operation' = '@smp/console-application-server/registry-credentials';

-- Do not use CASCADE: unexpected dependencies must abort the whole migration.
DROP TABLE IF EXISTS application_registry_requests;
DROP TABLE IF EXISTS application_registry_bindings;
DROP TABLE IF EXISTS application_registry_clients;
DROP SEQUENCE IF EXISTS server_configuration_sequence;

ALTER TABLE server_jobs DROP CONSTRAINT server_jobs_purpose_check;
ALTER TABLE server_jobs ADD CONSTRAINT server_jobs_purpose_check
  CHECK (purpose IN ('inspect', 'detect_updates', 'apply_plan'));
