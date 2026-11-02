import type { JobRecord } from '../../src/host/execution/persistence/rows.ts'

export function inspectionJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 'job-1', server_id: 'server-1', server_identity: 'server-1', worker_id: 'worker-1',
    fence: '1', definition_revision: 'fixture', purpose: 'inspect', state: 'running', phase: 'inspect',
    mutation_phase: null, expected_config_revision: '1', expected_environment_revision: '1',
    target_id: null, operation_id: 'op-1', lease_expires_at: new Date(Date.now() + 60000),
    request_snapshot: { action: 'inspect', source: 'scheduled' }, result: null, output_excerpt: '',
    created_at: new Date(), started_at: null, finished_at: null, recovery_attempts: 0, ...overrides,
  }
}
