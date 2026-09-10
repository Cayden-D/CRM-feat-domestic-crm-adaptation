BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(120) NOT NULL,
  slug varchar(80) NOT NULL UNIQUE,
  default_currency char(3) NOT NULL DEFAULT 'USD',
  default_timezone varchar(64) NOT NULL DEFAULT 'Asia/Shanghai',
  default_locale varchar(16) NOT NULL DEFAULT 'zh-CN',
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code varchar(50) NOT NULL,
  name varchar(80) NOT NULL,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email citext NOT NULL,
  password_hash text,
  display_name varchar(80) NOT NULL,
  mobile varchar(40),
  locale varchar(16) NOT NULL DEFAULT 'zh-CN',
  timezone varchar(64) NOT NULL DEFAULT 'Asia/Shanghai',
  ai_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'disabled')),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (tenant_id, email)
);

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  manager_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE team_members (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  name varchar(200) NOT NULL,
  normalized_name varchar(200),
  website varchar(255),
  domain citext,
  country_code char(2),
  region varchar(100),
  city varchar(100),
  industry varchar(120),
  tax_id varchar(100),
  credit_level char(1) CHECK (credit_level IN ('A', 'B', 'C', 'D')),
  compliance_status varchar(20) NOT NULL DEFAULT 'pending' CHECK (compliance_status IN ('pending', 'approved', 'restricted', 'blocked')),
  preferred_language varchar(16),
  preferred_currency char(3),
  lifecycle_status varchar(24) NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active', 'silent', 'public_pool', 'lost')),
  source varchar(80),
  ai_insight text,
  last_ai_summary_at timestamptz,
  last_contact_at timestamptz,
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  first_name varchar(80),
  last_name varchar(80),
  full_name varchar(160) NOT NULL,
  job_title varchar(120),
  department varchar(120),
  email citext,
  phone varchar(50),
  whatsapp varchar(50),
  timezone varchar(64),
  language varchar(16),
  preferred_channel varchar(30),
  employment_status varchar(20) NOT NULL DEFAULT 'active' CHECK (employment_status IN ('active', 'left', 'unknown')),
  is_primary boolean NOT NULL DEFAULT false,
  ai_generated boolean NOT NULL DEFAULT false,
  confidence_score numeric(5,4) CHECK (confidence_score BETWEEN 0 AND 1),
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  company_name varchar(200) NOT NULL,
  contact_name varchar(160),
  email citext,
  phone varchar(50),
  website varchar(255),
  country_code char(2),
  source varchar(80),
  source_detail varchar(160),
  interested_products text,
  inquiry_text text,
  status varchar(24) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'unassigned', 'contacted', 'nurturing', 'qualified', 'converted', 'disqualified', 'public_pool')),
  priority varchar(12) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  allocation_score numeric(5,2) CHECK (allocation_score BETWEEN 0 AND 100),
  ai_duplicate_group uuid,
  duplicate_confidence numeric(5,4) CHECK (duplicate_confidence BETWEEN 0 AND 1),
  next_follow_up_at timestamptz,
  converted_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  converted_at timestamptz,
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE opportunity_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name varchar(80) NOT NULL,
  code varchar(50) NOT NULL,
  position smallint NOT NULL,
  default_probability numeric(5,2) NOT NULL CHECK (default_probability BETWEEN 0 AND 100),
  is_won boolean NOT NULL DEFAULT false,
  is_lost boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, position)
);

CREATE TABLE opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  primary_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  source_lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  stage_id uuid NOT NULL REFERENCES opportunity_stages(id) ON DELETE RESTRICT,
  name varchar(200) NOT NULL,
  description text,
  amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency char(3) NOT NULL DEFAULT 'USD',
  expected_close_date date,
  probability numeric(5,2) CHECK (probability BETWEEN 0 AND 100),
  ai_predicted_probability numeric(5,2) CHECK (ai_predicted_probability BETWEEN 0 AND 100),
  ai_recommended_action text,
  competitor_info jsonb NOT NULL DEFAULT '[]'::jsonb,
  status varchar(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost', 'cancelled')),
  lost_reason varchar(200),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  deleted_at timestamptz
);

ALTER TABLE leads ADD COLUMN converted_opportunity_id uuid REFERENCES opportunities(id) ON DELETE SET NULL;

