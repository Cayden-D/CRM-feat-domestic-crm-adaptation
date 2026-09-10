BEGIN;

CREATE TABLE opportunity_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  from_stage_id uuid REFERENCES opportunity_stages(id) ON DELETE SET NULL,
  to_stage_id uuid NOT NULL REFERENCES opportunity_stages(id) ON DELETE RESTRICT,
  changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opportunity_history_opportunity_time
  ON opportunity_stage_history (opportunity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_opportunities_tenant_stage_owner
  ON opportunities (tenant_id, stage_id, owner_id, expected_close_date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_activities_opportunity_time
  ON activities (opportunity_id, occurred_at DESC)
  WHERE opportunity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_opportunity_status_due
  ON tasks (opportunity_id, status, due_at)
  WHERE opportunity_id IS NOT NULL;

UPDATE roles
SET permissions = permissions || '["opportunity:create","opportunity:update","opportunity:delete","opportunity:advance"]'::jsonb
WHERE code = 'sales_rep'
  AND NOT permissions ? 'opportunity:create';

COMMIT;
