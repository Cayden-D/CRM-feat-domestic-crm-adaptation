import { z } from 'zod';
import { db } from '../db.js';
import { requirePermission } from '../auth.js';
import { IntegrationError } from '../integrations/1688.js';
import { comparison, platformSkus } from '../integrations/1688-comparison.js';
const params = z.object({ id: z.string().uuid() });
export async function listingBindingRoutes(app) {
    app.get('/listings/:id/comparison', { preHandler: [requirePermission('integration:read'), requirePermission('product:read')] }, async (request) => {
        const { id } = params.parse(request.params);
        const input = z.object({ productId: z.string().uuid().optional() }).parse(request.query);
        const client = await db.connect();
        try {
            await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
            const listing = (await client.query('SELECT * FROM integration_1688_listings WHERE id=$1 AND tenant_id=$2', [id, request.authUser.tenantId])).rows[0];
            if (!listing)
                throw new IntegrationError('NOT_FOUND', '平台商品不存在。', 404);
            const chosen = input.productId || listing.product_id;
            const product = chosen ? (await client.query("SELECT * FROM products WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL AND ($3::boolean=false OR status='active')", [chosen, request.authUser.tenantId, Boolean(input.productId)])).rows[0] : null;
            if (input.productId && !product)
                throw new IntegrationError('NOT_FOUND', '请选择当前组织的已启用正式产品。', 404);
            const variants = product ? (await client.query('SELECT * FROM product_variants WHERE product_id=$1 AND tenant_id=$2 ORDER BY position', [product.id, request.authUser.tenantId])).rows : [];
            await client.query('COMMIT');
            return { data: comparison(listing, product || null, variants) };
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    });
    app.post('/listings/:id/binding', { preHandler: [requirePermission('integration:manage'), requirePermission('product:read')] }, async (request) => {
        const { id } = params.parse(request.params);
        const input = z.object({ productId: z.string().uuid().nullable(), revision: z.number().int().positive(), syncedAt: z.string().datetime({ offset: true }), confirmed: z.literal(true), bindings: z.array(z.object({ specId: z.string().trim().min(1).max(100), variantId: z.string().uuid() })).max(2000) }).parse(request.body);
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const identity = (await client.query('SELECT connection_id FROM integration_1688_listings WHERE id=$1 AND tenant_id=$2', [id, request.authUser.tenantId])).rows[0];
            if (!identity)
                throw new IntegrationError('NOT_FOUND', '平台商品不存在。', 404);
            // Serialize local binding changes with the publish claim for this shop.
            await client.query('SELECT id FROM integration_1688_connections WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [identity.connection_id, request.authUser.tenantId]);
            const listing = (await client.query('SELECT * FROM integration_1688_listings WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [id, request.authUser.tenantId])).rows[0];
            if (!listing)
                throw new IntegrationError('NOT_FOUND', '平台商品不存在。', 404);
            if (listing.binding_revision !== input.revision || new Date(listing.synced_at).getTime() !== new Date(input.syncedAt).getTime())
                throw new IntegrationError('BINDING_CONFLICT', '关联或平台快照已变化，请刷新后重新核对。', 409);
            if (listing.product_id !== input.productId) {
                if (listing.product_id && input.productId)
                    throw new IntegrationError('ALREADY_BOUND', '请先解除旧关联，再选择新产品。', 409);
                const products = [listing.product_id, input.productId].filter(Boolean);
                const locked = (await client.query("SELECT id FROM integration_1688_publish_drafts WHERE connection_id=$1 AND tenant_id=$2 AND product_id=ANY($3::uuid[]) AND status IN ('submitting','unknown','published') LIMIT 1", [listing.connection_id, request.authUser.tenantId, products])).rows[0];
                if (locked)
                    throw new IntegrationError('PUBLISH_BINDING_LOCKED', '发布中、结果待核对或发布生成的关联不能手工替换或解除。', 409);
            }
            if (!input.productId && input.bindings.length)
                throw new IntegrationError('INVALID_BINDINGS', '未关联正式产品时不能保存 SKU 对应关系。', 400);
            if (input.productId) {
                const product = (await client.query("SELECT id FROM products WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL AND status='active' FOR SHARE", [input.productId, request.authUser.tenantId])).rows[0];
                if (!product)
                    throw new IntegrationError('NOT_FOUND', '请选择当前组织的已启用正式产品。', 404);
                const variants = (await client.query('SELECT id FROM product_variants WHERE product_id=$1 AND tenant_id=$2', [input.productId, request.authUser.tenantId])).rows;
                const platform = platformSkus(listing.snapshot || {}), specs = platform.map((sku) => sku.specId).filter(Boolean);
                const specIds = new Set(specs), variantIds = new Set(variants.map(v => v.id));
                if (input.bindings.length && specIds.size !== specs.length)
                    throw new IntegrationError('INVALID_BINDINGS', '平台 specId 存在重复，请先核对商品详情。', 400);
                if (new Set(input.bindings.map(b => b.specId)).size !== input.bindings.length || new Set(input.bindings.map(b => b.variantId)).size !== input.bindings.length || input.bindings.some(b => !specIds.has(b.specId) || !variantIds.has(b.variantId)))
                    throw new IntegrationError('INVALID_BINDINGS', '规格对应关系无效或重复，请使用当前商品及正式产品的实际 SKU。', 400);
            }
            const row = (await client.query('UPDATE integration_1688_listings SET product_id=$3,sku_bindings=$4::jsonb,binding_revision=binding_revision+1 WHERE id=$1 AND tenant_id=$2 RETURNING id,product_id,binding_revision', [id, request.authUser.tenantId, input.productId, JSON.stringify(input.bindings)])).rows[0];
            await client.query("INSERT INTO audit_logs(tenant_id,actor_id,action,entity_type,entity_id,before_data,after_data,request_id)VALUES($1,$2,'1688.listing.binding','1688_listing',$3,$4,$5,$6)", [request.authUser.tenantId, request.authUser.sub, id, JSON.stringify({ productId: listing.product_id, bindings: listing.sku_bindings }), JSON.stringify({ productId: input.productId, bindings: input.bindings }), request.id]);
            await client.query('COMMIT');
            return { data: row };
        }
        catch (error) {
            await client.query('ROLLBACK');
            if (error.code === '23505')
                throw new IntegrationError('PRODUCT_ALREADY_BOUND', '该正式产品已关联这个店铺的其他商品。', 409);
            throw error;
        }
        finally {
            client.release();
        }
    });
}
