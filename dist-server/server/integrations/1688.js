import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { config } from '../config.js';
import { db } from '../db.js';
import JSONbigFactory from 'json-bigint';
const json = JSONbigFactory({ storeAsString: true, protoAction: 'error', constructorAction: 'error' });
export const parsePlatformJson = (value) => json.parse(value);
export class IntegrationError extends Error {
    code;
    statusCode;
    constructor(code, message, statusCode = 502) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
    }
}
export const publicConnectionColumns = 'id,app_key,ali_id,member_id,login_id,display_name,access_expires_at,refresh_expires_at,status,member_capability,last_tested_at,last_refreshed_at,created_at,updated_at';
export const stateHash = (value) => createHash('sha256').update(value).digest('hex');
export function appCredentials() {
    if (!config.ALI1688_APP_KEY || !config.ALI1688_APP_SECRET || !config.ALI1688_REDIRECT_URI) {
        throw new IntegrationError('NOT_CONFIGURED', '1688 应用尚未配置。', 503);
    }
    return { appKey: config.ALI1688_APP_KEY, secret: config.ALI1688_APP_SECRET, redirect: config.ALI1688_REDIRECT_URI };
}
async function encryptionKey() {
    if (config.ALI1688_TOKEN_ENCRYPTION_KEY)
        return Buffer.from(config.ALI1688_TOKEN_ENCRYPTION_KEY, 'hex');
    if (config.NODE_ENV === 'production')
        throw new IntegrationError('KEY_MISSING', '生产环境需要配置独立令牌加密密钥。', 503);
    const path = '.1688-key.local';
    try {
        return validateKey(await readFile(path));
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
        const key = randomBytes(32);
        try {
            await writeFile(path, key, { mode: 0o600, flag: 'wx' });
            return key;
        }
        catch (writeError) {
            if (writeError.code === 'EEXIST')
                return validateKey(await readFile(path));
            throw writeError;
        }
    }
}
function validateKey(key) {
    if (key.length !== 32)
        throw new IntegrationError('KEY_INVALID', '本地令牌加密密钥无效。', 503);
    return key;
}
export async function encryptGrant(grant) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', await encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(grant), 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64')).join('.');
}
export async function decryptGrant(encoded) {
    const [iv, tag, data] = encoded.split('.').map(part => Buffer.from(part, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', await encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
}
export function signApi(path, params, secret) {
    const data = path + Object.keys(params).filter(key => key !== '_aop_signature').sort().map(key => key + params[key]).join('');
    return createHmac('sha1', secret).update(data, 'utf8').digest('hex').toUpperCase();
}
export function parseRefreshExpiry(value) {
    if (!value)
        return null;
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{3})?([+-]\d{2})(\d{2})$/.exec(value);
    const date = new Date(match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.${match[7] || '000'}${match[8]}:${match[9]}` : value);
    if (Number.isNaN(date.getTime()))
        throw new IntegrationError('INVALID_EXPIRY', '平台返回的刷新令牌有效期无法解析。');
    return date;
}
// Accept only the known gateway. Credentials never enter a query string or redirect.
async function gateway(path, params, image) {
    let response;
    try {
        let body = new URLSearchParams(params);
        if (image) {
            body = new FormData();
            for (const [key, value] of Object.entries(params))
                body.append(key, value);
            body.append('imageBytes', new Blob([new Uint8Array(image.bytes)], { type: image.type }), image.name);
        }
        response = await fetch(`https://gw.open.1688.com/openapi/${path}`, {
            method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(20_000),
        });
    }
    catch {
        throw new IntegrationError('NETWORK_ERROR', '1688 网关暂时无法连接，请稍后重试。');
    }
    if (response.status >= 500)
        throw new IntegrationError('NETWORK_ERROR', '1688 网关处理异常，请先核对操作结果。');
    let data;
    try {
        data = json.parse(await response.text());
    }
    catch {
        throw new IntegrationError('INVALID_RESPONSE', '1688 网关返回了无法解析的数据。');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new IntegrationError('INVALID_RESPONSE', '1688 网关响应格式不正确。');
    const nested = data.result && typeof data.result === 'object' ? data.result : data;
    const code = data.error_code ?? data.errorCode ?? nested.errorCode ?? nested.error_code;
    if (!response.ok || (code && code !== '0' && code !== 0) || data.success === false || data.success === 'false' || nested.success === false || nested.success === 'false') {
        const safeCode = String(code || nested.bizCode || response.status).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 100);
        throw new IntegrationError(safeCode, `1688 接口调用失败（${safeCode}），请检查接口权限或重新授权。`);
    }
    if (Array.isArray(data.result) && data.result.some((item) => item.result === false))
        throw new IntegrationError('PARTIAL_FAILURE', '平台报告部分商品处理失败，请重新读取状态后核对。');
    return data;
}
export async function uploadPhoto(id, tenantId, actorId, albumId, name, bytes, type, requestId) {
    const started = Date.now();
    try {
        const { grant } = await connectionToken(id, tenantId, actorId);
        const credentials = appCredentials();
        const path = `param2/1/com.alibaba.product/alibaba.photobank.photo.add/${credentials.appKey}`;
        const params = { albumID: albumId, name, webSite: '1688', access_token: grant.access_token, _aop_timestamp: String(Date.now()) };
        const response = await gateway(path, { ...params, _aop_signature: signApi(path, params, credentials.secret) }, { bytes, name, type });
        await recordOperation(tenantId, id, actorId, 'alibaba.photobank.photo.add', started, undefined, requestId);
        return response.image;
    }
    catch (error) {
        await recordOperation(tenantId, id, actorId, 'alibaba.photobank.photo.add', started, error, requestId);
        throw error;
    }
}
export async function getGrant(params) {
    const credentials = appCredentials();
    const form = { client_id: credentials.appKey, client_secret: credentials.secret };
    if ('code' in params)
        Object.assign(form, { grant_type: 'authorization_code', need_refresh_token: 'true', redirect_uri: credentials.redirect, code: params.code });
    else
        Object.assign(form, { grant_type: 'refresh_token', refresh_token: params.refreshToken });
    const data = await gateway(`http/1/system.oauth2/getToken/${credentials.appKey}`, form);
    const grant = data;
    if (typeof grant.access_token !== 'string' || !grant.access_token || !Number.isFinite(Number(grant.expires_in)) || Number(grant.expires_in) <= 0) {
        throw new IntegrationError('INVALID_GRANT', '1688 返回的令牌缺少有效期或访问凭证。');
    }
    return grant;
}
export async function saveConnection(tenantId, actorId, grant, obtainedAt = Date.now()) {
    const credentials = appCredentials();
    const aliId = String(grant.aliId || '');
    if (!aliId || !grant.access_token || !Number.isFinite(Number(grant.expires_in)) || Number(grant.expires_in) <= 0)
        throw new IntegrationError('IDENTITY_MISSING', '授权结果缺少平台账号身份或有效期。', 400);
    const ciphertext = await encryptGrant(grant);
    const expiry = new Date(obtainedAt + Number(grant.expires_in) * 1000);
    if (expiry.getTime() <= Date.now())
        throw new IntegrationError('TOKEN_EXPIRED', '导入的访问令牌已过期，请重新授权。', 409);
    const result = await db.query(`INSERT INTO integration_1688_connections(tenant_id,app_key,ali_id,member_id,login_id,display_name,token_ciphertext,access_expires_at,refresh_expires_at,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT(app_key,ali_id) DO UPDATE SET member_id=excluded.member_id,login_id=excluded.login_id,display_name=excluded.display_name,token_ciphertext=excluded.token_ciphertext,access_expires_at=excluded.access_expires_at,refresh_expires_at=excluded.refresh_expires_at,status='connected',member_capability='unknown',updated_at=now()
    WHERE integration_1688_connections.tenant_id=excluded.tenant_id
    RETURNING ${publicConnectionColumns}`, [tenantId, credentials.appKey, aliId, grant.memberId || null, grant.resource_owner || null, grant.resource_owner || grant.memberId || aliId, ciphertext, expiry, parseRefreshExpiry(grant.refresh_token_timeout), actorId]);
    if (!result.rows[0])
        throw new IntegrationError('ALREADY_BOUND', '该 1688 账号已绑定其他租户。', 409);
    return result.rows[0];
}
export async function recordOperation(tenantId, connectionId, actorId, apiName, started, error, requestId) {
    await db.query('INSERT INTO integration_1688_operations(tenant_id,connection_id,actor_id,api_name,outcome,error_code,duration_ms,request_id) SELECT $1,$2,$3,$4,$5,$6,$7,$8 WHERE $2::uuid IS NULL OR EXISTS(SELECT 1 FROM integration_1688_connections WHERE id=$2 AND tenant_id=$1)', [tenantId, connectionId, actorId, apiName, error ? 'failed' : 'success', error instanceof IntegrationError ? error.code : error ? 'INTERNAL_ERROR' : null, Date.now() - started, requestId || null]);
}
export async function connectionToken(id, tenantId, actorId, force = false) {
    const client = await db.connect();
    const started = Date.now();
    let refreshed = false;
    let refreshAttempted = false;
    let refreshError;
    try {
        await client.query('BEGIN');
        const connection = (await client.query('SELECT * FROM integration_1688_connections WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [id, tenantId])).rows[0];
        if (!connection)
            throw new IntegrationError('NOT_FOUND', '店铺连接不存在。', 404);
        if (connection.app_key !== appCredentials().appKey)
            throw new IntegrationError('APP_MISMATCH', '连接属于其他应用，请重新授权。', 409);
        if (connection.status !== 'connected')
            throw new IntegrationError('CONNECTION_INACTIVE', '连接已停用或需要重新授权。', 409);
        let grant = await decryptGrant(connection.token_ciphertext);
        if (force || connection.access_expires_at.getTime() <= Date.now() + 120_000) {
            refreshAttempted = true;
            if (!grant.refresh_token || (connection.refresh_expires_at && connection.refresh_expires_at.getTime() <= Date.now())) {
                await client.query("UPDATE integration_1688_connections SET status='reauthorize',updated_at=now() WHERE id=$1", [id]);
                await client.query('COMMIT');
                throw new IntegrationError('REAUTHORIZE', '刷新令牌已失效，请重新授权。', 409);
            }
            let updated;
            try {
                updated = await getGrant({ refreshToken: grant.refresh_token });
            }
            catch (error) {
                if (error instanceof IntegrationError && /invalid.*(token|grant)|expired|^401$/i.test(error.code)) {
                    await client.query("UPDATE integration_1688_connections SET status='reauthorize',updated_at=now() WHERE id=$1", [id]);
                    await client.query('COMMIT');
                }
                throw error;
            }
            if (updated.aliId && String(updated.aliId) !== connection.ali_id)
                throw new IntegrationError('IDENTITY_MISMATCH', '刷新后的账号身份不一致，请重新授权。', 409);
            grant = { ...grant, ...updated };
            await client.query('UPDATE integration_1688_connections SET token_ciphertext=$2,access_expires_at=$3,refresh_expires_at=$4,last_refreshed_at=now(),updated_at=now() WHERE id=$1', [id, await encryptGrant(grant), new Date(Date.now() + Number(grant.expires_in) * 1000), parseRefreshExpiry(grant.refresh_token_timeout)]);
            refreshed = true;
        }
        await client.query('COMMIT');
        return { connection, grant };
    }
    catch (error) {
        refreshError = error;
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
        if (refreshed || refreshAttempted)
            await recordOperation(tenantId, id, actorId, 'system.oauth2/getToken.refresh', started, refreshError);
    }
}
export async function testMember(id, tenantId, actorId, requestId) {
    const started = Date.now();
    try {
        const { grant } = await connectionToken(id, tenantId, actorId);
        const credentials = appCredentials();
        const path = `param2/1/com.alibaba.account/alibaba.account.basic/${credentials.appKey}`;
        const params = { access_token: grant.access_token, _aop_timestamp: String(Date.now()) };
        const response = await gateway(path, { ...params, _aop_signature: signApi(path, params, credentials.secret) });
        const result = (response.result || response);
        const first = Array.isArray(result.toReturn) ? result.toReturn[0] : result;
        if (!first || !Object.keys(first).length)
            throw new IntegrationError('EMPTY_PROFILE', '接口未返回会员资料。');
        const name = typeof first.companyName === 'string' ? first.companyName : typeof first.sellerName === 'string' ? first.sellerName : null;
        await db.query("UPDATE integration_1688_connections SET display_name=coalesce($3,display_name),member_capability='available',last_tested_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2", [id, tenantId, name]);
        await recordOperation(tenantId, id, actorId, 'alibaba.account.basic', started, undefined, requestId);
        return { verified: true };
    }
    catch (error) {
        const permissionDenied = error instanceof IntegrationError && /permission|unauthor|accessdenied|^401$|^403$/i.test(error.code);
        await db.query("UPDATE integration_1688_connections SET member_capability=CASE WHEN $3 THEN 'unavailable' ELSE member_capability END,last_tested_at=now() WHERE id=$1 AND tenant_id=$2", [id, tenantId, permissionDenied]);
        await recordOperation(tenantId, id, actorId, 'alibaba.account.basic', started, error, requestId);
        throw error;
    }
}
export async function callProductApi(id, tenantId, actorId, name, input, requestId) {
    const allowed = ['alibaba.product.list.get', 'alibaba.product.get', 'alibaba.category.searchByKeyword', 'alibaba.category.get', 'alibaba.new.product.getSchema', 'alibaba.new.product.getSubSchema', 'alibaba.new.product.add', 'alibaba.product.modifyStock'];
    if (!allowed.includes(name))
        throw new IntegrationError('API_NOT_SUPPORTED', '该接口尚未接入。', 400);
    const started = Date.now();
    try {
        const { grant } = await connectionToken(id, tenantId, actorId);
        const credentials = appCredentials();
        const path = `param2/1/com.alibaba.product/${name}/${credentials.appKey}`;
        const params = { access_token: grant.access_token, _aop_timestamp: String(Date.now()) };
        for (const [key, value] of Object.entries(input))
            if (value !== undefined && value !== null) {
                params[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
            }
        const result = await gateway(path, { ...params, _aop_signature: signApi(path, params, credentials.secret) });
        await recordOperation(tenantId, id, actorId, name, started, undefined, requestId);
        return result;
    }
    catch (error) {
        await recordOperation(tenantId, id, actorId, name, started, error, requestId);
        throw error;
    }
}
export function parseBusinessData(response) {
    const result = (response.result || response);
    const data = result.bizData;
    if (typeof data === 'string') {
        try {
            return json.parse(data);
        }
        catch {
            throw new IntegrationError('INVALID_SCHEMA', '平台返回的商品规则无法解析。');
        }
    }
    if (data && typeof data === 'object')
        return data;
    throw new IntegrationError('EMPTY_SCHEMA', '平台没有返回商品规则。');
}
