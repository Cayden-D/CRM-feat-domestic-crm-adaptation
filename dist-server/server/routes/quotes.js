import { z } from 'zod';
import { db } from '../db.js';
import { hasPermission, requireAuth, requirePermission } from '../auth.js';
const idSchema = z.object({ id: z.string().uuid() });
const listSchema = z.object({
    search: z.string().trim().max(100).optional(),
    status: z.enum(['draft', 'pending_approval', 'approved', 'sent', 'accepted', 'rejected', 'expired', 'cancelled']).optional(),
});
const itemSchema = z.object({
    productId: z.string().uuid(), quantity: z.coerce.number().positive(),
    unit: z.string().trim().min(1).max(30).default('件'),
    unitPrice: z.coerce.number().min(0).optional().nullable(),
    discountRate: z.coerce.number().min(0).max(100).default(0),
    description: z.string().trim().max(500).optional().nullable(),
    specifications: z.record(z.string(), z.string()).optional(),
});
const quoteSchema = z.object({
    accountId: z.string().uuid(), opportunityId: z.string().uuid().optional().nullable(),
    contactId: z.string().uuid().optional().nullable(), validUntil: z.string().date().optional().nullable(),
    paymentTerms: z.string().trim().max(2000).optional().nullable(),
    shippingCost: z.coerce.number().min(0).default(0), discountAmount: z.coerce.number().min(0).default(0),
    taxAmount: z.coerce.number().min(0).default(0), notes: z.string().trim().max(10000).optional().nullable(),
    items: z.array(itemSchema).min(1).max(200),
});
const updateSchema = quoteSchema.omit({ accountId: true, opportunityId: true, contactId: true, items: true }).partial().extend({
    items: z.array(itemSchema).min(1).max(200).optional(),
});
const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const canReadAll = (permissions) => hasPermission(permissions, 'quote:*') || hasPermission(permissions, 'quote:read');
async function priceItems(client, tenantId, account, items) {
    const priced = [];
    for (const item of items) {
        const product = (await client.query(`SELECT * FROM products WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL AND status='active'`, [item.productId, tenantId])).rows[0];
        if (!product)
            throw Object.assign(new Error('报价中包含不存在或已停用的产品。'), { statusCode: 400 });
        let unitPrice = item.unitPrice == null ? null : Number(item.unitPrice);
        if (unitPrice == null) {
            const candidates = await client.query(`SELECT unit_price,min_quantity,customer_level FROM product_prices WHERE product_id=$1 AND min_quantity<=$2::numeric AND (valid_from IS NULL OR valid_from<=current_date) AND (valid_until IS NULL OR valid_until>=current_date)`, [item.productId, item.quantity]);
            const level = account.credit_level ? String(account.credit_level).trim() : null;
            const tier = candidates.rows
                .filter(row => row.customer_level == null || String(row.customer_level).trim() === level)
                .sort((a, b) => (b.customer_level != null ? 1 : 0) - (a.customer_level != null ? 1 : 0) || Number(b.min_quantity) - Number(a.min_quantity))[0];
            unitPrice = tier ? Number(tier.unit_price) : Number(product.base_price);
        }
        const lineTotal = round2(Number(item.quantity) * unitPrice * (1 - Number(item.discountRate) / 100));
        priced.push({ product_id: product.id, sku: product.sku, description: item.description || product.name, specifications: item.specifications ?? product.specifications, quantity: Number(item.quantity), unit: item.unit, unit_price: unitPrice, discount_rate: Number(item.discountRate), line_total: lineTotal });
    }
    return priced;
}
export async function quoteRoutes(app) {
    app.get('/', { preHandler: requireAuth }, async (request, reply) => {
        const input = listSchema.safeParse(request.query);
        if (!input.success)
            return reply.code(400).send({ error: 'VALIDATION_ERROR' });
        const values = [request.authUser.tenantId, canReadAll(request.authUser.permissions), request.authUser.sub];
        const where = ['q.tenant_id=$1', 'q.deleted_at IS NULL', '($2::boolean OR q.owner_id=$3::uuid)'];
        if (input.data.search) {
            values.push(`%${input.data.search}%`);
            where.push(`(q.quote_number ILIKE $${values.length} OR a.name ILIKE $${values.length})`);
        }
        if (input.data.status) {
            values.push(input.data.status);
            where.push(`q.status=$${values.length}`);
        }
        const result = await db.query(`SELECT q.*,a.name AS account_name,o.name AS opportunity_name,c.full_name AS contact_name,u.display_name AS owner_name,count(qi.id)::int AS item_count FROM quotes q JOIN accounts a ON a.id=q.account_id LEFT JOIN opportunities o ON o.id=q.opportunity_id LEFT JOIN contacts c ON c.id=q.contact_id LEFT JOIN users u ON u.id=q.owner_id LEFT JOIN quote_items qi ON qi.quote_id=q.id WHERE ${where.join(' AND ')} GROUP BY q.id,a.name,o.name,c.full_name,u.display_name ORDER BY q.created_at DESC`, values);
        return { data: result.rows };
    });
    app.get('/:id', { preHandler: requireAuth }, async (request, reply) => {
        const id = idSchema.safeParse(request.params);
        if (!id.success)
            return reply.code(400).send({ error: 'VALIDATION_ERROR' });
        const quote = await db.query(`SELECT q.*,a.name AS account_name,a.province,a.credit_level,o.name AS opportunity_name,c.full_name AS contact_name,u.display_name AS owner_name FROM quotes q JOIN accounts a ON a.id=q.account_id LEFT JOIN opportunities o ON o.id=q.opportunity_id LEFT JOIN contacts c ON c.id=q.contact_id LEFT JOIN users u ON u.id=q.owner_id WHERE q.id=$1 AND q.tenant_id=$2 AND q.deleted_at IS NULL AND ($3::boolean OR q.owner_id=$4::uuid)`, [id.data.id, request.authUser.tenantId, canReadAll(request.authUser.permissions), request.authUser.sub]);
        if (!quote.rows[0])
            return reply.code(404).send({ error: 'NOT_FOUND' });
        const items = await db.query('SELECT * FROM quote_items WHERE quote_id=$1 ORDER BY line_number', [id.data.id]);
        return { data: { quote: quote.rows[0], items: items.rows } };
    });
    app.post('/', { preHandler: requirePermission('quote:create') }, async (request, reply) => {
        const input = quoteSchema.safeParse(request.body);
        if (!input.success)
            return reply.code(400).send({ error: 'VALIDATION_ERROR', message: '报价字段格式不正确。', details: input.error.flatten() });
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const d = input.data;
            const account = (await client.query('SELECT * FROM accounts WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL AND ($3::boolean OR owner_id=$4::uuid) FOR UPDATE', [d.accountId, request.authUser.tenantId, canReadAll(request.authUser.permissions), request.authUser.sub])).rows[0];
            if (!account) {
                await client.query('ROLLBACK');
                return reply.code(404).send({ error: 'ACCOUNT_NOT_FOUND' });
            }
            if (d.opportunityId && !(await client.query('SELECT 1 FROM opportunities WHERE id=$1 AND account_id=$2 AND tenant_id=$3 AND deleted_at IS NULL', [d.opportunityId, d.accountId, request.authUser.tenantId])).rows[0]) {
                await client.query('ROLLBACK');
                return reply.code(400).send({ error: 'INVALID_OPPORTUNITY' });
            }
            if (d.contactId && !(await client.query('SELECT 1 FROM contacts WHERE id=$1 AND account_id=$2 AND tenant_id=$3 AND deleted_at IS NULL', [d.contactId, d.accountId, request.authUser.tenantId])).rows[0]) {
                await client.query('ROLLBACK');
                return reply.code(400).send({ error: 'INVALID_CONTACT' });
            }
            const items = await priceItems(client, request.authUser.tenantId, account, d.items);
            const subtotal = round2(items.reduce((sum, item) => sum + item.line_total, 0));
            const total = round2(subtotal - d.discountAmount + d.shippingCost + d.taxAmount);
            if (total < 0) {
                await client.query('ROLLBACK');
                return reply.code(400).send({ error: 'INVALID_TOTAL', message: '报价总额不能为负数。' });
            }
            const prefix = `BJ-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${request.authUser.tenantId}:${prefix}`]);
            const seq = Number((await client.query('SELECT count(*)::int+1 AS value FROM quotes WHERE tenant_id=$1 AND quote_number LIKE $2', [request.authUser.tenantId, `${prefix}-%`])).rows[0].value);
            const quoteNumber = `${prefix}-${seq.toString().padStart(4, '0')}`;
            const quote = (await client.query(`INSERT INTO quotes(tenant_id,opportunity_id,account_id,contact_id,owner_id,quote_number,currency,valid_until,payment_terms,shipping_cost,subtotal,discount_amount,tax_amount,total_amount,notes) VALUES($1,$2,$3,$4,$5,$6,'CNY',$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [request.authUser.tenantId, d.opportunityId, d.accountId, d.contactId, request.authUser.sub, quoteNumber, d.validUntil, d.paymentTerms, d.shippingCost, subtotal, d.discountAmount, d.taxAmount, total, d.notes])).rows[0];
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                await client.query(`INSERT INTO quote_items(quote_id,product_id,line_number,sku,description,specifications,quantity,unit,unit_price,discount_rate,line_total) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [quote.id, item.product_id, i + 1, item.sku, item.description, JSON.stringify(item.specifications), item.quantity, item.unit, item.unit_price, item.discount_rate, item.line_total]);
            }
            await client.query(`INSERT INTO audit_logs(tenant_id,actor_id,action,entity_type,entity_id,after_data,request_id) VALUES($1,$2,'quote.create','quote',$3,$4,$5)`, [request.authUser.tenantId, request.authUser.sub, quote.id, JSON.stringify({ ...quote, items }), request.id]);
            await client.query('COMMIT');
            return reply.code(201).send({ data: { quote, items } });
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    });
    app.patch('/:id', { preHandler: requirePermission('quote:update') }, async (request, reply) => {
        const id = idSchema.safeParse(request.params), input = updateSchema.safeParse(request.body);
        if (!id.success || !input.success || !Object.keys(input.data).length)
            return reply.code(400).send({ error: 'VALIDATION_ERROR' });
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const current = (await client.query(`SELECT q.*,a.credit_level FROM quotes q JOIN accounts a ON a.id=q.account_id WHERE q.id=$1 AND q.tenant_id=$2 AND q.deleted_at IS NULL AND q.status IN ('draft','rejected') AND ($3::boolean OR q.owner_id=$4::uuid) FOR UPDATE`, [id.data.id, request.authUser.tenantId, canReadAll(request.authUser.permissions), request.authUser.sub])).rows[0];
            if (!current) {
                await client.query('ROLLBACK');
                return reply.code(404).send({ error: 'NOT_FOUND_OR_LOCKED', message: '报价不存在或当前状态不可编辑。' });
            }
            const d = input.data;
            let subtotal = Number(current.subtotal);
            if (d.items) {
                const items = await priceItems(client, request.authUser.tenantId, current, d.items);
                subtotal = round2(items.reduce((sum, item) => sum + item.line_total, 0));
                await client.query('DELETE FROM quote_items WHERE quote_id=$1', [id.data.id]);
                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    await client.query(`INSERT INTO quote_items(quote_id,product_id,line_number,sku,description,specifications,quantity,unit,unit_price,discount_rate,line_total) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id.data.id, item.product_id, i + 1, item.sku, item.description, JSON.stringify(item.specifications), item.quantity, item.unit, item.unit_price, item.discount_rate, item.line_total]);
                }
            }
            const shipping = Number(d.shippingCost ?? current.shipping_cost), discount = Number(d.discountAmount ?? current.discount_amount), tax = Number(d.taxAmount ?? current.tax_amount), total = round2(subtotal - discount + shipping + tax);
            if (total < 0) {
                await client.query('ROLLBACK');
                return reply.code(400).send({ error: 'INVALID_TOTAL' });
            }
            const result = await client.query(`UPDATE quotes SET currency='CNY',valid_until=coalesce($1,valid_until),payment_terms=coalesce($2,payment_terms),shipping_cost=$3,subtotal=$4,discount_amount=$5,tax_amount=$6,total_amount=$7,notes=coalesce($8,notes),updated_at=now() WHERE id=$9 RETURNING *`, [d.validUntil, d.paymentTerms, shipping, subtotal, discount, tax, total, d.notes, id.data.id]);
            await client.query(`INSERT INTO audit_logs(tenant_id,actor_id,action,entity_type,entity_id,after_data,request_id) VALUES($1,$2,'quote.update','quote',$3,$4,$5)`, [request.authUser.tenantId, request.authUser.sub, id.data.id, JSON.stringify(result.rows[0]), request.id]);
            await client.query('COMMIT');
            return { data: result.rows[0] };
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    });
    app.delete('/:id', { preHandler: requirePermission('quote:delete') }, async (request, reply) => {
        const id = idSchema.safeParse(request.params);
        if (!id.success)
            return reply.code(400).send({ error: 'VALIDATION_ERROR' });
        const result = await db.query(`UPDATE quotes SET deleted_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL AND status IN ('draft','rejected','cancelled') AND ($3::boolean OR owner_id=$4::uuid) RETURNING id`, [id.data.id, request.authUser.tenantId, canReadAll(request.authUser.permissions), request.authUser.sub]);
        if (!result.rows[0])
            return reply.code(404).send({ error: 'NOT_FOUND_OR_LOCKED' });
        await db.query(`INSERT INTO audit_logs(tenant_id,actor_id,action,entity_type,entity_id,request_id) VALUES($1,$2,'quote.delete','quote',$3,$4)`, [request.authUser.tenantId, request.authUser.sub, id.data.id, request.id]);
        return reply.code(204).send();
    });
}
