BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_contact_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_leads_company_trgm
  ON leads USING gin (company_name gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_name_trgm
  ON accounts USING gin (name gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_activities_lead_time
  ON activities (lead_id, occurred_at DESC)
  WHERE lead_id IS NOT NULL;

UPDATE roles
SET permissions = permissions || '["lead:convert"]'::jsonb
WHERE code = 'sales_rep' AND NOT permissions ? 'lead:convert';

COMMENT ON EXTENSION pg_trgm IS '用于客户及线索公司名称的相似度查重';

COMMIT;
