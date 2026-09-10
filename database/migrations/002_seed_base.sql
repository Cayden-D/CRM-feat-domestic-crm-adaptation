BEGIN;

INSERT INTO tenants (name, slug, default_currency, default_timezone, default_locale)
VALUES ('航迹 CRM 演示组织', 'default', 'USD', 'Asia/Shanghai', 'zh-CN')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO roles (tenant_id, code, name, permissions, is_system)
SELECT t.id, v.code, v.name, v.permissions::jsonb, true
FROM tenants t
CROSS JOIN (VALUES
  ('super_admin', '超级管理员', '["*"]'),
  ('sales_manager', '销售经理', '["dashboard:*","lead:*","account:*","opportunity:*","quote:approve","report:read"]'),
  ('sales_rep', '外贸业务员', '["dashboard:read","lead:own","account:own","opportunity:own","quote:own","order:read"]'),
  ('order_specialist', '跟单员', '["order:*","fulfillment:*","account:read"]'),
  ('finance', '财务人员', '["order:read","payment:*","report:finance"]'),
  ('executive', '管理层', '["dashboard:*","report:*","account:read","opportunity:read"]')
) AS v(code, name, permissions)
WHERE t.slug = 'default'
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO opportunity_stages (tenant_id, name, code, position, default_probability, is_won, is_lost)
SELECT t.id, v.name, v.code, v.position, v.probability, v.is_won, v.is_lost
FROM tenants t
CROSS JOIN (VALUES
  ('初步接触', 'initial_contact', 1, 20.00, false, false),
  ('需求确认', 'needs_confirmed', 2, 40.00, false, false),
  ('方案报价', 'proposal_quote', 3, 60.00, false, false),
  ('商务谈判', 'negotiation', 4, 80.00, false, false),
  ('合同签订', 'contract_signed', 5, 95.00, false, false),
  ('已成交', 'won', 6, 100.00, true, false),
  ('已丢失', 'lost', 7, 0.00, false, true)
) AS v(name, code, position, probability, is_won, is_lost)
WHERE t.slug = 'default'
ON CONFLICT (tenant_id, code) DO NOTHING;

COMMIT;
