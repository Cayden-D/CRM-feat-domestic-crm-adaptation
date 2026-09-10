import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../server/app.js';
import { db } from '../server/db.js';
import { createTestAdmin, deleteTestAdmin } from './test-auth.js';
const password = process.env.CRM_ADMIN_PASSWORD;
if (!password)
    throw new Error('CRM_ADMIN_PASSWORD is required');
const app = await buildApp();
let testUserId = '', collectionId = '';
try {
    const identity = await createTestAdmin('collection');
    testUserId = identity.userId;
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: identity.email, password, tenant: 'default' } });
    assert.equal(login.statusCode, 200, login.body);
    const authorization = `Bearer ${login.json().token}`;
    const script = await app.inject({ method: 'GET', url: '/api/product-collections/collector-script.user.js' });
    assert.equal(script.statusCode, 200, script.body);
    assert.match(script.body, /==UserScript==/);
    const keyResponse = await app.inject({ method: 'POST', url: '/api/product-collections/access-key', headers: { authorization } });
    assert.equal(keyResponse.statusCode, 200, keyResponse.body);
    const collectorKey = keyResponse.json().data.key;
    assert.match(collectorKey, /^crm1688_/);
    const session = await app.inject({ method: 'GET', url: '/api/product-collections/session', headers: { 'x-collector-key': collectorKey } });
    assert.equal(session.statusCode, 200, session.body);
    assert.equal(session.json().data.id, testUserId);
    const marker = randomUUID().slice(0, 8), sourceProductId = `test-${marker}`;
    const payload = { source: '1688', sourceProductId, sourceUrl: `https://detail.1688.com/offer/${sourceProductId}.html`, title: `采集测试商品 ${marker}`, mainImageUrl: 'https://cbu01.alicdn.com/img/example.jpg', galleryImages: ['https://cbu01.alicdn.com/img/example.jpg'], detailImages: ['https://cbu01.alicdn.com/img/detail.jpg'], videoUrl: 'https://cloud.video.taobao.com/example.mp4', descriptionUrl: 'https://detail.1688.com/desc/example.html', currency: 'CNY', priceMin: 12.5, priceMax: 18, attributes: { 材质: '棉' }, skuProps: [{ name: '颜色', values: [{ name: '红色' }] }], sellerName: '测试供应商', sellerId: 'seller-001', categoryPath: '服饰 > 上装', sourceCategoryId: '101', sourceCategoryAttributes: [{ attrName: '材质', attrValue: '棉' }], tags: ['测试'], collectorNote: '完整商品采集', sourceCollectedAt: '2026-08-09T01:00:00.000Z', collectorMode: 'full-product', collectorVersion: '2.1.0', rawData: { fixture: true }, variants: [{ externalSkuId: 'sku-red-l', label: '红色 / L', attributes: { 颜色: '红色', 尺码: 'L' }, imageUrl: 'https://cbu01.alicdn.com/img/red.jpg', priceText: '¥12.50', price: 12.5, stockText: '库存 20', stock: 20, rawData: { 颜色: '红色', 尺码: 'L', 价格: '¥12.50', 库存: '库存 20' } }] };
    const imported = await app.inject({ method: 'POST', url: '/api/product-collections/import', headers: { 'x-collector-key': collectorKey }, payload });
    assert.equal(imported.statusCode, 201, imported.body);
    collectionId = imported.json().data.id;
    assert.equal(imported.json().data.variantCount, 1);
    const updated = await app.inject({ method: 'POST', url: '/api/product-collections/import', headers: { 'x-collector-key': collectorKey }, payload: { ...payload, title: `采集测试商品更新 ${marker}`, variants: [...payload.variants, { label: '蓝色 / M', attributes: { 颜色: '蓝色', 尺码: 'M' }, priceText: '13.00', price: 13, stockText: '8', stock: 8, rawData: { 颜色: '蓝色' } }] } });
    assert.equal(updated.statusCode, 201, updated.body);
    assert.equal(updated.json().data.id, collectionId);
    assert.equal(updated.json().data.variantCount, 2);
    const listed = await app.inject({ method: 'GET', url: `/api/product-collections?search=${marker}`, headers: { authorization } });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.equal(listed.json().data.length, 1);
    assert.equal(listed.json().data[0].variant_count, 2);
    const detail = await app.inject({ method: 'GET', url: `/api/product-collections/${collectionId}`, headers: { authorization } });
    assert.equal(detail.statusCode, 200, detail.body);
    assert.equal(detail.json().data.variants.length, 2);
    assert.equal(detail.json().data.product.title, `采集测试商品更新 ${marker}`);
    assert.equal(detail.json().data.product.seller_name, '测试供应商');
    assert.equal(detail.json().data.product.video_url, 'https://cloud.video.taobao.com/example.mp4');
    assert.equal(Number(detail.json().data.product.price_max), 18);
    assert.equal(detail.json().data.product.sku_props[0].name, '颜色');
    const badKey = await app.inject({ method: 'POST', url: '/api/product-collections/import', headers: { 'x-collector-key': 'crm1688_invalid' }, payload });
    assert.equal(badKey.statusCode, 401, badKey.body);
    const removed = await app.inject({ method: 'DELETE', url: `/api/product-collections/${collectionId}`, headers: { authorization } });
    assert.equal(removed.statusCode, 204, removed.body);
    const audits = await db.query(`SELECT action FROM audit_logs WHERE entity_type='collected_product' AND entity_id=$1 ORDER BY created_at`, [collectionId]);
    assert.deepEqual(audits.rows.map(row => row.action), ['collection.import', 'collection.import', 'collection.delete']);
    console.log(JSON.stringify({ fullProductCollector: 'ok', collectorSession: 'ok', collectorKey: 'ok', firstImport: 'ok', idempotentUpdate: 'ok', productMediaAndSeller: 'ok', variantSnapshot: 'ok', invalidKey: 'ok', collectionAudit: 3 }));
}
finally {
    if (collectionId)
        await db.query('DELETE FROM audit_logs WHERE entity_id=$1', [collectionId]);
    if (testUserId) {
        await db.query('DELETE FROM product_collector_keys WHERE user_id=$1', [testUserId]);
        await deleteTestAdmin(testUserId);
    }
    await app.close();
    await db.end();
}
