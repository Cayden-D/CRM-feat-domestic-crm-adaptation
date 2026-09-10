import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../server/app.js';
import { db } from '../server/db.js';
import { createTestAdmin, deleteTestAdmin } from './test-auth.js';
const password = process.env.CRM_ADMIN_PASSWORD;
if (!password)
    throw new Error('CRM_ADMIN_PASSWORD is required');
const app = await buildApp();
let accountId = '';
let contactId = '';
let opportunityId = '';
let activityId = '';
let taskId = '';
let orderId = '';
let paymentId = '';
let testUserId = '';
try {
    const identity = await createTestAdmin('customer');
    testUserId = identity.userId;
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: identity.email, password, tenant: 'default' } });
    assert.equal(login.statusCode, 200, login.body);
    const authorization = `Bearer ${login.json().token}`;
    const marker = randomUUID().slice(0, 8);
    const created = await app.inject({ method: 'POST', url: '/api/accounts', headers: { authorization }, payload: { name: `Customer 360 ${marker}`, province: '浙江省', city: '杭州市', district: '余杭区', industry: 'HVAC', creditLevel: 'B', source: 'integration-test' } });
    assert.equal(created.statusCode, 201, created.body);
    accountId = created.json().data.id;
    const listed = await app.inject({ method: 'GET', url: `/api/accounts?search=${marker}`, headers: { authorization } });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.equal(listed.json().pagination.total, 1);
    const updated = await app.inject({ method: 'PATCH', url: `/api/accounts/${accountId}`, headers: { authorization }, payload: { name: `Customer 360 ${marker}`, creditLevel: 'A', lifecycleStatus: 'active', address: '文一西路 998 号' } });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal(updated.json().data.credit_level, 'A');
    const contact = await app.inject({ method: 'POST', url: `/api/accounts/${accountId}/contacts`, headers: { authorization }, payload: { fullName: '王芳', jobTitle: '采购经理', wechat: `wx-${marker}`, preferredChannel: 'wechat', isPrimary: true } });
    assert.equal(contact.statusCode, 201, contact.body);
    contactId = contact.json().data.id;
    const contactUpdated = await app.inject({ method: 'PATCH', url: `/api/accounts/${accountId}/contacts/${contactId}`, headers: { authorization }, payload: { phone: '+49 40 1234 5678' } });
    assert.equal(contactUpdated.statusCode, 200, contactUpdated.body);
    assert.equal(contactUpdated.json().data.phone, '+49 40 1234 5678');
    const context = await db.query(`SELECT a.tenant_id,a.owner_id,s.id AS stage_id FROM accounts a JOIN opportunity_stages s ON s.tenant_id=a.tenant_id AND s.code='initial_contact' WHERE a.id=$1`, [accountId]);
    const { tenant_id: tenantId, owner_id: ownerId, stage_id: stageId } = context.rows[0];
    opportunityId = (await db.query(`INSERT INTO opportunities (tenant_id,account_id,primary_contact_id,owner_id,stage_id,name,amount,currency,probability,created_by) VALUES ($1,$2,$3,$4,$5,$6,25000,'CNY',35,$4) RETURNING id`, [tenantId, accountId, contactId, ownerId, stageId, `Customer test opportunity ${marker}`])).rows[0].id;
    activityId = (await db.query(`INSERT INTO activities (tenant_id,actor_id,account_id,contact_id,activity_type,content,next_action,next_action_at) VALUES ($1,$2,$3,$4,'meeting','Reviewed annual sourcing plan.','Send technical proposal',now()+interval '2 days') RETURNING id`, [tenantId, ownerId, accountId, contactId])).rows[0].id;
    taskId = (await db.query(`INSERT INTO tasks (tenant_id,assignee_id,created_by,account_id,title,due_at) VALUES ($1,$2,$2,$3,'Send technical proposal',now()+interval '2 days') RETURNING id`, [tenantId, ownerId, accountId])).rows[0].id;
    orderId = (await db.query(`INSERT INTO orders (tenant_id,account_id,owner_id,order_number,status,currency,total_amount) VALUES ($1,$2,$3,$4,'confirmed','CNY',8000) RETURNING id`, [tenantId, accountId, ownerId, `TEST-${marker}`])).rows[0].id;
    paymentId = (await db.query(`INSERT INTO payments (tenant_id,order_id,payment_number,status,currency,amount,due_date,received_amount) VALUES ($1,$2,$3,'received','CNY',8000,current_date,8000) RETURNING id`, [tenantId, orderId, `PAY-${marker}`])).rows[0].id;
    const detail = await app.inject({ method: 'GET', url: `/api/accounts/${accountId}`, headers: { authorization } });
    assert.equal(detail.statusCode, 200, detail.body);
    assert.equal(detail.json().data.contacts.length, 1);
    assert.equal(detail.json().data.summary.openOpportunityCount, 1);
    assert.equal(detail.json().data.summary.openPipeline, 25000);
    assert.equal(detail.json().data.summary.orderTotal, 8000);
    assert.equal(Number(detail.json().data.summary.received_amount), 8000);
    assert.equal(detail.json().data.activities.length, 1);
    assert.equal(detail.json().data.tasks.length, 1);
    const removedContact = await app.inject({ method: 'DELETE', url: `/api/accounts/${accountId}/contacts/${contactId}`, headers: { authorization } });
    assert.equal(removedContact.statusCode, 204, removedContact.body);
    const removedAccount = await app.inject({ method: 'DELETE', url: `/api/accounts/${accountId}`, headers: { authorization } });
    assert.equal(removedAccount.statusCode, 204, removedAccount.body);
    const accountAudit = await db.query(`SELECT count(*)::text FROM audit_logs WHERE entity_type='account' AND entity_id=$1`, [accountId]);
    const contactAudit = await db.query(`SELECT count(*)::text FROM audit_logs WHERE entity_type='contact' AND entity_id=$1`, [contactId]);
    assert.equal(Number(accountAudit.rows[0].count), 3);
    assert.equal(Number(contactAudit.rows[0].count), 3);
    console.log(JSON.stringify({ customerCrud: 'ok', contactCrud: 'ok', customer360: 'ok', tenantAndAudit: 'ok', accountAudit: 3, contactAudit: 3 }));
}
finally {
    if (paymentId)
        await db.query('DELETE FROM payments WHERE id=$1', [paymentId]);
    if (orderId)
        await db.query('DELETE FROM orders WHERE id=$1', [orderId]);
    if (taskId)
        await db.query('DELETE FROM tasks WHERE id=$1', [taskId]);
    if (activityId)
        await db.query('DELETE FROM activities WHERE id=$1', [activityId]);
    if (opportunityId)
        await db.query('DELETE FROM opportunities WHERE id=$1', [opportunityId]);
    if (contactId) {
        await db.query('DELETE FROM audit_logs WHERE entity_id=$1', [contactId]);
        await db.query('DELETE FROM contacts WHERE id=$1', [contactId]);
    }
    if (accountId) {
        await db.query('DELETE FROM audit_logs WHERE entity_id=$1', [accountId]);
        await db.query('DELETE FROM accounts WHERE id=$1', [accountId]);
    }
    await deleteTestAdmin(testUserId);
    await app.close();
    await db.end();
}
