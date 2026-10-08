import { db } from '../db.js';
import { callProductApi, IntegrationError, parseBusinessData } from './1688.js';
import { collectedCategoryDefaults } from './1688-collected-attributes.js';
export async function createDraftFromProduct(input) {
    const { tenantId, actorId, requestId, connectionId, product, catId, scene } = input;
    if (input.reuse) {
        const existing = (await db.query('SELECT * FROM integration_1688_publish_drafts WHERE tenant_id=$1 AND connection_id=$2 AND product_id=$3', [tenantId, connectionId, product.id])).rows[0];
        if (existing) {
            if (!['draft', 'failed'].includes(existing.status))
                throw new IntegrationError('DRAFT_EXISTS', '该商品已有不可自动重试的发布记录。', 409);
            return existing;
        }
    }
    const args = scene === 'industry' ? { scene, bizParam: { industryCategoryId: catId } } : { scene, catId };
    const schema = parseBusinessData(await callProductApi(connectionId, tenantId, actorId, 'alibaba.new.product.getSchema', args, requestId));
    if (!schema.data || !schema.global)
        throw new IntegrationError('INVALID_SCHEMA', '平台规则缺少表单字段或发布上下文。');
    const defaults = Object.fromEntries(Object.entries(schema.data).filter(([, node]) => node.fields?.value !== undefined).map(([key, node]) => [key, node.fields.value]));
    const source = (await db.query('SELECT * FROM collected_products WHERE tenant_id=$1 AND product_id=$2 ORDER BY updated_at DESC LIMIT 1', [tenantId, product.id])).rows[0] || null;
    const category = collectedCategoryDefaults(schema, source);
    const maxImages = Number(schema.data.primaryPicture?.fields?.maxItems || 10);
    const formValues = { ...defaults, title: product.name, primaryPicture: { imageList: (product.images || []).slice(0, maxImages).map((url) => ({ url })) }, description: { detailList: [{ id: '0', title: '图文详情', content: product.description || '', isRequired: true }] }, ...(schema.data.priceRange ? { priceRange: [{ pricerange_beginAmount: 1, pricerange_price: Number(product.base_price) }] } : {}), ...(Object.keys(category).length ? { catProp: { ...(defaults.catProp || {}), ...category } } : {}) };
    const body = { global: schema.global, formValues };
    const row = (await db.query('INSERT INTO integration_1688_publish_drafts(tenant_id,connection_id,product_id,cat_id,scene,platform_schema,data_body,created_by)VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(connection_id,product_id) DO NOTHING RETURNING *', [tenantId, connectionId, product.id, catId, scene, JSON.stringify(schema), JSON.stringify(body), actorId])).rows[0];
    if (!row)
        throw new IntegrationError('DRAFT_EXISTS', '该产品在这个店铺已有发布草稿，请打开原草稿。', 409);
    return row;
}
