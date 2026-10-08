import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const script = readFileSync(new URL('./1688-product-collector.user.js', import.meta.url), 'utf8')
const marker = '    // ─── Add global styles'
assert.ok(script.includes(marker))
const links = []
const sandbox = {
  URL,
  location: { href: 'https://detail.1688.com/offer/987654.html' },
  document: { querySelectorAll: () => links },
}
runInNewContext(script.replace(marker, '    globalThis.collectorTest = { get1688ContextData, extract1688CategoryId, extract1688CategoryIdFromDom, mergeProducts$2 }; return;\n' + marker), sandbox)
const { get1688ContextData, extract1688CategoryId, extract1688CategoryIdFromDom, mergeProducts$2 } = sandbox.collectorTest

const sample = { Root: { fields: { dataJson: { tempModel: { offerId: 911245022175, topCategoryId: 122916002, postCategoryId: 124746024 }, offerBaseInfo: { catId: 124746024 } } } } }
assert.equal(extract1688CategoryId(sample), '124746024')
sandbox.unsafeWindow = { context: { result: { data: sample } } }
assert.equal(extract1688CategoryId(get1688ContextData()), '124746024')
assert.equal(extract1688CategoryId({ Root: { fields: { dataJson: { tempModel: { topCategoryId: 122916002 }, offerBaseInfo: { catId: 124746024 } } } } }), '124746024')
assert.equal(extract1688CategoryId({ Root: { fields: { dataJson: { tempModel: { topCategoryId: 122916002 } } } } }), undefined)
assert.equal(extract1688CategoryId({ Root: { fields: { dataJson: { tempModel: { postCategoryId: 124746024 }, offerBaseInfo: { catId: 999 } } } } }), undefined)

assert.equal(extract1688CategoryId({ categoryInfo: { fields: { categoryId: 12345 } } }), '12345')
assert.equal(extract1688CategoryId({ Root: { fields: { dataJson: { productInfo: { catId: '67890' } } } } }), '67890')
links.push({ getAttribute: () => '/category/24680?offerId=987654' })
assert.equal(extract1688CategoryIdFromDom(), '24680')
assert.equal(extract1688CategoryId({ categoryInfo: { fields: { categoryPath: '服饰 > 女装' } } }), '24680')
links.length = 0
assert.equal(extract1688CategoryId({ categoryInfo: { fields: { categoryId: 'not-a-category' } } }), undefined)
assert.equal(extract1688CategoryId({}), undefined)
const base = { title: '测试', mainImages: [], detailImages: [], attributes: {}, skuProps: [], skus: [] }
assert.equal(mergeProducts$2({ ...base }, { ...base, sourceCategoryId: '24680' }).sourceCategoryId, '24680')
assert.equal(mergeProducts$2({ ...base, sourceCategoryId: '12345' }, { ...base, sourceCategoryId: '24680' }).sourceCategoryId, '12345')
assert.match(script, /sourceCategoryId: product\.sourceCategoryId/)
console.log(JSON.stringify({ samplePublishCategory: '124746024', context: 'ok', rootCategory: 'ok', breadcrumbFallback: 'ok', topCategoryOnly: 'blocked', conflictingPublishIds: 'blocked', merge: 'ok', importPayload: 'ok' }))