CREATE TABLE activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES opportunities(id) ON DELETE CASCADE,
  activity_type varchar(30) NOT NULL CHECK (activity_type IN ('note', 'call', 'email', 'meeting', 'whatsapp', 'stage_change', 'system')),
  subject varchar(200),
  content text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  next_action varchar(240),
  next_action_at timestamptz,
  ai_generated boolean NOT NULL DEFAULT false,
  source_language varchar(16),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (account_id IS NOT NULL OR lead_id IS NOT NULL OR opportunity_id IS NOT NULL)
);

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assignee_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES opportunities(id) ON DELETE CASCADE,
  title varchar(240) NOT NULL,
  description text,
  priority varchar(12) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status varchar(20) NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')),
  due_at timestamptz,
  reminder_at timestamptz,
  completed_at timestamptz,
  ai_generated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sku varchar(80) NOT NULL,
  name varchar(200) NOT NULL,
  category varchar(120),
  description text,
  specifications jsonb NOT NULL DEFAULT '{}'::jsonb,
  base_price numeric(18,4) NOT NULL DEFAULT 0 CHECK (base_price >= 0),
  base_currency char(3) NOT NULL DEFAULT 'USD',
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (tenant_id, sku)
);

CREATE TABLE exchange_rates (
  id bigserial PRIMARY KEY,
  base_currency char(3) NOT NULL,
  quote_currency char(3) NOT NULL,
  rate numeric(20,10) NOT NULL CHECK (rate > 0),
  rate_date date NOT NULL,
  source varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (base_currency, quote_currency, rate_date, source)
);

CREATE TABLE quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES opportunities(id) ON DELETE SET NULL,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  quote_number varchar(60) NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status varchar(24) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'sent', 'accepted', 'rejected', 'expired', 'cancelled')),
  currency char(3) NOT NULL DEFAULT 'USD',
  exchange_rate numeric(20,10) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  exchange_rate_date date,
  incoterm varchar(10),
  valid_until date,
  payment_terms text,
  shipping_cost numeric(18,2) NOT NULL DEFAULT 0,
  insurance_cost numeric(18,2) NOT NULL DEFAULT 0,
  subtotal numeric(18,2) NOT NULL DEFAULT 0,
  discount_amount numeric(18,2) NOT NULL DEFAULT 0,
  tax_amount numeric(18,2) NOT NULL DEFAULT 0,
  total_amount numeric(18,2) NOT NULL DEFAULT 0,
  risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  sent_at timestamptz,
  UNIQUE (tenant_id, quote_number, version)
);

CREATE TABLE quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  line_number integer NOT NULL,
  sku varchar(80),
  description varchar(500) NOT NULL,
  specifications jsonb NOT NULL DEFAULT '{}'::jsonb,
  quantity numeric(18,4) NOT NULL CHECK (quantity > 0),
  unit varchar(30) NOT NULL DEFAULT 'pcs',
  unit_price numeric(18,4) NOT NULL CHECK (unit_price >= 0),
  discount_rate numeric(7,4) NOT NULL DEFAULT 0 CHECK (discount_rate BETWEEN 0 AND 100),
  line_total numeric(18,2) NOT NULL CHECK (line_total >= 0),
  UNIQUE (quote_id, line_number)
);

CREATE TABLE approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type varchar(30) NOT NULL CHECK (entity_type IN ('quote', 'order')),
  entity_id uuid NOT NULL,
  level smallint NOT NULL DEFAULT 1,
  approver_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  comment text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  opportunity_id uuid REFERENCES opportunities(id) ON DELETE SET NULL,
  quote_id uuid REFERENCES quotes(id) ON DELETE SET NULL,
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  order_number varchar(60) NOT NULL,
  customer_po_number varchar(100),
  status varchar(24) NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'confirmed', 'in_production', 'ready_to_ship', 'shipped', 'completed', 'cancelled')),
  currency char(3) NOT NULL DEFAULT 'USD',
  total_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  incoterm varchar(10),
  payment_terms text,
  delivery_date date,
  shipping_address jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  completed_at timestamptz,
  UNIQUE (tenant_id, order_number)
);

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  line_number integer NOT NULL,
  sku varchar(80),
  description varchar(500) NOT NULL,
  specifications jsonb NOT NULL DEFAULT '{}'::jsonb,
  quantity numeric(18,4) NOT NULL CHECK (quantity > 0),
  unit varchar(30) NOT NULL DEFAULT 'pcs',
  unit_price numeric(18,4) NOT NULL CHECK (unit_price >= 0),
  line_total numeric(18,2) NOT NULL CHECK (line_total >= 0),
  UNIQUE (order_id, line_number)
);

CREATE TABLE fulfillments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status varchar(24) NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'production', 'ready', 'shipped', 'delivered', 'exception')),
  carrier varchar(120),
  tracking_number varchar(120),
  vessel_or_flight varchar(120),
  etd date,
  eta date,
  shipped_at timestamptz,
  delivered_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  payment_number varchar(60),
  payment_type varchar(30) NOT NULL DEFAULT 'balance',
  status varchar(20) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'pending', 'received', 'overdue', 'cancelled')),
  currency char(3) NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  due_date date NOT NULL,
  received_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (received_amount >= 0),
  received_at timestamptz,
  bank_reference varchar(160),
  risk_flag boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  opportunity_id uuid REFERENCES opportunities(id) ON DELETE SET NULL,
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  external_message_id varchar(255),
  direction varchar(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_address citext NOT NULL,
  to_addresses jsonb NOT NULL DEFAULT '[]'::jsonb,
  cc_addresses jsonb NOT NULL DEFAULT '[]'::jsonb,
  subject text,
  body_text text,
  sent_at timestamptz,
  ai_summary text,
  ai_intent varchar(80),
  extracted_entities jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, external_message_id)
);

