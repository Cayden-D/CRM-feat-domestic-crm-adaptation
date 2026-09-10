BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_one_primary_per_account
  ON contacts (account_id)
  WHERE is_primary = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_account_active
  ON contacts (account_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_opportunities_account_status
  ON opportunities (account_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_activities_account_time
  ON activities (account_id, occurred_at DESC)
  WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_account_status_due
  ON tasks (account_id, status, due_at)
  WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_account_status
  ON orders (account_id, status, created_at DESC);

UPDATE roles
SET permissions = permissions || '["account:create","account:update","account:delete","account:contact"]'::jsonb
WHERE code = 'sales_rep'
  AND NOT permissions ? 'account:create';

COMMIT;
