import assert from 'node:assert/strict';
import { createServer } from 'node:http';
const password = process.env.CRM_ADMIN_PASSWORD;
if (!password)
    throw new Error('CRM_ADMIN_PASSWORD is required');
let receivedBody;
const lastRequest = () => { if (!receivedBody)
    throw new Error('Qwen request was not received'); return receivedBody; };
const fakeQwen = createServer((request, response) => { let raw = ''; request.on('data', chunk => raw += chunk); request.on('end', () => { receivedBody = JSON.parse(raw); response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ id: 'chatcmpl-test', model: receivedBody.model, choices: [{ message: { role: 'assistant', content: '这是来自千问测试适配器的回答。' }, finish_reason: 'stop' }], usage: { prompt_tokens: 42, completion_tokens: 12, total_tokens: 54 } })); }); });
await new Promise(resolve => fakeQwen.listen(0, '127.0.0.1', resolve));
const address = fakeQwen.address();
if (!address || typeof address === 'string')
    throw new Error('Fake Qwen server failed to start');
process.env.DASHSCOPE_API_KEY = 'test-dashscope-key';
process.env.DASHSCOPE_BASE_URL = `http://127.0.0.1:${address.port}/compatible-mode/v1`;
process.env.QWEN_DEFAULT_MODEL = 'qwen3.7-flash';
const [{ buildApp }, { db }, { createTestAdmin, deleteTestAdmin }] = await Promise.all([import('../server/app.js'), import('../server/db.js'), import('./test-auth.js')]);
const app = await buildApp();
let testUserId = '', conversationId = '';
try {
    const identity = await createTestAdmin('ai');
    testUserId = identity.userId;
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: identity.email, password, tenant: 'default' } });
    assert.equal(login.statusCode, 200, login.body);
    const authorization = `Bearer ${login.json().token}`;
    const models = await app.inject({ method: 'GET', url: '/api/ai/models', headers: { authorization } });
    assert.equal(models.statusCode, 200, models.body);
    assert.equal(models.json().data.configured, true);
    assert.equal(models.json().data.defaultModel, 'qwen3.7-flash');
    assert.deepEqual(models.json().data.models, ['qwen3.7-flash', 'qwen3.7-plus', 'qwen3.6-plus']);
    const chat = await app.inject({ method: 'POST', url: '/api/ai/chat', headers: { authorization }, payload: { message: '请介绍你的能力', context: { page: 'dashboard', pageTitle: '销售作战台' } } });
    assert.equal(chat.statusCode, 200, chat.body);
    conversationId = chat.json().data.conversationId;
    assert.equal(chat.json().data.message.content, '这是来自千问测试适配器的回答。');
    assert.equal(lastRequest().model, 'qwen3.7-flash');
    assert.equal(lastRequest().messages[0].role, 'system');
    const followUp = await app.inject({ method: 'POST', url: '/api/ai/chat', headers: { authorization }, payload: { message: '继续', conversationId, model: 'qwen3.7-plus' } });
    assert.equal(followUp.statusCode, 200, followUp.body);
    assert.equal(lastRequest().model, 'qwen3.7-plus');
    assert.equal(lastRequest().messages.length, 4);
    const history = await app.inject({ method: 'GET', url: `/api/ai/conversations/${conversationId}/messages`, headers: { authorization } });
    assert.equal(history.statusCode, 200, history.body);
    assert.deepEqual(history.json().data.messages.map((item) => item.role), ['user', 'assistant', 'user', 'assistant']);
    assert.equal(history.json().data.messages[1].input_tokens, 42);
    assert.equal(history.json().data.messages[1].output_tokens, 12);
    const unsupported = await app.inject({ method: 'POST', url: '/api/ai/chat', headers: { authorization }, payload: { message: 'test', model: 'not-allowed' } });
    assert.equal(unsupported.statusCode, 400, unsupported.body);
    console.log(JSON.stringify({ qwenCompatibleApi: 'ok', defaultModel: 'qwen3.7-flash', modelSwitch: 'ok', conversationPersistence: 'ok', tokenUsage: 'ok', modelWhitelist: 'ok' }));
}
finally {
    if (conversationId)
        await db.query(`DELETE FROM audit_logs WHERE entity_type='ai_conversation' AND entity_id=$1`, [conversationId]);
    if (testUserId)
        await deleteTestAdmin(testUserId);
    await app.close();
    await db.end();
    await new Promise(resolve => fakeQwen.close(() => resolve()));
}
