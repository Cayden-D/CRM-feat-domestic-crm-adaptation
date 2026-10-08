import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db.js'
import { requirePermission } from '../auth.js'
import { IntegrationError } from '../integrations/1688.js'
import { getPublishTemplate, publishTemplateInput } from '../integrations/1688-publish-template.js'

export async function publishTemplateRoutes(app:FastifyInstance){
  app.get('/publish-template',{preHandler:requirePermission('integration:read')},async request=>({data:await getPublishTemplate(request.authUser.tenantId)}))
  app.put('/publish-template',{preHandler:[requirePermission('integration:manage'),requirePermission('integration:publish')]},async request=>{
    const parsed=z.object({revision:z.number().int().nonnegative(),values:publishTemplateInput}).safeParse(request.body)
    if(!parsed.success)throw new IntegrationError('INVALID_TEMPLATE','请检查公共模板的单位、选项和件重尺：重量须为正整数克，尺寸全部留空或填写完整，长 ≥ 宽 ≥ 高，最多一位小数。',400)
    const input=parsed.data,tenant=request.authUser.tenantId,client=await db.connect()
    try{
      await client.query('BEGIN')
      await client.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE',[tenant])
      const current=(await client.query('SELECT revision FROM integration_1688_publish_templates WHERE tenant_id=$1',[tenant])).rows[0]
      if((current?.revision||0)!==input.revision)throw new IntegrationError('TEMPLATE_CONFLICT','公共模板已被修改，请重新加载后再保存。',409)
      const saved=(await client.query(`INSERT INTO integration_1688_publish_templates(tenant_id,template_values,updated_by) VALUES($1,$2,$3) ON CONFLICT(tenant_id) DO UPDATE SET template_values=excluded.template_values,updated_by=excluded.updated_by,revision=integration_1688_publish_templates.revision+1,updated_at=now() RETURNING template_values AS values,revision`,[tenant,JSON.stringify(input.values),request.authUser.sub])).rows[0]
      await client.query("INSERT INTO audit_logs(tenant_id,actor_id,action,entity_type,entity_id,after_data,request_id) VALUES($1,$2,'1688.publish-template.update','1688_publish_template',$1,$3,$4)",[tenant,request.authUser.sub,JSON.stringify(saved),request.id])
      await client.query('COMMIT');return {data:saved}
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  })
}
