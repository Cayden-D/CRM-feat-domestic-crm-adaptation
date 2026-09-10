// ==UserScript==
// @name         销途 CRM · 1688/Alibaba 商品采集器
// @namespace    https://cc.local
// @version      2.1.0
// @description  从 1688、Alibaba.com 完整采集商品并直接保存到销途 CRM
// @author       cc
// @noframes
// @match        https://detail.1688.com/offer/*
// @match        https://www.1688.com/*
// @match        https://*.1688.com/*
// @match        https://www.alibaba.com/*
// @match        https://*.alibaba.com/*
// @match        https://detail.alibaba.com/*
// @connect      127.0.0.1
// @connect      localhost
// @connect      s.alicdn.com
// @connect      sc04.alicdn.com
// @connect      gv.videocdn.alibaba.com
// @connect      itemcdn.tmall.com
// @connect      cbu01.alicdn.com
// @connect      img.alicdn.com
// @connect      detail.1688.com
// @connect      h5api.m.1688.com
// @icon         https://www.google.com/s2/favicons?sz=64&domain=1688.com
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    globalThis.__CC_API_BASE__ = "http://127.0.0.1:3001/api/product-collections";

    /**
     * Helper: get text content from a DOM element via selector
     */
    /**
     * Detect platform from current URL
     */
    function detectPlatform() {
        const host = location.hostname;
        if (host.includes("1688.com"))
            return "1688";
        if (host.includes("alibaba.com"))
            return "alibaba";
        if (host.includes("aliexpress.com"))
            return "aliexpress";
        return "unknown";
    }

    /**
     * 访问页面主世界（main world）的 window。
     * Tampermonkey 用户脚本运行在隔离环境，直接读 window.context 会得到 undefined。
     */
    function getPageWindow() {
        const g = globalThis;
        return (typeof g.unsafeWindow !== "undefined" ? g.unsafeWindow : window);
    }
    /** 从页面 window.context / __INITIAL_STATE__ 读取 1688 商品数据 */
    function get1688ContextData() {
        try {
            const pw = getPageWindow();
            if (pw.context?.result?.data)
                return pw.context.result.data;
            if (pw.__INITIAL_STATE__?.data)
                return pw.__INITIAL_STATE__.data;
            return null;
        }
        catch {
            return null;
        }
    }
    /** 不区分大小写读取顶层模块，如 Root / gallery */
    function getContextModule(data, tag) {
        const key = Object.keys(data).find((k) => k.toLowerCase() === tag.toLowerCase());
        if (!key)
            return undefined;
        const mod = data[key];
        if (mod && typeof mod === "object")
            return mod;
        return undefined;
    }
    function getContextModuleFields(data, tag) {
        return getContextModule(data, tag)?.fields;
    }
    /** 读取 Root.fields.dataJson（兼容大小写） */
    function getDataJson(data) {
        const fields = getContextModuleFields(data, "Root");
        if (!fields)
            return undefined;
        const key = Object.keys(fields).find((k) => k.toLowerCase() === "datajson");
        if (!key)
            return undefined;
        const val = fields[key];
        return val && typeof val === "object" ? val : undefined;
    }
    /** 深度查找含 skuInfoMap 的 skuModel */
    function findSkuModel(data) {
        if (!data || typeof data !== "object")
            return undefined;
        const walk = (obj, depth) => {
            if (!obj || typeof obj !== "object" || depth > 14)
                return undefined;
            if (!Array.isArray(obj)) {
                const rec = obj;
                if (rec.skuInfoMap && typeof rec.skuInfoMap === "object")
                    return rec;
                for (const v of Object.values(rec)) {
                    const found = walk(v, depth + 1);
                    if (found)
                        return found;
                }
            }
            else {
                for (const item of obj) {
                    const found = walk(item, depth + 1);
                    if (found)
                        return found;
                }
            }
            return undefined;
        };
        return walk(data, 0);
    }
    /** 阿里国际站 PDP：SSR 注入的 window.detailData */
    function getAlibabaDetailData() {
        try {
            const pw = getPageWindow();
            const data = pw.detailData;
            if (data?.globalData?.product)
                return data;
            return null;
        }
        catch {
            return null;
        }
    }
    function decodeHtmlEntities(text) {
        if (!text || !text.includes("&"))
            return text;
        const el = document.createElement("textarea");
        el.innerHTML = text;
        return el.value;
    }

    const DETAIL_IMAGE_LIMIT = 6;
    const MAIN_IMAGE_LIMIT = 6;
    function absolutizeUrl$1(raw) {
        const trimmed = raw.trim();
        if (!trimmed)
            return "";
        if (trimmed.startsWith("http"))
            return trimmed;
        if (trimmed.startsWith("//"))
            return `${location.protocol}${trimmed}`;
        return new URL(trimmed, location.origin).href;
    }
    function normalize1688ImageUrl(raw) {
        const url = absolutizeUrl$1(raw);
        if (!url || url.startsWith("data:"))
            return "";
        return url.replace(/\.(jpg|jpeg|png|webp)_[^/?]+\.(jpg|jpeg|png|webp)(?=[?#]|$)/i, ".$1");
    }
    function uniqueUrls$1(urls) {
        const seen = new Set();
        const out = [];
        for (const url of urls) {
            const normalized = normalize1688ImageUrl(url);
            if (normalized && !seen.has(normalized)) {
                seen.add(normalized);
                out.push(normalized);
            }
        }
        return out;
    }
    function findCardRootFromImage(img) {
        let cur = img.parentElement;
        while (cur && cur !== document.body) {
            const style = cur.getAttribute("style") || "";
            const hasCardShape = /width:\s*2[0-9]{2}px/i.test(style) &&
                /display:\s*inline-block/i.test(style) &&
                cur.querySelector("p[title], a[title], [class*='title']");
            if (hasCardShape)
                return cur;
            cur = cur.parentElement;
        }
        return null;
    }
    function get1688ListCards() {
        const cards = new Set();
        document
            .querySelectorAll(".offer-card, .sm-offer-card, [class*='offer-card'], .item-card, .feni-card, [class*='card-item']")
            .forEach((el) => cards.add(el));
        document.querySelectorAll(".main-picture").forEach((img) => {
            const card = findCardRootFromImage(img);
            if (card)
                cards.add(card);
        });
        return Array.from(cards);
    }
    let cachedMtopOffers = [];
    let cachedMtopPage = 0;
    let mtopOfferRequesting = false;
    let lastMtopRequestAt = 0;
    function isObjectRecord(value) {
        return !!value && typeof value === "object";
    }
    function getUnsafeGlobal() {
        const g = globalThis;
        return (g.unsafeWindow || window);
    }
    function getCookieValue(name) {
        const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
        return match?.[1] ? decodeURIComponent(match[1]) : "";
    }
    function md5(input) {
        const rotateLeft = (lValue, shiftBits) => (lValue << shiftBits) | (lValue >>> (32 - shiftBits));
        const addUnsigned = (x, y) => {
            const x4 = x & 0x40000000;
            const y4 = y & 0x40000000;
            const x8 = x & 0x80000000;
            const y8 = y & 0x80000000;
            const result = (x & 0x3fffffff) + (y & 0x3fffffff);
            if (x4 & y4)
                return result ^ 0x80000000 ^ x8 ^ y8;
            if (x4 | y4) {
                if (result & 0x40000000)
                    return result ^ 0xc0000000 ^ x8 ^ y8;
                return result ^ 0x40000000 ^ x8 ^ y8;
            }
            return result ^ x8 ^ y8;
        };
        const f = (x, y, z) => (x & y) | (~x & z);
        const g = (x, y, z) => (x & z) | (y & ~z);
        const h = (x, y, z) => x ^ y ^ z;
        const i = (x, y, z) => y ^ (x | ~z);
        const ff = (a, b, c, d, x, s, ac) => addUnsigned(rotateLeft(addUnsigned(addUnsigned(a, f(b, c, d)), addUnsigned(x, ac)), s), b);
        const gg = (a, b, c, d, x, s, ac) => addUnsigned(rotateLeft(addUnsigned(addUnsigned(a, g(b, c, d)), addUnsigned(x, ac)), s), b);
        const hh = (a, b, c, d, x, s, ac) => addUnsigned(rotateLeft(addUnsigned(addUnsigned(a, h(b, c, d)), addUnsigned(x, ac)), s), b);
        const ii = (a, b, c, d, x, s, ac) => addUnsigned(rotateLeft(addUnsigned(addUnsigned(a, i(b, c, d)), addUnsigned(x, ac)), s), b);
        const utf8 = unescape(encodeURIComponent(input));
        const words = [];
        for (let n = 0; n < utf8.length; n += 1) {
            words[n >> 2] = words[n >> 2] || 0;
            words[n >> 2] |= utf8.charCodeAt(n) << ((n % 4) * 8);
        }
        const bitLength = utf8.length * 8;
        words[bitLength >> 5] = words[bitLength >> 5] || 0;
        words[bitLength >> 5] |= 0x80 << bitLength % 32;
        words[(((bitLength + 64) >>> 9) << 4) + 14] = bitLength;
        let a = 0x67452301;
        let b = 0xefcdab89;
        let c = 0x98badcfe;
        let d = 0x10325476;
        for (let k = 0; k < words.length; k += 16) {
            const aa = a;
            const bb = b;
            const cc = c;
            const dd = d;
            a = ff(a, b, c, d, words[k + 0] || 0, 7, 0xd76aa478);
            d = ff(d, a, b, c, words[k + 1] || 0, 12, 0xe8c7b756);
            c = ff(c, d, a, b, words[k + 2] || 0, 17, 0x242070db);
            b = ff(b, c, d, a, words[k + 3] || 0, 22, 0xc1bdceee);
            a = ff(a, b, c, d, words[k + 4] || 0, 7, 0xf57c0faf);
            d = ff(d, a, b, c, words[k + 5] || 0, 12, 0x4787c62a);
            c = ff(c, d, a, b, words[k + 6] || 0, 17, 0xa8304613);
            b = ff(b, c, d, a, words[k + 7] || 0, 22, 0xfd469501);
            a = ff(a, b, c, d, words[k + 8] || 0, 7, 0x698098d8);
            d = ff(d, a, b, c, words[k + 9] || 0, 12, 0x8b44f7af);
            c = ff(c, d, a, b, words[k + 10] || 0, 17, 0xffff5bb1);
            b = ff(b, c, d, a, words[k + 11] || 0, 22, 0x895cd7be);
            a = ff(a, b, c, d, words[k + 12] || 0, 7, 0x6b901122);
            d = ff(d, a, b, c, words[k + 13] || 0, 12, 0xfd987193);
            c = ff(c, d, a, b, words[k + 14] || 0, 17, 0xa679438e);
            b = ff(b, c, d, a, words[k + 15] || 0, 22, 0x49b40821);
            a = gg(a, b, c, d, words[k + 1] || 0, 5, 0xf61e2562);
            d = gg(d, a, b, c, words[k + 6] || 0, 9, 0xc040b340);
            c = gg(c, d, a, b, words[k + 11] || 0, 14, 0x265e5a51);
            b = gg(b, c, d, a, words[k + 0] || 0, 20, 0xe9b6c7aa);
            a = gg(a, b, c, d, words[k + 5] || 0, 5, 0xd62f105d);
            d = gg(d, a, b, c, words[k + 10] || 0, 9, 0x02441453);
            c = gg(c, d, a, b, words[k + 15] || 0, 14, 0xd8a1e681);
            b = gg(b, c, d, a, words[k + 4] || 0, 20, 0xe7d3fbc8);
            a = gg(a, b, c, d, words[k + 9] || 0, 5, 0x21e1cde6);
            d = gg(d, a, b, c, words[k + 14] || 0, 9, 0xc33707d6);
            c = gg(c, d, a, b, words[k + 3] || 0, 14, 0xf4d50d87);
            b = gg(b, c, d, a, words[k + 8] || 0, 20, 0x455a14ed);
            a = gg(a, b, c, d, words[k + 13] || 0, 5, 0xa9e3e905);
            d = gg(d, a, b, c, words[k + 2] || 0, 9, 0xfcefa3f8);
            c = gg(c, d, a, b, words[k + 7] || 0, 14, 0x676f02d9);
            b = gg(b, c, d, a, words[k + 12] || 0, 20, 0x8d2a4c8a);
            a = hh(a, b, c, d, words[k + 5] || 0, 4, 0xfffa3942);
            d = hh(d, a, b, c, words[k + 8] || 0, 11, 0x8771f681);
            c = hh(c, d, a, b, words[k + 11] || 0, 16, 0x6d9d6122);
            b = hh(b, c, d, a, words[k + 14] || 0, 23, 0xfde5380c);
            a = hh(a, b, c, d, words[k + 1] || 0, 4, 0xa4beea44);
            d = hh(d, a, b, c, words[k + 4] || 0, 11, 0x4bdecfa9);
            c = hh(c, d, a, b, words[k + 7] || 0, 16, 0xf6bb4b60);
            b = hh(b, c, d, a, words[k + 10] || 0, 23, 0xbebfbc70);
            a = hh(a, b, c, d, words[k + 13] || 0, 4, 0x289b7ec6);
            d = hh(d, a, b, c, words[k + 0] || 0, 11, 0xeaa127fa);
            c = hh(c, d, a, b, words[k + 3] || 0, 16, 0xd4ef3085);
            b = hh(b, c, d, a, words[k + 6] || 0, 23, 0x04881d05);
            a = hh(a, b, c, d, words[k + 9] || 0, 4, 0xd9d4d039);
            d = hh(d, a, b, c, words[k + 12] || 0, 11, 0xe6db99e5);
            c = hh(c, d, a, b, words[k + 15] || 0, 16, 0x1fa27cf8);
            b = hh(b, c, d, a, words[k + 2] || 0, 23, 0xc4ac5665);
            a = ii(a, b, c, d, words[k + 0] || 0, 6, 0xf4292244);
            d = ii(d, a, b, c, words[k + 7] || 0, 10, 0x432aff97);
            c = ii(c, d, a, b, words[k + 14] || 0, 15, 0xab9423a7);
            b = ii(b, c, d, a, words[k + 5] || 0, 21, 0xfc93a039);
            a = ii(a, b, c, d, words[k + 12] || 0, 6, 0x655b59c3);
            d = ii(d, a, b, c, words[k + 3] || 0, 10, 0x8f0ccc92);
            c = ii(c, d, a, b, words[k + 10] || 0, 15, 0xffeff47d);
            b = ii(b, c, d, a, words[k + 1] || 0, 21, 0x85845dd1);
            a = ii(a, b, c, d, words[k + 8] || 0, 6, 0x6fa87e4f);
            d = ii(d, a, b, c, words[k + 15] || 0, 10, 0xfe2ce6e0);
            c = ii(c, d, a, b, words[k + 6] || 0, 15, 0xa3014314);
            b = ii(b, c, d, a, words[k + 13] || 0, 21, 0x4e0811a1);
            a = ii(a, b, c, d, words[k + 4] || 0, 6, 0xf7537e82);
            d = ii(d, a, b, c, words[k + 11] || 0, 10, 0xbd3af235);
            c = ii(c, d, a, b, words[k + 2] || 0, 15, 0x2ad7d2bb);
            b = ii(b, c, d, a, words[k + 9] || 0, 21, 0xeb86d391);
            a = addUnsigned(a, aa);
            b = addUnsigned(b, bb);
            c = addUnsigned(c, cc);
            d = addUnsigned(d, dd);
        }
        const wordToHex = (value) => [0, 8, 16, 24]
            .map((shift) => (`0${((value >>> shift) & 0xff).toString(16)}`).slice(-2))
            .join("");
        return `${wordToHex(a)}${wordToHex(b)}${wordToHex(c)}${wordToHex(d)}`.toLowerCase();
    }
    function getReactExpandoValues(el) {
        const rec = el;
        return Object.keys(rec)
            .filter((key) => key.startsWith("__reactProps$") || key.startsWith("__reactFiber$"))
            .map((key) => rec[key]);
    }
    function isRaw1688Offer(value) {
        if (!isObjectRecord(value))
            return false;
        const id = value.id;
        return ((typeof id === "string" || typeof id === "number") &&
            /^\d{8,}$/.test(String(id)) &&
            (typeof value.subject === "string" ||
                typeof value.title === "string" ||
                Array.isArray(value.offerImages) ||
                typeof value.imgUrl === "string"));
    }
    function findOfferListInValue(value, depth = 0, seen = new WeakSet()) {
        if (!isObjectRecord(value) || depth > 8 || seen.has(value))
            return [];
        seen.add(value);
        if (Array.isArray(value)) {
            if (value.length > 0 && value.some(isRaw1688Offer)) {
                return value.filter(isRaw1688Offer);
            }
            for (const item of value.slice(0, 8)) {
                const found = findOfferListInValue(item, depth + 1, seen);
                if (found.length > 0)
                    return found;
            }
            return [];
        }
        const directList = value.offerList;
        if (Array.isArray(directList) && directList.some(isRaw1688Offer)) {
            return directList.filter(isRaw1688Offer);
        }
        for (const key of Object.keys(value)) {
            if (!/props|state|stateNode|data|content|offer|list|result|memoized|return|child|sibling|alternate/i.test(key) &&
                depth > 1) {
                continue;
            }
            const found = findOfferListInValue(value[key], depth + 1, seen);
            if (found.length > 0)
                return found;
        }
        return [];
    }
    function extract1688OfferListFromReactState() {
        const scopes = [
            ...Array.from(document.querySelectorAll("[data-modulename='wp_pc_common_offerlist'], [data-widgetid='45753076']")),
            ...get1688ListCards(),
        ];
        const seenElements = new Set();
        for (const scope of scopes) {
            let cur = scope;
            while (cur && cur !== document.body && !seenElements.has(cur)) {
                seenElements.add(cur);
                for (const value of getReactExpandoValues(cur)) {
                    const found = findOfferListInValue(value);
                    if (found.length > 0)
                        return found;
                }
                cur = cur.parentElement;
            }
        }
        for (const el of Array.from(document.querySelectorAll("*"))) {
            for (const value of getReactExpandoValues(el)) {
                const found = findOfferListInValue(value);
                if (found.length > 0) {
                    console.log(`[CC] 1688 runtime offerList found: ${found.length}`);
                    return found;
                }
            }
        }
        return [];
    }
    function pickReactProductInfo(value, depth = 0, seen = new WeakSet()) {
        if (!value || typeof value !== "object" || depth > 5)
            return null;
        if (seen.has(value))
            return null;
        seen.add(value);
        const rec = value;
        const url = typeof rec.detailUrl === "string"
            ? rec.detailUrl
            : typeof rec.detailURL === "string"
                ? rec.detailURL
                : typeof rec.url === "string" && /offer\/\d+|offerId=/i.test(rec.url)
                    ? rec.url
                    : undefined;
        const id = rec.offerId ?? rec.offerid ?? rec.offerID ?? rec.id;
        if ((typeof id === "string" || typeof id === "number") || url) {
            const idText = id != null ? String(id) : "";
            if (!idText || /^\d{8,}$/.test(idText) || url) {
                return { id: idText, detailUrl: url };
            }
        }
        for (const key of Object.keys(rec)) {
            if (!/props|children|data|item|offer|product|result|model/i.test(key) &&
                depth > 1) {
                continue;
            }
            const found = pickReactProductInfo(rec[key], depth + 1, seen);
            if (found)
                return found;
        }
        return null;
    }
    function extractReactProductInfoFromCard(card) {
        let cur = card;
        while (cur && cur !== document.body) {
            const rec = cur;
            for (const key of Object.keys(rec)) {
                if (!key.startsWith("__reactProps$") && !key.startsWith("__reactFiber$"))
                    continue;
                const found = pickReactProductInfo(rec[key]);
                if (found)
                    return found;
            }
            cur = cur.parentElement;
        }
        return null;
    }
    function extractOfferIdFromCard(card, href, reactInfo) {
        const attrs = [
            "data-offer-id",
            "data-offerid",
            "data-id",
            "offer-id",
            "offerid",
        ];
        for (const attr of attrs) {
            const value = card.getAttribute(attr);
            if (value && /^\d{8,}$/.test(value))
                return value;
        }
        return (href.match(/offer\/(\d+)/)?.[1] ||
            href.match(/[?&](?:offerId|offerid)=(\d+)/)?.[1] ||
            reactInfo?.id ||
            reactInfo?.detailUrl?.match(/offer\/(\d+)/)?.[1] ||
            reactInfo?.detailUrl?.match(/[?&](?:offerId|offerid)=(\d+)/)?.[1] ||
            "");
    }
    function extract1688CardTitle(card) {
        return (card.querySelector("a[title]")?.getAttribute("title") ||
            card.querySelector("p[title]")?.getAttribute("title") ||
            card.querySelector("[class*='title']")?.textContent?.trim() ||
            "");
    }
    function extract1688CardPrice(card) {
        const text = card.textContent?.replace(/\s+/g, "") || "";
        const match = text.match(/[\u00a5\uffe5]\d+(?:\.\d+)?(?:[-~\u81f3]\d+(?:\.\d+)?)?/);
        if (match)
            return match[0].replace("\uffe5", "\u00a5");
        return card.querySelector("[class*='price']")?.textContent?.trim() || "";
    }
    function get1688CardHref(card) {
        const link = card.querySelector("a[href*='detail.1688.com/offer/'], a[href*='/offer/'], a[href*='offerId=']");
        return link?.getAttribute("href") || "";
    }
    function find1688CardRootFromLink(link) {
        let cur = link.parentElement;
        let fallback = link;
        for (let i = 0; cur && cur !== document.body && i < 8; i += 1, cur = cur.parentElement) {
            fallback = cur;
            const text = cur.textContent?.replace(/\s+/g, "") || "";
            const hasImage = !!cur.querySelector("img");
            const hasPrice = /[\u00a5\uffe5]\d/.test(text);
            const className = cur.getAttribute("class") || "";
            if ((hasImage && hasPrice) ||
                /card|offer|item|product|goods|search|list/i.test(className) ||
                cur.hasAttribute("data-cc-list-card")) {
                return cur;
            }
        }
        return fallback;
    }
    function build1688DetailUrl(id) {
        return `https://detail.1688.com/offer/${id}.html`;
    }
    function getRaw1688OfferId(offer) {
        const id = offer.id != null ? String(offer.id) : "";
        return /^\d{8,}$/.test(id) ? id : "";
    }
    function getRaw1688OfferTitle(offer) {
        return offer.subject || offer.title || "";
    }
    function getRaw1688OfferImage(offer) {
        const firstImage = offer.offerImages?.[0]?.size310x310ImageURI ||
            offer.offerImages?.[0]?.fullPathImageURI ||
            offer.imgUrl ||
            "";
        return normalize1688ImageUrl(firstImage);
    }
    function getRaw1688OfferPrice(offer) {
        const raw = offer.finalPriceVo?.priceText ||
            offer.finalPriceVo?.price ||
            offer.offerPrice ||
            offer.discountPrice ||
            offer.bPrice ||
            offer.originalPrice ||
            "";
        return raw ? `\u00a5${String(raw).replace(/^[\u00a5\uffe5]/, "")}` : "";
    }
    function getRaw1688OfferUrl(offer) {
        const id = getRaw1688OfferId(offer);
        if (!id)
            return "";
        const suffix = offer.extraParams ? `?${offer.extraParams}` : "";
        return `${build1688DetailUrl(id)}${suffix}`;
    }
    function get1688SellerMemberId() {
        const w = getUnsafeGlobal();
        const api = typeof w.shopPageDataApi === "string" ? w.shopPageDataApi : "";
        if (api) {
            try {
                const value = new URL(api, location.href).searchParams.get("sellerMemberId");
                if (value)
                    return value;
            }
            catch {
                const match = api.match(/[?&]sellerMemberId=([^&]+)/);
                if (match?.[1])
                    return decodeURIComponent(match[1]);
            }
        }
        const pageData = w.pageData;
        if (isObjectRecord(pageData)) {
            const text = JSON.stringify(pageData);
            const match = text.match(/"memberId"\s*:\s*"([^"]+)"/);
            if (match?.[1])
                return match[1];
        }
        const htmlMatch = document.documentElement.innerHTML.match(/sellerMemberId=([^&"']+)/);
        return htmlMatch?.[1] ? decodeURIComponent(htmlMatch[1]) : "";
    }
    function get1688CurrentListPage() {
        const params = new URLSearchParams(location.search);
        const fromUrl = Number(params.get("pageNum") || params.get("page"));
        if (Number.isFinite(fromUrl) && fromUrl > 0)
            return fromUrl;
        const pageText = document.body?.textContent?.match(/(\d+)\s*\/\s*\d+/);
        if (pageText?.[1]) {
            const page = Number(pageText[1]);
            if (Number.isFinite(page) && page > 0)
                return page;
        }
        const controls = Array.from(document.querySelectorAll("button, a, div, span"));
        for (const el of controls) {
            const text = el.textContent?.trim() || "";
            if (!/^\d+$/.test(text))
                continue;
            const style = getComputedStyle(el);
            if (style.backgroundColor === "rgb(255, 64, 0)" ||
                (style.color === "rgb(255, 255, 255)" && /255,\s*64,\s*0/.test(style.backgroundColor))) {
                return Number(text);
            }
        }
        return 1;
    }
    function get1688MtopClient() {
        const w = getUnsafeGlobal();
        const asMtopClient = (value) => {
            if (isObjectRecord(value) &&
                typeof value.request === "function") {
                return value;
            }
            return null;
        };
        const candidates = [
            w.lib?.mtop,
            w.mtop,
            w.Mtop,
            w.pageUtils?.Mtop,
        ];
        for (const candidate of candidates) {
            const mtop = asMtopClient(candidate);
            if (mtop)
                return mtop;
        }
        const seen = new WeakSet();
        const findMtopInValue = (value, depth = 0) => {
            if (!isObjectRecord(value) || depth > 6 || seen.has(value))
                return null;
            seen.add(value);
            const pageUtils = value.pageUtils;
            const fromPageUtils = isObjectRecord(pageUtils) ? asMtopClient(pageUtils.Mtop) : null;
            if (fromPageUtils)
                return fromPageUtils;
            const mtop = value.Mtop || value.mtop;
            const direct = asMtopClient(mtop);
            if (direct)
                return direct;
            for (const key of Object.keys(value)) {
                if (!/props|stateNode|memoized|return|child|sibling|pageUtils|Mtop|mtop/i.test(key) && depth > 1) {
                    continue;
                }
                const found = findMtopInValue(value[key], depth + 1);
                if (found)
                    return found;
            }
            return null;
        };
        for (const el of Array.from(document.querySelectorAll("*"))) {
            for (const value of getReactExpandoValues(el)) {
                const found = findMtopInValue(value);
                if (found)
                    return found;
            }
        }
        return null;
    }
    function normalizeMtopContent(res) {
        const root = isObjectRecord(res) && isObjectRecord(res.data) ? res.data : res;
        if (!isObjectRecord(root))
            return null;
        const content = root.content;
        if (typeof content === "string") {
            try {
                return JSON.parse(content);
            }
            catch {
                return null;
            }
        }
        return isObjectRecord(content) ? content : root;
    }
    function apply1688MtopOffers(res, pageNum, source) {
        const content = normalizeMtopContent(res);
        const offers = Array.isArray(content?.offerList)
            ? content.offerList.filter(isRaw1688Offer)
            : [];
        cachedMtopOffers = offers;
        cachedMtopPage = pageNum;
        console.log(`[CC] 1688 ${source} offerList page ${pageNum}: ${offers.length}`);
    }
    function parseJsonpResponse(text) {
        const trimmed = text.trim();
        const jsonText = trimmed.startsWith("{")
            ? trimmed
            : trimmed.replace(/^[^(]*\(/, "").replace(/\)\s*;?\s*$/, "");
        return JSON.parse(jsonText);
    }
    function request1688OfferListFromH5Api(memberId, pageNum) {
        const appKey = "12574478";
        const t = Date.now();
        const token = getCookieValue("_m_h5_tk").split("_")[0] || "";
        const appdata = {
            sortType: "wangpu_score",
            pageNum,
            count: 30,
        };
        const data = JSON.stringify({
            componentKey: "Wp_pc_common_offerlist",
            params: JSON.stringify({ memberId, appdata }),
        });
        const sign = md5(`${token}&${t}&${appKey}&${data}`);
        const callback = `mtopjsonp${Math.floor(Math.random() * 1000000)}`;
        const url = "https://h5api.m.1688.com/h5/mtop.alibaba.alisite.cbu.server.moduleasyncservice/1.0/?" +
            new URLSearchParams({
                jsv: "2.7.2",
                appKey,
                t: String(t),
                sign,
                api: "mtop.alibaba.alisite.cbu.server.ModuleAsyncService",
                v: "1.0",
                type: "jsonp",
                dataType: "jsonp",
                callback,
                data,
            }).toString();
        GM_xmlhttpRequest({
            method: "GET",
            url,
            headers: {
                Referer: location.href,
                Accept: "application/json, text/javascript, */*; q=0.01",
            },
            onload(response) {
                mtopOfferRequesting = false;
                try {
                    const body = parseJsonpResponse(response.responseText);
                    if (isObjectRecord(body) &&
                        Array.isArray(body.ret) &&
                        String(body.ret[0] || "").includes("TOKEN")) {
                        console.warn("[CC] 1688 H5 MTop token issue", body.ret);
                    }
                    apply1688MtopOffers(body, pageNum, "H5 MTop");
                }
                catch (err) {
                    console.warn("[CC] 1688 H5 MTop parse failed", err, response.responseText.slice(0, 200));
                }
            },
            onerror(err) {
                mtopOfferRequesting = false;
                console.warn("[CC] 1688 H5 MTop request failed", err);
            },
        });
    }
    function request1688OfferListFromMtop() {
        const pageNum = get1688CurrentListPage();
        if (mtopOfferRequesting)
            return;
        if (cachedMtopPage === pageNum && cachedMtopOffers.length > 0)
            return;
        if (Date.now() - lastMtopRequestAt < 1200)
            return;
        const memberId = get1688SellerMemberId();
        if (!memberId) {
            console.warn("[CC] 1688 MTop client/memberId not ready", {
                hasMtop: !!get1688MtopClient(),
                memberId,
            });
            return;
        }
        mtopOfferRequesting = true;
        lastMtopRequestAt = Date.now();
        const mtop = get1688MtopClient();
        if (!mtop) {
            console.warn("[CC] 1688 page MTop not found, fallback to signed H5 MTop", { memberId });
            request1688OfferListFromH5Api(memberId, pageNum);
            return;
        }
        mtop.request({
            api: "mtop.alibaba.alisite.cbu.server.ModuleAsyncService",
            data: {
                componentKey: "Wp_pc_common_offerlist",
                params: JSON.stringify({
                    memberId,
                    appdata: {
                        sortType: "wangpu_score",
                        pageNum,
                        count: 30,
                    },
                }),
            },
            v: "1.0",
            ecode: 0,
            type: "POST",
            valueType: "string",
            dataType: "jsonp",
            timeout: 10000,
        }, (res) => {
            mtopOfferRequesting = false;
            apply1688MtopOffers(res, pageNum, "page MTop");
        }, (err) => {
            mtopOfferRequesting = false;
            console.warn("[CC] 1688 MTop offerList failed", err);
        });
    }
    function requestText(url) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: "GET",
                url,
                headers: {
                    Referer: location.href,
                    Accept: "text/html,application/javascript,application/json,*/*",
                },
                onload(response) {
                    resolve(response.responseText || "");
                },
                onerror() {
                    resolve("");
                },
            });
        });
    }
    function decodeDescriptionText(text) {
        return text
            .replace(/\\\//g, "/")
            .replace(/\\u002F/gi, "/")
            .replace(/\\"/g, '"')
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, "&");
    }
    function extractDescriptionImages(text) {
        const decoded = decodeDescriptionText(text);
        const urls = [];
        const patterns = [
            /<img[^>]+(?:src|data-src|data-lazyload-src)=["']([^"']+)["']/gi,
            /(?:https?:)?\/\/[^"'<>\\\s]+?\.(?:jpg|jpeg|png|webp)(?:_[^"'<>\\\s]+)?(?:\?[^"'<>\\\s]*)?/gi,
        ];
        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(decoded))) {
                const raw = match[1] || match[0];
                if (!/alicdn\.com|1688\.com|taobaocdn\.com/i.test(raw))
                    continue;
                urls.push(raw);
                if (urls.length >= DETAIL_IMAGE_LIMIT * 3)
                    break;
            }
        }
        return uniqueUrls$1(urls).slice(0, DETAIL_IMAGE_LIMIT);
    }
    async function fetchLimitedDescriptionImages(descriptionUrl) {
        if (!descriptionUrl)
            return [];
        const url = absolutizeUrl$1(descriptionUrl);
        if (!url)
            return [];
        const text = await requestText(url);
        if (!text)
            return [];
        return extractDescriptionImages(text);
    }
    async function limit1688DetailImages(product) {
        const fromExisting = uniqueUrls$1(product.detailImages || []).slice(0, DETAIL_IMAGE_LIMIT);
        const fromDescription = fromExisting.length >= DETAIL_IMAGE_LIMIT
            ? []
            : await fetchLimitedDescriptionImages(product.descriptionUrl);
        const detailImages = uniqueUrls$1([...fromExisting, ...fromDescription]).slice(0, DETAIL_IMAGE_LIMIT);
        return {
            ...product,
            detailImages,
            descriptionUrl: detailImages.length > 0 ? undefined : product.descriptionUrl,
        };
    }
    function isDisabledPageControl(el) {
        const text = el.textContent?.trim() || "";
        const style = getComputedStyle(el);
        return (el.disabled ||
            el.getAttribute("aria-disabled") === "true" ||
            el.classList.contains("disabled") ||
            el.classList.contains("disable") ||
            (/\u4e0a\u4e00\u9875/.test(text) && style.color === "rgb(204, 204, 204)") ||
            style.cursor === "not-allowed");
    }
    function find1688NextPageControl() {
        const controls = Array.from(document.querySelectorAll("button, a, [role='button'], .pagination-item, .next"));
        return (controls.find((el) => {
            const text = el.textContent?.replace(/\s+/g, "") || "";
            return /\u4e0b\u4e00\u9875|\u4e0b\u9875|Next|>/.test(text) && !isDisabledPageControl(el);
        }) || null);
    }
    function asStringArray(val) {
        if (!Array.isArray(val))
            return [];
        return val.filter((x) => typeof x === "string" && x.length > 0);
    }
    function resolveGalleryFields(data) {
        const fields = getContextModuleFields(data, "gallery");
        return fields;
    }
    function resolveSkuModel(data) {
        const fromJson = getDataJson(data)?.skuModel;
        if (fromJson && typeof fromJson === "object")
            return fromJson;
        const found = findSkuModel(data);
        return found;
    }
    function extractMainImages$1(data) {
        const gallery = resolveGalleryFields(data);
        if (!gallery)
            return [];
        const fromOffer = asStringArray(gallery.offerImgList);
        if (fromOffer.length > 0)
            return uniqueUrls$1(fromOffer).slice(0, MAIN_IMAGE_LIMIT);
        const fromMain = asStringArray(gallery.mainImage);
        if (fromMain.length > 0)
            return uniqueUrls$1(fromMain).slice(0, MAIN_IMAGE_LIMIT);
        // 兜底：Root.dataJson.images[].fullPathImageURI
        const dataJson = getDataJson(data);
        const images = dataJson?.images;
        if (Array.isArray(images)) {
            const urls = images
                .map((img) => img?.fullPathImageURI)
                .filter((u) => !!u);
            if (urls.length > 0)
                return uniqueUrls$1(urls).slice(0, MAIN_IMAGE_LIMIT);
        }
        return [];
    }
    function extractVideoUrl$1(data) {
        const gallery = resolveGalleryFields(data);
        const video = gallery?.video;
        if (!video)
            return undefined;
        return video.videoUrl || video.url || undefined;
    }
    function extractDescriptionUrl(data) {
        const fields = getContextModuleFields(data, "description");
        const url = fields?.detailUrl;
        return typeof url === "string" && url ? url : undefined;
    }
    function buildSkuImageMap(skuModel) {
        const map = {};
        for (const prop of skuModel?.skuProps || []) {
            for (const v of prop.value || []) {
                if (v.name && v.imageUrl) {
                    map[v.name] = v.imageUrl;
                    map[decodeHtmlEntities(v.name)] = v.imageUrl;
                }
            }
        }
        return map;
    }
    function resolveSkuImage(specKey, specAttrs, imageMap) {
        const candidates = [
            specKey,
            specAttrs,
            decodeHtmlEntities(specKey),
            decodeHtmlEntities(specAttrs),
        ];
        for (const c of candidates) {
            if (c && imageMap[c])
                return imageMap[c];
        }
        // 多维规格 "颜色>规格" 取第一段匹配颜色图
        for (const c of candidates) {
            const first = c.split(/[>＞]/)[0]?.trim();
            if (first && imageMap[first])
                return imageMap[first];
        }
        return undefined;
    }
    function parseSkuProps(skuModel) {
        if (!skuModel?.skuProps)
            return [];
        return skuModel.skuProps
            .filter((p) => p.prop && p.value)
            .map((p) => ({
            name: p.prop,
            values: p.value
                .filter((v) => v.name)
                .map((v) => ({
                name: decodeHtmlEntities(v.name),
                image: v.imageUrl || undefined,
            })),
        }));
    }
    function normalizePriceValue(value) {
        if (value == null)
            return "";
        const text = String(value).trim();
        if (!text || text === "null" || text === "undefined")
            return "";
        const match = text.match(/[\d.]+/);
        return match ? match[0] : "";
    }
    function normalizePriceScaleDefault(value) {
        if (value == null)
            return "";
        const prices = String(value)
            .match(/\d+(?:\.\d+)?/g)
            ?.map((price) => Number(price))
            .filter((price) => Number.isFinite(price));
        if (!prices || prices.length === 0)
            return "";
        return String(Math.max(...prices));
    }
    function normalizePriceModelTiers(priceModel) {
        const tiers = (Array.isArray(priceModel?.currentPrices) && priceModel.currentPrices.length > 0
            ? priceModel.currentPrices
            : priceModel?.originalPrices) || [];
        const normalized = tiers
            .map((tier) => ({
            quantity: Number(tier.beginAmount ?? 0),
            price: Number(normalizePriceValue(tier.price)),
        }))
            .filter((tier) => tier.quantity > 0 && tier.price > 0)
            .sort((a, b) => a.quantity - b.quantity)
            .slice(0, 4);
        const quantities = new Set(normalized.map((tier) => tier.quantity));
        const isLadderPrice = priceModel?.priceDisplayType === "rangePrice" &&
            normalized.length >= 2 &&
            quantities.size >= 2;
        return isLadderPrice ? normalized : [];
    }
    function normalizePriceModelPrices(priceModel) {
        const tiers = (Array.isArray(priceModel?.currentPrices) && priceModel.currentPrices.length > 0
            ? priceModel.currentPrices
            : priceModel?.originalPrices) || [];
        return tiers
            .map((tier) => Number(normalizePriceValue(tier.price)))
            .filter((price) => price > 0);
    }
    function resolve1688PriceModel(data) {
        const fields = getContextModuleFields(data, "mainPrice");
        const priceModel = fields?.priceModel;
        return priceModel && typeof priceModel === "object" ? priceModel : undefined;
    }
    function format1688LadderPrice(tiers) {
        return tiers
            .map((tier) => `¥${tier.price.toFixed(2)} (${tier.quantity} pieces)`)
            .join(" / ");
    }
    function computePriceBoundsFromTiers(tiers) {
        const prices = tiers.map((tier) => tier.price).filter((price) => price > 0);
        if (prices.length === 0)
            return {};
        return { priceMin: Math.min(...prices), priceMax: Math.max(...prices) };
    }
    function extractRangeSkuDefaultPrice(dataJson, skuModel, priceModel) {
        const priceModelTiers = normalizePriceModelTiers(priceModel);
        if (priceModelTiers.length > 0) {
            return String(priceModelTiers[0].price);
        }
        const skuParam = dataJson?.orderParamModel
            ?.orderParam?.skuParam;
        const ranges = [
            skuParam?.skuRangePrices,
            skuParam?.skuPriceRange,
            skuParam?.priceRange,
        ].find((list) => Array.isArray(list) && list.length > 0);
        if (ranges) {
            const firstTier = [...ranges]
                .filter((tier) => normalizePriceValue(tier.price))
                .sort((a, b) => Number(a.beginAmount ?? 0) - Number(b.beginAmount ?? 0))[0];
            const price = normalizePriceValue(firstTier?.price);
            if (price)
                return price;
        }
        const priceScale = normalizePriceScaleDefault(skuModel?.skuPriceScale);
        if (priceScale)
            return priceScale;
        return "";
    }
    function parseSkus(skuModel, defaultPrice = "") {
        const map = skuModel?.skuInfoMap || skuModel?.skuInfoMapOriginal;
        if (!map || typeof map !== "object")
            return [];
        const imageMap = buildSkuImageMap(skuModel);
        return Object.entries(map)
            .filter(([, info]) => !!info)
            .map(([specKey, info]) => {
            const specAttrs = decodeHtmlEntities(info.specAttrs || specKey);
            const price = normalizePriceValue(info.discountPrice ?? info.price) || defaultPrice || "0";
            return {
                skuId: info.skuId != null ? String(info.skuId) : specKey,
                spec: specAttrs,
                price,
                stock: info.canBookCount ?? 0,
                image: resolveSkuImage(specKey, info.specAttrs || specKey, imageMap),
            };
        });
    }
    function extractAttributesFromContext(data) {
        const attrs = {};
        const fields = getContextModuleFields(data, "productAttributes");
        if (!fields)
            return attrs;
        for (const raw of [fields.attributes, fields.attrList, fields.props, fields.offerAttrs]) {
            if (Array.isArray(raw)) {
                for (const item of raw) {
                    if (!item || typeof item !== "object")
                        continue;
                    const rec = item;
                    const name = rec.name || rec.label || rec.propName || rec.key;
                    const value = rec.value ?? rec.text ?? rec.propValue;
                    if (name && value != null && value !== "") {
                        attrs[String(name).replace(/[：:]\s*$/, "").trim()] = String(value).trim();
                    }
                }
            }
        }
        return attrs;
    }
    function extractAttributesFromDom$1() {
        const attrs = {};
        document
            .querySelectorAll(".mod-detail-attr .attr-item, [class*='attr-item'], .detail-attributes tr, " +
            ".offer-attr-list .offer-attr-item, [class*='product-attributes'] tr, " +
            "[class*='Attribute'] dl")
            .forEach((el) => {
            const label = el.querySelector(".attr-label, [class*='label'], th, dt")?.textContent?.trim() || "";
            const value = el.querySelector(".attr-value, [class*='value'], td, dd")?.textContent?.trim() || "";
            if (label && value)
                attrs[label.replace(/[：:]/g, "").trim()] = value;
        });
        return attrs;
    }
    function extractTitle$1(data) {
        const titleFields = getContextModuleFields(data, "productTitle");
        const gallery = resolveGalleryFields(data);
        return ((typeof titleFields?.title === "string" && titleFields.title) ||
            (typeof gallery?.subject === "string" && gallery.subject) ||
            (typeof titleFields?.subTitle === "string" && titleFields.subTitle) ||
            document.title.replace(/-.*$/, "").trim() ||
            "");
    }
    function extractFromContext() {
        const data = get1688ContextData();
        if (!data)
            return null;
        const offerId = location.href.match(/offer\/(\d+)/)?.[1] || "";
        const dataJson = getDataJson(data);
        const priceModel = resolve1688PriceModel(data);
        const priceTiers = normalizePriceModelTiers(priceModel);
        const priceModelPrices = normalizePriceModelPrices(priceModel);
        const priceBounds = priceTiers.length > 0
            ? computePriceBoundsFromTiers(priceTiers)
            : priceModelPrices.length > 0
                ? { priceMin: Math.min(...priceModelPrices), priceMax: Math.max(...priceModelPrices) }
                : {};
        const skuModel = resolveSkuModel(data);
        const defaultSkuPrice = extractRangeSkuDefaultPrice(dataJson, skuModel, priceModel);
        const skus = parseSkus(skuModel, defaultSkuPrice);
        const mainImages = extractMainImages$1(data);
        const videoUrl = extractVideoUrl$1(data);
        const descriptionUrl = extractDescriptionUrl(data);
        const title = extractTitle$1(data);
        const titleFields = getContextModuleFields(data, "productTitle");
        const shopInfo = titleFields?.shopInfo;
        const shopFields = getContextModuleFields(data, "shopInfo");
        const companyFields = getContextModuleFields(data, "companyInfo");
        const categoryFields = getContextModuleFields(data, "categoryInfo");
        const sellerName = (typeof shopFields?.shopName === "string" && shopFields.shopName) ||
            (typeof companyFields?.companyName === "string" && companyFields.companyName) ||
            shopInfo?.shopName ||
            shopInfo?.companyName ||
            "";
        // context 存在但关键字段全空 → 视为未就绪，交给 DOM 兜底
        if (!title && mainImages.length === 0 && skus.length === 0 && !videoUrl) {
            console.warn("[CC] window.context 已读到但商品字段为空，可能尚未渲染完成");
            return null;
        }
        const saleNum = typeof titleFields?.saleNum === "string" ? titleFields.saleNum : undefined;
        const attributes = { ...extractAttributesFromDom$1(), ...extractAttributesFromContext(data) };
        if (priceTiers.length > 0) {
            attributes["阶梯价格"] = format1688LadderPrice(priceTiers);
            attributes["价格区间"] = `${priceBounds.priceMin} ~ ${priceBounds.priceMax}`;
        }
        else if (typeof priceModel?.originalPriceDisplay === "string" && priceModel.originalPriceDisplay) {
            attributes["价格区间"] = priceModel.originalPriceDisplay;
        }
        return {
            platform: "1688",
            platformId: offerId,
            title,
            mainImages,
            detailImages: [],
            descriptionUrl,
            videoUrl,
            attributes,
            skuProps: parseSkuProps(skuModel),
            skus,
            sellerName: sellerName || undefined,
            sellerId: typeof shopFields?.shopId === "string" ? shopFields.shopId : undefined,
            sourceUrl: location.href,
            categoryPath: typeof categoryFields?.categoryPath === "string" ? categoryFields.categoryPath : undefined,
            currency: "CNY",
            priceMin: priceBounds.priceMin,
            priceMax: priceBounds.priceMax,
            collectorNote: saleNum ? `月销 ${saleNum}` : undefined,
            collectedAt: new Date().toISOString(),
        };
    }
    function extractFromDom$2() {
        if (!/detail\.1688\.com\/offer\/\d+/.test(location.href))
            return null;
        const offerId = location.href.match(/offer\/(\d+)/)?.[1] || "";
        const title = document.querySelector(".d-title h1, .mod-detail-title .title, .detail-title, h1[data-title], [class*='title-text']")?.textContent?.trim() ||
            document.title.replace(/-.*$/, "").trim() ||
            "";
        const mainImages = [];
        const seen = new Set();
        const addImg = (raw) => {
            if (!raw)
                return;
            const url = raw.startsWith("http") ? raw : new URL(raw, location.origin).href;
            if (!seen.has(url)) {
                seen.add(url);
                mainImages.push(url);
            }
        };
        document
            .querySelectorAll("[class*='gallery'] img, [class*='Gallery'] img, .detail-gallery img, " +
            ".mod-detail-gallery img, [class*='offer-image'] img, [class*='main-image'] img")
            .forEach((el) => {
            addImg(el.getAttribute("src") || el.getAttribute("data-src") || el.getAttribute("data-lazy-src") || "");
        });
        const videoEl = document.querySelector("[class*='gallery'] video source, [class*='gallery'] video, video[src]");
        const videoUrl = videoEl?.getAttribute("src") ||
            videoEl?.querySelector("source")?.getAttribute("src") ||
            undefined;
        return {
            platform: "1688",
            platformId: offerId,
            title,
            mainImages: uniqueUrls$1(mainImages).slice(0, MAIN_IMAGE_LIMIT),
            detailImages: [],
            videoUrl: videoUrl?.startsWith("http") ? videoUrl : undefined,
            attributes: extractAttributesFromDom$1(),
            skuProps: [],
            skus: [],
            sourceUrl: location.href,
            currency: "CNY",
            collectedAt: new Date().toISOString(),
        };
    }
    function mergeProducts$2(ctx, dom) {
        if (!ctx && !dom)
            return null;
        if (!ctx)
            return dom;
        if (!dom)
            return ctx;
        return {
            ...ctx,
            title: ctx.title || dom.title,
            mainImages: (ctx.mainImages.length > 0 ? ctx.mainImages : dom.mainImages).slice(0, MAIN_IMAGE_LIMIT),
            videoUrl: ctx.videoUrl || dom.videoUrl,
            descriptionUrl: ctx.descriptionUrl,
            detailImages: ctx.detailImages.length > 0 ? ctx.detailImages : dom.detailImages,
            attributes: { ...dom.attributes, ...ctx.attributes },
            skuProps: ctx.skuProps.length > 0 ? ctx.skuProps : dom.skuProps,
            skus: ctx.skus.length > 0 ? ctx.skus : dom.skus,
            sellerName: ctx.sellerName || dom.sellerName,
        };
    }
    const platform1688 = {
        name: "1688",
        code: "1688",
        matchUrls: ["detail.1688.com", "www.1688.com"],
        isDetailPage() {
            if (location.hostname !== "detail.1688.com")
                return false;
            return (/\/offer\/\d+/.test(location.pathname) ||
                /^\d+$/.test(new URLSearchParams(location.search).get("offerId") || ""));
        },
        isListPage() {
            // 详情页底部也有相关商品卡片，不能据此把整个页面识别为列表页。
            if (location.hostname === "detail.1688.com")
                return false;
            return (/(www\.)?1688\.com\/(.*\/)?(search|offer|page)/.test(location.href) ||
                document.querySelectorAll(".offer-card, .sm-offer-card, .item-card, .feni-card").length > 3 ||
                document.querySelectorAll(".main-picture").length > 3 ||
                /\u4ef6\u76f8\u5173\u4ea7\u54c1|\u6240\u6709\u7c7b\u76ee/.test(document.body?.textContent || ""));
        },
        async extract() {
            const fromCtx = extractFromContext();
            const fromDom = extractFromDom$2();
            const product = mergeProducts$2(fromCtx, fromDom);
            if (product) {
                const limitedProduct = await limit1688DetailImages(product);
                console.log(`[CC] ✅ 1688 提取: ${limitedProduct.title}`);
                console.log(`[CC]    主图 ${limitedProduct.mainImages.length} | SKU ${limitedProduct.skus.length} | ` +
                    `视频 ${limitedProduct.videoUrl ? "✓" : "✗"} | 详情图 ${limitedProduct.detailImages.length} | ` +
                    `来源 ${fromCtx ? "context" : "DOM"}${fromCtx && fromDom ? "+DOM" : ""}`);
                if (limitedProduct.skus.length === 0) {
                    console.warn("[CC] ⚠️ 未读到 SKU 价格，请确认已用 unsafeWindow 访问 window.context");
                }
                return limitedProduct;
            }
            console.log("[CC] ❌ 提取失败");
            return null;
        },
        extractListItems() {
            const items = [];
            const seen = new Set();
            const cards = get1688ListCards();
            let runtimeOffers = extract1688OfferListFromReactState();
            if (runtimeOffers.length === 0) {
                runtimeOffers = cachedMtopOffers;
                request1688OfferListFromMtop();
            }
            cards.forEach((el, index) => {
                const href = get1688CardHref(el);
                const reactInfo = extractReactProductInfoFromCard(el);
                const runtimeOffer = runtimeOffers[index];
                const image = normalize1688ImageUrl(el.querySelector("img.main-picture")?.getAttribute("src") ||
                    el.querySelector("img.main-picture")?.getAttribute("data-src") ||
                    el.querySelector("img")?.getAttribute("src") ||
                    el.querySelector("img")?.getAttribute("data-src") ||
                    "");
                const id = extractOfferIdFromCard(el, href, reactInfo) ||
                    (runtimeOffer ? getRaw1688OfferId(runtimeOffer) : "");
                const url = href
                    ? absolutizeUrl$1(href)
                    : reactInfo?.detailUrl
                        ? absolutizeUrl$1(reactInfo.detailUrl)
                        : runtimeOffer
                            ? getRaw1688OfferUrl(runtimeOffer)
                            : id
                                ? build1688DetailUrl(id)
                                : "";
                if (!id || !url || seen.has(id))
                    return;
                seen.add(id);
                el.setAttribute("data-cc-list-card", "1688");
                items.push({
                    id,
                    title: extract1688CardTitle(el) || (runtimeOffer ? getRaw1688OfferTitle(runtimeOffer) : ""),
                    image: image || (runtimeOffer ? getRaw1688OfferImage(runtimeOffer) : ""),
                    price: extract1688CardPrice(el) || (runtimeOffer ? getRaw1688OfferPrice(runtimeOffer) : ""),
                    url,
                });
            });
            document
                .querySelectorAll("a[href*='detail.1688.com/offer/'], a[href*='/offer/'], a[href*='offerId=']")
                .forEach((link) => {
                const href = link.getAttribute("href") || "";
                const id = href.match(/offer\/(\d+)/)?.[1] || href.match(/[?&](?:offerId|offerid)=(\d+)/)?.[1] || "";
                const url = href ? absolutizeUrl$1(href) : id ? build1688DetailUrl(id) : "";
                if (!id || !url || seen.has(id))
                    return;
                const root = find1688CardRootFromLink(link);
                const image = normalize1688ImageUrl(root.querySelector("img.main-picture")?.getAttribute("src") ||
                    root.querySelector("img.main-picture")?.getAttribute("data-src") ||
                    root.querySelector("img")?.getAttribute("src") ||
                    root.querySelector("img")?.getAttribute("data-src") ||
                    "");
                seen.add(id);
                root.setAttribute("data-cc-list-card", "1688");
                items.push({
                    id,
                    title: link.getAttribute("title") ||
                        extract1688CardTitle(root) ||
                        link.textContent?.trim() ||
                        "",
                    image,
                    price: extract1688CardPrice(root),
                    url,
                });
            });
            if (items.length === 0 && runtimeOffers.length > 0) {
                runtimeOffers.forEach((offer) => {
                    const id = getRaw1688OfferId(offer);
                    const url = getRaw1688OfferUrl(offer);
                    if (!id || !url || seen.has(id))
                        return;
                    seen.add(id);
                    items.push({
                        id,
                        title: getRaw1688OfferTitle(offer),
                        image: getRaw1688OfferImage(offer),
                        price: getRaw1688OfferPrice(offer),
                        url,
                    });
                });
            }
            return items;
        },
        hasNextListPage() {
            return !!find1688NextPageControl();
        },
        goToNextListPage() {
            cachedMtopOffers = [];
            cachedMtopPage = 0;
            find1688NextPageControl()?.click();
        },
    };

    /** 国际站 PDP URL：/product-detail/...-{productId}.html */
    const DETAIL_URL_RE = /\/product-detail\/[^/]*-(\d+)\.html(?:\?|$)/i;
    function getAlibabaListCardCount() {
        return document.querySelectorAll(".module-product-list .icbu-product-card.product-item, " +
            ".component-product-list .icbu-product-card.product-item, " +
            ".search-card, .product-card, [class*='offer-card'], .organic-card, " +
            "[data-testid='product-card'], [data-testid*='search']").length;
    }
    function isAlibabaListLikePage(href = location.href) {
        if (/\/product-detail\//i.test(location.pathname))
            return false;
        if (/detail\.alibaba\.com/i.test(href))
            return false;
        if (/\/product\/\d+/i.test(location.pathname))
            return false;
        return (/alibaba\.com\/(.*\/)?(search|products|productlist|showroom|supplier|trade\/search)/i.test(href) ||
            !!document.querySelector(".module-product-list, .component-product-list") ||
            getAlibabaListCardCount() > 3);
    }
    function isAlibabaDetailUrl(href = location.href) {
        if (DETAIL_URL_RE.test(href))
            return true;
        if (/detail\.alibaba\.com/i.test(href))
            return true;
        if (/\/product\/\d+/i.test(location.pathname))
            return true;
        if (isAlibabaListLikePage(href))
            return false;
        if (document.body?.classList.contains("details-page"))
            return true;
        return document.querySelector('[data-module-name="module_title"] h1') != null;
    }
    function extractPlatformId(href = location.href) {
        const fromUrl = href.match(DETAIL_URL_RE)?.[1];
        if (fromUrl)
            return fromUrl;
        const legacy = href.match(/product\/(\d+)/i)?.[1] || href.match(/offer\/(\d+)/i)?.[1];
        if (legacy)
            return legacy;
        const dot = document.querySelector("[data-aplus-similar-dot]")?.getAttribute("data-aplus-similar-dot");
        const fromDot = dot?.match(/productId=(\d+)/)?.[1];
        if (fromDot)
            return fromDot;
        const og = document.querySelector('meta[property="og:url"]')?.getAttribute("content") || "";
        return og.match(DETAIL_URL_RE)?.[1] || "";
    }
    function absolutizeUrl(raw) {
        const trimmed = raw.trim();
        if (!trimmed)
            return "";
        if (trimmed.startsWith("http"))
            return trimmed;
        if (trimmed.startsWith("//"))
            return `https:${trimmed}`;
        return new URL(trimmed, location.origin).href;
    }
    /** 去掉 alicdn 尺寸后缀，尽量保留原图 */
    function normalizeAliImageUrl(url) {
        if (!url)
            return url;
        return url
            .replace(/\.(jpg|jpeg|png|webp)_[\d]+x[\d]+[^/]*\.(jpg|jpeg|png|webp)?/i, ".$1")
            .replace(/\.(jpg|jpeg|png|webp)_[\d]+x[\d]+q\d+\.(jpg|jpeg|png|webp)?/i, ".$1");
    }
    function parseBgImageUrl(style) {
        if (!style)
            return "";
        const m = style.match(/url\(["']?([^"')]+)["']?\)/);
        return m?.[1] ? absolutizeUrl(m[1]) : "";
    }
    function uniqueUrls(urls) {
        const seen = new Set();
        const out = [];
        for (const u of urls) {
            const n = normalizeAliImageUrl(u);
            if (n && !seen.has(n)) {
                seen.add(n);
                out.push(n);
            }
        }
        return out;
    }
    function sleep$1(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    function getTextIn(root, selector) {
        return root.querySelector(selector)?.textContent?.trim() || "";
    }
    function isSideRecommendCard(el) {
        return !!el.closest(".module-recommendProductTile, .product-recommond-small, .next-slick-vertical");
    }
    /** 提取可参与 parseFloat 的数字价格（如 US$0.58 → 0.58） */
    function parseNumericPrice(text) {
        if (!text)
            return "";
        const cleaned = text.replace(/[^0-9.,]/g, "").replace(/,/g, "");
        const num = parseFloat(cleaned);
        return Number.isNaN(num) ? "" : String(num);
    }
    function formatLadderSpecFromData(tier) {
        const min = tier.localMin ?? (tier.min != null ? String(tier.min) : "");
        const max = tier.localMax ?? (tier.max != null && tier.max > 0 ? String(tier.max) : "");
        if (min && max && max !== "-1")
            return `${min} - ${max} pieces`;
        if (min)
            return `≥ ${min} pieces`;
        return "批发";
    }
    const DEFAULT_STOCK = 99999;
    function isImageUrl(url) {
        return /^https?:\/\//i.test(url) && !/\.(mp4|m3u8|flv|webm)(\?|$)/i.test(url);
    }
    /** 从 mediaItems.videoUrl 对象或 product.video 解析最佳 MP4 地址 */
    function resolveProductVideoUrl(product) {
        const mediaItems = product.mediaItems;
        if (Array.isArray(mediaItems)) {
            for (const item of mediaItems) {
                const rec = item;
                if (rec.type !== "video")
                    continue;
                const fromVariants = pickVideoUrlFromVariants(rec.videoUrl);
                if (fromVariants)
                    return fromVariants;
            }
        }
        const video = product.video;
        if (video?.videoId && Array.isArray(mediaItems)) {
            for (const item of mediaItems) {
                const rec = item;
                if (rec.type === "video" && rec.videoId === video.videoId) {
                    const fromVariants = pickVideoUrlFromVariants(rec.videoUrl);
                    if (fromVariants)
                        return fromVariants;
                }
            }
        }
        return undefined;
    }
    function pickVideoUrlFromVariants(videoUrl) {
        if (typeof videoUrl === "string" && videoUrl) {
            return absolutizeUrl(videoUrl);
        }
        if (!videoUrl || typeof videoUrl !== "object")
            return undefined;
        const variants = videoUrl;
        const prefer = ["hd", "sd", "hd_265", "sd_265", "ld"];
        for (const key of prefer) {
            const url = variants[key]?.videoUrl;
            if (url)
                return absolutizeUrl(url);
        }
        for (const v of Object.values(variants)) {
            if (v?.videoUrl)
                return absolutizeUrl(v.videoUrl);
        }
        return undefined;
    }
    function extractMainImagesFromProduct(product) {
        const urls = [];
        const mediaItems = product.mediaItems;
        if (!Array.isArray(mediaItems))
            return urls;
        for (const item of mediaItems) {
            const rec = item;
            if (rec.type !== "image")
                continue;
            if (rec.group && rec.group !== "photos")
                continue;
            const big = rec.imageUrl?.big || rec.imageUrl?.normal;
            if (big)
                urls.push(absolutizeUrl(big));
        }
        return uniqueUrls(urls.filter(isImageUrl));
    }
    function extractAttributesFromProduct(product) {
        const attributes = {};
        const propLists = [
            product.productBasicProperties,
            product.productKeyIndustryProperties,
            product.productOtherProperties,
        ];
        for (const list of propLists) {
            if (!Array.isArray(list))
                continue;
            for (const row of list) {
                const r = row;
                if (r.attrName && r.attrValue && !attributes[r.attrName]) {
                    attributes[r.attrName] = r.attrValue;
                }
            }
        }
        const moq = product.moq;
        if (moq != null)
            attributes["MOQ"] = String(moq);
        const sampleInfo = product.sampleInfo;
        if (sampleInfo?.enable && sampleInfo.formatPrice) {
            attributes["样品价格"] = sampleInfo.formatPrice;
        }
        return attributes;
    }
    function normalizeIdList(value) {
        const values = Array.isArray(value) ? value : [value];
        const result = [];
        for (const item of values) {
            if (item == null)
                continue;
            for (const part of String(item).split(",")) {
                const id = part.trim();
                if (id && id !== "-1" && !result.includes(id))
                    result.push(id);
            }
        }
        return result;
    }
    function extractSourceCategoryAttributes(product) {
        const readRows = (value) => {
            if (!Array.isArray(value))
                return [];
            return value.flatMap((row) => {
                if (!row || typeof row !== "object" || Array.isArray(row))
                    return [];
                const item = row;
                const attrName = String(item.attrName ?? "").trim();
                const attrNameId = normalizeIdList(item.attrNameId)[0];
                const attrValue = String(item.attrValue ?? "").trim();
                if (!attrName || !attrValue)
                    return [];
                return [{
                        attrName,
                        attrNameId,
                        attrValue,
                        attrValueIds: normalizeIdList(item.attrValueIds ?? item.attrValueIdList ?? item.attrValueId),
                    }];
            });
        };
        const normalizeName = (value) => value.trim().toLocaleLowerCase().replace(/[\s/／_-]+/g, "");
        const keyIndustryRows = readRows(product.productKeyIndustryProperties);
        const keyIndustryByName = new Map(keyIndustryRows.map((item) => [normalizeName(item.attrName), item]));
        const otherRows = readRows(product.productOtherProperties);
        const merged = otherRows.map((item) => {
            const supplement = keyIndustryByName.get(normalizeName(item.attrName));
            return {
                ...item,
                attrNameId: item.attrNameId || supplement?.attrNameId,
                attrValueIds: item.attrValueIds?.length
                    ? item.attrValueIds
                    : supplement?.attrValueIds,
            };
        });
        const seenNames = new Set(merged.map((item) => normalizeName(item.attrName)));
        for (const item of keyIndustryRows) {
            if (!seenNames.has(normalizeName(item.attrName)))
                merged.push(item);
        }
        return merged;
    }
    function extractSourceCategoryId(product, global) {
        const productCategory = product.category;
        const globalCategory = global?.category;
        const candidates = [
            product.categoryId,
            product.catId,
            product.category_id,
            productCategory && typeof productCategory === "object"
                ? productCategory.id
                : undefined,
            global?.categoryId,
            global?.catId,
            globalCategory && typeof globalCategory === "object"
                ? (globalCategory.categoryId ??
                    globalCategory.id)
                : undefined,
        ];
        for (const candidate of candidates) {
            const id = normalizeIdList(candidate)[0];
            if (id)
                return id;
        }
        return undefined;
    }
    function extractSourceCategoryIdFromDom() {
        const links = Array.from(document.querySelectorAll(".module_breadcrumbNew nav ol a[href]")).reverse();
        for (const link of links) {
            const href = link.href;
            const candidates = [
                new URL(href, location.origin).searchParams.get("categoryId"),
                new URL(href, location.origin).searchParams.get("catId"),
                href.match(/\/category\/(\d+)/i)?.[1],
                href.match(/\/c\/(\d+)/i)?.[1],
            ];
            for (const candidate of candidates) {
                const id = normalizeIdList(candidate)[0];
                if (id)
                    return id;
            }
        }
        return undefined;
    }
    function resolvePriceBlock(product) {
        const price = product.price;
        const custom = product.customPrice;
        if (price?.productLadderPrices?.length)
            return price;
        if (custom?.productLadderPrices?.length)
            return custom;
        if (price?.productRangePrices)
            return price;
        if (custom?.productRangePrices)
            return custom;
        if (price?.formatLadderPrice)
            return price;
        if (custom?.formatLadderPrice)
            return custom;
        return price || custom;
    }
    function extractRangePrices(block) {
        const range = block?.productRangePrices;
        if (!range)
            return null;
        const low = range.priceRangeLow ?? range.dollarPriceRangeLow;
        const high = range.priceRangeHigh ?? range.dollarPriceRangeHigh;
        if (low == null && high == null)
            return null;
        const lowNum = low ?? high;
        const highNum = high ?? low;
        return {
            low: Math.min(lowNum, highNum),
            high: Math.max(lowNum, highNum),
            text: range.priceRangeText,
        };
    }
    function skuEntryPrice(entry, fallback) {
        if (!entry)
            return fallback;
        if (entry.formatPrice) {
            const n = parseNumericPrice(entry.formatPrice);
            if (n)
                return n;
        }
        if (entry.price != null && entry.price > 0)
            return String(entry.price);
        if (entry.dollarPrice != null && entry.dollarPrice > 0)
            return String(entry.dollarPrice);
        return fallback;
    }
    function computeProductPriceBounds(ladder, formatLadderPrice, range, skus) {
        if (ladder.length > 0) {
            const fromLadder = computeLadderPriceBounds(ladder, formatLadderPrice);
            if (fromLadder.priceMin != null)
                return fromLadder;
        }
        if (range) {
            return { priceMin: range.low, priceMax: range.high };
        }
        return computeSkuListPriceBounds(skus);
    }
    function buildSkuPropsFromAttrs(attrs) {
        return attrs
            .filter((a) => a.name && a.values?.length)
            .map((a) => ({
            name: a.name,
            values: a.values
                .filter((v) => v.usable !== false && v.name)
                .map((v) => ({
                name: v.name,
                image: v.originImage ? absolutizeUrl(v.originImage) : undefined,
            })),
        }));
    }
    /** 按 skuInfoMap 键规则生成多维 SKU 笛卡尔组合（优先使用 map 内各 SKU 独立价） */
    function buildSkusFromProductSku(skuRoot, platformId, defaultPriceNumeric, stockMap) {
        const attrs = skuRoot.skuAttrs || [];
        const filtered = attrs
            .filter((a) => a.id != null && a.name && a.values?.length)
            .map((a) => ({
            id: a.id,
            name: a.name,
            values: a.values.filter((v) => v.usable !== false && v.name && v.id != null),
        }))
            .filter((a) => a.values.length > 0);
        if (filtered.length === 0)
            return [];
        const skuInfoMap = skuRoot.skuInfoMap || {};
        const results = [];
        const walk = (index, picks) => {
            if (index >= filtered.length) {
                const mapKey = picks.map((p) => `${p.attrId}:${p.val.id};`).join("");
                const entry = skuInfoMap[mapKey];
                const skuId = entry?.id != null ? String(entry.id) : `${platformId}-${mapKey}`;
                const spec = picks.map((p) => p.val.name).join("-");
                const imagePick = picks.find((p) => p.val.originImage);
                results.push({
                    skuId,
                    spec,
                    price: skuEntryPrice(entry, defaultPriceNumeric),
                    stock: entry?.id != null ? stockMap[String(entry.id)] ?? DEFAULT_STOCK : DEFAULT_STOCK,
                    image: imagePick?.val.originImage
                        ? absolutizeUrl(imagePick.val.originImage)
                        : undefined,
                });
                return;
            }
            const attr = filtered[index];
            for (const val of attr.values) {
                walk(index + 1, [...picks, { attrId: attr.id, val }]);
            }
        };
        walk(0, []);
        return results;
    }
    const LADDER_SKU_ID_MARK = "-ladder-";
    function isLadderTierSku(sku) {
        return sku.skuId.includes(LADDER_SKU_ID_MARK);
    }
    /** 从阶梯价数组或 formatLadderPrice（如 US$2.50-4.45）计算价格区间 */
    function computeLadderPriceBounds(ladder, formatLadderPrice) {
        const nums = ladder
            .map((t) => parseNumericPrice(t.formatPrice || String(t.price ?? "")))
            .filter((n) => n !== "")
            .map(Number);
        if (nums.length === 0 && formatLadderPrice) {
            const parts = formatLadderPrice.match(/\d+(?:\.\d+)?/g);
            if (parts) {
                for (const p of parts)
                    nums.push(parseFloat(p));
            }
        }
        if (nums.length === 0)
            return {};
        return { priceMin: Math.min(...nums), priceMax: Math.max(...nums) };
    }
    /**
     * 仅在有 2 档及以上阶梯价时追加 [量档] SKU；区间价/单档价保留各规格 SKU 自身价格。
     */
    function applyLadderPricing(variantSkus, ladder, _platformId, moqTierPrice, _quantityLabels) {
        const tierPrice = ladder[0]
            ? parseNumericPrice(ladder[0].formatPrice || String(ladder[0].price ?? ""))
            : "";
        const fallbackPrice = moqTierPrice || tierPrice;
        return variantSkus
            .filter((s) => !isLadderTierSku(s))
            .map((s) => ({
            ...s,
            price: parseNumericPrice(s.price) || fallbackPrice || s.price,
            stock: s.stock >= 0 ? s.stock : DEFAULT_STOCK,
        }));
    }
    function ladderTiersToLadderPrice(tiers) {
        return tiers.map((t) => ({
            formatPrice: t.displayPrice,
            price: parseFloat(t.numericPrice) || undefined,
        }));
    }
    function buildInventoryStockMap(global) {
        const skuStockMap = {};
        const inventory = global?.inventory;
        const repo = inventory?.repoSkuInventory;
        if (!repo || typeof repo !== "object")
            return skuStockMap;
        for (const place of Object.values(repo)) {
            const map = place?.skuMap;
            if (!map)
                continue;
            for (const [skuId, info] of Object.entries(map)) {
                if (info?.inventoryCount != null) {
                    skuStockMap[skuId] = info.inventoryCount >= 0 ? info.inventoryCount : DEFAULT_STOCK;
                }
            }
        }
        return skuStockMap;
    }
    function extractFromDetailData() {
        const detail = getAlibabaDetailData();
        const global = detail?.globalData;
        const product = global?.product;
        if (!product)
            return null;
        const platformId = String(product.productId ?? extractPlatformId());
        const title = (typeof product.subject === "string" && product.subject) ||
            getTextIn(document, '[data-module-name="module_title"] h1') ||
            document.title.replace(/\s*[-–|].*$/, "").trim();
        const mainImages = extractMainImagesFromProduct(product);
        const videoUrl = resolveProductVideoUrl(product);
        const attributes = extractAttributesFromProduct(product);
        const sourceCategoryId = extractSourceCategoryId(product, global);
        const sourceCategoryAttributes = extractSourceCategoryAttributes(product);
        const priceBlock = resolvePriceBlock(product);
        const ladder = priceBlock?.productLadderPrices || [];
        const range = extractRangePrices(priceBlock);
        const defaultPriceNumeric = parseNumericPrice(ladder[0]?.formatPrice ||
            range?.text ||
            (range ? String(range.low) : "") ||
            priceBlock?.formatLadderPrice ||
            "");
        if (ladder.length > 0) {
            attributes["阶梯价格"] = ladder
                .map((t) => `${t.formatPrice || t.price} (${formatLadderSpecFromData(t)})`)
                .join(" / ");
        }
        else if (range) {
            attributes["价格区间"] = range.text || `US$${range.low}-${range.high}`;
        }
        const skuRoot = product.sku;
        const skuProps = skuRoot?.skuAttrs ? buildSkuPropsFromAttrs(skuRoot.skuAttrs) : [];
        const skuStockMap = buildInventoryStockMap(global);
        let skus = skuRoot ? buildSkusFromProductSku(skuRoot, platformId, defaultPriceNumeric, skuStockMap) : [];
        if (skus.length === 0 && defaultPriceNumeric) {
            skus.push({
                skuId: platformId,
                spec: "默认",
                price: defaultPriceNumeric,
                stock: DEFAULT_STOCK,
            });
        }
        skus = applyLadderPricing(skus, ladder, platformId, defaultPriceNumeric);
        const priceBounds = computeProductPriceBounds(ladder, priceBlock?.formatLadderPrice, range, skus);
        if (ladder.length > 0 && priceBounds.priceMin != null && !attributes["价格区间"]) {
            attributes["价格区间"] = `${priceBounds.priceMin} ~ ${priceBounds.priceMax ?? priceBounds.priceMin}`;
        }
        const seller = global?.seller;
        const trade = global?.trade;
        return {
            platform: "alibaba",
            platformId,
            title: title || "Unknown Product",
            mainImages: uniqueUrls(mainImages),
            detailImages: extractDetailImagesFromDom(),
            videoUrl,
            attributes,
            skuProps,
            skus,
            sellerName: seller?.companyName,
            sellerId: seller?.companyId != null ? String(seller.companyId) : seller?.aliId != null ? String(seller.aliId) : undefined,
            sourceUrl: location.href,
            sourceCategoryId,
            sourceCategoryAttributes,
            currency: "USD",
            priceMin: priceBounds.priceMin,
            priceMax: priceBounds.priceMax,
            collectorNote: trade?.salesVolume ? String(trade.salesVolume) : undefined,
            collectedAt: new Date().toISOString(),
        };
    }
    // ─── DOM（data-testid，兜底）────────────────────────────
    function extractMainImagesFromDom() {
        const urls = [];
        document
            .querySelectorAll('[data-testid="product-image-view"] [data-testid="media-image"] img[src]')
            .forEach((img) => {
            const src = img.getAttribute("src");
            if (src)
                urls.push(absolutizeUrl(src));
        });
        if (urls.length === 0) {
            document.querySelectorAll('[data-testid="product-image-view"] img[src]').forEach((img) => {
                if (img.closest('[data-testid="media-video"], video'))
                    return;
                const src = img.getAttribute("src");
                if (src)
                    urls.push(absolutizeUrl(src));
            });
        }
        document
            .querySelectorAll('[data-testid="product-image-list"] [style*="background-image"]')
            .forEach((el) => {
            const u = parseBgImageUrl(el.getAttribute("style"));
            if (u)
                urls.push(u);
        });
        const og = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
        if (og)
            urls.push(absolutizeUrl(og));
        return uniqueUrls(urls.filter(isImageUrl));
    }
    function extractAttributesFromDom() {
        const attributes = {};
        document.querySelectorAll('[data-testid="module-attribute-row"]').forEach((row) => {
            const name = getTextIn(row, '[data-testid="module-attribute-name-text"]') ||
                row.querySelector('[data-testid="module-attribute-name"]')?.getAttribute("title") ||
                "";
            const value = getTextIn(row, '[data-testid="module-attribute-value-text"]') ||
                row.querySelector('[data-testid="module-attribute-value"]')?.getAttribute("title") ||
                "";
            if (name && value)
                attributes[name] = value;
        });
        document.querySelectorAll('[data-testid="three-column-key-attributes-row"]').forEach((row) => {
            row.querySelectorAll(":scope > div.id-min-w-0").forEach((col) => {
                const ps = col.querySelectorAll("p");
                const label = ps[0]?.getAttribute("title") || ps[0]?.textContent?.trim();
                const val = ps[1]?.getAttribute("title") || ps[1]?.textContent?.trim();
                if (label && val)
                    attributes[label] = val;
            });
        });
        return attributes;
    }
    function extractSkuFromDom(defaultPriceNumeric, ladderTiers) {
        const skuProps = [];
        const skus = [];
        const platformId = extractPlatformId();
        document.querySelectorAll('[data-testid="sku-list"]').forEach((listEl) => {
            const propName = getTextIn(listEl, '[data-testid="sku-list-title"] span') || "规格";
            const values = [];
            listEl.querySelectorAll('[data-testid="sku-list-item"] img[alt]').forEach((img) => {
                const name = img.getAttribute("alt")?.trim();
                const src = img.getAttribute("src");
                if (!name)
                    return;
                values.push({
                    name,
                    image: src ? absolutizeUrl(src) : undefined,
                });
                skus.push({
                    skuId: `${platformId}-${name}`,
                    spec: name,
                    price: defaultPriceNumeric,
                    stock: DEFAULT_STOCK,
                    image: src ? absolutizeUrl(src) : undefined,
                });
            });
            if (values.length)
                skuProps.push({ name: propName, values });
        });
        if (skus.length === 0 && defaultPriceNumeric) {
            skus.push({
                skuId: platformId,
                spec: "默认",
                price: defaultPriceNumeric,
                stock: DEFAULT_STOCK,
            });
        }
        return { skuProps, skus };
    }
    function extractLadderPricesFromDom() {
        const tiers = [];
        const seen = new Set();
        document.querySelectorAll('[data-testid="ladder-price"] .price-item').forEach((item) => {
            const priceEl = item.querySelector(":scope > div:first-child span") ||
                item.querySelector("span");
            const displayPrice = priceEl?.textContent?.trim() || "";
            const numericPrice = parseNumericPrice(displayPrice);
            if (!numericPrice)
                return;
            const rangeEl = item.querySelector(".id-text-sm, [class*='text-sm'], [class*='whitespace-nowrap']");
            const spec = rangeEl?.textContent?.trim() || "批发";
            const key = `${numericPrice}|${spec}`;
            if (seen.has(key))
                return;
            seen.add(key);
            tiers.push({ displayPrice, numericPrice, spec });
        });
        return tiers;
    }
    /** 页面区间价展示（如 US$0.68-1.05），非阶梯多档 */
    function extractRangePriceFromDom() {
        const roots = document.querySelectorAll('[data-testid="product-price"], [data-testid="module-price"]');
        for (const root of roots) {
            if (root.querySelector('[data-testid="ladder-price"]'))
                continue;
            const text = root.querySelector(".price-item span")?.textContent?.trim() ||
                root.querySelector('[class*="text-[26px]"] span')?.textContent?.trim() ||
                root.textContent?.trim() ||
                "";
            const rangeMatch = text.match(/US?\$?\s*([\d,.]+)\s*[-–~]\s*([\d,.]+)/i);
            if (!rangeMatch)
                continue;
            const low = parseFloat(rangeMatch[1].replace(/,/g, ""));
            const high = parseFloat(rangeMatch[2].replace(/,/g, ""));
            if (Number.isNaN(low) || Number.isNaN(high))
                continue;
            return {
                low: Math.min(low, high),
                high: Math.max(low, high),
                text: rangeMatch[0].replace(/\s+/g, ""),
            };
        }
        return null;
    }
    /** 供应商产品说明区详情图（排除公司介绍等其它 structure 块） */
    function extractDetailImagesFromRoot(root, baseUrl = location.href) {
        const urls = [];
        const addImg = (img) => {
            const candidates = [
                img.getAttribute("data-src"),
                img.getAttribute("data-lazy-src"),
                img.getAttribute("data-original"),
                img.getAttribute("data-image"),
                img.currentSrc,
                img.getAttribute("src"),
            ];
            const srcset = img.getAttribute("data-srcset") || img.getAttribute("srcset");
            if (srcset) {
                candidates.push(...srcset.split(",").map((part) => part.trim().split(/\s+/)[0]));
            }
            for (const src of candidates) {
                if (!src || src.startsWith("data:"))
                    continue;
                let absolute = "";
                try {
                    absolute = new URL(src, baseUrl).href;
                }
                catch {
                    continue;
                }
                if (/alicdn\.com\//i.test(absolute) && !/\.(?:gif|svg)(?:\?|$)/i.test(absolute)) {
                    urls.push(absolute);
                    break;
                }
            }
        };
        root.querySelectorAll("img").forEach(addImg);
        return uniqueUrls(urls);
    }
    function extractDetailImagesFromDom() {
        const urls = [];
        const productDescRoot = document.querySelector('[data-module-name="module_structure_descption_productDescription"]') ||
            document.querySelector('[data-module-name="module_structure_description"] [data-module-name="module_structure_descption_productDescription"]');
        const scope = productDescRoot || document.querySelector('[data-module-name="module_structure_description"]');
        if (scope) {
            urls.push(...extractDetailImagesFromRoot(scope));
        }
        if (urls.length === 0) {
            const legacyScope = document.querySelector('[data-testid="product-detail-image-simple"]') ||
                document.querySelector('[data-module-name="module_description"]') ||
                document.querySelector("#description-layout");
            if (legacyScope)
                urls.push(...extractDetailImagesFromRoot(legacyScope));
        }
        return uniqueUrls(urls);
    }
    function findDescriptionIframe() {
        return document.querySelector('[data-module-name="module_product_specification"] iframe[src*="/product-detail/description/descIframe.html"], ' +
            'iframe[src*="/product-detail/description/descIframe.html"]');
    }
    /**
     * New Alibaba PDPs render the product description in a same-origin iframe.
     * Wait for that second document to render, then read both normal and lazy image attributes.
     */
    async function extractDetailImagesFromIframe(timeout = 12000) {
        const moduleRoot = document.querySelector('[data-module-name="module_product_specification"]');
        let iframe = findDescriptionIframe();
        if (!moduleRoot && !iframe)
            return [];
        moduleRoot?.scrollIntoView({ behavior: "auto", block: "start" });
        const startedAt = Date.now();
        let lastUrls = [];
        let lastSignature = "";
        let stableTicks = 0;
        while (Date.now() - startedAt < timeout) {
            iframe ||= findDescriptionIframe();
            if (!iframe && Date.now() - startedAt >= 3000)
                return [];
            if (iframe) {
                iframe.loading = "eager";
                try {
                    const frameDocument = iframe.contentDocument;
                    if (frameDocument?.documentElement) {
                        const frameBaseUrl = iframe.src || new URL(iframe.getAttribute("src") || "", location.href).href;
                        const urls = extractDetailImagesFromRoot(frameDocument, frameBaseUrl);
                        const signature = urls.join("\n");
                        if (urls.length > 0 && signature === lastSignature) {
                            stableTicks += 1;
                            if (stableTicks >= 3)
                                return urls;
                        }
                        else {
                            stableTicks = 0;
                            lastUrls = urls;
                            lastSignature = signature;
                        }
                    }
                }
                catch {
                    // Regional redirects can make the frame cross-origin; use the fetch fallback below.
                }
            }
            await sleep$1(350);
        }
        if (lastUrls.length > 0)
            return lastUrls;
        const iframeUrl = iframe?.getAttribute("src");
        if (!iframeUrl)
            return [];
        try {
            const absoluteUrl = new URL(iframeUrl, location.href).href;
            const response = await fetch(absoluteUrl, { credentials: "include" });
            if (!response.ok)
                return [];
            const frameDocument = new DOMParser().parseFromString(await response.text(), "text/html");
            return extractDetailImagesFromRoot(frameDocument, absoluteUrl);
        }
        catch {
            return [];
        }
    }
    function extractFromDom$1() {
        if (!isAlibabaDetailUrl())
            return null;
        const platformId = extractPlatformId();
        const title = document.querySelector('[data-module-name="module_title"] h1')?.getAttribute("title") ||
            getTextIn(document, '[data-module-name="module_title"] h1') ||
            document.title.replace(/\s*[-–|].*$/, "").trim();
        const ladderTiers = extractLadderPricesFromDom();
        const rangeFromDom = ladderTiers.length === 0 ? extractRangePriceFromDom() : null;
        const defaultPriceNumeric = ladderTiers[0]?.numericPrice ||
            (rangeFromDom ? String(rangeFromDom.low) : "") ||
            parseNumericPrice(document.querySelector('[data-testid="product-price"] span')?.textContent?.trim() || "");
        const attributes = extractAttributesFromDom();
        if (ladderTiers.length > 0) {
            attributes["阶梯价格"] = ladderTiers
                .map((t) => `${t.displayPrice} (${t.spec})`)
                .join(" / ");
        }
        else if (rangeFromDom) {
            attributes["价格区间"] = rangeFromDom.text || `US$${rangeFromDom.low}-${rangeFromDom.high}`;
        }
        let { skuProps, skus } = extractSkuFromDom(defaultPriceNumeric);
        const ladderFromDom = ladderTiersToLadderPrice(ladderTiers);
        skus = applyLadderPricing(skus, ladderFromDom, platformId, defaultPriceNumeric, ladderTiers.map((t) => t.spec));
        const priceBounds = computeProductPriceBounds(ladderFromDom, ladderTiers.length > 0
            ? `${ladderTiers[0].displayPrice}-${ladderTiers[ladderTiers.length - 1].displayPrice}`
            : undefined, rangeFromDom, skus);
        const sellerName = document.querySelector('[data-testid="three-column-mini-company-card"] a[title]')?.getAttribute("title") ||
            getTextIn(document, '[data-testid="three-column-mini-company-card"] a');
        const breadcrumb = [];
        document.querySelectorAll(".module_breadcrumbNew nav ol a").forEach((a) => {
            const t = a.textContent?.trim();
            if (t)
                breadcrumb.push(t);
        });
        const sold = document.querySelector(".detail-review-item.detail-separator")?.textContent?.trim();
        return {
            platform: "alibaba",
            platformId,
            title: title || "Unknown Product",
            mainImages: extractMainImagesFromDom(),
            detailImages: extractDetailImagesFromDom(),
            attributes,
            skuProps,
            skus,
            sellerName: sellerName || undefined,
            sourceUrl: location.href,
            categoryPath: breadcrumb.length ? breadcrumb.join(" > ") : undefined,
            sourceCategoryId: extractSourceCategoryIdFromDom(),
            currency: "USD",
            priceMin: priceBounds.priceMin,
            priceMax: priceBounds.priceMax,
            collectorNote: sold || undefined,
            collectedAt: new Date().toISOString(),
        };
    }
    function skusHaveValidPrice(skus) {
        return skus.some((s) => {
            const n = parseNumericPrice(s.price);
            return n !== "" && parseFloat(n) > 0;
        });
    }
    function computeSkuListPriceBounds(skus) {
        const nums = skus
            .map((s) => parseFloat(parseNumericPrice(s.price)))
            .filter((p) => !Number.isNaN(p) && p > 0);
        if (nums.length === 0)
            return {};
        return { priceMin: Math.min(...nums), priceMax: Math.max(...nums) };
    }
    function mergeVariantSkus(primary, fallback) {
        const variantPrimary = primary.filter((s) => !isLadderTierSku(s));
        const variantFallback = fallback.filter((s) => !isLadderTierSku(s));
        if (variantPrimary.length === 0)
            return variantFallback;
        if (variantFallback.length === 0)
            return variantPrimary;
        const primaryFromData = variantPrimary.some((s) => /^\d{8,}$/.test(s.skuId));
        const pick = skusHaveValidPrice(variantPrimary) && (primaryFromData || variantPrimary.length <= variantFallback.length)
            ? variantPrimary
            : skusHaveValidPrice(variantFallback)
                ? variantFallback
                : variantPrimary;
        const priceById = new Map(variantFallback.map((s) => [s.skuId, s.price]));
        const priceBySpec = new Map(variantFallback.map((s) => [s.spec, s.price]));
        return pick.map((s) => {
            const numeric = parseNumericPrice(s.price);
            if (numeric)
                return { ...s, price: numeric };
            const fromFallback = priceById.get(s.skuId) || priceBySpec.get(s.spec);
            return {
                ...s,
                price: fromFallback ? parseNumericPrice(fromFallback) || fromFallback : s.price,
            };
        });
    }
    function mergeSkus(primary, fallback) {
        if (primary.length === 0)
            return fallback;
        if (fallback.length === 0)
            return primary;
        const variants = mergeVariantSkus(primary, fallback);
        const tierById = new Map();
        for (const s of [...primary, ...fallback]) {
            if (isLadderTierSku(s))
                tierById.set(s.skuId, s);
        }
        return [...variants, ...tierById.values()];
    }
    function mergeProducts$1(primary, fallback) {
        if (!primary && !fallback)
            return null;
        if (!primary)
            return fallback;
        if (!fallback)
            return primary;
        const mergedSkus = mergeSkus(primary.skus, fallback.skus);
        const skuBounds = computeSkuListPriceBounds(mergedSkus);
        const mins = [primary.priceMin, fallback.priceMin, skuBounds.priceMin].filter((n) => n != null && n > 0);
        const maxs = [primary.priceMax, fallback.priceMax, skuBounds.priceMax].filter((n) => n != null && n > 0);
        return {
            ...primary,
            title: primary.title || fallback.title,
            platformId: primary.platformId || fallback.platformId,
            mainImages: primary.mainImages.length > 0 ? primary.mainImages : fallback.mainImages,
            detailImages: uniqueUrls([...primary.detailImages, ...fallback.detailImages]),
            videoUrl: primary.videoUrl || fallback.videoUrl,
            attributes: { ...fallback.attributes, ...primary.attributes },
            skuProps: primary.skuProps.length > 0 ? primary.skuProps : fallback.skuProps,
            skus: mergedSkus,
            priceMin: mins.length ? Math.min(...mins) : undefined,
            priceMax: maxs.length ? Math.max(...maxs) : undefined,
            sellerName: primary.sellerName || fallback.sellerName,
            sellerId: primary.sellerId || fallback.sellerId,
            categoryPath: primary.categoryPath || fallback.categoryPath,
            sourceCategoryId: primary.sourceCategoryId || fallback.sourceCategoryId,
            sourceCategoryAttributes: primary.sourceCategoryAttributes?.length
                ? primary.sourceCategoryAttributes
                : fallback.sourceCategoryAttributes,
            collectorNote: primary.collectorNote || fallback.collectorNote,
        };
    }
    /**
     * Alibaba.com (International) — SSR detailData + DOM data-testid
     */
    const platformAlibaba = {
        name: "Alibaba",
        code: "alibaba",
        matchUrls: ["alibaba.com"],
        isDetailPage() {
            return isAlibabaDetailUrl();
        },
        isListPage() {
            return isAlibabaListLikePage();
        },
        async extract() {
            if (!this.isDetailPage())
                return null;
            const iframeDetailImages = await extractDetailImagesFromIframe();
            const product = mergeProducts$1(extractFromDetailData(), extractFromDom$1());
            if (product && iframeDetailImages.length > 0) {
                product.detailImages = uniqueUrls([...product.detailImages, ...iframeDetailImages]);
            }
            return product;
        },
        extractListItems() {
            const items = [];
            const seen = new Set();
            document
                .querySelectorAll(".search-card, .product-card, [class*='offer-card'], .organic-card, " +
                ".module-product-list .icbu-product-card.product-item, .icbu-product-card.product-item, " +
                "[data-testid='product-card']")
                .forEach((el) => {
                if (isSideRecommendCard(el))
                    return;
                const link = el.querySelector("a.product-image[href*='product-detail'], a.title-link[href*='product-detail'], " +
                    "a[href*='product-detail'], a[href*='product/'], a[href*='offer/']");
                const href = link?.getAttribute("href") || "";
                const url = href.startsWith("http")
                    ? href
                    : href.startsWith("//")
                        ? `${location.protocol}${href}`
                        : href
                            ? new URL(href, location.origin).href
                            : "";
                const id = el.getAttribute("data-id") ||
                    href.match(DETAIL_URL_RE)?.[1] ||
                    href.match(/_(\d+)\.html/i)?.[1] ||
                    href.match(/product\/(\d+)/i)?.[1] ||
                    href.match(/offer\/(\d+)/i)?.[1] ||
                    "";
                if (!id || !url || seen.has(id))
                    return;
                seen.add(id);
                items.push({
                    id,
                    title: el.querySelector("a.title-link")?.getAttribute("title") ||
                        el.querySelector(".title-con, [class*='title'], h2, h3")?.textContent?.trim() ||
                        "",
                    image: absolutizeUrl(el.querySelector(".product-image img")?.getAttribute("src") ||
                        el.querySelector(".product-image img")?.getAttribute("data-src") ||
                        el.querySelector("img")?.getAttribute("src") ||
                        el.querySelector("img")?.getAttribute("data-src") ||
                        ""),
                    price: el.querySelector(".price")?.getAttribute("title") ||
                        el.querySelector(".price .num, [class*='price']")?.textContent?.trim() ||
                        "",
                    url,
                });
            });
            return items;
        },
        hasNextListPage() {
            const nextBtn = document.querySelector(".next-pagination .next-pagination-item.next");
            if (!nextBtn)
                return false;
            return !nextBtn.disabled && !nextBtn.classList.contains("disabled");
        },
        goToNextListPage() {
            const nextBtn = document.querySelector(".next-pagination .next-pagination-item.next");
            nextBtn?.click();
        },
    };
    /** 供 main.ts 等待 PDP 数据就绪 */
    function isAlibabaPageReady() {
        if (getAlibabaDetailData()?.globalData?.product)
            return true;
        const h1 = document.querySelector('[data-module-name="module_title"] h1');
        return !!h1?.textContent?.trim();
    }

    // ─── Helper functions ────────────────────────────────
    function getWindowDC() {
        try {
            const w = unsafeWindow;
            const dc = w._d_c_;
            if (dc && typeof dc === "object")
                return dc;
            return null;
        }
        catch {
            return null;
        }
    }
    function getLifecycleData(dc) {
        const event = dc.lifeCycleEventList?.find((e) => e.type === "RENDER");
        return event?.data || {};
    }
    function extractProductId() {
        // From URL: /item/1005012064303546.html
        const urlMatch = location.href.match(/\/item\/(\d+)/);
        if (urlMatch)
            return urlMatch[1];
        // From _d_c_ data
        const dc = getWindowDC();
        const lifecycle = dc ? getLifecycleData(dc) : {};
        const shipping = lifecycle.SHIPPING;
        const itemId = shipping?.deliveryLayoutInfo?.[0]?.bizData?.itemId;
        if (itemId)
            return String(itemId);
        return "";
    }
    function extractTitle(dc) {
        const lifecycle = getLifecycleData(dc);
        const titleData = lifecycle.PRODUCT_TITLE;
        return titleData?.title || titleData?.subject || document.title.replace(/-\s*AliExpress.*$/i, "").trim() || "";
    }
    function extractMainImages(dc) {
        const lifecycle = getLifecycleData(dc);
        const headerImage = lifecycle.HEADER_IMAGE_PC;
        // Prefer imgList (960x960 resolution)
        if (headerImage?.imgList && headerImage.imgList.length > 0) {
            return headerImage.imgList;
        }
        // Fallback to imagePathList from DCData
        if (dc.DCData?.imagePathList && dc.DCData.imagePathList.length > 0) {
            return dc.DCData.imagePathList;
        }
        // Fallback to imagePathList from lifecycle
        if (headerImage?.imagePathList && headerImage.imagePathList.length > 0) {
            return headerImage.imagePathList;
        }
        return [];
    }
    function extractVideoUrl(dc) {
        const lifecycle = getLifecycleData(dc);
        const videoData = lifecycle.VIDEO_PLAYER;
        if (videoData?.videoUrl)
            return videoData.videoUrl;
        if (videoData?.video?.url)
            return videoData.video.url;
        // Try DOM fallback
        const videoEl = document.querySelector("video[src]");
        if (videoEl?.src)
            return videoEl.src;
        return undefined;
    }
    function extractPrice(dc) {
        const lifecycle = getLifecycleData(dc);
        const priceBlock = lifecycle.PRICE_BLOCK;
        // Try to parse from formatted price
        const parsePriceStr = (s) => {
            if (!s)
                return 0;
            const cleaned = s.replace(/[^0-9.,]/g, "").replace(/,/g, "");
            const num = parseFloat(cleaned);
            return isNaN(num) ? 0 : num;
        };
        const activityPrice = parsePriceStr(priceBlock?.formattedActivityPrice);
        const salePrice = parsePriceStr(priceBlock?.formattedPrice || priceBlock?.salePrice);
        const originalPrice = parsePriceStr(priceBlock?.originalPrice);
        // Use affData if available
        const affData = dc.affData;
        if (affData?.minPrice && affData?.maxPrice) {
            return { priceMin: affData.minPrice, priceMax: affData.maxPrice, currency: "USD" };
        }
        if (activityPrice > 0) {
            return { priceMin: activityPrice, priceMax: activityPrice, currency: "USD" };
        }
        if (salePrice > 0) {
            return { priceMin: salePrice, priceMax: originalPrice > salePrice ? originalPrice : salePrice, currency: "USD" };
        }
        // Parse from shipping data as fallback
        const shipping = lifecycle.SHIPPING;
        if (shipping?.deliveryExt) {
            try {
                const ext = JSON.parse(shipping.deliveryExt);
                if (Array.isArray(ext) && ext.length > 0) {
                    const price = parseFloat(ext[0].p1);
                    if (!isNaN(price)) {
                        return { priceMin: price, priceMax: price, currency: ext[0].d1 || "CNY" };
                    }
                }
            }
            catch { /* ignore */ }
        }
        return { priceMin: 0, priceMax: 0, currency: "USD" };
    }
    function extractSkuProps(dc) {
        const lifecycle = getLifecycleData(dc);
        const skuData = lifecycle.SKU;
        if (!skuData?.skuProperties)
            return [];
        return skuData.skuProperties
            .filter((p) => p.skuPropertyName && p.skuPropertyValues)
            .map((p) => ({
            name: p.skuPropertyName,
            values: (p.skuPropertyValues || [])
                .filter((v) => v.propertyValueDisplayName || v.propertyValueName)
                .map((v) => ({
                name: v.propertyValueDisplayName || v.propertyValueName || "",
                image: v.skuPropertyImagePath || undefined,
            })),
        }));
    }
    function extractSkus(dc) {
        const lifecycle = getLifecycleData(dc);
        const skuData = lifecycle.SKU;
        if (!skuData?.skuPaths)
            return [];
        lifecycle.SHIPPING;
        return skuData.skuPaths.map((path) => {
            const spec = path.skuAttr || "";
            const skuId = path.skuIdStr || String(path.skuId || "");
            const stock = path.skuStock || 0;
            // Try to extract price from SKU attributes
            let price = "0";
            const priceMatch = spec.match(/(?:US?\s*\$?|CN?\s*￥?\s*)([\d.]+)/i);
            if (priceMatch) {
                price = priceMatch[1];
            }
            // Build spec string from skuAttr format "14:200006151#1PC"
            const specParts = spec.split("#");
            const specDisplay = specParts.length > 1 ? specParts.slice(1).join("#") : spec;
            return {
                skuId,
                spec: specDisplay,
                price,
                stock,
                image: undefined,
            };
        });
    }
    function extractAttributes(dc) {
        const attrs = {};
        const lifecycle = getLifecycleData(dc);
        // Extract from PRODUCT_ATTRS
        const productAttrs = lifecycle.PRODUCT_ATTRS;
        const attrList = productAttrs?.attributes || productAttrs?.attrs;
        if (Array.isArray(attrList)) {
            for (const item of attrList) {
                if (item.name && item.value) {
                    attrs[item.name] = item.value;
                }
            }
        }
        // Extract from ITEM_ATTRIBUTES (alternative location)
        const itemAttrs = lifecycle.ITEM_ATTRIBUTES;
        if (Array.isArray(itemAttrs?.attributes)) {
            for (const item of itemAttrs.attributes) {
                if (item.name && item.value && !attrs[item.name]) {
                    attrs[item.name] = item.value;
                }
            }
        }
        return attrs;
    }
    function extractSellerInfo(dc) {
        const lifecycle = getLifecycleData(dc);
        const shopInfo = lifecycle.SHOP_INFO;
        const sellerName = shopInfo?.shopName || shopInfo?.storeName || shopInfo?.companyName;
        const sellerId = String(lifecycle.SHOP_INFO?.shopId || "");
        return {
            sellerName: sellerName || undefined,
            sellerId: sellerId || undefined,
        };
    }
    /** 使用 GM_xmlhttpRequest 跨域获取详情图 */
    function fetchDetailImages(nativeDescUrl) {
        return new Promise((resolve) => {
            try {
                GM_xmlhttpRequest({
                    method: "GET",
                    url: nativeDescUrl,
                    responseType: "json",
                    onload(response) {
                        try {
                            if (response.status !== 200) {
                                console.warn("[CC] 详情图请求失败:", response.status);
                                resolve([]);
                                return;
                            }
                            const data = response.response;
                            if (!data?.moduleList || !Array.isArray(data.moduleList)) {
                                resolve([]);
                                return;
                            }
                            const images = [];
                            for (const item of data.moduleList) {
                                if (item.type === "image" && item.data?.url) {
                                    images.push(item.data.url);
                                }
                            }
                            console.log(`[CC] 从 nativeDescUrl 获取到 ${images.length} 张详情图`);
                            resolve(images);
                        }
                        catch (e) {
                            console.error("[CC] 解析详情图数据失败:", e);
                            resolve([]);
                        }
                    },
                    onerror(err) {
                        console.error("[CC] 详情图请求错误:", err);
                        resolve([]);
                    },
                    ontimeout() {
                        console.warn("[CC] 详情图请求超时");
                        resolve([]);
                    },
                });
            }
            catch (e) {
                console.error("[CC] GM_xmlhttpRequest 调用失败:", e);
                resolve([]);
            }
        });
    }
    async function extractDetailImages(dc) {
        const lifecycle = getLifecycleData(dc);
        const descData = lifecycle.DESC;
        // 优先从 nativeDescUrl 获取（JSON 格式，更可靠）
        if (descData?.nativeDescUrl) {
            console.log("[CC] 从 nativeDescUrl 获取详情图:", descData.nativeDescUrl);
            const images = await fetchDetailImages(descData.nativeDescUrl);
            if (images.length > 0)
                return images;
        }
        // 兜底：从 HTML content 提取
        if (descData?.htmlContent) {
            const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
            const images = [];
            let match;
            while ((match = imgRegex.exec(descData.htmlContent)) !== null) {
                const url = match[1];
                if (url && url.startsWith("http")) {
                    images.push(url);
                }
            }
            return images;
        }
        return [];
    }
    async function extractFromDC() {
        const dc = getWindowDC();
        if (!dc)
            return null;
        const productId = extractProductId();
        const title = extractTitle(dc);
        const mainImages = extractMainImages(dc);
        const videoUrl = extractVideoUrl(dc);
        const { priceMin, priceMax, currency } = extractPrice(dc);
        const skuProps = extractSkuProps(dc);
        const skus = extractSkus(dc);
        const attributes = extractAttributes(dc);
        const { sellerName, sellerId } = extractSellerInfo(dc);
        const detailImages = await extractDetailImages(dc);
        // Validate extraction
        if (!title && mainImages.length === 0 && skus.length === 0) {
            console.warn("[CC] _d_c_ data found but product fields empty");
            return null;
        }
        return {
            platform: "aliexpress",
            platformId: productId,
            title,
            mainImages,
            detailImages,
            videoUrl,
            attributes,
            skuProps,
            skus,
            sellerName,
            sellerId,
            sourceUrl: location.href,
            currency,
            priceMin: priceMin || undefined,
            priceMax: priceMax || undefined,
            collectedAt: new Date().toISOString(),
        };
    }
    function extractFromDom() {
        // DOM fallback for when _d_c_ is not available
        const productId = location.href.match(/\/item\/(\d+)/)?.[1] || "";
        if (!productId)
            return null;
        const title = document.querySelector("h1.product-title-text, [class*='product-title'], h1")?.textContent?.trim() || document.title.replace(/-\s*AliExpress.*$/i, "").trim() || "";
        const mainImages = [];
        const seen = new Set();
        document.querySelectorAll(".thumb-list img, .gallery img, [class*='product-image'] img, [class*='main-image'] img").forEach((el) => {
            const src = el.getAttribute("src") || el.getAttribute("data-src") || "";
            const url = src.startsWith("http") ? src : new URL(src, location.origin).href;
            if (url && !seen.has(url)) {
                seen.add(url);
                mainImages.push(url);
            }
        });
        const priceText = document.querySelector(".product-price-value, [class*='price'], [class*='Price']")?.textContent?.trim() || "";
        const priceMatch = priceText.match(/[\d.]+/);
        const price = priceMatch ? parseFloat(priceMatch[0]) : 0;
        return {
            platform: "aliexpress",
            platformId: productId,
            title,
            mainImages,
            detailImages: [],
            attributes: {},
            skuProps: [],
            skus: [],
            sourceUrl: location.href,
            currency: "USD",
            priceMin: price || undefined,
            priceMax: price || undefined,
            collectedAt: new Date().toISOString(),
        };
    }
    function mergeProducts(ctx, dom) {
        if (!ctx && !dom)
            return null;
        if (!ctx)
            return dom;
        if (!dom)
            return ctx;
        return {
            ...ctx,
            title: ctx.title || dom.title,
            mainImages: ctx.mainImages.length > 0 ? ctx.mainImages : dom.mainImages,
            videoUrl: ctx.videoUrl || dom.videoUrl,
            detailImages: ctx.detailImages.length > 0 ? ctx.detailImages : dom.detailImages,
            attributes: { ...dom.attributes, ...ctx.attributes },
            skuProps: ctx.skuProps.length > 0 ? ctx.skuProps : dom.skuProps,
            skus: ctx.skus.length > 0 ? ctx.skus : dom.skus,
            sellerName: ctx.sellerName || dom.sellerName,
        };
    }
    // ─── Platform config export ──────────────────────────
    function isAliExpressPageReady() {
        try {
            const dc = getWindowDC();
            if (dc && dc.lifeCycleEventList && dc.lifeCycleEventList.length > 0) {
                return true;
            }
        }
        catch { /* ignore */ }
        // Fallback: check DOM
        const title = document.querySelector("h1.product-title-text, [class*='product-title']");
        return !!title?.textContent?.trim();
    }
    const platformAliExpress = {
        name: "AliExpress",
        code: "aliexpress",
        matchUrls: ["aliexpress.com", "www.aliexpress.com"],
        isDetailPage() {
            return /aliexpress\.com\/item\/\d+/.test(location.href);
        },
        isListPage() {
            return (/aliexpress\.com\/(wholesale|category|store)/.test(location.href) ||
                document.querySelectorAll("[class*='product-card'], [class*='item-card']").length > 3);
        },
        async extract() {
            const fromDC = await extractFromDC();
            const fromDom = extractFromDom();
            const product = mergeProducts(fromDC, fromDom);
            if (product) {
                console.log(`[CC] ✅ AliExpress 提取: ${product.title}`);
                console.log(`[CC]    主图 ${product.mainImages.length} | SKU ${product.skus.length} | ` +
                    `视频 ${product.videoUrl ? "✓" : "✗"} | 详情图 ${product.detailImages.length} | ` +
                    `来源 ${fromDC ? "_d_c_" : "DOM"}${fromDC && fromDom ? "+DOM" : ""}`);
                return product;
            }
            console.log("[CC] ❌ AliExpress 提取失败");
            return null;
        },
        extractListItems() {
            const items = [];
            const seen = new Set();
            document.querySelectorAll("[class*='product-card'], [class*='item-card']").forEach((el) => {
                const link = el.querySelector("a[href*='/item/']");
                const href = link?.getAttribute("href") || "";
                const url = href.startsWith("http")
                    ? href
                    : href.startsWith("//")
                        ? `${location.protocol}${href}`
                        : href
                            ? new URL(href, location.origin).href
                            : "";
                const match = href.match(/\/item\/(\d+)/);
                const id = match?.[1] || "";
                if (!id || !url || seen.has(id))
                    return;
                seen.add(id);
                items.push({
                    id,
                    title: el.querySelector("[class*='title']")?.textContent?.trim() || "",
                    image: el.querySelector("img")?.getAttribute("src") || "",
                    price: el.querySelector("[class*='price']")?.textContent?.trim() || "",
                    url,
                });
            });
            return items;
        },
    };

    const DEFAULT_API_BASE = (globalThis.__CC_API_BASE__ ||
        "http://127.0.0.1:3001/api/product-collections").replace(/\/$/, "");
    const API_BASE_STORAGE_KEY = "cc_api_base";
    const STORAGE_KEY = "cc_auth_session";
    const AUTO_DRAFT_STORAGE_KEY = "cc_auto_platform_draft";
    let authToken = null;
    let authUser = null;
    function gmGet(key) {
        try {
            return GM_getValue(key, undefined);
        }
        catch {
            return undefined;
        }
    }
    function gmSet(key, value) {
        GM_setValue(key, value);
    }
    function gmDelete(key) {
        GM_deleteValue(key);
    }
    function loadSessionFromStorage() {
        try {
            const raw = gmGet(STORAGE_KEY);
            if (!raw)
                return null;
            const session = JSON.parse(raw);
            if (session?.token && session?.user?.id)
                return session;
        }
        catch {
            // ignore
        }
        return null;
    }
    function saveSessionToStorage(session) {
        gmSet(STORAGE_KEY, JSON.stringify(session));
    }
    function clearSessionStorage() {
        gmDelete(STORAGE_KEY);
    }
    function getApiBase() {
        const stored = gmGet(API_BASE_STORAGE_KEY);
        return (stored || DEFAULT_API_BASE).replace(/\/$/, "");
    }
    function getAuthUser() {
        return authUser;
    }
    function isLoggedIn() {
        return !!authToken;
    }
    function clearAuth() {
        authToken = null;
        authUser = null;
        clearSessionStorage();
    }
    function saveAuth(token, user) {
        authToken = token;
        authUser = user;
        saveSessionToStorage({ token, user });
    }
    /** 启动时从 Tampermonkey 存储恢复登录态 */
    function loadAuthFromStorage() {
        const session = loadSessionFromStorage();
        if (!session)
            return false;
        authToken = session.token;
        authUser = session.user;
        return true;
    }
    function gmRequest(options) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: options.method,
                url: options.url,
                headers: options.headers,
                data: options.data,
                onload(response) {
                    try {
                        const body = JSON.parse(response.responseText);
                        resolve({ status: response.status, body });
                    }
                    catch {
                        reject(new Error("解析响应失败"));
                    }
                },
                onerror() {
                    reject(new Error("网络请求失败，请检查服务端是否运行"));
                },
            });
        });
    }
    /** 邮箱密码登录，凭证持久化到 Tampermonkey 存储 */
    async function login(apiBase, collectorKey) {
        if (apiBase)
            gmSet(API_BASE_STORAGE_KEY, apiBase.trim().replace(/\/$/, ""));
        const { status, body } = await gmRequest({
            method: "GET",
            url: `${getApiBase()}/session`,
            headers: { "X-Collector-Key": collectorKey },
        });
        if (status !== 200 || !body.data) {
            throw new Error(body.message || "采集密钥验证失败");
        }
        saveAuth(collectorKey, body.data);
        return body.data;
    }
    function logout() {
        clearAuth();
    }
    /** 验证当前 token 是否有效 */
    async function getMe() {
        if (!authToken)
            throw new Error("未登录");
        const { status, body } = await gmRequest({
            method: "GET",
            url: `${getApiBase()}/session`,
            headers: { "X-Collector-Key": authToken },
        });
        if (status === 401) {
            clearAuth();
            throw new Error("登录已过期");
        }
        if (status !== 200 || !body.data) {
            throw new Error(body.message || "验证采集密钥失败");
        }
        const user = body.data;
        if (user && authToken) {
            authUser = user;
            saveSessionToStorage({ token: authToken, user });
        }
        return user;
    }
    let authEnsurer = null;
    /** 由 auth-panel 注册：未登录时弹出登录框 */
    function setAuthEnsurer(fn) {
        authEnsurer = fn;
    }
    /** 确保已登录（内存 → 存储 → 弹窗登录） */
    async function ensureAuthenticated() {
        if (authToken) {
            try {
                await getMe();
                return true;
            }
            catch {
                clearAuth();
            }
        }
        if (loadAuthFromStorage()) {
            try {
                await getMe();
                return true;
            }
            catch {
                clearAuth();
            }
        }
        if (authEnsurer)
            return authEnsurer();
        return false;
    }
    function loadAutoDraftSettings() {
        try {
            const raw = gmGet(AUTO_DRAFT_STORAGE_KEY);
            if (!raw)
                return { enabled: false };
            const parsed = JSON.parse(raw);
            return { enabled: Boolean(parsed.enabled), storeId: parsed.storeId, categoryId: parsed.categoryId };
        }
        catch {
            return { enabled: false };
        }
    }
    function saveAutoDraftSettings(settings) {
        gmSet(AUTO_DRAFT_STORAGE_KEY, JSON.stringify(settings));
    }
    async function listListingStores() {
        return [];
    }
    async function getExchangeRate(from, to) {
        if (from === to)
            return { rate: 1, source: "same-currency" };
        throw new Error("采集阶段保留来源价格，不提供汇率换算");
    }
    function submitProduct(product, _options) {
        return new Promise((resolve, reject) => {
            ensureAuthenticated()
                .then((ok) => {
                if (!ok) {
                    reject(new Error("请先连接销途 CRM"));
                    return;
                }
                if (!authToken) {
                    reject(new Error("未配置采集密钥"));
                    return;
                }
                const headers = {
                    "Content-Type": "application/json",
                    "X-Collector-Key": authToken,
                };
                const body = {
                    source: product.platform,
                    sourceProductId: String(product.platformId || ""),
                    sourceUrl: product.sourceUrl || location.href,
                    title: product.title,
                    currency: product.currency || "CNY",
                    priceMin: product.priceMin,
                    priceMax: product.priceMax,
                    galleryImages: product.mainImages || [],
                    mainImageUrl: product.mainImages?.[0] || null,
                    detailImages: product.detailImages || [],
                    descriptionUrl: product.descriptionUrl,
                    videoUrl: product.videoUrl,
                    attributes: product.attributes || {},
                    skuProps: product.skuProps || [],
                    variants: (product.skus || []).map((sku) => ({
                        externalSkuId: sku.skuId != null ? String(sku.skuId) : null,
                        label: String(sku.spec || sku.skuId || "默认规格"),
                        attributes: sku.spec ? { 规格: String(sku.spec) } : {},
                        imageUrl: sku.image || null,
                        priceText: sku.price != null ? String(sku.price) : null,
                        price: Number.isFinite(Number(sku.price)) && Number(sku.price) >= 0 ? Number(sku.price) : null,
                        stockText: sku.stock != null ? String(sku.stock) : null,
                        stock: Number.isFinite(Number(sku.stock)) && Number(sku.stock) >= 0 ? Number(sku.stock) : null,
                        rawData: sku,
                    })),
                    sellerName: product.sellerName,
                    sellerId: product.sellerId,
                    categoryPath: product.categoryPath,
                    sourceCategoryId: product.sourceCategoryId,
                    sourceCategoryAttributes: product.sourceCategoryAttributes || [],
                    tags: product.tags || [],
                    collectorNote: product.collectorNote,
                    sourceCollectedAt: product.collectedAt,
                    collectorMode: "full-product",
                    collectorVersion: "2.1.0",
                    rawData: product,
                };
                GM_xmlhttpRequest({
                    method: "POST",
                    url: `${getApiBase()}/import`,
                    headers,
                    data: JSON.stringify(body),
                    onload(response) {
                        if (response.status >= 200 && response.status < 300) {
                            try {
                                const json = JSON.parse(response.responseText);
                                resolve({ code: 0, data: json.data });
                            }
                            catch {
                                reject(new Error("解析响应失败"));
                            }
                        }
                        else if (response.status === 401) {
                            clearAuth();
                            reject(new Error("采集密钥无效，请重新配置"));
                        }
                        else {
                            reject(new Error(`HTTP ${response.status}: ${response.statusText}`));
                        }
                    },
                    onerror() {
                        reject(new Error("网络请求失败，请检查服务端是否运行"));
                    },
                });
            })
                .catch(reject);
        });
    }

    const DEST_STORAGE_KEY = "cc_collect_destination";
    function loadCollectDestination() {
        try {
            const raw = GM_getValue(DEST_STORAGE_KEY, undefined);
            if (!raw)
                return null;
            const parsed = JSON.parse(raw);
            if (parsed?.mode === "personal")
                return { mode: "personal" };
            if (parsed?.mode === "team" && parsed.teamId)
                return parsed;
        }
        catch {
            // ignore
        }
        return null;
    }
    function saveCollectDestination(dest) {
        GM_setValue(DEST_STORAGE_KEY, JSON.stringify(dest));
    }
    function cloneProduct$1(product) {
        return JSON.parse(JSON.stringify(product));
    }
    function replaceProduct(target, source) {
        for (const key of Object.keys(target)) {
            delete target[key];
        }
        Object.assign(target, cloneProduct$1(source));
    }
    function parseMoney(value) {
        const text = String(value ?? "").replace(/,/g, "");
        const match = text.match(/\d+(?:\.\d+)?/);
        if (!match)
            return null;
        const n = Number(match[0]);
        return Number.isFinite(n) && n > 0 ? n : null;
    }
    function detectSourceCurrency(product) {
        const text = [
            product.currency,
            product.attributes?.["阶梯价格"],
            product.attributes?.["价格区间"],
            product.attributes?.["Ladder Price"],
            product.attributes?.["ladderPrice"],
            ...((product.skus || []).map((sku) => sku.price)),
        ]
            .filter(Boolean)
            .join(" ");
        if (/¥|￥|CNY|RMB/i.test(text))
            return "CNY";
        if (/US\$|\$|USD/i.test(text))
            return "USD";
        if (/EUR|€/i.test(text))
            return "EUR";
        if (/GBP|£/i.test(text))
            return "GBP";
        if (product.platform === "1688")
            return "CNY";
        if (product.platform === "alibaba" || product.platform === "aliexpress")
            return "USD";
        return String(product.currency || "CNY").toUpperCase();
    }
    function currencyPrefix(currency) {
        const code = currency.toUpperCase();
        if (code === "USD")
            return "$";
        if (code === "CNY" || code === "RMB")
            return "¥";
        if (code === "EUR")
            return "€";
        if (code === "GBP")
            return "£";
        return `${code} `;
    }
    function convertPrice(value, rate, profit) {
        const n = parseMoney(value);
        if (n == null)
            return null;
        return Number((n * rate * profit).toFixed(2));
    }
    function parseLadderPriceText(text) {
        return text
            .split(/\s*\/\s*/)
            .map((part) => {
            const price = parseMoney(part);
            const scope = part.match(/\(([^)]*)\)/)?.[1] || part;
            const quantityMatch = scope.match(/(?:≥|>=)?\s*([0-9][\d,]*)/);
            const quantity = quantityMatch ? Number(quantityMatch[1].replace(/,/g, "")) : NaN;
            if (!price || !Number.isFinite(quantity) || quantity <= 0)
                return null;
            return { quantity, price };
        })
            .filter((row) => !!row)
            .sort((a, b) => a.quantity - b.quantity)
            .slice(0, 4);
    }
    function formatLadderPriceText(rows, targetCurrency) {
        const prefix = currencyPrefix(targetCurrency);
        return rows
            .map((row) => `${prefix}${row.price.toFixed(2)} (${row.quantity} pieces)`)
            .join(" / ");
    }
    function applyPanelReprice(product, source, options) {
        replaceProduct(product, source);
        const { rate, profit, targetCurrency } = options;
        const convertedSkuPrices = [];
        product.skus = (product.skus || []).map((sku) => {
            const next = { ...sku };
            const price = convertPrice(sku.price, rate, profit);
            if (price != null) {
                convertedSkuPrices.push(price);
                next.originalPrice = sku.originalPrice || sku.price;
                next.price = String(price);
            }
            return next;
        });
        const ladderText = product.attributes?.["阶梯价格"] ||
            product.attributes?.["Ladder Price"] ||
            product.attributes?.["ladderPrice"] ||
            "";
        const ladderRows = ladderText ? parseLadderPriceText(ladderText) : [];
        if (ladderRows.length > 0) {
            const converted = ladderRows.map((row) => ({
                quantity: row.quantity,
                price: Number((row.price * rate * profit).toFixed(2)),
            }));
            product.attributes = {
                ...(product.attributes || {}),
                _sourceLadderPrice: ladderText,
                阶梯价格: formatLadderPriceText(converted, targetCurrency),
            };
            convertedSkuPrices.push(...converted.map((row) => row.price));
        }
        const min = convertPrice(source.priceMin, rate, profit);
        const max = convertPrice(source.priceMax, rate, profit);
        if (min != null || max != null) {
            product.priceMin = min ?? max ?? undefined;
            product.priceMax = max ?? min ?? undefined;
        }
        else if (convertedSkuPrices.length > 0) {
            product.priceMin = Math.min(...convertedSkuPrices);
            product.priceMax = Math.max(...convertedSkuPrices);
        }
        if (product.priceMin != null && product.priceMax != null) {
            product.attributes = {
                ...(product.attributes || {}),
                价格区间: `${product.priceMin} ~ ${product.priceMax}`,
            };
        }
        product.currency = targetCurrency;
        product.tags = Array.from(new Set([...(product.tags || []), "已改价"]));
        product.collectorNote = [
            product.collectorNote,
            `面板改价：${detectSourceCurrency(source)} -> ${targetCurrency}，汇率 ${rate}，利润系数 ${profit}`,
        ]
            .filter(Boolean)
            .join("；");
    }
    function getStoreCategoryOptions$1(store) {
        const options = [];
        const seen = new Set();
        const defaultCategoryId = String(store?.config?.defaultCategoryId || "").trim();
        const defaultCategoryName = (store?.config?.commonCategories || []).find((item) => String(item.categoryId || "").trim() === defaultCategoryId)?.name;
        const add = (categoryId, name) => {
            const id = String(categoryId || "").trim();
            if (!id || seen.has(id))
                return;
            seen.add(id);
            options.push({ id, label: name ? `${name} (${id})` : id });
        };
        add(defaultCategoryId, defaultCategoryName || "默认类目");
        for (const item of store?.config?.commonCategories || []) {
            add(item.categoryId, item.name);
        }
        return options;
    }
    /**
     * Create and show the collector preview panel overlay.
     * Returns a promise that resolves when the user confirms submission.
     */
    function showCollectorPanel(product) {
        return new Promise((resolve) => {
            void buildCollectorPanel(product, resolve);
        });
    }
    async function buildCollectorPanel(product, resolve) {
        const originalProduct = cloneProduct$1(product);
        let user = getAuthUser();
        try {
            user = await getMe();
        }
        catch {
            // 使用缓存用户信息
        }
        const teams = user?.teams || [];
        let listingStores = [];
        try {
            listingStores = await listListingStores();
        }
        catch {
            listingStores = [];
        }
        const savedDest = loadCollectDestination();
        const savedAutoDraft = loadAutoDraftSettings();
        let destMode = savedDest?.mode === "personal"
            ? "personal"
            : teams.length > 0
                ? "team"
                : "personal";
        let selectedTeamId = savedDest?.mode === "team" && teams.some((t) => t.id === savedDest.teamId)
            ? savedDest.teamId
            : user?.activeTeamId && teams.some((t) => t.id === user.activeTeamId)
                ? user.activeTeamId
                : teams[0]?.id;
        // ─── Create overlay ──────────────────────────────
        const overlay = document.createElement("div");
        overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.5); z-index: 999999;
      display: flex; align-items: center; justify-content: center;
      padding: 16px; box-sizing: border-box; overflow: hidden;
      overscroll-behavior: contain;
    `;
        // ─── Create panel ────────────────────────────────
        const panel = document.createElement("div");
        panel.style.cssText = `
      background: #fff; border-radius: 12px; padding: 24px 24px 0;
      width: 520px; max-width: calc(100vw - 32px);
      max-height: calc(100dvh - 32px); overflow-y: auto;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      position: relative;
      box-sizing: border-box; overscroll-behavior: contain;
    `;
        // ─── Header ──────────────────────────────────────
        const header = document.createElement("div");
        header.style.cssText = `
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 16px; padding-bottom: 12px;
      border-bottom: 1px solid #f0f0f0;
    `;
        header.innerHTML = `<h2 style="margin:0;font-size:18px;color:#333;">📦 确认采集</h2>
      <span style="font-size:12px;color:#999;">${product.platform}</span>`;
        // ─── Image preview ──────────────────────────────
        const imgContainer = document.createElement("div");
        imgContainer.style.cssText = "margin-bottom: 12px; text-align: center;";
        const previewImage = (product.mainImages || []).find((u) => typeof u === "string" && /^https?:\/\//i.test(u) && !/\.(mp4|m3u8|flv)(\?|$)/i.test(u));
        if (previewImage) {
            const img = document.createElement("img");
            img.src = previewImage;
            img.style.cssText = "max-width: 100%; max-height: 160px; border-radius: 8px; object-fit: contain; background: #f5f5f5;";
            img.onerror = () => { img.style.display = "none"; };
            imgContainer.appendChild(img);
        }
        // ─── Info fields ─────────────────────────────────
        const infoTable = document.createElement("div");
        infoTable.style.cssText = "margin-bottom: 16px;";
        const addField = (label, value, highlight = false) => {
            const row = document.createElement("div");
            row.style.cssText = "display: flex; padding: 5px 0; border-bottom: 1px solid #f5f5f5;";
            const lbl = document.createElement("div");
            lbl.style.cssText = "width: 70px; color: #888; font-size: 12px; flex-shrink: 0; line-height: 1.6;";
            lbl.textContent = label;
            const val = document.createElement("div");
            val.style.cssText = `flex: 1; font-size: 13px; color: #333; word-break: break-all; line-height: 1.6; ${highlight ? "color:#1677ff;font-weight:600;" : ""}`;
            val.textContent = value || "-";
            row.appendChild(lbl);
            row.appendChild(val);
            infoTable.appendChild(row);
        };
        // 价格：优先阶梯价属性 / priceMin~Max，否则从 skus 推导
        const sym = product.currency === "USD" ? "$" : "¥";
        const ladderAttr = product.attributes?.["阶梯价格"];
        if (ladderAttr) {
            addField("阶梯价格", ladderAttr, true);
        }
        let priceInfo = "-";
        if (product.priceMin != null && product.priceMax != null) {
            priceInfo = `${sym}${product.priceMin}`;
            if (product.priceMax !== product.priceMin) {
                priceInfo += ` ~ ${sym}${product.priceMax}`;
            }
            addField("价格区间", priceInfo, !ladderAttr);
        }
        else if (product.skus && product.skus.length > 0) {
            const prices = product.skus.map((s) => parseFloat(s.price)).filter((p) => !isNaN(p) && p > 0);
            if (prices.length > 0) {
                const minP = Math.min(...prices);
                const maxP = Math.max(...prices);
                priceInfo = `${sym}${minP}`;
                if (maxP !== minP)
                    priceInfo += ` ~ ${sym}${maxP}`;
                const variantCount = product.skus.filter((s) => !s.skuId.includes("-ladder-")).length;
                const tierCount = product.skus.length - variantCount;
                const skuHint = tierCount > 0
                    ? `${variantCount} 个规格 + ${tierCount} 档批发价`
                    : `${product.skus.length} 个 SKU`;
                if (!ladderAttr)
                    addField("价格区间", `${priceInfo} (${skuHint})`, true);
            }
            else if (!ladderAttr) {
                addField("价格区间", priceInfo);
            }
        }
        else if (!ladderAttr) {
            addField("价格区间", priceInfo);
        }
        addField("标题", product.title);
        addField("卖家", product.sellerName || "-");
        if (product.videoUrl)
            addField("视频", product.videoUrl);
        if (product.descriptionUrl)
            addField("详情URL", product.descriptionUrl);
        // 属性
        if (product.attributes && Object.keys(product.attributes).length > 0) {
            const attrStr = Object.entries(product.attributes)
                .map(([k, v]) => `${k}: ${v}`)
                .join(" | ");
            addField("属性", attrStr);
        }
        // SKU 规格属性
        if (product.skuProps && product.skuProps.length > 0) {
            const propStr = product.skuProps
                .map((p) => `${p.name}: ${p.values.map((v) => v.name).join("/")}`)
                .join(" | ");
            addField("规格", propStr);
        }
        // SKU 数量和库存
        if (product.skus && product.skus.length > 0) {
            const totalStock = product.skus.reduce((sum, s) => sum + (s.stock || 0), 0);
            addField("SKU", `${product.skus.length} 个组合，总库存 ${totalStock}`);
        }
        // 图片信息
        const imgCount = product.mainImages.length;
        if (imgCount > 0 || product.descriptionUrl) {
            const detailHint = product.descriptionUrl ? "详情聚合页（后台自动解析）" : `${product.detailImages.length} 张详情图`;
            addField("图片", `${product.mainImages.length} 张主图 + ${detailHint}`);
        }
        addField("平台", product.platform);
        if (product.categoryPath)
            addField("类目", product.categoryPath.slice(0, 100));
        // ─── Note input ──────────────────────────────────
        const repriceSection = document.createElement("div");
        repriceSection.style.cssText = `
      margin: 12px 0; padding: 12px; background: #f8fbff;
      border: 1px solid #d6e4ff; border-radius: 8px;
    `;
        const detectedCurrency = detectSourceCurrency(product);
        const repriceTitle = document.createElement("div");
        repriceTitle.style.cssText = "font-size:13px;color:#1d39c4;font-weight:600;margin-bottom:8px;";
        repriceTitle.textContent = "改价";
        repriceSection.appendChild(repriceTitle);
        const repriceGrid = document.createElement("div");
        repriceGrid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;";
        const makeInputWrap = (label, input) => {
            const wrap = document.createElement("label");
            wrap.style.cssText = "display:flex;flex-direction:column;gap:4px;font-size:12px;color:#666;";
            const span = document.createElement("span");
            span.textContent = label;
            wrap.appendChild(span);
            wrap.appendChild(input);
            return wrap;
        };
        const inputStyle = "width:100%;box-sizing:border-box;padding:7px 8px;border:1px solid #adc6ff;border-radius:6px;background:#fff;font-size:13px;";
        const sourceCurrencySelect = document.createElement("select");
        sourceCurrencySelect.style.cssText = inputStyle;
        const targetCurrencySelect = document.createElement("select");
        targetCurrencySelect.style.cssText = inputStyle;
        for (const code of ["CNY", "USD", "EUR", "GBP", "JPY", "HKD"]) {
            const sourceOpt = document.createElement("option");
            sourceOpt.value = code;
            sourceOpt.textContent = code;
            sourceCurrencySelect.appendChild(sourceOpt);
            const targetOpt = document.createElement("option");
            targetOpt.value = code;
            targetOpt.textContent = code;
            targetCurrencySelect.appendChild(targetOpt);
        }
        sourceCurrencySelect.value = detectedCurrency;
        targetCurrencySelect.value = "USD";
        const profitInput = document.createElement("input");
        profitInput.type = "number";
        profitInput.min = "0.01";
        profitInput.step = "0.01";
        profitInput.value = "1.3";
        profitInput.style.cssText = inputStyle;
        const rateInput = document.createElement("input");
        rateInput.type = "number";
        rateInput.min = "0.000001";
        rateInput.step = "0.000001";
        rateInput.value = sourceCurrencySelect.value === targetCurrencySelect.value ? "1" : "";
        rateInput.placeholder = "自动获取";
        rateInput.style.cssText = inputStyle;
        repriceGrid.appendChild(makeInputWrap("源币种", sourceCurrencySelect));
        repriceGrid.appendChild(makeInputWrap("目标币种", targetCurrencySelect));
        repriceGrid.appendChild(makeInputWrap("利润系数", profitInput));
        repriceGrid.appendChild(makeInputWrap("汇率", rateInput));
        repriceSection.appendChild(repriceGrid);
        const repriceHint = document.createElement("div");
        repriceHint.style.cssText = "font-size:11px;color:#597ef7;margin-top:8px;line-height:1.5;";
        repriceHint.textContent = `已识别源币种：${detectedCurrency}。检测到 ¥/￥ 会按 CNY 汇率转换后再乘利润系数。`;
        repriceSection.appendChild(repriceHint);
        const repriceResult = document.createElement("div");
        repriceResult.style.cssText = "font-size:12px;color:#333;margin-top:8px;display:none;background:#fff;padding:8px;border-radius:6px;border:1px solid #e6f4ff;";
        repriceSection.appendChild(repriceResult);
        const repriceActions = document.createElement("div");
        repriceActions.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:10px;";
        const fetchRateBtn = document.createElement("button");
        fetchRateBtn.type = "button";
        fetchRateBtn.textContent = "获取汇率";
        fetchRateBtn.style.cssText = "padding:6px 10px;border:1px solid #adc6ff;border-radius:6px;background:#fff;color:#1d39c4;cursor:pointer;";
        const applyRepriceBtn = document.createElement("button");
        applyRepriceBtn.type = "button";
        applyRepriceBtn.textContent = "应用改价";
        applyRepriceBtn.style.cssText = "padding:6px 10px;border:0;border-radius:6px;background:#1677ff;color:#fff;cursor:pointer;";
        const resetRepriceBtn = document.createElement("button");
        resetRepriceBtn.type = "button";
        resetRepriceBtn.textContent = "恢复原价";
        resetRepriceBtn.style.cssText = "padding:6px 10px;border:1px solid #d9d9d9;border-radius:6px;background:#fff;color:#333;cursor:pointer;";
        repriceActions.appendChild(fetchRateBtn);
        repriceActions.appendChild(applyRepriceBtn);
        repriceActions.appendChild(resetRepriceBtn);
        repriceSection.appendChild(repriceActions);
        const syncRate = async () => {
            const from = sourceCurrencySelect.value;
            const to = targetCurrencySelect.value;
            if (from === to) {
                rateInput.value = "1";
                return 1;
            }
            fetchRateBtn.textContent = "读取中...";
            fetchRateBtn.disabled = true;
            try {
                const result = await getExchangeRate(from, to);
                rateInput.value = String(result.rate);
                repriceHint.textContent = `汇率：1 ${from} = ${result.rate} ${to}${result.date ? `（${result.date}）` : ""}，来源：${result.source || "system"}`;
                return result.rate;
            }
            catch (err) {
                repriceHint.textContent = `汇率自动获取失败：${err?.message || err}。可手动填写汇率。`;
                throw err;
            }
            finally {
                fetchRateBtn.textContent = "获取汇率";
                fetchRateBtn.disabled = false;
            }
        };
        fetchRateBtn.onclick = () => {
            void syncRate();
        };
        sourceCurrencySelect.onchange = () => {
            rateInput.value = sourceCurrencySelect.value === targetCurrencySelect.value ? "1" : "";
        };
        targetCurrencySelect.onchange = () => {
            rateInput.value = sourceCurrencySelect.value === targetCurrencySelect.value ? "1" : "";
        };
        applyRepriceBtn.onclick = async () => {
            let rate = Number(rateInput.value);
            if (!Number.isFinite(rate) || rate <= 0) {
                try {
                    rate = await syncRate();
                }
                catch {
                    return;
                }
            }
            const profit = Number(profitInput.value);
            if (!Number.isFinite(profit) || profit <= 0) {
                repriceHint.textContent = "利润系数需要大于 0";
                return;
            }
            applyPanelReprice(product, originalProduct, {
                rate,
                profit,
                targetCurrency: targetCurrencySelect.value,
            });
            const prefix = currencyPrefix(product.currency || targetCurrencySelect.value);
            repriceResult.style.display = "block";
            repriceResult.textContent =
                `已应用：${sourceCurrencySelect.value} -> ${targetCurrencySelect.value}，汇率 ${rate}，利润系数 ${profit}。` +
                    (product.priceMin != null
                        ? ` 新价格区间：${prefix}${product.priceMin}${product.priceMax !== product.priceMin ? ` ~ ${prefix}${product.priceMax}` : ""}`
                        : "");
        };
        resetRepriceBtn.onclick = () => {
            replaceProduct(product, originalProduct);
            sourceCurrencySelect.value = detectSourceCurrency(product);
            rateInput.value = sourceCurrencySelect.value === targetCurrencySelect.value ? "1" : "";
            repriceResult.style.display = "none";
            repriceHint.textContent = `已恢复原价。已识别源币种：${sourceCurrencySelect.value}`;
        };
        // 原始价格直接保存，汇率和利润调整交给后续 AI 处理流程。
        const noteLabel = document.createElement("div");
        noteLabel.style.cssText = "font-size: 12px; color: #888; margin: 10px 0 4px;";
        noteLabel.textContent = "📝 采集备注（可选）";
        const noteInput = document.createElement("textarea");
        noteInput.placeholder = "添加备注，如：爆款潜力、需要询价…";
        noteInput.style.cssText = `
      width: 100%; padding: 8px 10px; border: 1px solid #d9d9d9;
      border-radius: 6px; font-size: 13px; resize: vertical;
      box-sizing: border-box; min-height: 42px; font-family: inherit;
      transition: border-color 0.2s;
    `;
        noteInput.onfocus = () => { noteInput.style.borderColor = "#1677ff"; };
        noteInput.onblur = () => { noteInput.style.borderColor = "#d9d9d9"; };
        // ─── Duplicate warning ───────────────────────────
        const dupWarning = document.createElement("div");
        dupWarning.style.cssText = `
      display: none; margin: 8px 0; padding: 8px 12px;
      background: #fff7e6; border: 1px solid #ffd591; border-radius: 6px;
      font-size: 12px; color: #d46b08;
    `;
        infoTable.appendChild(noteLabel);
        infoTable.appendChild(noteInput);
        infoTable.appendChild(dupWarning);
        // ─── 采集目标（个人 / 团队公共池）────────────────
        const destSection = document.createElement("div");
        destSection.style.cssText = `
      margin-top: 12px; padding: 12px; background: #fafafa;
      border: 1px solid #f0f0f0; border-radius: 8px;
    `;
        const destTitle = document.createElement("div");
        destTitle.style.cssText = "font-size: 12px; color: #666; margin-bottom: 8px; font-weight: 600;";
        destTitle.textContent = "📁 采集到";
        destSection.appendChild(destTitle);
        const destRow = document.createElement("div");
        destRow.style.cssText = "display: flex; flex-wrap: wrap; gap: 8px; align-items: center;";
        const personalLabel = document.createElement("label");
        personalLabel.style.cssText = `
      display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
      font-size: 13px; color: #333; padding: 6px 10px; border-radius: 6px;
      border: 1px solid #d9d9d9; background: #fff;
    `;
        const personalRadio = document.createElement("input");
        personalRadio.type = "radio";
        personalRadio.name = "cc-collect-dest";
        personalRadio.value = "personal";
        personalRadio.checked = destMode === "personal";
        personalLabel.appendChild(personalRadio);
        personalLabel.appendChild(document.createTextNode("个人仓库"));
        destRow.appendChild(personalLabel);
        const teamLabel = document.createElement("label");
        teamLabel.style.cssText = personalLabel.style.cssText;
        const teamRadio = document.createElement("input");
        teamRadio.type = "radio";
        teamRadio.name = "cc-collect-dest";
        teamRadio.value = "team";
        teamRadio.checked = destMode === "team";
        teamRadio.disabled = teams.length === 0;
        if (teams.length === 0) {
            teamLabel.style.opacity = "0.5";
            teamLabel.style.cursor = "not-allowed";
        }
        teamLabel.appendChild(teamRadio);
        teamLabel.appendChild(document.createTextNode("团队公共池"));
        destRow.appendChild(teamLabel);
        const teamSelect = document.createElement("select");
        teamSelect.style.cssText = `
      flex: 1; min-width: 140px; padding: 6px 8px; border: 1px solid #d9d9d9;
      border-radius: 6px; font-size: 13px; background: #fff;
    `;
        teams.forEach((t) => {
            const opt = document.createElement("option");
            opt.value = t.id;
            opt.textContent = t.myRoleLabel ? `${t.name}（${t.myRoleLabel}）` : t.name;
            teamSelect.appendChild(opt);
        });
        if (selectedTeamId)
            teamSelect.value = selectedTeamId;
        teamSelect.disabled = teams.length === 0 || destMode !== "team";
        if (teams.length > 0)
            destRow.appendChild(teamSelect);
        const syncDestUi = () => {
            const isTeam = destMode === "team" && teams.length > 0;
            personalLabel.style.borderColor = destMode === "personal" ? "#1677ff" : "#d9d9d9";
            personalLabel.style.background = destMode === "personal" ? "#e6f4ff" : "#fff";
            teamLabel.style.borderColor = isTeam ? "#1677ff" : "#d9d9d9";
            teamLabel.style.background = isTeam ? "#e6f4ff" : "#fff";
            teamSelect.disabled = !isTeam;
            teamSelect.style.opacity = isTeam ? "1" : "0.5";
        };
        syncDestUi();
        personalRadio.onchange = () => {
            if (personalRadio.checked) {
                destMode = "personal";
                syncDestUi();
            }
        };
        teamRadio.onchange = () => {
            if (teamRadio.checked && teams.length > 0) {
                destMode = "team";
                selectedTeamId = teamSelect.value;
                syncDestUi();
            }
        };
        teamSelect.onchange = () => {
            selectedTeamId = teamSelect.value;
            destMode = "team";
            teamRadio.checked = true;
            syncDestUi();
        };
        if (teams.length === 0) {
            const hint = document.createElement("div");
            hint.style.cssText = "font-size: 11px; color: #999; margin-top: 6px;";
            hint.textContent = "您尚未加入团队，仅可采集到个人仓库。可在管理系统「团队管理」中创建或加入团队。";
            destSection.appendChild(destRow);
            destSection.appendChild(hint);
        }
        else {
            destSection.appendChild(destRow);
        }
        const getSubmitTeamId = () => {
            if (destMode === "personal" || teams.length === 0)
                return null;
            return teamSelect.value || selectedTeamId || null;
        };
        // ─── AI 完成后自动创建平台草稿 ─────────────────────
        const autoDraftSection = document.createElement("div");
        autoDraftSection.style.cssText = `
      margin-top: 12px; padding: 12px; background: #f6ffed;
      border: 1px solid #b7eb8f; border-radius: 8px;
    `;
        const autoDraftTitle = document.createElement("label");
        autoDraftTitle.style.cssText = "display:flex;align-items:center;gap:8px;font-size:13px;color:#234f12;font-weight:600;cursor:pointer;";
        const autoDraftCheckbox = document.createElement("input");
        autoDraftCheckbox.type = "checkbox";
        autoDraftCheckbox.checked = Boolean(savedAutoDraft.enabled && savedAutoDraft.storeId);
        autoDraftTitle.appendChild(autoDraftCheckbox);
        autoDraftTitle.appendChild(document.createTextNode("AI处理成功后自动创建平台草稿"));
        autoDraftSection.appendChild(autoDraftTitle);
        const autoDraftHint = document.createElement("div");
        autoDraftHint.style.cssText = "font-size:11px;color:#5b8c00;margin:6px 0 8px 22px;line-height:1.5;";
        autoDraftHint.textContent = "采集完成后等待 AI Agent 标记可上架，再自动上架到所选店铺的平台草稿箱。";
        autoDraftSection.appendChild(autoDraftHint);
        const storeSelect = document.createElement("select");
        storeSelect.style.cssText = `
      width: 100%; padding: 7px 8px; border: 1px solid #b7eb8f;
      border-radius: 6px; font-size: 13px; background: #fff;
    `;
        if (listingStores.length === 0) {
            const opt = document.createElement("option");
            opt.value = "";
            opt.textContent = "暂无可用店铺，请先到管理系统添加/启用店铺";
            storeSelect.appendChild(opt);
            autoDraftCheckbox.checked = false;
            autoDraftCheckbox.disabled = true;
        }
        else {
            listingStores.forEach((store) => {
                const opt = document.createElement("option");
                opt.value = store.id;
                opt.textContent = `${store.name}（${store.targetPlatform}${store.sellerAccount ? ` · ${store.sellerAccount}` : ""}）`;
                storeSelect.appendChild(opt);
            });
            if (savedAutoDraft.storeId && listingStores.some((s) => s.id === savedAutoDraft.storeId)) {
                storeSelect.value = savedAutoDraft.storeId;
            }
            else {
                storeSelect.value = listingStores[0].id;
            }
        }
        autoDraftSection.appendChild(storeSelect);
        const categorySelect = document.createElement("select");
        categorySelect.style.cssText = `
      width: 100%; padding: 7px 8px; border: 1px solid #b7eb8f;
      border-radius: 6px; font-size: 13px; background: #fff; margin-top: 8px;
    `;
        const syncCategorySelect = () => {
            categorySelect.innerHTML = "";
            const store = listingStores.find((item) => item.id === storeSelect.value);
            const categories = getStoreCategoryOptions$1(store);
            if (categories.length === 0) {
                const opt = document.createElement("option");
                opt.value = "";
                opt.textContent = "使用店铺默认发品类目";
                categorySelect.appendChild(opt);
                return;
            }
            if (product.platform === "alibaba") {
                const sourceOpt = document.createElement("option");
                sourceOpt.value = "";
                sourceOpt.textContent = "自动使用源商品类目（采集失败时使用店铺默认类目）";
                categorySelect.appendChild(sourceOpt);
            }
            for (const category of categories) {
                const opt = document.createElement("option");
                opt.value = category.id;
                opt.textContent = category.label;
                categorySelect.appendChild(opt);
            }
            categorySelect.value =
                savedAutoDraft.categoryId && categories.some((item) => item.id === savedAutoDraft.categoryId)
                    ? savedAutoDraft.categoryId
                    : product.platform === "alibaba"
                        ? ""
                        : categories[0].id;
        };
        syncCategorySelect();
        autoDraftSection.appendChild(categorySelect);
        const syncAutoDraftUi = () => {
            const enabled = autoDraftCheckbox.checked && listingStores.length > 0;
            storeSelect.disabled = !enabled;
            categorySelect.disabled = !enabled;
            storeSelect.style.opacity = enabled ? "1" : "0.55";
            categorySelect.style.opacity = enabled ? "1" : "0.55";
            autoDraftSection.style.background = enabled ? "#f6ffed" : "#fafafa";
            autoDraftSection.style.borderColor = enabled ? "#b7eb8f" : "#f0f0f0";
        };
        syncAutoDraftUi();
        autoDraftCheckbox.onchange = syncAutoDraftUi;
        storeSelect.onchange = () => {
            syncCategorySelect();
            syncAutoDraftUi();
        };
        const persistDestination = () => {
            if (destMode === "personal") {
                saveCollectDestination({ mode: "personal" });
            }
            else if (teamSelect.value) {
                saveCollectDestination({ mode: "team", teamId: teamSelect.value });
            }
            saveAutoDraftSettings({
                enabled: autoDraftCheckbox.checked && listingStores.length > 0,
                storeId: storeSelect.value || undefined,
                categoryId: categorySelect.value || undefined,
            });
        };
        const getAutoDraftStoreId = () => {
            if (!autoDraftCheckbox.checked || listingStores.length === 0)
                return null;
            return storeSelect.value || null;
        };
        // ─── Buttons ─────────────────────────────────────
        const btnContainer = document.createElement("div");
        btnContainer.style.cssText = `
      display: flex; gap: 8px; justify-content: flex-end;
      padding: 12px 0 16px; border-top: 1px solid #f0f0f0;
      position: sticky; bottom: 0; background: #fff; z-index: 2;
    `;
        const cancelBtn = document.createElement("button");
        cancelBtn.textContent = "取消";
        cancelBtn.style.cssText = `
      padding: 8px 18px; border: 1px solid #d9d9d9; border-radius: 6px;
      background: #fff; cursor: pointer; font-size: 14px; color: #333;
      transition: all 0.2s;
    `;
        cancelBtn.onmouseenter = () => { cancelBtn.style.borderColor = "#1677ff"; cancelBtn.style.color = "#1677ff"; };
        cancelBtn.onmouseleave = () => { cancelBtn.style.borderColor = "#d9d9d9"; cancelBtn.style.color = "#333"; };
        cancelBtn.onclick = () => { overlay.remove(); resolve(false); };
        const submitBtn = document.createElement("button");
        submitBtn.textContent = "✅ 确认采集";
        submitBtn.style.cssText = `
      padding: 8px 18px; border: none; border-radius: 6px;
      background: #1677ff; color: #fff; cursor: pointer; font-size: 14px;
      transition: all 0.2s;
    `;
        submitBtn.onmouseenter = () => { submitBtn.style.background = "#4096ff"; };
        submitBtn.onmouseleave = () => { submitBtn.style.background = "#1677ff"; };
        submitBtn.onclick = async () => {
            const manualNote = noteInput.value.trim();
            if (manualNote) {
                product.collectorNote = [product.collectorNote, manualNote].filter(Boolean).join("；");
            }
            // 禁用按钮显示提交中
            submitBtn.disabled = true;
            submitBtn.textContent = "⏳ 提交中…";
            submitBtn.style.opacity = "0.7";
            cancelBtn.style.display = "none";
            try {
                persistDestination();
                const teamId = getSubmitTeamId();
                const res = await submitProduct(product, {
                    teamId,
                    autoDraftStoreId: getAutoDraftStoreId(),
                    autoDraftCategoryId: categorySelect.value || undefined,
                });
                if (res.code === 409) {
                    const destHint = teamId ? "团队公共池" : "个人仓库";
                    dupWarning.style.display = "block";
                    dupWarning.textContent = `⚠️ 该商品已在${destHint}中（ID: ${res.data?.existingId?.slice(0, 8)}...）`;
                    submitBtn.disabled = false;
                    submitBtn.textContent = "✅ 确认采集";
                    submitBtn.style.opacity = "1";
                    cancelBtn.style.display = "";
                    return;
                }
                const destName = teamId && teams.length > 0
                    ? teams.find((t) => t.id === teamId)?.name || "团队公共池"
                    : "个人仓库";
                showToast(`已采集到${destName}`);
                overlay.remove();
                resolve(true);
            }
            catch (err) {
                submitBtn.disabled = false;
                submitBtn.textContent = "✅ 确认采集";
                submitBtn.style.opacity = "1";
                cancelBtn.style.display = "";
                if (err?.message?.includes("登录")) {
                    showErrorToast(`${err.message}，请点击右下角「登录」`);
                }
                else {
                    showErrorToast(`❌ 采集失败: ${err.message}`);
                }
            }
        };
        btnContainer.appendChild(cancelBtn);
        btnContainer.appendChild(submitBtn);
        // ─── Assemble panel ──────────────────────────────
        panel.appendChild(header);
        panel.appendChild(imgContainer);
        panel.appendChild(infoTable);
        panel.appendChild(btnContainer);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        // 点击 overlay 关闭
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                overlay.remove();
                resolve(false);
            }
        };
    }
    // ─── Toast helpers ──────────────────────────────────
    /**
     * Show a brief toast notification
     */
    function showToast(message, type = "success") {
        const bg = type === "success" ? "#52c41a" : "#ff4d4f";
        const icon = type === "success" ? "✅" : "❌";
        const toast = document.createElement("div");
        toast.style.cssText = `
    position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
    background: ${bg}; color: #fff; padding: 10px 20px;
    border-radius: 8px; font-size: 14px; z-index: 1000000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
        toast.textContent = `${icon} ${message}`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }
    function showErrorToast(message) {
        const toast = document.createElement("div");
        toast.style.cssText = `
    position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
    background: #ff4d4f; color: #fff; padding: 10px 20px;
    border-radius: 8px; font-size: 14px; z-index: 1000000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
        toast.textContent = `❌ ${message}`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }

    let refreshAuthWidget = null;
    let launcherAction = null;
    let launcherActionLabel = null;
    let launcherButton = null;
    let launcherBusy = false;
    function setLauncherAction(action) {
        launcherAction = action;
        refreshAuthWidget?.();
    }
    function setLauncherState(label, state = "idle") {
        launcherBusy = state === "busy";
        if (!launcherButton || !launcherActionLabel)
            return;
        launcherButton.disabled = launcherBusy;
        launcherButton.dataset.state = state;
        launcherActionLabel.textContent = label || launcherAction?.label || "打开采集助手";
    }
    /** 登录弹窗，成功返回 true */
    function showLoginModal() {
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1000001;
      display: flex; align-items: center; justify-content: center;
    `;
            const panel = document.createElement("div");
            panel.style.cssText = `
      background: #fff; border-radius: 12px; padding: 24px; width: 380px; max-width: 92vw;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
            panel.innerHTML = `
      <h2 style="margin:0 0 8px;font-size:18px;color:#333;">🔐 连接销途 CRM</h2>
      <p style="margin:0 0 16px;font-size:12px;color:#888;">在 CRM 的“1688 采集 → 配置采集器”中生成专用密钥</p>
      <label style="display:block;font-size:12px;color:#666;margin-bottom:4px;">CRM API 地址</label>
      <input id="cc-login-email" type="text" value="${getApiBase()}" placeholder="http://127.0.0.1:3001/api/product-collections"
        style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d9d9d9;border-radius:6px;margin-bottom:12px;font-size:14px;" />
      <label style="display:block;font-size:12px;color:#666;margin-bottom:4px;">采集密钥</label>
      <input id="cc-login-password" type="password" placeholder="crm1688_..."
        style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d9d9d9;border-radius:6px;margin-bottom:8px;font-size:14px;" />
      <div id="cc-login-error" style="color:#ff4d4f;font-size:12px;min-height:18px;margin-bottom:8px;"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">
        <button id="cc-login-cancel" type="button"
          style="padding:8px 16px;border:1px solid #d9d9d9;border-radius:6px;background:#fff;cursor:pointer;">取消</button>
        <button id="cc-login-submit" type="button"
          style="padding:8px 16px;border:none;border-radius:6px;background:#1677ff;color:#fff;cursor:pointer;">连接</button>
      </div>
    `;
            overlay.appendChild(panel);
            document.body.appendChild(overlay);
            const emailInput = panel.querySelector("#cc-login-email");
            const passwordInput = panel.querySelector("#cc-login-password");
            const errorEl = panel.querySelector("#cc-login-error");
            const submitBtn = panel.querySelector("#cc-login-submit");
            const cancelBtn = panel.querySelector("#cc-login-cancel");
            const close = (result) => {
                overlay.remove();
                resolve(result);
            };
            const doLogin = async () => {
                const email = emailInput.value.trim();
                const password = passwordInput.value.trim();
                if (!email || !password) {
                    errorEl.textContent = "请输入 CRM API 地址和采集密钥";
                    return;
                }
                submitBtn.disabled = true;
                submitBtn.textContent = "连接中…";
                errorEl.textContent = "";
                try {
                    await login(email, password);
                    showToast(`已连接，${getAuthUser()?.username || "可以开始采集"}`);
                    refreshAuthWidget?.();
                    close(true);
                }
                catch (err) {
                    errorEl.textContent = err?.message || "登录失败";
                    submitBtn.disabled = false;
                    submitBtn.textContent = "连接";
                }
            };
            submitBtn.onclick = doLogin;
            cancelBtn.onclick = () => close(false);
            passwordInput.onkeydown = (e) => {
                if (e.key === "Enter")
                    doLogin();
            };
            overlay.onclick = (e) => {
                if (e.target === overlay)
                    close(false);
            };
            setTimeout(() => emailInput.focus(), 50);
        });
    }
    /** 右下角统一悬浮入口（采集动作 + 账号状态） */
    function mountAuthWidget() {
        try {
            if (window.self !== window.top)
                return;
        }
        catch {
            return;
        }
        if (document.querySelector(".cc-auth-widget"))
            return;
        const wrap = document.createElement("div");
        wrap.className = "cc-auth-widget";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cc-launcher-btn";
        btn.innerHTML = `
    <span class="cc-launcher-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18">
        <path d="M4.5 7.5 12 3l7.5 4.5v9L12 21l-7.5-4.5v-9Z"></path>
        <path d="m4.8 7.7 7.2 4.2 7.2-4.2M12 12v8.4"></path>
      </svg>
    </span>
    <span class="cc-launcher-copy">
      <span class="cc-launcher-kicker">COLLECTOR</span>
      <span class="cc-launcher-action">打开采集助手</span>
    </span>
    <span class="cc-launcher-rule" aria-hidden="true"></span>
    <span class="cc-launcher-account">
      <span class="cc-launcher-status" aria-hidden="true"></span>
      <span class="cc-launcher-account-label">连接</span>
      <svg class="cc-launcher-chevron" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
        <path d="m3 4.5 3 3 3-3"></path>
      </svg>
    </span>
  `;
        btn.setAttribute("aria-haspopup", "menu");
        btn.setAttribute("aria-expanded", "false");
        launcherButton = btn;
        launcherActionLabel = btn.querySelector(".cc-launcher-action");
        const menu = document.createElement("div");
        menu.className = "cc-launcher-menu";
        menu.style.display = "none";
        const logoutItem = document.createElement("button");
        logoutItem.type = "button";
        logoutItem.className = "cc-launcher-logout";
        logoutItem.innerHTML = `
    <span>
      <strong class="cc-launcher-menu-user">当前账号</strong>
      <small>采集数据将保存到此账号</small>
    </span>
    <span class="cc-launcher-logout-label">退出</span>
  `;
        menu.appendChild(logoutItem);
        wrap.appendChild(menu);
        wrap.appendChild(btn);
        document.body.appendChild(wrap);
        const setMenuOpen = (open) => {
            menu.style.display = open ? "block" : "none";
            btn.setAttribute("aria-expanded", String(open));
            if (open)
                logoutItem.focus();
        };
        const update = () => {
            const accountLabel = btn.querySelector(".cc-launcher-account-label");
            const menuUser = menu.querySelector(".cc-launcher-menu-user");
            if (isLoggedIn()) {
                const user = getAuthUser();
                const displayName = user?.username || user?.email || "已登录";
                accountLabel.textContent = displayName;
                menuUser.textContent = displayName;
                btn.dataset.authenticated = "true";
                btn.title = launcherAction?.title || "打开采集助手";
            }
            else {
                accountLabel.textContent = "连接";
                menuUser.textContent = "未连接 CRM";
                btn.dataset.authenticated = "false";
                btn.title = launcherAction ? `连接 CRM 后${launcherAction.label}` : "连接销途 CRM";
                setMenuOpen(false);
            }
            if (!launcherBusy) {
                launcherActionLabel.textContent = launcherAction?.label || "打开采集助手";
                btn.dataset.state = "idle";
                btn.disabled = false;
            }
        };
        btn.onclick = async (event) => {
            const target = event.target;
            if (target.closest(".cc-launcher-account")) {
                event.stopPropagation();
                if (!isLoggedIn()) {
                    await showLoginModal();
                    update();
                    return;
                }
                setMenuOpen(menu.style.display === "none");
                return;
            }
            setMenuOpen(false);
            if (!isLoggedIn()) {
                const loggedIn = await showLoginModal();
                update();
                if (!loggedIn)
                    return;
            }
            await launcherAction?.onClick();
        };
        btn.onkeydown = (event) => {
            if (event.key === "ArrowDown" && isLoggedIn()) {
                event.preventDefault();
                setMenuOpen(true);
            }
        };
        logoutItem.onclick = () => {
            logout();
            setMenuOpen(false);
            update();
            showToast("已退出登录");
        };
        logoutItem.onkeydown = (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                setMenuOpen(false);
                btn.focus();
            }
        };
        document.addEventListener("click", (e) => {
            if (!wrap.contains(e.target))
                setMenuOpen(false);
        });
        refreshAuthWidget = update;
        update();
    }
    /** 初始化：恢复登录态 + 挂载 UI + 注册 ensureAuth 回调 */
    async function initAuth() {
        setAuthEnsurer(showLoginModal);
        loadAuthFromStorage();
        mountAuthWidget();
        if (isLoggedIn()) {
            try {
                await getMe();
                refreshAuthWidget?.();
                console.log("[CC] 已恢复登录:", getAuthUser()?.username);
            }
            catch {
                console.log("[CC] 存储的登录凭证已失效");
                refreshAuthWidget?.();
            }
        }
    }

    // ─── Platform registry ──────────────────────────────
    const platforms = {
        "1688": platform1688,
        alibaba: platformAlibaba,
        aliexpress: platformAliExpress,
    };
    // ─── Add global styles ──────────────────────────────
    GM_addStyle(`
  .cc-collect-btn {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 9999;
    padding: 4px 12px;
    background: #1677ff;
    color: #fff;
    border: none;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    opacity: 0.85;
    transition: opacity 0.2s;
    box-shadow: 0 2px 6px rgba(0,0,0,0.15);
    line-height: 1.4;
  }
  .cc-collect-btn:hover { opacity: 1; }
  .cc-collect-btn.collected { background: #52c41a; }
  .cc-auth-widget {
    position: fixed;
    right: 22px;
    bottom: 22px;
    z-index: 1000000;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
    font-family: Inter, "SF Pro Display", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .cc-launcher-btn {
    position: relative;
    display: flex;
    align-items: center;
    min-height: 58px;
    max-width: min(420px, calc(100vw - 32px));
    padding: 7px 8px 7px 9px;
    overflow: hidden;
    color: #f8fbff;
    background: #10233a;
    border: 1px solid rgba(255,255,255,.14);
    border-radius: 18px;
    box-shadow:
      0 18px 42px rgba(15,35,58,.28),
      0 3px 10px rgba(15,35,58,.18),
      inset 0 1px 0 rgba(255,255,255,.08);
    cursor: pointer;
    text-align: left;
    isolation: isolate;
    transition: transform .22s ease, box-shadow .22s ease, background .22s ease;
  }
  .cc-launcher-btn::after {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: 3px;
    background: #2dd4bf;
    box-shadow: 0 0 18px rgba(45,212,191,.65);
  }
  .cc-launcher-btn:hover {
    transform: translateY(-2px);
    background: #142b47;
    box-shadow:
      0 22px 48px rgba(15,35,58,.32),
      0 4px 12px rgba(15,35,58,.2),
      inset 0 1px 0 rgba(255,255,255,.1);
  }
  .cc-launcher-btn:active { transform: translateY(0) scale(.985); }
  .cc-launcher-btn:focus-visible {
    outline: 3px solid rgba(45,212,191,.42);
    outline-offset: 3px;
  }
  .cc-launcher-btn:disabled {
    cursor: wait;
    transform: none;
    opacity: .84;
  }
  .cc-launcher-btn[data-state="success"]::after { background: #86efac; }
  .cc-launcher-mark {
    display: grid;
    place-items: center;
    width: 39px;
    height: 39px;
    flex: 0 0 39px;
    color: #0f233a;
    background: #2dd4bf;
    border-radius: 12px;
    box-shadow: inset 0 1px 0 rgba(255,255,255,.5);
  }
  .cc-launcher-mark svg,
  .cc-launcher-chevron {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .cc-launcher-copy {
    display: flex;
    flex-direction: column;
    min-width: 116px;
    padding: 0 14px 0 12px;
    line-height: 1;
  }
  .cc-launcher-kicker {
    margin-bottom: 5px;
    color: #86a4c2;
    font-size: 9px;
    font-weight: 750;
    letter-spacing: .15em;
  }
  .cc-launcher-action {
    overflow: hidden;
    color: #fff;
    font-size: 14px;
    font-weight: 680;
    line-height: 1.15;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cc-launcher-rule {
    width: 1px;
    height: 28px;
    flex: 0 0 1px;
    background: rgba(255,255,255,.13);
  }
  .cc-launcher-account {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    max-width: 150px;
    margin-left: 7px;
    padding: 10px 8px;
    border-radius: 11px;
    color: #bfd0e1;
    transition: color .18s ease, background .18s ease;
  }
  .cc-launcher-account:hover {
    color: #fff;
    background: rgba(255,255,255,.08);
  }
  .cc-launcher-status {
    width: 7px;
    height: 7px;
    flex: 0 0 7px;
    background: #fbbf24;
    border-radius: 50%;
    box-shadow: 0 0 0 3px rgba(251,191,36,.13);
  }
  .cc-launcher-btn[data-authenticated="true"] .cc-launcher-status {
    background: #4ade80;
    box-shadow: 0 0 0 3px rgba(74,222,128,.13);
  }
  .cc-launcher-account-label {
    overflow: hidden;
    font-size: 12px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cc-launcher-chevron { flex: 0 0 auto; opacity: .7; }
  .cc-launcher-menu {
    display: none;
    width: min(290px, calc(100vw - 32px));
    padding: 7px;
    background: rgba(255,255,255,.98);
    border: 1px solid rgba(15,35,58,.09);
    border-radius: 16px;
    box-shadow: 0 18px 45px rgba(15,35,58,.2);
    backdrop-filter: blur(16px);
  }
  .cc-launcher-logout {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    width: 100%;
    padding: 10px 11px;
    color: #243b53;
    background: transparent;
    border: 0;
    border-radius: 11px;
    cursor: pointer;
    text-align: left;
  }
  .cc-launcher-logout:hover { background: #f1f5f9; }
  .cc-launcher-logout strong,
  .cc-launcher-logout small { display: block; }
  .cc-launcher-logout strong {
    max-width: 190px;
    overflow: hidden;
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cc-launcher-logout small {
    margin-top: 3px;
    color: #718096;
    font-size: 10px;
  }
  .cc-launcher-logout-label {
    color: #dc4c4c;
    font-size: 12px;
    font-weight: 650;
  }
  @media (max-width: 520px) {
    .cc-auth-widget { right: 12px; bottom: 12px; }
    .cc-launcher-kicker { display: none; }
    .cc-launcher-copy { min-width: 0; padding-left: 10px; }
    .cc-launcher-rule { display: none; }
    .cc-launcher-account { max-width: 92px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .cc-launcher-btn,
    .cc-launcher-account { transition: none; }
  }
`);
    const BATCH_QUEUE_KEY = "cc_batch_collect_queue";
    const BATCH_STOP_KEY = "cc_batch_collect_stop";
    const BATCH_NEXT_DELAY = 1200;
    function loadBatchQueue() {
        try {
            const raw = GM_getValue(BATCH_QUEUE_KEY, undefined);
            if (!raw)
                return null;
            const queue = JSON.parse(raw);
            if (!queue?.items?.length)
                return null;
            if (isBatchStopped(queue)) {
                clearBatchQueue();
                return null;
            }
            if (queue.index >= queue.items.length && !queue.awaitingNextPage)
                return null;
            return queue;
        }
        catch {
            return null;
        }
    }
    function saveBatchQueue(queue) {
        if (isBatchStopped(queue))
            return;
        GM_setValue(BATCH_QUEUE_KEY, JSON.stringify(queue));
    }
    async function flushExtensionStorage() {
        const flush = globalThis.__CC_FLUSH_EXTENSION_STORAGE__;
        await flush?.();
    }
    function clearBatchQueue() {
        GM_deleteValue(BATCH_QUEUE_KEY);
    }
    function clearBatchStopMarker() {
        GM_deleteValue(BATCH_STOP_KEY);
    }
    function markBatchStopped(queue) {
        if (queue?.startedAt) {
            GM_setValue(BATCH_STOP_KEY, queue.startedAt);
        }
        clearBatchQueue();
    }
    function isBatchStopped(queue) {
        try {
            return GM_getValue(BATCH_STOP_KEY, undefined) === queue.startedAt;
        }
        catch {
            return false;
        }
    }
    function getCurrentBatchItem(queue) {
        return queue.items[queue.index] || null;
    }
    function sameProductUrl(a, b) {
        try {
            const au = new URL(a, location.href);
            const bu = new URL(b, location.href);
            return au.origin === bu.origin && au.pathname === bu.pathname;
        }
        catch {
            return a === b;
        }
    }
    function dedupeListItems(items) {
        const seen = new Set();
        const out = [];
        for (const item of items) {
            const key = item.id || item.url;
            if (!item.url || !key || seen.has(key))
                continue;
            seen.add(key);
            out.push(item);
        }
        return out;
    }
    function isValidProduct(product) {
        return !!product && !!(product.title || product.platformId);
    }
    function isIgnoredListCard(el) {
        return !!el.closest(".module-recommendProductTile, .product-recommond-small, .next-slick-vertical");
    }
    function showBatchStatus(queue) {
        if (isBatchStopped(queue))
            return;
        document.querySelector(".cc-batch-status")?.remove();
        const current = getCurrentBatchItem(queue);
        const box = document.createElement("div");
        box.className = "cc-batch-status";
        box.style.cssText = `
    position: fixed; right: 20px; bottom: 140px; z-index: 2147483647;
    width: 260px; padding: 12px 14px; border-radius: 10px;
    background: rgba(0,0,0,0.78); color: #fff;
    font: 13px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    box-shadow: 0 6px 18px rgba(0,0,0,0.22);
    pointer-events: auto;
  `;
        const title = document.createElement("div");
        title.style.cssText = "font-weight:600;margin-bottom:6px;";
        title.textContent = `批量采集中 ${queue.index + 1}/${queue.items.length}`;
        const currentText = document.createElement("div");
        currentText.style.cssText = "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
        currentText.textContent = current?.title || current?.id || "当前商品";
        const stats = document.createElement("div");
        stats.style.cssText = "margin-top:6px;color:#d9f7be;";
        stats.textContent = `成功 ${queue.stats.success} · 重复 ${queue.stats.duplicate} · 失败 ${queue.stats.failed}`;
        box.appendChild(title);
        box.appendChild(currentText);
        box.appendChild(stats);
        const pageText = document.createElement("div");
        pageText.style.cssText = "margin-top:4px;color:#b7ebff;";
        pageText.textContent = `当前第 ${queue.pageIndex || 1} 页${queue.maxPages ? ` / 共 ${queue.maxPages} 页` : " / 全部页"}`;
        box.appendChild(pageText);
        if (queue.reprice) {
            const repriceText = document.createElement("div");
            repriceText.style.cssText = "margin-top:4px;color:#ffd666;";
            repriceText.textContent = `改价 ${queue.reprice.sourceCurrency}->${queue.reprice.targetCurrency} ×${queue.reprice.profit}`;
            box.appendChild(repriceText);
        }
        const stopBtn = document.createElement("button");
        stopBtn.textContent = "停止";
        stopBtn.style.cssText = `
    margin-top: 8px; padding: 4px 10px; border: 1px solid rgba(255,255,255,0.45);
    border-radius: 6px; background: transparent; color: #fff; cursor: pointer;
    pointer-events: auto;
  `;
        stopBtn.onclick = () => {
            markBatchStopped(queue);
            box.remove();
            showToast("已停止批量采集");
        };
        box.appendChild(stopBtn);
        document.body.appendChild(box);
    }
    function goToNextBatchItem(platform, queue) {
        if (isBatchStopped(queue))
            return;
        queue.index += 1;
        if (queue.index >= queue.items.length) {
            if (queue.autoNextPage && queue.sourceListUrl) {
                if (queue.maxPages && (queue.pageIndex || 1) >= queue.maxPages) {
                    clearBatchQueue();
                    showToast(`批量采集完成：已达到 ${queue.maxPages} 页；成功 ${queue.stats.success}，重复 ${queue.stats.duplicate}，失败 ${queue.stats.failed}`);
                    return;
                }
                queue.awaitingNextPage = true;
                saveBatchQueue(queue);
                showBatchStatus(queue);
                setTimeout(() => {
                    if (isBatchStopped(queue))
                        return;
                    if (queue.sourceListUrl) {
                        location.href = queue.sourceListUrl;
                    }
                }, BATCH_NEXT_DELAY);
                return;
            }
            clearBatchQueue();
            showToast(`批量采集完成：成功 ${queue.stats.success}，重复 ${queue.stats.duplicate}，失败 ${queue.stats.failed}`);
            return;
        }
        saveBatchQueue(queue);
        showBatchStatus(queue);
        setTimeout(() => {
            if (isBatchStopped(queue))
                return;
            const next = getCurrentBatchItem(queue);
            if (next?.url)
                location.href = next.url;
        }, BATCH_NEXT_DELAY);
    }
    function getItemSignature(items) {
        return items.map((item) => item.id || item.url).filter(Boolean).join("|");
    }
    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    function cloneProduct(product) {
        return JSON.parse(JSON.stringify(product));
    }
    function defaultBatchSourceCurrency(platformCode) {
        if (platformCode === "1688")
            return "CNY";
        if (platformCode === "alibaba" || platformCode === "aliexpress")
            return "USD";
        return "CNY";
    }
    function formatStoreOption(store) {
        return `${store.name}（${store.targetPlatform}${store.sellerAccount ? ` · ${store.sellerAccount}` : ""}）`;
    }
    function getStoreCategoryOptions(store) {
        const options = [];
        const seen = new Set();
        const defaultCategoryId = String(store?.config?.defaultCategoryId || "").trim();
        const defaultCategoryName = (store?.config?.commonCategories || []).find((item) => String(item.categoryId || "").trim() === defaultCategoryId)?.name;
        const add = (categoryId, name) => {
            const id = String(categoryId || "").trim();
            if (!id || seen.has(id))
                return;
            seen.add(id);
            options.push({ id, label: name ? `${name} (${id})` : id });
        };
        add(defaultCategoryId, defaultCategoryName || "默认类目");
        for (const item of store?.config?.commonCategories || []) {
            add(item.categoryId, item.name);
        }
        return options;
    }
    async function showBatchCollectDialog(itemCount, canAutoNextPage, platformCode) {
        let listingStores = [];
        let storeLoadError = "";
        try {
            listingStores = await listListingStores();
        }
        catch (err) {
            storeLoadError = err instanceof Error ? err.message : "获取店铺列表失败";
        }
        const savedAutoDraft = loadAutoDraftSettings();
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 1000001;
      background: rgba(0,0,0,0.42); display: flex;
      align-items: center; justify-content: center;
      padding: 16px; box-sizing: border-box; overflow: hidden;
      overscroll-behavior: contain;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
            const panel = document.createElement("div");
            panel.style.cssText = `
      width: 440px; max-width: calc(100vw - 32px); background: #fff;
      max-height: calc(100dvh - 32px); overflow-y: auto;
      border-radius: 12px; padding: 18px 18px 0; box-shadow: 0 12px 36px rgba(0,0,0,0.22);
      color: #1f1f1f; box-sizing: border-box; overscroll-behavior: contain;
    `;
            const title = document.createElement("div");
            title.style.cssText = "font-size:17px;font-weight:700;margin-bottom:8px;";
            title.textContent = canAutoNextPage ? "确认采集多页商品" : "确认采集本页商品";
            panel.appendChild(title);
            const desc = document.createElement("div");
            desc.style.cssText = "font-size:13px;color:#666;line-height:1.6;margin-bottom:14px;";
            desc.textContent = `将自动跳转并采集当前列表中的 ${itemCount} 个商品${canAutoNextPage ? "，本页完成后会自动翻页继续采集" : ""}。`;
            panel.appendChild(desc);
            const pageSection = document.createElement("div");
            pageSection.style.cssText = `
      padding: 12px; border: 1px solid #f0f0f0; border-radius: 8px;
      background: #fafafa; margin-bottom: 14px;
    `;
            const pageLabel = document.createElement("label");
            pageLabel.style.cssText = "display:block;font-size:13px;font-weight:600;margin-bottom:6px;";
            pageLabel.textContent = "采集页数";
            pageSection.appendChild(pageLabel);
            const pageInput = document.createElement("input");
            pageInput.type = "number";
            pageInput.min = "1";
            pageInput.step = "1";
            pageInput.placeholder = canAutoNextPage ? "不填则采集全部页" : "当前平台仅采集本页";
            pageInput.disabled = !canAutoNextPage;
            pageInput.style.cssText = `
      width: 100%; box-sizing: border-box; padding: 8px 10px;
      border: 1px solid #d9d9d9; border-radius: 6px; font-size: 13px;
      background: #fff;
    `;
            pageSection.appendChild(pageInput);
            const pageHint = document.createElement("div");
            pageHint.style.cssText = "font-size:12px;color:#666;line-height:1.5;margin-top:7px;";
            pageHint.textContent = canAutoNextPage
                ? "例如填写 3，则从当前页开始最多采集 3 页；留空会持续翻页直到没有下一页。"
                : "当前页面没有识别到下一页能力，只会采集本页商品。";
            pageSection.appendChild(pageHint);
            panel.appendChild(pageSection);
            const repriceSection = document.createElement("div");
            repriceSection.style.cssText = `
      padding: 12px; border: 1px solid #d6e4ff; border-radius: 8px;
      background: #f8fbff; margin-bottom: 14px;
    `;
            const repriceLabel = document.createElement("label");
            repriceLabel.style.cssText = "display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;cursor:pointer;color:#1d39c4;";
            const repriceCheckbox = document.createElement("input");
            repriceCheckbox.type = "checkbox";
            repriceLabel.appendChild(repriceCheckbox);
            repriceLabel.appendChild(document.createTextNode("批量改价"));
            repriceSection.appendChild(repriceLabel);
            const repriceHint = document.createElement("div");
            repriceHint.style.cssText = "font-size:12px;color:#597ef7;line-height:1.5;margin:7px 0 8px 22px;";
            repriceHint.textContent = "开启后，每个商品提交前都会按：原价 × 汇率 × 利润系数 改价。1688 默认识别为 CNY。";
            repriceSection.appendChild(repriceHint);
            const repriceGrid = document.createElement("div");
            repriceGrid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;";
            const inputStyle = "width:100%;box-sizing:border-box;padding:7px 8px;border:1px solid #adc6ff;border-radius:6px;background:#fff;font-size:13px;";
            const wrapInput = (label, input) => {
                const wrap = document.createElement("label");
                wrap.style.cssText = "display:flex;flex-direction:column;gap:4px;font-size:12px;color:#666;";
                const span = document.createElement("span");
                span.textContent = label;
                wrap.appendChild(span);
                wrap.appendChild(input);
                return wrap;
            };
            const sourceCurrencySelect = document.createElement("select");
            sourceCurrencySelect.style.cssText = inputStyle;
            const targetCurrencySelect = document.createElement("select");
            targetCurrencySelect.style.cssText = inputStyle;
            for (const code of ["CNY", "USD", "EUR", "GBP", "JPY", "HKD"]) {
                const sourceOpt = document.createElement("option");
                sourceOpt.value = code;
                sourceOpt.textContent = code;
                sourceCurrencySelect.appendChild(sourceOpt);
                const targetOpt = document.createElement("option");
                targetOpt.value = code;
                targetOpt.textContent = code;
                targetCurrencySelect.appendChild(targetOpt);
            }
            sourceCurrencySelect.value = defaultBatchSourceCurrency(platformCode);
            targetCurrencySelect.value = "USD";
            const profitInput = document.createElement("input");
            profitInput.type = "number";
            profitInput.min = "0.01";
            profitInput.step = "0.01";
            profitInput.value = "1.3";
            profitInput.style.cssText = inputStyle;
            const rateInput = document.createElement("input");
            rateInput.type = "number";
            rateInput.min = "0.000001";
            rateInput.step = "0.000001";
            rateInput.placeholder = "自动获取";
            rateInput.style.cssText = inputStyle;
            rateInput.value = sourceCurrencySelect.value === targetCurrencySelect.value ? "1" : "";
            repriceGrid.appendChild(wrapInput("源币种", sourceCurrencySelect));
            repriceGrid.appendChild(wrapInput("目标币种", targetCurrencySelect));
            repriceGrid.appendChild(wrapInput("利润系数", profitInput));
            repriceGrid.appendChild(wrapInput("汇率", rateInput));
            repriceSection.appendChild(repriceGrid);
            const repriceActions = document.createElement("div");
            repriceActions.style.cssText = "display:flex;justify-content:flex-end;margin-top:8px;";
            const fetchRateBtn = document.createElement("button");
            fetchRateBtn.type = "button";
            fetchRateBtn.textContent = "获取汇率";
            fetchRateBtn.style.cssText = "padding:6px 10px;border:1px solid #adc6ff;border-radius:6px;background:#fff;color:#1d39c4;cursor:pointer;";
            repriceActions.appendChild(fetchRateBtn);
            repriceSection.appendChild(repriceActions);
            const syncRepriceUi = () => {
                const enabled = repriceCheckbox.checked;
                for (const el of [sourceCurrencySelect, targetCurrencySelect, profitInput, rateInput, fetchRateBtn]) {
                    el.disabled = !enabled;
                    el.style.opacity = enabled ? "1" : "0.55";
                }
                repriceSection.style.background = enabled ? "#f8fbff" : "#fafafa";
                repriceSection.style.borderColor = enabled ? "#d6e4ff" : "#f0f0f0";
            };
            const syncBatchRate = async () => {
                const from = sourceCurrencySelect.value;
                const to = targetCurrencySelect.value;
                if (from === to) {
                    rateInput.value = "1";
                    return 1;
                }
                fetchRateBtn.textContent = "读取中...";
                fetchRateBtn.disabled = true;
                try {
                    const result = await getExchangeRate(from, to);
                    rateInput.value = String(result.rate);
                    repriceHint.textContent = `汇率：1 ${from} = ${result.rate} ${to}${result.date ? `（${result.date}）` : ""}，来源：${result.source || "system"}`;
                    return result.rate;
                }
                catch (err) {
                    repriceHint.textContent = `汇率自动获取失败，可手动填写汇率：${err instanceof Error ? err.message : String(err)}`;
                    throw err;
                }
                finally {
                    fetchRateBtn.textContent = "获取汇率";
                    fetchRateBtn.disabled = !repriceCheckbox.checked;
                }
            };
            fetchRateBtn.onclick = () => {
                void syncBatchRate();
            };
            repriceCheckbox.onchange = syncRepriceUi;
            sourceCurrencySelect.onchange = () => {
                rateInput.value = sourceCurrencySelect.value === targetCurrencySelect.value ? "1" : "";
            };
            targetCurrencySelect.onchange = () => {
                rateInput.value = sourceCurrencySelect.value === targetCurrencySelect.value ? "1" : "";
            };
            syncRepriceUi();
            panel.appendChild(repriceSection);
            const autoDraftSection = document.createElement("div");
            autoDraftSection.style.cssText = `
      padding: 12px; border: 1px solid #f0f0f0; border-radius: 8px;
      background: #fafafa; margin-bottom: 14px;
    `;
            const checkboxLabel = document.createElement("label");
            checkboxLabel.style.cssText = "display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;cursor:pointer;";
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = Boolean(savedAutoDraft.enabled && savedAutoDraft.storeId && listingStores.some((s) => s.id === savedAutoDraft.storeId));
            checkbox.disabled = listingStores.length === 0;
            checkboxLabel.appendChild(checkbox);
            checkboxLabel.appendChild(document.createTextNode("AI处理成功后自动创建平台草稿"));
            autoDraftSection.appendChild(checkboxLabel);
            const hint = document.createElement("div");
            hint.style.cssText = "font-size:12px;color:#666;line-height:1.5;margin:7px 0 8px 22px;";
            hint.textContent = storeLoadError || "采集完成后等待 AI Agent 标记可上架，再自动上架到所选店铺的平台草稿箱。";
            autoDraftSection.appendChild(hint);
            const select = document.createElement("select");
            select.style.cssText = `
      width: 100%; box-sizing: border-box; padding: 8px 10px;
      border: 1px solid #d9d9d9; border-radius: 6px; font-size: 13px;
      background: #fff;
    `;
            if (listingStores.length === 0) {
                const opt = document.createElement("option");
                opt.value = "";
                opt.textContent = storeLoadError || "暂无可用店铺，请先到管理系统添加/启用店铺";
                select.appendChild(opt);
            }
            else {
                for (const store of listingStores) {
                    const opt = document.createElement("option");
                    opt.value = store.id;
                    opt.textContent = formatStoreOption(store);
                    select.appendChild(opt);
                }
                select.value = savedAutoDraft.storeId && listingStores.some((s) => s.id === savedAutoDraft.storeId)
                    ? savedAutoDraft.storeId
                    : listingStores[0].id;
            }
            autoDraftSection.appendChild(select);
            const categorySelect = document.createElement("select");
            categorySelect.style.cssText = `
      width: 100%; box-sizing: border-box; padding: 8px 10px;
      border: 1px solid #d9d9d9; border-radius: 6px; font-size: 13px;
      background: #fff; margin-top: 8px;
    `;
            const syncCategorySelect = () => {
                categorySelect.innerHTML = "";
                const store = listingStores.find((item) => item.id === select.value);
                const categories = getStoreCategoryOptions(store);
                if (categories.length === 0) {
                    const opt = document.createElement("option");
                    opt.value = "";
                    opt.textContent = "使用店铺默认发品类目";
                    categorySelect.appendChild(opt);
                    return;
                }
                if (platformCode === "alibaba") {
                    const sourceOpt = document.createElement("option");
                    sourceOpt.value = "";
                    sourceOpt.textContent = "自动使用源商品类目（采集失败时使用店铺默认类目）";
                    categorySelect.appendChild(sourceOpt);
                }
                for (const category of categories) {
                    const opt = document.createElement("option");
                    opt.value = category.id;
                    opt.textContent = category.label;
                    categorySelect.appendChild(opt);
                }
                categorySelect.value =
                    savedAutoDraft.categoryId && categories.some((item) => item.id === savedAutoDraft.categoryId)
                        ? savedAutoDraft.categoryId
                        : platformCode === "alibaba"
                            ? ""
                            : categories[0].id;
            };
            syncCategorySelect();
            autoDraftSection.appendChild(categorySelect);
            const syncAutoDraftUi = () => {
                const enabled = checkbox.checked && listingStores.length > 0;
                select.disabled = !enabled;
                categorySelect.disabled = !enabled;
                select.style.opacity = enabled ? "1" : "0.55";
                categorySelect.style.opacity = enabled ? "1" : "0.55";
                autoDraftSection.style.background = enabled ? "#f6ffed" : "#fafafa";
                autoDraftSection.style.borderColor = enabled ? "#b7eb8f" : "#f0f0f0";
            };
            checkbox.onchange = syncAutoDraftUi;
            select.onchange = () => {
                syncCategorySelect();
                syncAutoDraftUi();
            };
            syncAutoDraftUi();
            panel.appendChild(autoDraftSection);
            const actions = document.createElement("div");
            actions.style.cssText = "display:flex;justify-content:flex-end;gap:8px;position:sticky;bottom:0;background:#fff;padding:12px 0 16px;border-top:1px solid #f0f0f0;z-index:2;";
            const cancelBtn = document.createElement("button");
            cancelBtn.textContent = "取消";
            cancelBtn.style.cssText = "padding:8px 14px;border:1px solid #d9d9d9;border-radius:6px;background:#fff;cursor:pointer;";
            cancelBtn.onclick = () => {
                overlay.remove();
                resolve(null);
            };
            const startBtn = document.createElement("button");
            startBtn.textContent = "开始采集";
            startBtn.style.cssText = "padding:8px 16px;border:0;border-radius:6px;background:#1677ff;color:#fff;cursor:pointer;font-weight:600;";
            startBtn.onclick = async () => {
                const autoDraftStoreId = checkbox.checked && listingStores.length > 0 ? select.value || null : null;
                const autoDraftCategoryId = autoDraftStoreId ? categorySelect.value || null : null;
                const maxPagesRaw = Number(pageInput.value);
                const maxPages = canAutoNextPage && Number.isFinite(maxPagesRaw) && maxPagesRaw >= 1
                    ? Math.floor(maxPagesRaw)
                    : null;
                let reprice = null;
                if (repriceCheckbox.checked) {
                    const profit = Number(profitInput.value);
                    if (!Number.isFinite(profit) || profit <= 0) {
                        repriceHint.textContent = "利润系数需要大于 0";
                        return;
                    }
                    let rate = Number(rateInput.value);
                    if (!Number.isFinite(rate) || rate <= 0) {
                        try {
                            rate = await syncBatchRate();
                        }
                        catch {
                            return;
                        }
                    }
                    reprice = {
                        sourceCurrency: sourceCurrencySelect.value,
                        targetCurrency: targetCurrencySelect.value,
                        rate,
                        profit,
                    };
                }
                saveAutoDraftSettings({
                    enabled: Boolean(autoDraftStoreId),
                    storeId: autoDraftStoreId || undefined,
                    categoryId: autoDraftCategoryId || undefined,
                });
                overlay.remove();
                resolve({ autoDraftStoreId, autoDraftCategoryId, maxPages, reprice });
            };
            actions.appendChild(cancelBtn);
            actions.appendChild(startBtn);
            panel.appendChild(actions);
            overlay.appendChild(panel);
            document.body.appendChild(overlay);
        });
    }
    async function waitForListItems(platform, timeout = platform.code === "1688" ? 20000 : 8000) {
        const startedAt = Date.now();
        let items = [];
        while (Date.now() - startedAt < timeout) {
            items = dedupeListItems(platform.extractListItems?.() || []);
            if (items.length > 0)
                return items;
            if (platform.code === "1688") {
                window.scrollBy(0, Math.min(window.innerHeight * 0.45, 420));
            }
            await sleep(500);
        }
        return items;
    }
    function waitForListItemsChanged(platform, previousSignature, timeout = 15000) {
        const startedAt = Date.now();
        return new Promise((resolve) => {
            const check = () => {
                const items = dedupeListItems(platform.extractListItems?.() || []);
                const signature = getItemSignature(items);
                if (items.length > 0 && signature && signature !== previousSignature) {
                    resolve(items);
                    return;
                }
                if (Date.now() - startedAt >= timeout) {
                    resolve(items);
                    return;
                }
                setTimeout(check, 500);
            };
            check();
        });
    }
    async function continueBatchOnNextListPage(platform, queue) {
        if (isBatchStopped(queue))
            return true;
        if (!queue.awaitingNextPage)
            return false;
        showBatchStatus(queue);
        const queueSignature = getItemSignature(queue.items);
        const currentItems = dedupeListItems(platform.extractListItems?.() || []);
        const currentSignature = getItemSignature(currentItems);
        const currentSeen = new Set(queue.seenIds || queue.items.map((item) => item.id));
        const currentFreshItems = currentItems.filter((item) => {
            const key = item.id || item.url;
            return !!key && !currentSeen.has(key);
        });
        if (currentFreshItems.length > 0 && currentSignature !== queueSignature) {
            for (const item of currentFreshItems) {
                currentSeen.add(item.id || item.url);
            }
            queue.items = currentFreshItems;
            queue.index = 0;
            queue.awaitingNextPage = false;
            queue.pageIndex = (queue.pageIndex || 1) + 1;
            queue.sourceListUrl = location.href;
            queue.seenIds = Array.from(currentSeen);
            saveBatchQueue(queue);
            showBatchStatus(queue);
            setTimeout(() => {
                if (isBatchStopped(queue))
                    return;
                const next = getCurrentBatchItem(queue);
                if (next?.url)
                    location.href = next.url;
            }, BATCH_NEXT_DELAY);
            return true;
        }
        if (!platform.hasNextListPage?.() || !platform.goToNextListPage) {
            clearBatchQueue();
            showToast(`批量采集完成：成功 ${queue.stats.success}，重复 ${queue.stats.duplicate}，失败 ${queue.stats.failed}`);
            return true;
        }
        const previousItems = dedupeListItems(platform.extractListItems?.() || []);
        const previousSignature = getItemSignature(previousItems);
        platform.goToNextListPage();
        const nextItems = await waitForListItemsChanged(platform, previousSignature);
        const seen = new Set(queue.seenIds || queue.items.map((item) => item.id));
        const freshItems = nextItems.filter((item) => {
            const key = item.id || item.url;
            if (!key || seen.has(key))
                return false;
            seen.add(key);
            return true;
        });
        if (freshItems.length === 0) {
            clearBatchQueue();
            showToast(`批量采集完成：成功 ${queue.stats.success}，重复 ${queue.stats.duplicate}，失败 ${queue.stats.failed}`);
            return true;
        }
        queue.items = freshItems;
        queue.index = 0;
        queue.awaitingNextPage = false;
        queue.pageIndex = (queue.pageIndex || 1) + 1;
        queue.sourceListUrl = location.href;
        queue.seenIds = Array.from(seen);
        saveBatchQueue(queue);
        showBatchStatus(queue);
        setTimeout(() => {
            if (isBatchStopped(queue))
                return;
            const next = getCurrentBatchItem(queue);
            if (next?.url)
                location.href = next.url;
        }, BATCH_NEXT_DELAY);
        return true;
    }
    async function collectCurrentProductForBatch(platform, queue) {
        if (isBatchStopped(queue))
            return;
        showBatchStatus(queue);
        const current = getCurrentBatchItem(queue);
        if (current?.url && !sameProductUrl(location.href, current.url)) {
            location.href = current.url;
            return;
        }
        let product = null;
        try {
            product = await platform.extract();
        }
        catch (err) {
            console.error("[CC] Batch extract failed:", err);
        }
        if (!isValidProduct(product)) {
            if (isBatchStopped(queue))
                return;
            queue.stats.failed += 1;
            showToast("当前商品提取失败，继续下一个", "error");
            goToNextBatchItem(platform, queue);
            return;
        }
        try {
            if (isBatchStopped(queue))
                return;
            if (queue.reprice) {
                const originalProduct = cloneProduct(product);
                applyPanelReprice(product, originalProduct, {
                    rate: queue.reprice.rate,
                    profit: queue.reprice.profit,
                    targetCurrency: queue.reprice.targetCurrency,
                });
            }
            const submitOptions = queue.autoDraftStoreId !== undefined
                ? {
                    autoDraftStoreId: queue.autoDraftStoreId,
                    autoDraftCategoryId: queue.autoDraftCategoryId,
                }
                : undefined;
            const res = await submitProduct(product, submitOptions);
            if (res.code === 409) {
                queue.stats.duplicate += 1;
                showToast("商品已存在，继续下一个");
            }
            else {
                queue.stats.success += 1;
                showToast("采集成功，继续下一个");
            }
        }
        catch (err) {
            if (isBatchStopped(queue))
                return;
            queue.stats.failed += 1;
            console.error("[CC] Batch submit failed:", err);
            showToast("提交失败，继续下一个", "error");
        }
        if (isBatchStopped(queue))
            return;
        goToNextBatchItem(platform, queue);
    }
    async function startBatchCollect(platform) {
        const launcherLabel = platform.goToNextListPage ? "采集多页商品" : "采集本页商品";
        setLauncherState("正在读取商品…", "busy");
        const items = await waitForListItems(platform);
        setLauncherState(launcherLabel);
        if (items.length === 0) {
            showToast("未找到可采集的商品", "error");
            return;
        }
        const options = await showBatchCollectDialog(items.length, !!platform.goToNextListPage, platform.code);
        if (!options)
            return;
        clearBatchStopMarker();
        const queue = {
            platformCode: platform.code,
            startedAt: new Date().toISOString(),
            sourceListUrl: location.href,
            autoNextPage: !!platform.goToNextListPage,
            maxPages: options.maxPages,
            awaitingNextPage: false,
            autoDraftStoreId: options.autoDraftStoreId,
            autoDraftCategoryId: options.autoDraftCategoryId,
            reprice: options.reprice,
            pageIndex: 1,
            seenIds: items.map((item) => item.id || item.url).filter(Boolean),
            index: 0,
            items,
            stats: { success: 0, duplicate: 0, failed: 0 },
        };
        saveBatchQueue(queue);
        showBatchStatus(queue);
        await flushExtensionStorage();
        location.href = items[0].url;
    }
    // ─── Handle detail page ─────────────────────────────
    function handleDetailPage(platform) {
        setLauncherAction({
            label: "采集此商品",
            title: "采集此商品到管理系统",
            onClick: async () => {
                setLauncherState("正在提取商品…", "busy");
                let product;
                try {
                    product = await platform.extract();
                }
                catch (err) {
                    console.error("[CC] 提取异常:", err);
                    showToast("提取商品信息失败，请刷新页面后重试", "error");
                    setLauncherState();
                    return;
                }
                if (!product || (!product.title && !product.platformId)) {
                    showToast("提取商品信息失败，请确认页面已完全加载", "error");
                    setLauncherState();
                    return;
                }
                setLauncherState();
                const confirmed = await showCollectorPanel(product);
                if (confirmed) {
                    setLauncherState("已采集", "success");
                    showToast("采集成功！");
                    window.setTimeout(() => setLauncherState(), 1800);
                }
            },
        });
    }
    // ─── Handle list page ───────────────────────────────
    function handleListPage(platform) {
        if (!platform.extractListItems || platform.isDetailPage() || !platform.isListPage())
            return;
        setLauncherAction({
            label: platform.goToNextListPage ? "采集多页商品" : "采集本页商品",
            title: platform.goToNextListPage ? "批量采集当前及后续页面商品" : "批量采集本页商品",
            onClick: () => startBatchCollect(platform),
        });
        // 在每个商品卡片上叠加采集按钮
        const injectListButtons = () => {
            const items = platform.extractListItems?.();
            if (!items)
                return;
            const cards = document.querySelectorAll(".offer-card, .sm-offer-card, [class*='offer-card'], .item-card, .feni-card, " +
                "[class*='card-item'], .list-item, .search-card, .product-card, " +
                ".icbu-product-card.product-item, [data-cc-list-card]");
            Array.from(cards).filter((el) => !isIgnoredListCard(el)).forEach((el, i) => {
                if (i >= items.length)
                    return;
                if (el.querySelector(".cc-collect-btn"))
                    return;
                // 确保元素 position 非 static，以便按钮定位
                const pos = getComputedStyle(el).position;
                if (pos === "static") {
                    el.style.position = "relative";
                }
                const btn = document.createElement("button");
                btn.className = "cc-collect-btn";
                btn.textContent = "📥 采集";
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const link = el.querySelector("a[href]");
                    if (link) {
                        const href = link.getAttribute("href") || "";
                        const fullUrl = href.startsWith("http") ? href : new URL(href, location.origin).href;
                        window.open(fullUrl, "_blank");
                        showToast("已在新标签页打开商品详情");
                    }
                });
                el.appendChild(btn);
            });
        };
        // 延迟执行等待懒加载
        setTimeout(injectListButtons, 1500);
        // 滚动时重新注入（处理懒加载新卡片）
        let scrollTimer;
        window.addEventListener("scroll", () => {
            clearTimeout(scrollTimer);
            scrollTimer = setTimeout(injectListButtons, 500);
        }, { passive: true });
    }
    // ─── 等待数据就绪 ────────────────────────────────────
    /**
     * 等待页面数据就绪（window.context 可用或 DOM 渲染完成）
     * 返回 true 表示可以开始采集，false 表示超时
     */
    function waitForPageReady(platform) {
        // 如果是 1688，优先检查 window.context
        if (platform.code === "1688") {
            return new Promise((resolve) => {
                const isReady = () => {
                    try {
                        const data = get1688ContextData();
                        if (data) {
                            const sku = getDataJson(data)?.skuModel || findSkuModel(data);
                            const gallery = data.gallery || data.Gallery;
                            const hasGallery = gallery &&
                                typeof gallery === "object" &&
                                gallery.fields?.offerImgList;
                            if (sku || hasGallery) {
                                console.log("[CC] window.context 已就绪（unsafeWindow）");
                                return true;
                            }
                        }
                        const title = document.querySelector(".d-title h1, .mod-detail-title .title, .detail-title, [class*='title-text']");
                        if (title?.textContent?.trim())
                            return true;
                    }
                    catch {
                        // ignore
                    }
                    return false;
                };
                const check = () => {
                    if (isReady())
                        return resolve(true);
                    setTimeout(check, 200);
                };
                check();
                setTimeout(() => {
                    console.log("[CC] 等待超时，尝试继续");
                    resolve(true);
                }, 15000);
            });
        }
        // 阿里国际站：detailData 或标题模块
        if (platform.code === "alibaba") {
            return new Promise((resolve) => {
                const check = () => {
                    if (isAlibabaPageReady()) {
                        console.log("[CC] Alibaba PDP 已就绪");
                        resolve(true);
                        return;
                    }
                    setTimeout(check, 200);
                };
                check();
                setTimeout(() => {
                    console.log("[CC] 等待超时，尝试继续");
                    resolve(true);
                }, 15000);
            });
        }
        // 速卖通：_d_c_ 数据或标题模块
        if (platform.code === "aliexpress") {
            return new Promise((resolve) => {
                const check = () => {
                    if (isAliExpressPageReady()) {
                        console.log("[CC] AliExpress PDP 已就绪");
                        resolve(true);
                        return;
                    }
                    setTimeout(check, 200);
                };
                check();
                setTimeout(() => {
                    console.log("[CC] 等待超时，尝试继续");
                    resolve(true);
                }, 15000);
            });
        }
        // 其他平台：检查 DOM 标题
        return new Promise((resolve) => {
            const check = async () => {
                const product = await platform.extract();
                if (product && product.title) {
                    resolve(true);
                    return;
                }
                setTimeout(check, 300);
            };
            check();
            setTimeout(() => {
                console.log("[CC] 等待超时，尝试继续");
                resolve(true);
            }, 10000);
        });
    }
    /** 仅在顶层窗口注入 UI，避免同源 iframe / 悬浮层内重复出现按钮 */
    function isTopFrame() {
        try {
            return window.self === window.top;
        }
        catch {
            return false;
        }
    }
    // ─── Initialize ─────────────────────────────────────
    (async function init() {
        if (!isTopFrame())
            return;
        console.log("[CC] 商品采集器 v1.1 已加载");
        await initAuth();
        const code = detectPlatform();
        const platform = platforms[code];
        if (!platform) {
            console.log("[CC] 未识别当前平台:", location.hostname);
            return;
        }
        console.log(`[CC] ✅ 已识别平台: ${platform.name}`);
        let resumeTimer;
        const resumeBatchOnListPage = () => {
            if (platform.isDetailPage() || !platform.isListPage())
                return;
            clearTimeout(resumeTimer);
            resumeTimer = setTimeout(() => {
                if (platform.isDetailPage() || !platform.isListPage())
                    return;
                handleListPage(platform);
                const activeBatchQueue = loadBatchQueue();
                if (activeBatchQueue?.platformCode === platform.code) {
                    void continueBatchOnNextListPage(platform, activeBatchQueue);
                }
            }, 300);
        };
        window.addEventListener("pageshow", resumeBatchOnListPage);
        window.addEventListener("cc:resume-batch", resumeBatchOnListPage);
        let listDetectStartedAt = 0;
        const waitAndHandleListPage = () => {
            if (!platform.extractListItems)
                return;
            if (!listDetectStartedAt)
                listDetectStartedAt = Date.now();
            if (platform.isDetailPage())
                return;
            if (platform.isListPage()) {
                handleListPage(platform);
                const activeBatchQueue = loadBatchQueue();
                if (activeBatchQueue?.platformCode === platform.code) {
                    void continueBatchOnNextListPage(platform, activeBatchQueue);
                }
                return;
            }
            if (Date.now() - listDetectStartedAt < 15000) {
                setTimeout(waitAndHandleListPage, 500);
            }
        };
        const batchQueue = loadBatchQueue();
        if (batchQueue && batchQueue.platformCode !== platform.code) {
            clearBatchQueue();
        }
        if (platform.isDetailPage()) {
            await waitForPageReady(platform);
            const activeBatchQueue = loadBatchQueue();
            if (activeBatchQueue?.platformCode === platform.code) {
                await collectCurrentProductForBatch(platform, activeBatchQueue);
                return;
            }
            handleDetailPage(platform);
        }
        else if (platform.isListPage()) {
            handleListPage(platform);
            const activeBatchQueue = loadBatchQueue();
            if (activeBatchQueue?.platformCode === platform.code) {
                if (await continueBatchOnNextListPage(platform, activeBatchQueue)) {
                    return;
                }
                showBatchStatus(activeBatchQueue);
            }
        }
        else {
            waitAndHandleListPage();
            console.log("[CC] 当前页面不是商品详情页也不是列表页");
        }
    })();

})();
