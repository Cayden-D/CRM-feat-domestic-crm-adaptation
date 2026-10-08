BEGIN;
CREATE TABLE integration_1688_agent_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  draft_id uuid NOT NULL REFERENCES integration_1688_publish_drafts(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  draft_revision integer NOT NULL CHECK (draft_revision > 0),
  mode text NOT NULL CHECK (mode IN ('generate','edit')),
  source_url text,
  prompt text NOT NULL,
  model text NOT NULL,
  generated_url text NOT NULL,
  findings jsonb NOT NULL,
  status text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','applying','applied')),
  photo_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX idx_1688_agent_images_draft ON integration_1688_agent_images(tenant_id,draft_id,created_at DESC);
COMMIT;
