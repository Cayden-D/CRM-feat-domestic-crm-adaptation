import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../server/app.js';
import { db } from '../server/db.js';
import { createTestAdmin, deleteTestAdmin } from './test-auth.js';
const password = process.env.CRM_ADMIN_PASSWORD;
if (!password)
    throw new Error('CRM_ADMIN_PASSWORD is required');
const app = await buildApp();
let leadId = '';
let accountId = '';
let opportunityId = '';
let testUserId = '';
try {
    const identity = await createTestAdmin('lead');
    testUserId = identity.userId;
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().database, 'ai_crm');
    const unauthorized = await app.inject({ method: 'GET', url: '/api/leads' });
    assert.equal(unauthorized.statusCode, 401);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: {
            email: identity.email, password, tenant: 'default',
        } });
    assert.equal(login.statusCode, 200, login.body);
    const token = login.json().token;
    const authorization = `Bearer ${token}`;
    const marker = randomUUID().slice(0, 8);
    const created = await app.inject({ method: 'POST', url: '/api/leads', headers: { authorization }, payload: {
            companyName: `API Integration ${marker}`,
            contactName: 'Test Contact',
            email: `api-${marker}@example.com`,
            province: '江苏省', city: '南京市',
            source: 'integration-test',
            priority: 'high',
        } });
    assert.equal(created.statusCode, 201, created.body);
    leadId = created.json().data.id;
    const detail = await app.inject({ method: 'GET', url: `/api/leads/${leadId}`, headers: { authorization } });
    assert.equal(detail.statusCode, 200, detail.body);
    const updated = await app.inject({ method: 'PATCH', url: `/api/leads/${leadId}`, headers: { authorization }, payload: {
            companyName: `API Integration ${marker}`,
            contactName: 'Test Contact',
            email: `api-${marker}@example.com`,
            phone: null,
            province: '江苏省', city: '南京市',
            source: 'integration-test',
            interestedProducts: 'C23 smart thermostat',
            status: 'contacted',
            priority: 'urgent',
        } });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal(updated.json().data.status, 'contacted');
    const duplicates = await app.inject({ method: 'POST', url: '/api/leads/check-duplicates', headers: { authorization }, payload: {
            companyName: `API Integration ${marker}`, email: `api-${marker}@example.com`,
        } });
    assert.equal(duplicates.statusCode, 200, duplicates.body);
    assert.ok(duplicates.json().data.some((item) => item.id === leadId));
    const users = await app.inject({ method: 'GET', url: '/api/users/assignable', headers: { authorization } });
    assert.equal(users.statusCode, 200, users.body);
    assert.ok(users.json().data.length >= 1);
    const activity = await app.inject({ method: 'POST', url: `/api/leads/${leadId}/activities`, headers: { authorization }, payload: {
            activityType: 'call', content: 'Discussed sample requirements.', nextAction: 'Send sample list', nextActionAt: new Date(Date.now() + 86_400_000).toISOString(),
        } });
    assert.equal(activity.statusCode, 201, activity.body);
    const activities = await app.inject({ method: 'GET', url: `/api/leads/${leadId}/activities`, headers: { authorization } });
    assert.equal(activities.statusCode, 200, activities.body);
    assert.equal(activities.json().data.length, 1);
    const converted = await app.inject({ method: 'POST', url: `/api/leads/${leadId}/convert`, headers: { authorization }, payload: {
            createOpportunity: true, opportunityName: `Integration opportunity ${marker}`, amount: 12000,
        } });
    assert.equal(converted.statusCode, 201, converted.body);
    accountId = converted.json().data.account.id;
    opportunityId = converted.json().data.opportunity.id;
    assert.ok(accountId);
    assert.ok(opportunityId);
    const listed = await app.inject({ method: 'GET', url: `/api/leads?search=${marker}`, headers: { authorization } });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.equal(listed.json().pagination.total, 1);
    const removed = await app.inject({ method: 'DELETE', url: `/api/leads/${leadId}`, headers: { authorization } });
    assert.equal(removed.statusCode, 204, removed.body);
    const audit = await db.query('SELECT count(*)::text FROM audit_logs WHERE entity_id = $1', [leadId]);
    assert.equal(Number(audit.rows[0].count), 5);
    console.log(JSON.stringify({ health: 'ok', auth: 'ok', duplicateCheck: 'ok', assignment: 'ok', activities: 'ok', conversion: 'ok', auditRecords: 5 }));
}
finally {
    if (leadId) {
        await db.query('UPDATE leads SET converted_account_id=NULL, converted_opportunity_id=NULL WHERE id=$1', [leadId]);
        await db.query('DELETE FROM audit_logs WHERE entity_id=$1', [leadId]);
        await db.query('DELETE FROM leads WHERE id=$1', [leadId]);
    }
    if (opportunityId)
        await db.query('DELETE FROM opportunities WHERE id=$1', [opportunityId]);
    if (accountId) {
        await db.query('DELETE FROM contacts WHERE account_id=$1', [accountId]);
        const deletedAccount = await db.query('DELETE FROM accounts WHERE id=$1 RETURNING id', [accountId]);
        assert.equal(deletedAccount.rowCount, 1, 'integration-test account was not deleted');
        const remaining = await db.query('SELECT count(*)::text FROM accounts WHERE id=$1', [accountId]);
        assert.equal(Number(remaining.rows[0].count), 0, 'integration-test account cleanup failed');
    }
    await deleteTestAdmin(testUserId);
    await app.close();
    await db.end();
}
