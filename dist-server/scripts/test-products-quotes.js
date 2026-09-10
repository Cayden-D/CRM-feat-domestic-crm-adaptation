import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../server/app.js';
import { db } from '../server/db.js';
import { createTestAdmin, deleteTestAdmin } from './test-auth.js';
const password = process.env.CRM_ADMIN_PASSWORD;
if (!password)
    throw new Error('CRM_ADMIN_PASSWORD is required');
const app = await buildApp();
let accountId = '', productId = '', quoteId = '', testUserId = '';
try {
    const identity = await createTestAdmin('quote');
    testUserId = identity.userId;
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: identity.email, password, tenant: 'default' } });
    assert.equal(login.statusCode, 200, login.body);
    const authorization = `Bearer ${login.json().token}`;
    const marker = randomUUID().slice(0, 8);
    const account = await app.inject({ method: 'POST', url: '/api/accounts', headers: { authorization }, payload: { name: `Quote Test ${marker}`, province: '江苏省', city: '苏州市', creditLevel: 'A', source: 'quote-integration-test' } });
    assert.equal(account.statusCode, 201, account.body);
    accountId = account.json().data.id;
    const product = await app.inject({ method: 'POST', url: '/api/products', headers: { authorization }, payload: { sku: `SKU-${marker}`, name: 'Smart controller', category: 'Controls', description: 'Integration fixture', basePrice: 120, specifications: { voltage: '220V' }, prices: [{ minQuantity: 1, unitPrice: 100 }, { minQuantity: 100, unitPrice: 80, customerLevel: 'A' }] } });
    assert.equal(product.statusCode, 201, product.body);
    productId = product.json().data.id;
    const listed = await app.inject({ method: 'GET', url: `/api/products?search=${marker}`, headers: { authorization } });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.equal(listed.json().data.length, 1);
    assert.equal(listed.json().data[0].prices.length, 2);
    const updatedProduct = await app.inject({ method: 'PATCH', url: `/api/products/${productId}`, headers: { authorization }, payload: { description: 'Updated integration fixture' } });
    assert.equal(updatedProduct.statusCode, 200, updatedProduct.body);
    const quote = await app.inject({ method: 'POST', url: '/api/quotes', headers: { authorization }, payload: { accountId, validUntil: '2026-09-30', paymentTerms: '预付30%，验收后付清', shippingCost: 100, taxAmount: 50, items: [{ productId, quantity: 150, unit: '件', discountRate: 5 }] } });
    assert.equal(quote.statusCode, 201, quote.body);
    quoteId = quote.json().data.quote.id;
    assert.match(quote.json().data.quote.quote_number, /^BJ-\d{8}-\d{4}$/);
    assert.equal(quote.json().data.quote.currency.trim(), 'CNY');
    assert.equal(Number(quote.json().data.items[0].unit_price), 80);
    assert.equal(Number(quote.json().data.items[0].line_total), 11400);
    assert.equal(Number(quote.json().data.quote.total_amount), 11550);
    const detail = await app.inject({ method: 'GET', url: `/api/quotes/${quoteId}`, headers: { authorization } });
    assert.equal(detail.statusCode, 200, detail.body);
    assert.equal(detail.json().data.quote.province, '江苏省');
    assert.equal(detail.json().data.items.length, 1);
    const updatedQuote = await app.inject({ method: 'PATCH', url: `/api/quotes/${quoteId}`, headers: { authorization }, payload: { shippingCost: 0, discountAmount: 0, taxAmount: 0, items: [{ productId, quantity: 10, unit: '件', discountRate: 0 }] } });
    assert.equal(updatedQuote.statusCode, 200, updatedQuote.body);
    assert.equal(Number(updatedQuote.json().data.total_amount), 1000);
    const quoteList = await app.inject({ method: 'GET', url: `/api/quotes?search=${marker}`, headers: { authorization } });
    assert.equal(quoteList.statusCode, 200, quoteList.body);
    assert.equal(quoteList.json().data.length, 1);
    const removedQuote = await app.inject({ method: 'DELETE', url: `/api/quotes/${quoteId}`, headers: { authorization } });
    assert.equal(removedQuote.statusCode, 204, removedQuote.body);
    const removedProduct = await app.inject({ method: 'DELETE', url: `/api/products/${productId}`, headers: { authorization } });
    assert.equal(removedProduct.statusCode, 204, removedProduct.body);
    const productAudits = await db.query(`SELECT count(*)::text FROM audit_logs WHERE entity_type='product' AND entity_id=$1`, [productId]);
    const quoteAudits = await db.query(`SELECT count(*)::text FROM audit_logs WHERE entity_type='quote' AND entity_id=$1`, [quoteId]);
    assert.equal(Number(productAudits.rows[0].count), 3);
    assert.equal(Number(quoteAudits.rows[0].count), 3);
    console.log(JSON.stringify({ productCrud: 'ok', domesticTierPricing: 'ok', cnyQuote: 'ok', serverCalculation: 'ok', taxAndFreight: 'ok', productAudit: 3, quoteAudit: 3 }));
}
finally {
    if (quoteId) {
        await db.query('DELETE FROM audit_logs WHERE entity_id=$1', [quoteId]);
        await db.query('DELETE FROM quotes WHERE id=$1', [quoteId]);
    }
    if (productId) {
        await db.query('DELETE FROM audit_logs WHERE entity_id=$1', [productId]);
        await db.query('DELETE FROM products WHERE id=$1', [productId]);
    }
    if (accountId) {
        await db.query('DELETE FROM audit_logs WHERE entity_id=$1', [accountId]);
        await db.query('DELETE FROM accounts WHERE id=$1', [accountId]);
    }
    await deleteTestAdmin(testUserId);
    await app.close();
    await db.end();
}
