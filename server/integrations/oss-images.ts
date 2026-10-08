import OSS from 'ali-oss'
import { randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { IntegrationError } from './1688.js'

const prefix='1688-agent-images/'
const previewSeconds=3600
let client:OSS|undefined
let previewClient:OSS|undefined

export function requireImageStorage(){
  if(!config.OSS_REGION||!config.OSS_BUCKET||!config.OSS_ACCESS_KEY_ID||!config.OSS_ACCESS_KEY_SECRET)throw new IntegrationError('OSS_NOT_CONFIGURED','请先在服务器配置私有 OSS Bucket 与访问凭据。',503)
  return client??=new OSS({region:config.OSS_REGION,bucket:config.OSS_BUCKET,accessKeyId:config.OSS_ACCESS_KEY_ID,accessKeySecret:config.OSS_ACCESS_KEY_SECRET,authorizationV4:true,secure:true,timeout:30_000})
}

function imagePreviewClient(){
  if(!config.OSS_CUSTOM_DOMAIN)return requireImageStorage()
  requireImageStorage()
  return previewClient??=new OSS({region:config.OSS_REGION!,bucket:config.OSS_BUCKET!,accessKeyId:config.OSS_ACCESS_KEY_ID!,accessKeySecret:config.OSS_ACCESS_KEY_SECRET!,endpoint:config.OSS_CUSTOM_DOMAIN,cname:true,authorizationV4:true,secure:true,timeout:30_000})
}

function imageKey(key:string,tenantId:string,draftId:string){
  if(!key.startsWith(`${prefix}${tenantId}/${draftId}/`)||!/^1688-agent-images\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.png$/.test(key))throw new IntegrationError('OSS_IMAGE_KEY','图片存储标识无效。',400)
  return key
}

export async function persistAgentImage(tenantId:string,draftId:string,png:Buffer){
  const key=`${prefix}${tenantId}/${draftId}/${randomUUID()}.png`
  try{
    await requireImageStorage().put(key,png,{mime:'image/png',headers:{'x-oss-object-acl':'private','x-oss-forbid-overwrite':'true','Cache-Control':'private, max-age=3600'}})
  }catch{throw new IntegrationError('OSS_IMAGE_UPLOAD','图片持久化到 OSS 失败，未创建预览。',502)}
  return key
}

export async function agentImagePreviewUrl(key:string,tenantId:string,draftId:string){
  const url=await imagePreviewClient().signatureUrlV4('GET',previewSeconds,undefined,imageKey(key,tenantId,draftId))
  const parsed=new URL(url)
  if(parsed.protocol!=='https:'||(config.OSS_CUSTOM_DOMAIN&&parsed.hostname!==new URL(config.OSS_CUSTOM_DOMAIN).hostname))throw new IntegrationError('OSS_IMAGE_URL','OSS 预览链接的协议或域名不符合配置。',502)
  return url
}

export async function readAgentImage(key:string,tenantId:string,draftId:string){
  try{
    const result=await requireImageStorage().get(imageKey(key,tenantId,draftId))
    if(!Buffer.isBuffer(result.content)||result.content.length>10_000_000)throw new Error('Unexpected OSS image size')
    return result.content as Buffer
  }catch{throw new IntegrationError('OSS_IMAGE_READ','无法读取已保存的 OSS 图片，请检查存储配置。',502)}
}

export async function removeAgentImage(key:string,tenantId:string,draftId:string){
  await requireImageStorage().delete(imageKey(key,tenantId,draftId))
}
