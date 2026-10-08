import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.env.DASHSCOPE_API_KEY = 'agent-fixture-key';
process.env.DASHSCOPE_BASE_URL = 'https://agent-fixture.invalid/compatible-mode/v1';
const [{ buildApp }, { db }, { saveConnection }, { publishingImages, applyAgentFields }] = await Promise.all([import('../server/app.js'), import('../server/db.js'), import('../server/integrations/1688.js'), import('../server/integrations/1688-agent.js')]);
const app = await buildApp(), originalFetch = globalThis.fetch, tenants = [];
let publishCalls = 0, visionCalls = 0, textCalls = 0, risk = false, speculative = false, invalidProposal = false, invalidRequired = false, unreadable = false, incomplete = false, uncertainPublish = false;
let onVision = null, lastPublished = null;
const schema = { global: { systemParam: { catId: 101 } }, data: { title: { fields: { required: true, maxLength: 60 } }, primaryPicture: { fields: { required: true } }, catProp: { fields: { dataSource: [{ name: 'p-1', label: '材质', required: true, dataSource: [{ value: 1, text: '棉' }] }, { name: 'p-3', label: '功率', required: false, uiType: 'input' }] } }, priceRange: { fields: { required: true } }, saleProp: { fields: { dataSource: [{ name: 'p-2', propertyId: 2, label: '颜色', required: true, dataSource: [{ value: 10, text: '红色' }] }] } }, skuTable: { fields: { column: [] } } } };
const response = (body) => new Response(JSON.stringify(body), { status: 200 });
globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === 'https://agent-fixture.invalid/compatible-mode/v1/chat/completions') {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, 'qwen3.8-flash');
        if (!body.response_format)
            return response({ model: 'qwen3.8-flash', choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] });
        assert.equal(body.response_format.type, 'json_object');
        const content = body.messages.at(-1).content;
        let value;
        if (Array.isArray(content)) {
            visionCalls++;
            if (onVision)
                await onVision();
            const images = content.filter((part) => part.type === 'image_url');
            assert.ok(images.every((image) => image.image_url.url.startsWith('https://cbu01.alicdn.com/')));
            value = { images: incomplete ? [] : images.map((_, index) => ({ index, readable: !unreadable, companyWatermark: { detected: risk || speculative, name: risk ? '测试店铺有限公司' : speculative ? '源头工厂' : '', confidence: risk || speculative ? 0.99 : 0 }, famousBrandLogo: { detected: risk || speculative, name: risk ? 'Nike' : speculative ? 'Tesla' : '', confidence: risk ? 0.99 : speculative ? 0.7 : 0 } })) };
        }
        else {
            textCalls++;
            value = { title: '棉质红色测试商品', catProp: { 'p-1': invalidRequired ? { value: 9, text: '错误枚举' } : { value: 1, text: '棉' }, ...(invalidProposal ? { 'p-unknown': { value: 9, text: '虚构' }, 'p-3': { value: 9, text: '文本字段误报' } } : {}) }, mapping: { 'fabricated-property': 'untrusted' }, unknown: [] };
        }
        return response({ model: 'qwen3.8-flash', choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] });
    }
    assert.ok(url.startsWith('https://gw.open.1688.com/openapi/'), 'all network calls must be mocked');
    if (url.includes('alibaba.new.product.getSchema'))
        return response({ result: { success: true, bizData: schema } });
    if (url.includes('alibaba.new.product.add')) {
        publishCalls++;
        lastPublished = JSON.parse((init?.body).get('dataBody'));
        if (uncertainPublish)
            throw new Error('fixture transport timeout');
        return response({ result: { success: true, bizData: { dataJson: JSON.stringify({ itemId: String(900000 + publishCalls), offerStatus: 'auditing' }) } } });
    }
    throw new Error('unexpected mocked API');
};
try {
    for (let i = 0; i < 2; i++)
        tenants.push((await db.query('INSERT INTO tenants(name,slug)VALUES($1,$2)RETURNING id', ['agent fixture', `agent-${randomUUID()}`])).rows[0].id);
    const tenant = tenants[0], actor = (await db.query("INSERT INTO users(tenant_id,email,display_name,status)VALUES($1,$2,'Agent 测试','active')RETURNING id", [tenant, `${randomUUID()}@fixture.local`])).rows[0].id;
    const token = (tenantId = tenant, permissions = ['*']) => app.jwt.sign({ sub: actor, tenantId, email: 'test', displayName: 'test', permissions, roles: [] });
    const request = (method, path, payload, bearer = token()) => app.inject({ method, url: `/api/integrations/1688${path}`, headers: { authorization: `Bearer ${bearer}` }, ...(payload ? { payload } : {}) });
    const connection = await saveConnection(tenant, actor, { aliId: `agent-${randomUUID()}`, access_token: 'fixture-access', expires_in: 36000 });
    const settingPath = `/connections/${connection.id}/agent-settings`;
    const preflight = await app.inject({ method: 'OPTIONS', url: `/api/integrations/1688${settingPath}`, headers: { origin: 'http://127.0.0.1:5173', 'access-control-request-method': 'PUT', 'access-control-request-headers': 'authorization,content-type' } });
    assert.equal(preflight.statusCode, 204);
    assert.ok(preflight.headers['access-control-allow-methods']?.includes('PUT'), 'browser preflight must allow the Agent settings PUT');
    const settings = () => request('GET', '/agent/settings');
    const toggle = async (enabled) => { const rev = (await settings()).json().data[0].revision; const result = await request('PUT', settingPath, { enabled, revision: rev, confirmed: true }); assert.equal(result.statusCode, 200, result.body); };
    async function draft() {
        const product = (await db.query("INSERT INTO products(tenant_id,sku,name,description,base_price,base_currency,status,images)VALUES($1,$2,'测试商品','材质：棉',12,'CNY','active',$3)RETURNING id", [tenant, `agent-${randomUUID()}`, JSON.stringify(['https://cbu01.alicdn.com/img/fixture.png'])])).rows[0];
        await db.query("INSERT INTO product_variants(tenant_id,product_id,position,label,attributes,unit_price,stock,image_url)VALUES($1,$2,0,'红色','{\"颜色\":\"红色\"}',15,7,'https://cbu01.alicdn.com/img/sku-fixture.png')", [tenant, product.id]);
        const created = await request('POST', '/drafts', { connectionId: connection.id, productId: product.id, catId: '101', scene: 'cbu' });
        assert.equal(created.statusCode, 201, created.body);
        return created.json().data;
    }
    const run = (d) => request('POST', `/drafts/${d.id}/agent`, { revision: d.revision });
    assert.equal((await settings()).json().data[0].enabled, false);
    assert.equal((await request('PUT', settingPath, { enabled: true, revision: 0, confirmed: false })).statusCode, 400);
    assert.equal((await request('PUT', settingPath, { enabled: true, revision: 0, confirmed: true }, token(tenants[1]))).statusCode, 404);
    assert.equal((await request('PUT', settingPath, { enabled: true, revision: 0, confirmed: true }, token(tenant, ['integration:read']))).statusCode, 403);
    const disabledDraft = await draft();
    assert.equal((await run(disabledDraft)).statusCode, 409);
    assert.equal(textCalls, 0);
    assert.equal((await request('POST', '/agent/test', undefined, token(tenant, ['integration:read']))).statusCode, 403);
    assert.equal((await request('POST', '/agent/test')).json().data.connected, true);
    await toggle(true);
    assert.equal((await request('PUT', settingPath, { enabled: true, revision: 0, confirmed: true })).statusCode, 409);
    await db.query("INSERT INTO collected_products(tenant_id,source,source_product_id,source_url,title,main_image_url,gallery_images,detail_images,currency,attributes,source_category_id,product_id,collected_by)VALUES($1,'1688',$2,$3,'棉质红色测试商品','https://cbu01.alicdn.com/img/fixture.png','[]','[]','CNY',$4,'101',$5,$6)", [tenant, randomUUID(), `https://detail.1688.com/offer/${randomUUID()}.html`, JSON.stringify({ 材质: '棉', 功率: '120' }), disabledDraft.product_id, actor]);
    const success = await run(disabledDraft);
    assert.equal(success.statusCode, 200, success.body);
    assert.equal(success.json().data.status, 'published');
    assert.equal(publishCalls, 1);
    assert.equal(lastPublished.formValues.title, '棉质红色测试商品');
    assert.equal(lastPublished.formValues.skuTable[0].sku_price, 15);
    assert.equal(lastPublished.formValues.skuTable[0].sku_amountOnSale, 7);
    assert.equal(lastPublished.formValues.catProp['p-3'], '120');
    assert.equal(success.json().data.report.images.length, 2, 'SKU images must be inspected too');
    assert.equal((await run(disabledDraft)).statusCode, 409);
    assert.equal(publishCalls, 1);
    risk = true;
    const riskDraft = await draft();
    const risky = await run(riskDraft);
    assert.equal(risky.json().data.status, 'blocked');
    assert.match(risky.json().data.message, /水印/);
    assert.equal(publishCalls, 1);
    risk = false;
    unreadable = true;
    assert.equal((await run(await draft())).json().data.status, 'blocked');
    unreadable = false;
    incomplete = true;
    assert.equal((await run(await draft())).json().data.status, 'blocked');
    incomplete = false;
    const stoppedDraft = await draft();
    onVision = () => toggle(false);
    const stopped = await run(stoppedDraft);
    assert.equal(stopped.json().data.status, 'blocked');
    assert.equal(publishCalls, 1);
    onVision = null;
    await toggle(true);
    const concurrentDraft = await draft();
    onVision = async () => { const duplicate = await run(concurrentDraft); assert.equal(duplicate.statusCode, 409); const saved = await request('PATCH', `/drafts/${concurrentDraft.id}`, { revision: 1, formValues: concurrentDraft.data_body.formValues }); assert.equal(saved.statusCode, 200); };
    assert.equal((await run(concurrentDraft)).json().data.status, 'blocked');
    assert.equal(publishCalls, 1);
    onVision = null;
    const cancelDraft = await draft();
    onVision = async () => { const job = (await request('GET', `/drafts/${cancelDraft.id}/agent-job`)).json().data; assert.equal((await request('POST', `/agent-jobs/${job.id}/cancel`)).statusCode, 200); };
    assert.equal((await run(cancelDraft)).json().data.status, 'cancelled');
    assert.equal(publishCalls, 1);
    onVision = null;
    uncertainPublish = true;
    const unknownDraft = await draft();
    assert.equal((await run(unknownDraft)).json().data.status, 'unknown');
    const count = publishCalls;
    assert.equal((await run(unknownDraft)).statusCode, 409);
    assert.equal(publishCalls, count);
    uncertainPublish = false;
    speculative = true;
    const ordinary = await run(await draft());
    assert.equal(ordinary.json().data.status, 'published');
    assert.equal(publishCalls, count + 1);
    assert.equal(ordinary.json().data.report.images[0].watermark, false);
    assert.equal(ordinary.json().data.report.images[0].rightsRisk, false);
    speculative = false;
    invalidProposal = true;
    const ignored = await run(await draft());
    assert.equal(ignored.json().data.status, 'published');
    assert.equal(publishCalls, count + 2);
    assert.equal(lastPublished.formValues.catProp['p-unknown'], undefined);
    assert.equal(lastPublished.formValues.catProp['p-3'], undefined);
    invalidProposal = false;
    invalidRequired = true;
    const missingRequired = await run(await draft());
    assert.equal(missingRequired.json().data.status, 'blocked');
    assert.match(missingRequired.json().data.message, /材质/);
    assert.equal(publishCalls, count + 2);
    invalidRequired = false;
    assert.throws(() => publishingImages({ primaryPicture: { imageList: [{ url: 'https://127.0.0.1/secret.png' }] } }));
    assert.throws(() => publishingImages({ description: { content: '<img src="https://cbu01.alicdn.com/a.png" srcset="https://example.org/b.png">' } }));
    assert.equal(applyAgentFields(schema, {}, { title: '标题', catProp: { 'p-1': { value: 9, text: '假的材质' } }, unknown: [] }).catProp['p-1'], undefined);
    assert.throws(() => applyAgentFields(schema, {}, { title: '标题', catProp: {}, unknown: [], priceRange: [{ price: 1 }] }));
    assert.equal(applyAgentFields(schema, {}, { title: '标题', catProp: { 'p-1': { value: 1, text: '棉' } }, unknown: [] }, { text: '材质未提供', attributes: {} }).catProp['p-1'], undefined);
    assert.equal(applyAgentFields(schema, {}, { title: '标题', catProp: { 'p-1': { value: 1, text: '棉' } }, unknown: [] }, { text: '棉质产品', attributes: {} }).catProp['p-1'].value, 1);
    assert.equal(applyAgentFields(schema, { catProp: { 'p-1': { value: 1, text: '棉' }, 'p-3': '人工填写功率' } }, { title: '标题', catProp: { 'p-1': { value: 999, text: '错误覆盖' }, 'p-3': { value: 999, text: '错误覆盖' } }, unknown: ['功率'] }).catProp['p-3'], '人工填写功率');
    assert.deepEqual(publishingImages({ description: { content: '<img src="https://cbu01.alicdn.com/img/a.png?x=1&amp;y=2">' } }), ['https://cbu01.alicdn.com/img/a.png?x=1&y=2']);
    console.log(JSON.stringify({ modeDefaultOff: 'ok', agentSettingsCors: 'ok', permissions: 'ok', tenantIsolation: 'ok', settingsRevision: 'ok', model: 'qwen3.8-flash', automaticPublish: 'ok', reviewedSkuPrices: 'ok', allImagesInspected: 'ok', riskBlocking: 'ok', speculativeLogoAllowed: 'ok', invalidProposalIgnored: 'ok', invalidRequiredBlocked: 'ok', unreadableBlocking: 'ok', incompleteBlocking: 'ok', disableBeforePublish: 'ok', draftRace: 'ok', duplicateJob: 'ok', cancel: 'ok', unknownNoRetry: 'ok', imageHostGuard: 'ok', enumGuard: 'ok', economicFieldGuard: 'ok', textCalls, visionCalls, mockPublishCalls: publishCalls, livePlatformWrites: 0 }));
}
finally {
    globalThis.fetch = originalFetch;
    for (const tenant of tenants) {
        await db.query('DELETE FROM audit_logs WHERE tenant_id=$1', [tenant]);
        await db.query('DELETE FROM tenants WHERE id=$1', [tenant]);
    }
    await app.close();
    await db.end();
}
