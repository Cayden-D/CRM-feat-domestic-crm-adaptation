import sharp from 'sharp';
import { z } from 'zod';
import { db } from '../db.js';
import { requirePermission } from '../auth.js';
import { IntegrationError, uploadPhoto } from '../integrations/1688.js';
import { inspectPublishingImages, publishingImages } from '../integrations/1688-agent.js';
import { generateQwenImage, generatedImageUrl, IMAGE_MODELS } from '../llm/qwen-image.js';
import { agentImagePreviewUrl, persistAgentImage, readAgentImage, removeAgentImage, requireImageStorage } from '../integrations/oss-images.js';
const params = z.object({ id: z.string().uuid() });
const photoLimit = 2 * 1024 * 1024;
const blocked = (findings) => !findings.length || findings.some(f => !f.readable || f.watermark || f.rightsRisk || f.uncertain);
async function downloadGeneratedImage(raw) {
    const url = generatedImageUrl(raw);
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (!response.ok || !response.body)
        throw new IntegrationError('IMAGE_DOWNLOAD_FAILED', '生成图片已失效或无法读取，请重新生成。', 502);
    if (Number(response.headers.get('content-length') || 0) > 10_000_000)
        throw new IntegrationError('IMAGE_TOO_LARGE', '生成图超过安全下载上限。', 400);
    const reader = response.body.getReader(), parts = [];
    let length = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            length += value.length;
            if (length > 10_000_000)
                throw new IntegrationError('IMAGE_TOO_LARGE', '生成图超过安全下载上限。', 400);
            parts.push(value);
        }
    }
    finally {
        reader.releaseLock();
    }
    return Buffer.concat(parts.map(p => Buffer.from(p)));
}
async function prepareImage(source) {
    if (source.length > 10_000_000)
        throw new IntegrationError('IMAGE_TOO_LARGE', '图片超过安全处理上限。', 400);
    if (source.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
        throw new IntegrationError('INVALID_IMAGE', '生成结果不是 PNG 图片。', 400);
    try {
        const image = sharp(source, { limitInputPixels: 4_194_304, failOn: 'error' });
        const metadata = await image.metadata();
        if (metadata.format !== 'png' || !metadata.width || !metadata.height || metadata.width < 512 || metadata.height < 512)
            throw new IntegrationError('INVALID_IMAGE', '生成图片尺寸或格式不符合要求。', 400);
        for (const quality of [85, 70, 55]) {
            const bytes = await sharp(source, { limitInputPixels: 4_194_304 }).resize({ width: 1500, height: 1500, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#fff' }).jpeg({ quality }).toBuffer();
            if (bytes.length <= photoLimit)
                return bytes;
        }
        throw new IntegrationError('IMAGE_TOO_LARGE', '生成图片无法压缩到店铺相册限制以内。', 400);
    }
    catch (error) {
        if (error instanceof IntegrationError)
            throw error;
        throw new IntegrationError('INVALID_IMAGE', '生成图片无法安全解码。', 400);
    }
}
export async function agentImageRoutes(app) {
    app.get('/drafts/:id/agent-images', { preHandler: requirePermission('integration:read') }, async (request) => {
        const { id } = params.parse(request.params);
        const draft = (await db.query('SELECT id FROM integration_1688_publish_drafts WHERE id=$1 AND tenant_id=$2', [id, request.authUser.tenantId])).rows[0];
        if (!draft)
            throw new IntegrationError('NOT_FOUND', '草稿不存在。', 404);
        const rows = await db.query("SELECT id,mode,model,prompt,generated_url,oss_key,findings,status,photo_url,created_at,expires_at FROM integration_1688_agent_images WHERE draft_id=$1 AND tenant_id=$2 AND (oss_key IS NOT NULL OR expires_at>now()) ORDER BY created_at DESC LIMIT 10", [id, request.authUser.tenantId]);
        return { data: await Promise.all(rows.rows.map(async ({ generated_url, oss_key, ...row }) => ({ ...row, url: oss_key ? await agentImagePreviewUrl(oss_key, request.authUser.tenantId, id) : generated_url, storage: oss_key ? 'oss' : 'temporary' }))) };
    });
    app.post('/drafts/:id/agent-images', { preHandler: requirePermission('integration:publish') }, async (request) => {
        const { id } = params.parse(request.params);
        const input = z.object({ revision: z.number().int().positive(), mode: z.enum(['generate', 'edit']), model: z.enum(IMAGE_MODELS), prompt: z.string().trim().min(8).max(2000), sourceIndex: z.number().int().min(0).max(20).optional(), confirmed: z.literal(true) }).parse(request.body);
        if (/(?:去|除|删|擦|消).{0,6}(?:水印|商标|版权|logo)|(?:remove|erase|hide).{0,15}(?:watermark|copyright|logo|brand)/i.test(input.prompt))
            throw new IntegrationError('IMAGE_RIGHTS', '不能通过 AI 移除水印、商标或版权标识，请先提供有使用权的原图。', 400);
        const draft = (await db.query('SELECT d.id,d.tenant_id,d.revision,d.status,d.data_body,c.status AS connection_status FROM integration_1688_publish_drafts d JOIN integration_1688_connections c ON c.id=d.connection_id WHERE d.id=$1 AND d.tenant_id=$2', [id, request.authUser.tenantId])).rows[0];
        if (!draft)
            throw new IntegrationError('NOT_FOUND', '草稿不存在。', 404);
        if (draft.revision !== input.revision || !['draft', 'failed'].includes(draft.status))
            throw new IntegrationError('DRAFT_CONFLICT', '草稿已变化，请刷新后重新生成。', 409);
        if (draft.connection_status !== 'connected')
            throw new IntegrationError('CONNECTION_INACTIVE', '店铺未连接，不能生成并应用图片。', 409);
        requireImageStorage();
        if (input.mode === 'edit' && input.sourceIndex === undefined)
            throw new IntegrationError('IMAGE_SOURCE_REQUIRED', '请选择草稿中有使用权的原图。', 400);
        if (input.mode === 'generate' && input.sourceIndex !== undefined)
            throw new IntegrationError('IMAGE_SOURCE_UNEXPECTED', '纯生成不需要原图。', 400);
        let sourceUrl;
        if (input.mode === 'edit') {
            const image = draft.data_body.formValues?.primaryPicture?.imageList?.[input.sourceIndex];
            if (typeof image?.url !== 'string')
                throw new IntegrationError('IMAGE_SOURCE_REQUIRED', '原图不存在，请刷新草稿。', 400);
            sourceUrl = publishingImages({ primaryPicture: { imageList: [image] } })[0];
            const sourceFindings = await inspectPublishingImages([sourceUrl]);
            if (blocked(sourceFindings))
                throw new IntegrationError('IMAGE_SOURCE_RISK', '原图无法读取，或存在明确的公司水印/知名品牌 Logo；请更换有使用权的原图。', 400);
        }
        const generatedUrl = await generateQwenImage({ model: input.model, prompt: input.prompt, sourceUrl });
        let findings;
        try {
            findings = await inspectPublishingImages([generatedUrl]);
        }
        catch {
            findings = [{ url: generatedUrl, readable: false, watermark: false, rightsRisk: false, uncertain: true, reason: '生成结果未能完成图片复检，请重新生成或人工处理。' }];
        }
        const png = await downloadGeneratedImage(generatedUrl);
        await prepareImage(png);
        const key = await persistAgentImage(request.authUser.tenantId, id, png);
        let preview;
        try {
            preview = (await db.query("INSERT INTO integration_1688_agent_images(tenant_id,draft_id,actor_id,draft_revision,mode,source_url,prompt,model,generated_url,oss_key,persisted_at,findings,expires_at)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),$11::jsonb,now()+interval '23 hours') RETURNING id,mode,model,prompt,findings,status,created_at,expires_at", [request.authUser.tenantId, id, request.authUser.sub, input.revision, input.mode, sourceUrl || null, input.prompt, input.model, generatedUrl, key, JSON.stringify(findings)])).rows[0];
        }
        catch (error) {
            await removeAgentImage(key, request.authUser.tenantId, id).catch(() => { });
            throw error;
        }
        await db.query("INSERT INTO audit_logs(tenant_id,actor_id,action,entity_type,entity_id,after_data,request_id)VALUES($1,$2,'1688.agent.image.generate','1688_agent_image',$3,$4,$5)", [request.authUser.tenantId, request.authUser.sub, preview.id, JSON.stringify({ mode: input.mode, model: input.model, draftId: id, risky: blocked(findings) }), request.id]);
        return { data: { ...preview, url: await agentImagePreviewUrl(key, request.authUser.tenantId, id), storage: 'oss', risky: blocked(findings) } };
    });
    app.post('/drafts/:id/agent-images/:imageId/apply', { preHandler: requirePermission('integration:publish') }, async (request) => {
        const { id, imageId } = z.object({ id: z.string().uuid(), imageId: z.string().uuid() }).parse(request.params);
        const input = z.object({ revision: z.number().int().positive(), albumId: z.string().regex(/^\d{1,20}$/), placement: z.enum(['replace', 'append']), sourceIndex: z.number().int().min(0).max(20).optional(), confirmed: z.literal(true) }).parse(request.body);
        const data = (await db.query('SELECT i.*,d.connection_id,d.data_body,d.platform_schema,d.revision,d.status AS draft_status FROM integration_1688_agent_images i JOIN integration_1688_publish_drafts d ON d.id=i.draft_id WHERE i.id=$1 AND i.draft_id=$2 AND i.tenant_id=$3 AND d.tenant_id=$3', [imageId, id, request.authUser.tenantId])).rows[0];
        if (!data)
            throw new IntegrationError('NOT_FOUND', '图片预览不存在。', 404);
        if (data.status !== 'preview' || (!data.oss_key && new Date(data.expires_at).getTime() <= Date.now()))
            throw new IntegrationError('IMAGE_EXPIRED', '图片预览已使用或过期，请重新生成。', 409);
        if (blocked(data.findings))
            throw new IntegrationError('IMAGE_RISK', '图片复检未通过，不能应用到草稿。', 409);
        if (data.revision !== input.revision || data.draft_revision !== input.revision || !['draft', 'failed'].includes(data.draft_status))
            throw new IntegrationError('DRAFT_CONFLICT', '草稿已变化，请重新生成图片并复检。', 409);
        const list = data.data_body.formValues?.primaryPicture?.imageList;
        if (!Array.isArray(list))
            throw new IntegrationError('IMAGE_LIST_MISSING', '草稿主图列表不可用。', 400);
        if (input.placement === 'replace' && (!Number.isInteger(input.sourceIndex) || !list[input.sourceIndex]))
            throw new IntegrationError('IMAGE_SOURCE_REQUIRED', '请选择要替换的草稿主图。', 400);
        if (input.placement === 'append' && list.length >= Number(data.platform_schema?.data?.primaryPicture?.fields?.maxItems || 10))
            throw new IntegrationError('IMAGE_LIMIT', '商品主图数量达到上限。', 400);
        const source = data.oss_key ? await readAgentImage(data.oss_key, request.authUser.tenantId, id) : await downloadGeneratedImage(data.generated_url);
        const bytes = await prepareImage(source);
        const claimed = await db.query("UPDATE integration_1688_agent_images SET status='applying' WHERE id=$1 AND tenant_id=$2 AND draft_id=$3 AND status='preview' RETURNING id", [imageId, request.authUser.tenantId, id]);
        if (!claimed.rows.length)
            throw new IntegrationError('IMAGE_ALREADY_APPLYING', '图片正在处理或已使用，请勿重复上传。', 409);
        let photo;
        try {
            photo = await uploadPhoto(data.connection_id, request.authUser.tenantId, request.authUser.sub, input.albumId, `agent-${imageId.slice(0, 8)}.jpg`, bytes, 'image/jpeg', request.id);
        }
        catch {
            throw new IntegrationError('PHOTO_UPLOAD_UNKNOWN', '相册上传结果未确认，请到相册核对后再处理，勿重复提交。', 409);
        }
        if (!photo || typeof photo.url !== 'string')
            throw new IntegrationError('PHOTO_UPLOAD_UNKNOWN', '相册上传未返回图片地址，请先检查相册，避免重复上传。', 409);
        try {
            publishingImages({ primaryPicture: { imageList: [{ url: photo.url }] } });
        }
        catch {
            throw new IntegrationError('PHOTO_UPLOAD_UNKNOWN', '相册上传返回的图片地址不符合平台发布要求，请先检查相册，避免重复上传。', 409);
        }
        const values = { ...data.data_body.formValues, primaryPicture: { ...data.data_body.formValues.primaryPicture, imageList: input.placement === 'replace' ? list.map((item, index) => index === input.sourceIndex ? { url: photo.url } : item) : [...list, { url: photo.url }] } };
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const saved = (await client.query("UPDATE integration_1688_publish_drafts SET data_body=jsonb_set(data_body,'{formValues}',$4::jsonb),revision=revision+1,updated_at=now() WHERE id=$1 AND tenant_id=$2 AND revision=$3 AND status IN ('draft','failed') RETURNING *", [id, request.authUser.tenantId, input.revision, JSON.stringify(values)])).rows[0];
            if (!saved)
                throw new IntegrationError('DRAFT_CONFLICT', '上传后草稿已变化；图片已存入相册，请刷新草稿后手动选择，勿直接重试上传。', 409);
            await client.query("UPDATE integration_1688_agent_images SET status='applied',photo_url=$2 WHERE id=$1 AND status='applying'", [imageId, photo.url]);
            await client.query("INSERT INTO audit_logs(tenant_id,actor_id,action,entity_type,entity_id,after_data,request_id)VALUES($1,$2,'1688.agent.image.apply','1688_agent_image',$3,$4,$5)", [request.authUser.tenantId, request.authUser.sub, imageId, JSON.stringify({ draftId: id, albumId: input.albumId, placement: input.placement, photoId: photo.id || null }), request.id]);
            await client.query('COMMIT');
            return { data: { draft: saved, photoUrl: photo.url } };
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    });
}