CREATE TABLE ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(200),
  context_type varchar(40),
  context_id uuid,
  model_provider varchar(50),
  model_name varchar(100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role varchar(12) NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content text NOT NULL,
  redacted_content text,
  intent varchar(80),
  extracted_entities jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_tokens integer CHECK (input_tokens >= 0),
  output_tokens integer CHECK (output_tokens >= 0),
  latency_ms integer CHECK (latency_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_action_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES ai_conversations(id) ON DELETE SET NULL,
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action_type varchar(80) NOT NULL,
  target_type varchar(50),
  target_id uuid,
  proposed_payload jsonb NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected', 'executed', 'failed', 'expired')),
  confirmed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  executed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_type varchar(20) NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user', 'ai', 'system', 'api')),
  action varchar(100) NOT NULL,
  entity_type varchar(50) NOT NULL,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  ip_address inet,
  user_agent text,
  request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_tenant_status ON users (tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_accounts_tenant_owner ON accounts (tenant_id, owner_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_accounts_tenant_name ON accounts (tenant_id, normalized_name) WHERE deleted_at IS NULL;
CREATE INDEX idx_accounts_domain ON accounts (tenant_id, domain) WHERE domain IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_contacts_account ON contacts (account_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_contacts_email ON contacts (tenant_id, email) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_leads_tenant_status_owner ON leads (tenant_id, status, owner_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_email ON leads (tenant_id, email) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_leads_follow_up ON leads (tenant_id, next_follow_up_at) WHERE status NOT IN ('converted', 'disqualified') AND deleted_at IS NULL;
CREATE INDEX idx_opportunities_pipeline ON opportunities (tenant_id, stage_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_opportunities_owner_close ON opportunities (tenant_id, owner_id, expected_close_date) WHERE status = 'open' AND deleted_at IS NULL;
CREATE INDEX idx_activities_account_time ON activities (account_id, occurred_at DESC);
CREATE INDEX idx_activities_opportunity_time ON activities (opportunity_id, occurred_at DESC);
CREATE INDEX idx_tasks_assignee_due ON tasks (tenant_id, assignee_id, due_at) WHERE status IN ('todo', 'in_progress');
CREATE INDEX idx_quotes_account_status ON quotes (tenant_id, account_id, status);
CREATE INDEX idx_orders_account_status ON orders (tenant_id, account_id, status);
CREATE INDEX idx_payments_due ON payments (tenant_id, due_date) WHERE status IN ('scheduled', 'pending', 'overdue');
CREATE INDEX idx_emails_account_time ON emails (account_id, sent_at DESC);
CREATE INDEX idx_ai_messages_conversation ON ai_messages (conversation_id, created_at);
CREATE INDEX idx_ai_actions_pending ON ai_action_requests (tenant_id, requested_by, created_at DESC) WHERE status = 'pending';
CREATE INDEX idx_audit_entity ON audit_logs (tenant_id, entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_logs (tenant_id, actor_id, created_at DESC);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'tenants','roles','users','teams','accounts','contacts','leads','opportunities',
    'tasks','products','quotes','orders','fulfillments','payments','ai_conversations'
  ]
  LOOP
    EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', table_name, table_name);
  END LOOP;
END $$;

CREATE VIEW v_sales_pipeline AS
SELECT
  s.tenant_id,
  s.id AS stage_id,
  s.name AS stage_name,
  s.position,
  count(o.id) AS opportunity_count,
  coalesce(sum(o.amount), 0) AS total_amount,
  coalesce(sum(o.amount * coalesce(o.ai_predicted_probability, o.probability, s.default_probability) / 100), 0) AS weighted_amount
FROM opportunity_stages s
LEFT JOIN opportunities o ON o.stage_id = s.id AND o.deleted_at IS NULL AND o.status = 'open'
GROUP BY s.tenant_id, s.id, s.name, s.position;

COMMENT ON DATABASE ai_crm IS 'AI-powered CRM for cross-border trade';
COMMENT ON TABLE ai_action_requests IS 'AI 写操作的提案、人工确认与执行记录，禁止绕过确认直接写入关键业务数据';
COMMENT ON TABLE audit_logs IS '用户、AI、系统及 API 的不可变业务审计记录';

COMMIT;
