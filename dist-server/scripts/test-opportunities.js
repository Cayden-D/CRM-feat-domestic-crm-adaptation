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
let opportunityId = '';
let testUserId = '';
try {
    const identity = await createTestAdmin('opportunity');
    testUserId = identity.userId;
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: identity.email, password, tenant: 'default' } });
    assert.equal(login.statusCode, 200, login.body);
    const authorization = `Bearer ${login.json().token}`;
    const marker = randomUUID().slice(0, 8);
    const account = await app.inject({ method: 'POST', url: '/api/accounts', headers: { authorization }, payload: { name: `Opportunity Test ${marker}`, province: '广东省', city: '深圳市', source: 'opportunity-integration-test' } });
    assert.equal(account.statusCode, 201, account.body);
    accountId = account.json().data.id;
    const stages = await app.inject({ method: 'GET', url: '/api/opportunities/stages', headers: { authorization } });
    assert.equal(stages.statusCode, 200, stages.body);
    assert.equal(stages.json().data.length, 7);
    const initial = stages.json().data.find((stage) => stage.code === 'initial_contact');
    const needs = stages.json().data.find((stage) => stage.code === 'needs_confirmed');
    assert.ok(initial && needs);
    const created = await app.inject({ method: 'POST', url: '/api/opportunities', headers: { authorization }, payload: { accountId, stageId: initial.id, name: `Annual supply ${marker}`, amount: 42000, expectedCloseDate: '2026-09-30' } });
    assert.equal(created.statusCode, 201, created.body);
    opportunityId = created.json().data.id;
    assert.equal(Number(created.json().data.probability), 20);
    const updated = await app.inject({ method: 'PATCH', url: `/api/opportunities/${opportunityId}`, headers: { authorization }, payload: { name: `Annual supply ${marker}`, amount: 50000, probability: 30, description: 'Annual sourcing program' } });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal(Number(updated.json().data.amount), 50000);
    const activity = await app.inject({ method: 'POST', url: `/api/opportunities/${opportunityId}/activities`, headers: { authorization }, payload: { activityType: 'call', content: 'Confirmed annual volume and delivery cadence.', nextAction: 'Prepare specification matrix', nextActionAt: new Date(Date.now() + 86_400_000).toISOString() } });
    assert.equal(activity.statusCode, 201, activity.body);
    const advanced = await app.inject({ method: 'POST', url: `/api/opportunities/${opportunityId}/stage`, headers: { authorization }, payload: { stageId: needs.id, note: 'Customer confirmed volume and target specification.', nextAction: 'Send specification matrix', nextActionAt: new Date(Date.now() + 172_800_000).toISOString() } });
    assert.equal(advanced.statusCode, 200, advanced.body);
    assert.equal(advanced.json().data.stage_id, needs.id);
    assert.equal(Number(advanced.json().data.probability), 40);
    const board = await app.inject({ method: 'GET', url: `/api/opportunities?search=${marker}`, headers: { authorization } });
    assert.equal(board.statusCode, 200, board.body);
    assert.equal(board.json().summary.totalCount, 1);
    assert.equal(board.json().summary.totalAmount, 50000);
    assert.equal(board.json().summary.weightedAmount, 20000);
    assert.equal(board.json().data[0].stage_code, 'needs_confirmed');
    const detail = await app.inject({ method: 'GET', url: `/api/opportunities/${opportunityId}`, headers: { authorization } });
    assert.equal(detail.statusCode, 200, detail.body);
    assert.equal(detail.json().data.history.length, 2);
    assert.equal(detail.json().data.activities.length, 2);
    assert.equal(detail.json().data.tasks.length, 2);
    const removed = await app.inject({ method: 'DELETE', url: `/api/opportunities/${opportunityId}`, headers: { authorization } });
    assert.equal(removed.statusCode, 204, removed.body);
    const audits = await db.query(`SELECT count(*)::text FROM audit_logs WHERE entity_type='opportunity' AND entity_id=$1`, [opportunityId]);
    assert.equal(Number(audits.rows[0].count), 5);
    console.log(JSON.stringify({ opportunityCrud: 'ok', stageHistory: 'ok', followupTasks: 'ok', weightedForecast: 'ok', auditRecords: 5 }));
}
finally {
    if (opportunityId) {
        await db.query('DELETE FROM audit_logs WHERE entity_id=$1', [opportunityId]);
        await db.query('DELETE FROM opportunities WHERE id=$1', [opportunityId]);
    }
    if (accountId) {
        await db.query('DELETE FROM audit_logs WHERE entity_id=$1', [accountId]);
        await db.query('DELETE FROM accounts WHERE id=$1', [accountId]);
    }
    await deleteTestAdmin(testUserId);
    await app.close();
    await db.end();
}
