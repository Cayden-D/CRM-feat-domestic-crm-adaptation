import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
process.env.DASHSCOPE_API_KEY = 'image-fixture-key';
process.env.DASHSCOPE_BASE_URL = 'https://image-fixture.invalid/compatible-mode/v1';
process.env.OSS_REGION = 'oss-cn-beijing';
process.env.OSS_BUCKET = 'image-fixture-bucket';
process.env.OSS_ACCESS_KEY_ID = 'image-fixture-id';
process.env.OSS_ACCESS_KEY_SECRET = 'image-fixture-secret';
process.env.OSS_CUSTOM_DOMAIN = 'https://images.example.com';
const { default: OSS } = await import('ali-oss');
const originalPut = OSS.prototype.put, originalGet = OSS.prototype.get, originalDelete = OSS.prototype.delete;
const objects = new Map();
let puts = 0, reads = 0, failPut = false;
OSS.prototype.put = async function (key, bytes, options) { assert.equal(this.options.endpoint.hostname, 'oss-cn-beijing.aliyuncs.com'); assert.equal(options.mime, 'image/png'); assert.equal(options.headers['x-oss-object-acl'], 'private'); assert.equal(options.headers['x-oss-forbid-overwrite'], 'true'); if (failPut)
    throw new Error('fixture OSS outage'); objects.set(key, bytes); puts++; return { name: key }; };
