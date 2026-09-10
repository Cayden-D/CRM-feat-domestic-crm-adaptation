import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { db } from '../db.js';
import { requirePermission } from '../auth.js';
const idSchema = z.object({ id: z.string().uuid() });
const listSchema = z.object({ search: z.string().trim().max(100).optional(), source: z.enum(['1688', 'alibaba']).optional(), status: z.enum(['collected', 'ai_processing', 'ai_completed', 'ready', 'published', 'failed']).optional() });
const nullableUrl = z.union([z.string().url().max(2000), z.literal(''), z.null()]).optional().transform(value => value || null);
const variantSchema = z.object({ externalSkuId: z.string().trim().max(200).optional().nullable(), label: z.string().trim().min(1).max(500), attributes: z.record(z.string(), z.string()).default({}), imageUrl: nullableUrl, priceText: z.string().trim().max(200).optional().nullable(), price: z.coerce.number().min(0).optional().nullable(), stockText: z.string().trim().max(200).optional().nullable(), stock: z.coerce.number().min(0).optional().nullable(), rawData: z.record(z.string(), z.unknown()).default({}) });
const importSchema = z.object({ source: z.enum(['1688', 'alibaba']), sourceProductId: z.string().trim().min(1).max(200), sourceUrl: z.string().url().max(2000), title: z.string().trim().min(1).max(500), mainImageUrl: nullableUrl, galleryImages: z.array(z.string().url().max(2000)).max(200).default([]), detailImages: z.array(z.string().url().max(2000)).max(500).default([]), videoUrl: nullableUrl, descriptionUrl: nullableUrl, currency: z.string().trim().min(1).max(10).default('CNY'), priceMin: z.coerce.number().min(0).optional().nullable(), priceMax: z.coerce.number().min(0).optional().nullable(), attributes: z.record(z.string(), z.string()).default({}), skuProps: z.array(z.unknown()).max(100).default([]), sellerName: z.string().trim().max(500).optional().nullable(), sellerId: z.string().trim().max(200).optional().nullable(), categoryPath: z.string().trim().max(1000).optional().nullable(), sourceCategoryId: z.string().trim().max(200).optional().nullable(), sourceCategoryAttributes: z.array(z.unknown()).max(1000).default([]), tags: z.array(z.string().trim().max(100)).max(100).default([]), collectorNote: z.string().trim().max(10000).optional().nullable(), sourceCollectedAt: z.string().datetime().optional().nullable(), collectorMode: z.string().trim().max(100).optional().nullable(), collectorVersion: z.string().trim().max(30).optional().nullable(), rawData: z.record(z.string(), z.unknown()).default({}), variants: z.array(variantSchema).max(2000).default([]) }).refine(d => d.priceMin == null || d.priceMax == null || d.priceMax >= d.priceMin, { message: 'priceMax must be greater than or equal to priceMin', path: ['priceMax'] });
const hashKey = (key) => createHash('sha256').update(key).digest('hex');
async function getCollectorIdentity(request, reply) {
    const key = request.headers['x-collector-key'];
    if (typeof key !== 'string' || !key.startsWith('crm1688_')) {
        reply.code(401).send({ error: 'INVALID_COLLECTOR_KEY', message: '采集密钥缺失或格式无效。' });
        return null;
    }
    const result = await db.query(`SELECT id,tenant_id,user_id FROM product_collector_keys WHERE key_hash=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())`, [hashKey(key)]);
    const identity = result.rows[0];
    if (!identity) {
        reply.code(401).send({ error: 'INVALID_COLLECTOR_KEY', message: '采集密钥无效或已被吊销。' });
        return null;
    }
    await db.query('UPDATE product_collector_keys SET last_used_at=now() WHERE id=$1', [identity.id]);
    return identity;
}
export async function productCollectionRoutes(app) {
    app.get('/collector-script.user.js', async (_request, reply) => { const script = await readFile(resolve(process.cwd(), 'scripts', '1688-product-collector.user.js'), 'utf8'); return reply.type('application/javascript; charset=utf-8').header('Content-Disposition', 'inline; filename="1688-product-collector.user.js"').send(script); });
    app.get('/session', async (request, reply) => { const identity = await getCollectorIdentity(request, reply); if (!identity)
        return; const user = (await db.query(`SELECT id,email::text,display_name FROM users WHERE id=$1 AND tenant_id=$2 AND status='active' AND deleted_at IS NULL`, [identity.user_id, identity.tenant_id])).rows[0]; if (!user)
        return reply.code(401).send({ error: 'INVALID_COLLECTOR_KEY', message: '采集密钥所属账号不可用。' }); return { data: { id: user.id, email: user.email, username: user.display_name, displayName: user.display_name, teams: [] } }; });
    app.post('/access-key', { preHandler: requirePermission('collection:create') }, async (request) => {
        const plainKey = `crm1688_${randomBytes(24).toString('base64url')}`;
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await client.query('UPDATE product_collector_keys SET revoked_at=now() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL', [request.authUser.tenantId, request.authUser.sub]);
            const row = (await client.query(`INSERT INTO product_collector_keys(tenant_id,user_id,key_prefix,key_hash)VALUES($1,$2,$3,$4)RETURNING id,name,key_prefix,created_at`, [request.authUser.tenantId, request.authUser.sub, plainKey.slice(0, 18), hashKey(plainKey)])).rows[0];
            await client.query('COMMIT');
            return { data: { ...row, key: plainKey } };
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    });
    app.get('/', { preHandler: requirePermission('collection:read') }, async (request, reply) => { const input = listSchema.safeParse(request.query); if (!input.success)
        return reply.code(400).send({ error: 'VALIDATION_ERROR' }); const values = [request.authUser.tenantId]; const where = ['cp.tenant_id=$1']; if (input.data.search) {
        values.push(`%${input.data.search}%`);
        where.push(`(cp.title ILIKE $${values.length} OR cp.source_product_id ILIKE $${values.length})`);
    } if (input.data.source) {
        values.push(input.data.source);
        where.push(`cp.source=$${values.length}`);
    } if (input.data.status) {
        values.push(input.data.status);
        where.push(`cp.processing_status=$${values.length}`);
    } const result = await db.query(`SELECT cp.*,u.display_name AS collector_name,count(cpv.id)::int AS variant_count,min(cpv.price) AS min_price,max(cpv.price) AS max_price FROM collected_products cp LEFT JOIN users u ON u.id=cp.collected_by LEFT JOIN collected_product_variants cpv ON cpv.collected_product_id=cp.id WHERE ${where.join(' AND ')} GROUP BY cp.id,u.display_name ORDER BY cp.collected_at DESC`, values); return { data: result.rows }; });
    app.get('/:id', { preHandler: requirePermission('collection:read') }, async (request, reply) => { const id = idSchema.safeParse(request.params); if (!id.success)
        return reply.code(400).send({ error: 'VALIDATION_ERROR' }); const product = (await db.query('SELECT * FROM collected_products WHERE id=$1 AND tenant_id=$2', [id.data.id, request.authUser.tenantId])).rows[0]; if (!product)
        return reply.code(404).send({ error: 'NOT_FOUND' }); const variants = await db.query('SELECT * FROM collected_product_variants WHERE collected_product_id=$1 ORDER BY position', [id.data.id]); return { data: { product, variants: variants.rows } }; });
    app.delete('/:id', { preHandler: requirePermission('collection:delete') }, async (request, reply) => { const id = idSchema.safeParse(request.params); if (!id.success)
        return reply.code(400).send({ error: 'VALIDATION_ERROR' }); const result = await db.query('DELETE FROM collected_products WHERE id=$1 AND tenant_id=$2 RETURNING id,title', [id.data.id, request.authUser.tenantId]); if (!result.rows[0])
        return reply.code(404).send({ error: 'NOT_FOUND' }); await db.query(`INSERT INTO audit_logs(tenant_id,actor_id,action,entity_type,entity_id,before_data,request_id)VALUES($1,$2,'collection.delete','collected_product',$3,$4,$5)`, [request.authUser.tenantId, request.authUser.sub, id.data.id, JSON.stringify(result.rows[0]), request.id]); return reply.code(204).send(); });
    app.post('/import', async (request, reply) => { const identity = await getCollectorIdentity(request, reply); if (!identity)
        return; const input = importSchema.safeParse(request.body); if (!input.success)
        return reply.code(400).send({ error: 'VALIDATION_ERROR', message: '采集数据格式不正确。', details: input.error.flatten() }); const d = input.data; const client = await db.connect(); try {
        await client.query('BEGIN');
        const product = (await client.query(`INSERT INTO collected_products(tenant_id,source,source_product_id,source_url,title,main_image_url,gallery_images,detail_images,video_url,description_url,currency,price_min,price_max,attributes,sku_props,seller_name,seller_id,category_path,source_category_id,source_category_attributes,tags,collector_note,source_collected_at,raw_data,collector_mode,collector_version,collected_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27) ON CONFLICT(tenant_id,source,source_product_id) DO UPDATE SET source_url=excluded.source_url,title=excluded.title,main_image_url=excluded.main_image_url,gallery_images=excluded.gallery_images,detail_images=excluded.detail_images,video_url=excluded.video_url,description_url=excluded.description_url,currency=excluded.currency,price_min=excluded.price_min,price_max=excluded.price_max,attributes=excluded.attributes,sku_props=excluded.sku_props,seller_name=excluded.seller_name,seller_id=excluded.seller_id,category_path=excluded.category_path,source_category_id=excluded.source_category_id,source_category_attributes=excluded.source_category_attributes,tags=excluded.tags,collector_note=excluded.collector_note,source_collected_at=excluded.source_collected_at,raw_data=excluded.raw_data,collector_mode=excluded.collector_mode,collector_version=excluded.collector_version,collected_by=excluded.collected_by,collected_at=now(),updated_at=now() RETURNING *`, [identity.tenant_id, d.source, d.sourceProductId, d.sourceUrl, d.title, d.mainImageUrl, JSON.stringify(d.galleryImages), JSON.stringify(d.detailImages), d.videoUrl, d.descriptionUrl, d.currency, d.priceMin, d.priceMax, JSON.stringify(d.attributes), JSON.stringify(d.skuProps), d.sellerName, d.sellerId, d.categoryPath, d.sourceCategoryId, JSON.stringify(d.sourceCategoryAttributes), JSON.stringify(d.tags), d.collectorNote, d.sourceCollectedAt, JSON.stringify(d.rawData), d.collectorMode, d.collectorVersion, identity.user_id])).rows[0];
        await client.query('DELETE FROM collected_product_variants WHERE collected_product_id=$1', [product.id]);
        for (const [position, v] of d.variants.entries())
            await client.query(`INSERT INTO collected_product_variants(tenant_id,collected_product_id,position,external_sku_id,label,attributes,image_url,price_text,price,stock_text,stock,raw_data)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [identity.tenant_id, product.id, position, v.externalSkuId, v.label, JSON.stringify(v.attributes), v.imageUrl, v.priceText, v.price, v.stockText, v.stock, JSON.stringify(v.rawData)]);
        await client.query(`INSERT INTO audit_logs(tenant_id,actor_id,action,entity_type,entity_id,after_data,request_id)VALUES($1,$2,'collection.import','collected_product',$3,$4,$5)`, [identity.tenant_id, identity.user_id, product.id, JSON.stringify({ source: d.source, sourceProductId: d.sourceProductId, title: d.title, variantCount: d.variants.length }), request.id]);
        await client.query('COMMIT');
        return reply.code(201).send({ data: { id: product.id, title: product.title, variantCount: d.variants.length, collectedAt: product.collected_at } });
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    } });
}
