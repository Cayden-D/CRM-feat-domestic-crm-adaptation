import type {FastifyInstance} from 'fastify'
import {z} from 'zod'
import {db} from '../db.js'
import {requirePermission} from '../auth.js'
import {callProductApi,IntegrationError} from '../integrations/1688.js'
export async function deleteListingRoutes(app:FastifyInstance){
  app.post('/listings/:id/delete',{preHandler:[requirePermission('integration:manage'),requirePermission('integration:publish')]},async request=>{
    const parsed=z.object({confirmed:z.literal(true),offerId:z.string().regex(/^\d+$/),syncedAt:z.string().datetime()}).safeParse(request.body)
    if(!parsed.success)throw new IntegrationError('DELETE_CONFIRM_REQUIRED','请确认要移入回收站的商品并重新加载最新详情。',400)
    const {id}=z.object({id:z.string().uuid()}).parse(request.params),input=parsed.data,tenant=request.authUser.tenantId
    const client=await db.connect();let listing
    try{
      await client.query('BEGIN')
      listing=(await client.query('SELECT * FROM integration_1688_listings WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[id,tenant])).rows[0]
      if(!listing)throw new IntegrationError('NOT_FOUND','平台商品不存在。',404)
      if(listing.offer_id!==input.offerId)throw new IntegrationError('DELETE_MISMATCH','商品 ID 不一致，请重新加载。',409)
      if(listing.deletion_state==='deleted'){await client.query('COMMIT');return {data:{deleted:true}}}
      if(listing.deletion_state!=='active')throw new IntegrationError('DELETE_UNKNOWN','删除已提交或结果待核对，请在 1688 回收站核对，勿重复删除。',409)
      if(new Date(listing.synced_at).getTime()!==new Date(input.syncedAt).getTime())throw new IntegrationError('DELETE_STALE','商品详情已更新，请重新加载后确认。',409)
      await client.query("UPDATE integration_1688_listings SET deletion_state='deleting' WHERE id=$1",[id])
      await client.query("INSERT INTO audit_logs(tenant_id,actor_id,action,entity_type,entity_id,after_data,request_id)VALUES($1,$2,'1688.delete.request','1688_listing',$3,$4,$5)",[tenant,request.authUser.sub,id,JSON.stringify({offerId:listing.offer_id,connectionId:listing.connection_id}),request.id])
      await client.query('COMMIT')
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
    let rejected=false
    try{
      const result=await callProductApi(listing.connection_id,tenant,request.authUser.sub,'alibaba.product.delete',{productID:listing.offer_id},request.id)
      if(result.isSuccess===false){rejected=true;throw new IntegrationError('DELETE_REJECTED','1688 未确认删除成功，请到平台核对商品是否已在回收站。',400)}
      if(result.isSuccess!==true)throw new IntegrationError('DELETE_UNKNOWN','1688 未返回明确删除结果，请到回收站核对，勿重复提交。',409)
      await db.query("UPDATE integration_1688_listings SET deletion_state='deleted',status='deleted' WHERE id=$1 AND tenant_id=$2",[id,tenant])
      await db.query("INSERT INTO audit_logs(tenant_id,actor_id,action,entity_type,entity_id,request_id)VALUES($1,$2,'1688.delete.success','1688_listing',$3,$4)",[tenant,request.authUser.sub,id,request.id])
      return {data:{deleted:true}}
    }catch(error){
      await db.query("UPDATE integration_1688_listings SET deletion_state=$3 WHERE id=$1 AND tenant_id=$2 AND deletion_state='deleting'",[id,tenant,rejected?'active':'unknown'])
      if(rejected)throw error
      throw new IntegrationError('DELETE_UNKNOWN','删除结果尚未确认，请在 1688 回收站核对；系统不会自动重复删除。',409)
    }
  })
}