OSS.prototype.get = async function (key) { assert.equal(this.options.endpoint.hostname, 'oss-cn-beijing.aliyuncs.com'); reads++; assert.ok(objects.has(key)); return { content: objects.get(key) }; };
OSS.prototype.delete = async (key) => { objects.delete(key); return {}; };
const { generatedImageUrl } = await import('../server/llm/qwen-image.js');
const { config } = await import('../server/config.js');
const [{ buildApp }, { db }, { saveConnection }] = await Promise.all([import('../server/app.js'), import('../server/db.js'), import('../server/integrations/1688.js')]);
const app = await buildApp(), originalFetch = globalThis.fetch, tenants = [];
const png = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#ced9d2' } }).png().toBuffer();
const resultUrl = 'https://dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com/agent-fixture.png?Expires=2099999999';
assert.equal(generatedImageUrl('https://dashscope-a717.oss-accelerate.aliyuncs.com/test.png?Expires=2099999999'), 'https://dashscope-a717.oss-accelerate.aliyuncs.com/test.png?Expires=2099999999');
assert.throws(() => generatedImageUrl('https://dashscope-a717.oss-accelerate.aliyuncs.com.evil.test/test.png'));
let generated = 0, vision = 0, photos = 0, blocked = false, riskySource = false, photoBody = null;
let concurrent = null;
const response = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === 'https://image-fixture.invalid/compatible-mode/v1/images/generations') {
        generated++;
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, 'qwen-image-3.0');
        assert.equal(body.size, '1024x1024');
        assert.equal(body.n, 1);
        assert.equal(body.watermark, false);
        assert.ok(!Object.hasOwn(body, 'image') || ['https://cbu01.alicdn.com/img/source.png', 'https://cbu01.alicdn.com/img/generated.jpg'].includes(body.image));
        return response({ data: [{ url: resultUrl }], created: 123 });
    }
    if (url === 'https://image-fixture.invalid/compatible-mode/v1/chat/completions') {
        vision++;
        const body = JSON.parse(String(init?.body)), image = body.messages.at(-1).content[1].image_url.url;
        return response({ model: 'qwen3.8-flash', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ images: [{ index: 0, readable: true, companyWatermark: { detected: blocked && image === resultUrl, name: blocked && image === resultUrl ? '测试店铺有限公司' : '', confidence: blocked && image === resultUrl ? 0.99 : 0 }, famousBrandLogo: { detected: riskySource && image.includes('generated.jpg'), name: riskySource && image.includes('generated.jpg') ? 'Nike' : '', confidence: riskySource && image.includes('generated.jpg') ? 0.99 : 0 } }] }) } }] });
    }
    if (url === resultUrl)
        return new Response(png, { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(png.length) } });
    assert.ok(url.startsWith('https://gw.open.1688.com/openapi/'), 'unexpected external request');
    if (url.includes('alibaba.photobank.photo.add')) {
        photos++;
        assert.ok(init?.body instanceof FormData);
        photoBody = init.body;
        assert.equal(photoBody.get('albumID'), '123');
        assert.equal(photoBody.get('imageBytes').type, 'image/jpeg');
        if (concurrent) {
            const release = concurrent;
            concurrent = null;
            await new Promise(resolve => { release(); setTimeout(resolve, 80); });
        }
        return response({ image: { id: 'photo-fixture', url: 'https://cbu01.alicdn.com/img/generated.jpg' } });
    }
    throw new Error('unexpected gateway endpoint');
};
try {
    for (let i = 0; i < 2; i++)
        tenants.push((await db.query('INSERT INTO tenants(name,slug)VALUES($1,$2)RETURNING id', ['image fixture', `image-${randomUUID()}`])).rows[0].id);
    const tenant = tenants[0], actor = (await db.query("INSERT INTO users(tenant_id,email,display_name,status)VALUES($1,$2,'图像测试','active')RETURNING id", [tenant, `${randomUUID()}@fixture.local`])).rows[0].id;
    const token = (tenantId = tenant, permissions = ['*']) => app.jwt.sign({ sub: actor, tenantId, email: 'test', displayName: 'test', roles: [], permissions });
    const request = (method, path, payload, bearer = token()) => app.inject({ method, url: `/api/integrations/1688${path}`, headers: { authorization: `Bearer ${bearer}` }, ...(payload ? { payload } : {}) });
    const connection = await saveConnection(tenant, actor, { aliId: `images-${randomUUID()}`, access_token: 'fixture', expires_in: 36000 });
    const product = (await db.query("INSERT INTO products(tenant_id,sku,name,base_price,base_currency,status,images)VALUES($1,$2,'图像商品',12,'CNY','active','[\"https://cbu01.alicdn.com/img/source.png\"]')RETURNING id", [tenant, `image-${randomUUID()}`])).rows[0];
    const draft = (await db.query("INSERT INTO integration_1688_publish_drafts(tenant_id,connection_id,product_id,cat_id,scene,platform_schema,data_body,status)VALUES($1,$2,$3,'101','cbu',$4,$5,'draft')RETURNING *", [tenant, connection.id, product.id, JSON.stringify({ global: {}, data: { primaryPicture: { fields: { maxItems: 5 } } } }), JSON.stringify({ global: {}, formValues: { title: '图像商品', primaryPicture: { imageList: [{ url: 'https://cbu01.alicdn.com/img/source.png' }] } } })])).rows[0];
    const path = `/drafts/${draft.id}/agent-images`;
    const create = (mode, sourceIndex, revision = 1) => request('POST', path, { revision, mode, model: 'qwen-image-3.0', prompt: '保持商品形状，使用纯净白色背景', sourceIndex, confirmed: true });
    assert.equal((await request('POST', path, { revision: 1, mode: 'generate', model: 'qwen-image-3.0', prompt: '去除图片水印并替换商标', confirmed: true })).statusCode, 400);
    assert.equal((await request('POST', path, { revision: 1, mode: 'edit', model: 'qwen-image-3.0', prompt: '保持商品形状，使用纯净白色背景', confirmed: true })).statusCode, 400);
    assert.equal((await create('generate', undefined, 2)).statusCode, 409);
    assert.equal((await create('generate', undefined, 1)).statusCode, 200);
    const first = (await request('GET', path)).json().data[0];
    assert.equal(first.storage, 'oss');
    assert.equal(new URL(first.url).hostname, 'images.example.com');
    assert.equal(new URL(first.url).searchParams.get('x-oss-signature-version'), 'OSS4-HMAC-SHA256');
    assert.equal(first.status, 'preview');
    assert.equal(generated, 1);
    assert.equal(vision, 1);
    assert.equal(puts, 1);
    assert.equal(photos, 0);
    config.OSS_CUSTOM_DOMAIN = undefined;
    const native = (await request('GET', path)).json().data[0];
    assert.equal(new URL(native.url).hostname, 'image-fixture-bucket.oss-cn-beijing.aliyuncs.com');
    config.OSS_CUSTOM_DOMAIN = 'https://images.example.com';
    const savedImage = (await db.query('SELECT oss_key,persisted_at FROM integration_1688_agent_images WHERE id=$1', [first.id])).rows[0];
    assert.ok(savedImage.oss_key);
    assert.ok(savedImage.persisted_at);
    await db.query("UPDATE integration_1688_agent_images SET expires_at=now()-interval '1 hour' WHERE id=$1", [first.id]);
    assert.equal((await request('GET', path)).json().data[0].id, first.id);
    assert.equal((await request('GET', path, undefined, token(tenants[1]))).statusCode, 404);
    const applyPath = `${path}/${first.id}/apply`, apply = (revision, placement = 'replace') => request('POST', applyPath, { revision, albumId: '123', placement, sourceIndex: placement === 'replace' ? 0 : undefined, confirmed: true });
    assert.equal((await apply(2)).statusCode, 409);
    assert.equal(photos, 0);
    assert.equal((await apply(1, 'replace')).statusCode, 200);
    assert.equal(photos, 1);
    assert.equal(reads, 1);
    assert.equal((await apply(1)).statusCode, 409);
    assert.equal(photos, 1);
    const stored = (await db.query('SELECT revision,data_body FROM integration_1688_publish_drafts WHERE id=$1', [draft.id])).rows[0];
    assert.equal(stored.revision, 2);
    assert.equal(stored.data_body.formValues.primaryPicture.imageList[0].url, 'https://cbu01.alicdn.com/img/generated.jpg');
    assert.equal((await db.query('SELECT status,photo_url FROM integration_1688_agent_images WHERE id=$1', [first.id])).rows[0].status, 'applied');
    blocked = true;
    const unsafe = await create('generate', undefined, 2);
    assert.equal(unsafe.statusCode, 200);
    assert.equal(unsafe.json().data.risky, true);
    assert.equal((await request('POST', `${path}/${unsafe.json().data.id}/apply`, { revision: 2, albumId: '123', placement: 'append', confirmed: true })).statusCode, 409);
    assert.equal(photos, 1);
    blocked = false;
    riskySource = true;
    assert.equal((await create('edit', 0, 2)).statusCode, 400);
    assert.equal(generated, 2);
    riskySource = false;
    const edited = await create('edit', 0, 2);
    assert.equal(edited.statusCode, 200);
    assert.equal(generated, 3);
    const testPreview = edited.json().data.id;
    let reached;
    const uploadReached = new Promise(resolve => { reached = resolve; });
    concurrent = reached;
    const applying = request('POST', `${path}/${testPreview}/apply`, { revision: 2, albumId: '123', placement: 'append', confirmed: true });
    await uploadReached;
    assert.equal((await request('POST', `${path}/${testPreview}/apply`, { revision: 2, albumId: '123', placement: 'append', confirmed: true })).statusCode, 409);
    assert.equal((await applying).statusCode, 200);
    assert.equal(photos, 2);
    const after = (await db.query('SELECT revision,data_body FROM integration_1688_publish_drafts WHERE id=$1', [draft.id])).rows[0];
    assert.equal(after.revision, 3);
    assert.equal(after.data_body.formValues.primaryPicture.imageList.length, 2);
    const countBefore = Number((await db.query('SELECT count(*) AS count FROM integration_1688_agent_images WHERE draft_id=$1', [draft.id])).rows[0].count);
    failPut = true;
    assert.equal((await create('generate', undefined, 3)).statusCode, 502);
    failPut = false;
    assert.equal(Number((await db.query('SELECT count(*) AS count FROM integration_1688_agent_images WHERE draft_id=$1', [draft.id])).rows[0].count), countBefore);
    assert.equal(puts, 3);
    assert.equal(reads, 2);
    console.log(JSON.stringify({ textToImage: 'ok', imageToImage: 'ok', ossPrivatePut: 'ok', ossCustomDomainV4: 'ok', ossNativeFallback: 'ok', expiredSourceLink: 'ok', ossFailureNoPreview: 'ok', sourceRisk: 'ok', riskGate: 'ok', albumUpload: 'ok', draftVersion: 'ok', duplicateApply: 'ok', tenantIsolation: 'ok', gatewayPhotos: photos, platformProductsPublished: 0 }));
}
finally {
    globalThis.fetch = originalFetch;
    OSS.prototype.put = originalPut;
    OSS.prototype.get = originalGet;
    OSS.prototype.delete = originalDelete;
    for (const tenant of tenants) {
        await db.query('DELETE FROM audit_logs WHERE tenant_id=$1', [tenant]);
        await db.query('DELETE FROM tenants WHERE id=$1', [tenant]);
    }
    await app.close();
    await db.end();
}
