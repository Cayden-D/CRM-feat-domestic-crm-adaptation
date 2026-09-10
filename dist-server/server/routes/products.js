import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth, requirePermission } from '../auth.js';
const idSchema = z.object({ id: z.string().uuid() });
const listSchema = z.object({ search: z.string().trim().max(100).optional(), category: z.string().trim().max(120).optional(), status: z.enum(['draft', 'active', 'inactive']).optional() });
const priceSchema = z.object({ minQuantity: z.coerce.number().positive().default(1), unitPrice: z.coerce.number().min(0), customerLevel: z.enum(['A', 'B', 'C', 'D']).optional().nullable(), validFrom: z.string().date().optional().nullable(), validUntil: z.string().date().optional().nullable() });
const productSchema = z.object({ sku: z.string().trim().min(1).max(80), name: z.string().trim().min(1).max(200), category: z.string().trim().max(120).optional().nullable(), description: z.string().trim().max(10000).optional().nullable(), specifications: z.record(z.string(), z.string()).default({}), basePrice: z.coerce.number().min(0).default(0), status: z.enum(['draft', 'active', 'inactive']).default('active'), prices: z.array(priceSchema).max(100).default([]) });
const updateSchema = productSchema.omit({ prices: true }).partial().extend({ prices: z.array(priceSchema).max(100).optional() });
export async function productRoutes(app) {
    app.get('/', { preHandler: requireAuth }, async (request, reply) => { const input = listSchema.safeParse(request.query); if (!input.success)
        return reply.code(400).send({ error: 'VALIDATION_ERROR' }); const values = [request.authUser.tenantId]; const where = ['p.tenant_id=$1', 'p.deleted_at IS NULL']; if (input.data.search) {
        values.push(`%${input.data.search}%`);
        where.push(`(p.name ILIKE $${values.length} OR p.sku ILIKE $${values.length})`);
    } if (input.data.category) {
        values.push(input.data.category);
        where.push(`p.category=$${values.length}`);
    } if (input.data.status) {
        values.push(input.data.status);
        where.push(`p.status=$${values.length}`);
    } const result = await db.query(`SELECT p.*,coalesce(jsonb_agg(jsonb_build_object('id',pp.id,'min_quantity',pp.min_quantity,'unit_price',pp.unit_price,'customer_level',pp.customer_level,'valid_from',pp.valid_from,'valid_until',pp.valid_until) ORDER BY pp.min_quantity) FILTER(WHERE pp.id IS NOT NULL),'[]') AS prices FROM products p LEFT JOIN product_prices pp ON pp.product_id=p.id WHERE ${where.join(' AND ')} GROUP BY p.id ORDER BY p.category NULLS LAST,p.name`, values); return { data: result.rows }; });
    app.get('/:id', { preHandler: requireAuth }, async (request, reply) => { const id = idSchema.safeParse(request.params); if (!id.success)
        return reply.code(400).send({ error: 'VALIDATION_ERROR' }); const result = await db.query(`SELECT p.*,coalesce(jsonb_agg(jsonb_build_object('id',pp.id,'min_quantity',pp.min_quantity,'unit_price',pp.unit_price,'customer_level',pp.customer_level,'valid_from',pp.valid_from,'valid_until',pp.valid_until) ORDER BY pp.min_quantity) FILTER(WHERE pp.id IS NOT NULL),'[]') AS prices FROM products p LEFT JOIN product_prices pp ON pp.product_id=p.id WHERE p.id=$1 AND p.tenant_id=$2 AND p.deleted_at IS NULL GROUP BY p.id`, [id.data.id, request.authUser.tenantId]); if (!result.rows[0])
        return reply.code(404).send({ error: 'NOT_FOUND' }); return { data: result.rows[0] }; });
    app.post('/', { preHandler: requirePermission('product:create') }, async (request, reply) => { const input = productSchema.safeParse(request.body); if (!input.success)
        return reply.code(400).send({ error: 'VALIDATION_ERROR', message: '产品字段格式不正确。', details: input.error.flatten() }); const client = await db.connect(); try {
        await client.query('BEGIN');
        const d = input.data;
        const product = (await client.query(`INSERT INTO products(tenant_id,sku,name,category,description,specifications,base_price,base_currency,status)VALUES($1,$2,$3,$4,$5,$6,$7,'CNY',$8)RETURNING *`, [request.authUser.tenantId, d.sku, d.name, d.category, d.description, JSON.stringify(d.specifications), d.basePrice, d.status])).rows[0];
        for (const price of d.prices)
            await client.query(`INSERT INTO product_prices(tenant_id,product_id,min_quantity,unit_price,customer_level,valid_from,valid_until)VALUES($1,$2,$3,$4,$5,$6,$7)`, [request.authUser.tenantId, product.id, price.minQuantity, price.unitPrice, price.customerLevel, price.validFrom, price.validUntil]);
        await client.query(`INSERT INTO audit_logs(tenant_id,actor_id,action,entity_type,entity_id,after_data,request_id)VALUES($1,$2,'product.create','product',$3,$4,$5)`, [request.authUser.tenantId, request.authUser.sub, product.id, JSON.stringify(product), request.id]);
        await client.query('COMMIT');
        return reply.code(201).send({ data: product });
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    } });
    app.patch('/:id', { preHandler: requirePermission('product:update') }, async (request, reply) => { const id = idSchema.safeParse(request.params); const input = updateSchema.safeParse(request.body); if (!id.success || !input.success || !Object.keys(input.data).length)
        return reply.code(400).send({ error: 'VALIDATION_ERROR' }); const client = await db.connect(); try {
        await client.query('BEGIN');
        const d = input.data;
        const mapping = { sku: 'sku', name: 'name', category: 'category', description: 'description', specifications: 'specifications', basePrice: 'base_price', status: 'status' };
        const values = [id.data.id, request.authUser.tenantId];
        const sets = Object.entries(d).filter(([key]) => key !== 'prices').map(([key, value]) => { values.push(key === 'specifications' ? JSON.stringify(value) : value); return `${mapping[key]}=$${values.length}`; });
        if (sets.length)
            await client.query(`UPDATE products SET ${sets.join(',')},base_currency='CNY',updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, values);
        const exists = await client.query('SELECT * FROM products WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL', [id.data.id, request.authUser.tenantId]);
        if (!exists.rows[0]) {
            await client.query('ROLLBACK');
            return reply.code(404).send({ error: 'NOT_FOUND' });
        }
        if (d.prices) {
            await client.query('DELETE FROM product_prices WHERE product_id=$1', [id.data.id]);
            for (const price of d.prices)
                await client.query(`INSERT INTO product_prices(tenant_id,product_id,min_quantity,unit_price,customer_level,valid_from,valid_until)VALUES($1,$2,$3,$4,$5,$6,$7)`, [request.authUser.tenantId, id.data.id, price.minQuantity, price.unitPrice, price.customerLevel, price.validFrom, price.validUntil]);
        }
        await client.query(`INSERT INTO audit_logs(tenant_id,actor_id,action,entity_type,entity_id,after_data,request_id)VALUES($1,$2,'product.update','product',$3,$4,$5)`, [request.authUser.tenantId, request.authUser.sub, id.data.id, JSON.stringify(exists.rows[0]), request.id]);
        await client.query('COMMIT');
        return { data: exists.rows[0] };
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    } });
    app.delete('/:id', { preHandler: requirePermission('product:delete') }, async (request, reply) => { const id = idSchema.safeParse(request.params); if (!id.success)
        return reply.code(400).send({ error: 'VALIDATION_ERROR' }); const result = await db.query('UPDATE products SET deleted_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING id', [id.data.id, request.authUser.tenantId]); if (!result.rows[0])
        return reply.code(404).send({ error: 'NOT_FOUND' }); await db.query(`INSERT INTO audit_logs(tenant_id,actor_id,action,entity_type,entity_id,request_id)VALUES($1,$2,'product.delete','product',$3,$4)`, [request.authUser.tenantId, request.authUser.sub, id.data.id, request.id]); return reply.code(204).send(); });
}
