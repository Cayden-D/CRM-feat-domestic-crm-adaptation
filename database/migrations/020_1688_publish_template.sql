BEGIN;
CREATE TABLE integration_1688_publish_templates (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  template_values jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(template_values) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
