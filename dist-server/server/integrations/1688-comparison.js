export function decimal(value) {
    if (value == null || value === '')
        return null;
    if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))))
        return null;
    const text = String(value).trim();
    if (!/^\d+(\.\d+)?$/.test(text))
        return null;
    const [whole, fraction = ''] = text.split('.');
    const integral = whole.replace(/^0+(?=\d)/, '');
    const tail = fraction.replace(/0+$/, '');
    return integral + (tail ? `.${tail}` : '');
}
export function numericDifference(crm, platform) {
    const left = decimal(crm), right = decimal(platform);
    return { crm: left, platform: right, status: left == null || right == null ? 'unknown' : left === right ? 'equal' : 'changed' };
}
export function platformSkus(snapshot) {
    return (Array.isArray(snapshot.skuInfos) ? snapshot.skuInfos : []).map((sku, index) => {
        const specId = typeof sku?.specId === 'string' && sku.specId.trim() ? sku.specId : null;
        const attributes = Array.isArray(sku?.attributes) ? sku.attributes : [];
        const label = attributes.map((a) => [a?.attributeDisplayName || a?.attributeName, (typeof a?.customValueName === 'string' ? a.customValueName.trim() : '') || a?.attributeValue].filter(Boolean).join(': ')).filter(Boolean).join(' / ');
        return { specId, label: label || sku?.cargoNumber || `规格 ${index + 1}`, price: sku?.price ?? null, stock: sku?.amountOnSale ?? null };
    });
}
const imageUrl = (value) => typeof value === 'string' ? (value.startsWith('img/') ? `https://cbu01.alicdn.com/${value}` : value) : null;
export function comparison(listing, product, variants) {
    const skus = platformSkus(listing.snapshot || {}), bindings = Array.isArray(listing.sku_bindings) ? listing.sku_bindings : [];
    const byVariant = new Map(variants.map(v => [v.id, v])), bySpec = new Map(skus.filter((s) => s.specId && skus.filter((other) => other.specId === s.specId).length === 1).map((s) => [s.specId, s]));
    const currency = listing.snapshot?.saleInfo?.currency;
    const compatible = product?.base_currency === 'CNY' && (!currency || currency === 'CNY');
    const rows = bindings.map(binding => {
        const variant = byVariant.get(binding.variantId), sku = bySpec.get(binding.specId);
        return { ...binding, crmLabel: variant?.label || '正式规格已移除', platformLabel: sku?.label || '平台规格已移除', missing: !variant || !sku, price: numericDifference(variant?.unit_price, compatible ? sku?.price : null), stock: numericDifference(variant?.stock, sku?.stock) };
    });
    const ranges = listing.snapshot?.saleInfo?.priceRanges;
    const singlePrice = Array.isArray(ranges) && ranges.length === 1 && decimal(ranges[0]?.startQuantity) === '1' ? ranges[0].price : null;
    const crmImage = imageUrl(product?.images?.[0]), platformImage = imageUrl(listing.image_url);
    return { listing: { id: listing.id, offerId: listing.offer_id, title: listing.title, productId: listing.product_id, bindingRevision: listing.binding_revision, syncedAt: listing.synced_at }, product: product ? { id: product.id, sku: product.sku, name: product.name, status: product.status, currency: product.base_currency, updatedAt: product.updated_at } : null, variants: variants.map(v => ({ id: v.id, label: v.label, attributes: v.attributes, unitPrice: v.unit_price, stock: v.stock })), platformSkus: skus, bindings, rows, summary: { mapped: rows.length, unmatchedCrm: variants.filter(v => !bindings.some(b => b.variantId === v.id)).length, unmatchedPlatform: skus.filter((s) => !s.specId || !bindings.some(b => b.specId === s.specId)).length, changedPrice: rows.filter(row => row.price.status === 'changed').length, changedStock: rows.filter(row => row.stock.status === 'changed').length, unknown: rows.filter(row => row.missing || row.price.status === 'unknown' || row.stock.status === 'unknown').length }, fields: { title: { crm: product?.name ?? null, platform: listing.title, status: !product ? 'unknown' : product.name === listing.title ? 'equal' : 'changed' }, image: { crm: crmImage, platform: platformImage, status: !crmImage || !platformImage ? 'unknown' : crmImage === platformImage ? 'equal' : 'changed' }, basePrice: { ...numericDifference(product?.base_price, compatible ? singlePrice : null), basis: singlePrice == null ? '平台不是从 1 件起的单一价格，不能与基础单价直接比较' : !compatible ? '币种未确认一致' : '单一价格 · 起购 1 件' } } };
}
