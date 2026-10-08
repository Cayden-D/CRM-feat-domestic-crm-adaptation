BEGIN;
CREATE TABLE integration_1688_agent_settings (
  connection_id uuid PRIMARY KEY REFERENCES integration_1688_connections(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE integration_1688_agent_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES integration_1688_connections(id) ON DELETE CASCADE,
  draft_id uuid NOT NULL REFERENCES integration_1688_publish_drafts(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  settings_revision integer NOT NULL,
  draft_revision integer NOT NULL,
  status text NOT NULL CHECK(status IN ('analyzing','publishing','published','blocked','failed','unknown','cancelled')),
  report jsonb NOT NULL DEFAULT '{}',
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_1688_agent_active ON integration_1688_agent_jobs(draft_id) WHERE status IN ('analyzing','publishing','unknown');
CREATE INDEX idx_1688_agent_tenant ON integration_1688_agent_jobs(tenant_id,draft_id,created_at DESC);
COMMIT;
