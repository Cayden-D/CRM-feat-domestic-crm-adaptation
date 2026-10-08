import { config } from '../config.js'
import { IntegrationError } from '../integrations/1688.js'

export const IMAGE_MODELS=['qwen-image-3.0','qwen-image-3.0-pro','qwen-image-2.1-pro'] as const
export type ImageModel=typeof IMAGE_MODELS[number]
export function generatedImageUrl(raw:string){
  const url=new URL(raw)
  if(url.protocol!=='https:'||url.username||url.password||url.port||!(/^(?:dashscope-result-[a-z0-9-]+\.oss-[a-z0-9-]+|dashscope-a[0-9]+\.oss-accelerate)\.aliyuncs\.com$/.test(url.hostname))||!url.pathname.endsWith('.png')||raw.length>4096)throw new IntegrationError('INVALID_IMAGE_URL','生成图片地址不符合百炼临时结果域名。',502)
  return url.href
}
export async function generateQwenImage(input:{model:ImageModel;prompt:string;sourceUrl?:string}){
  if(!config.DASHSCOPE_API_KEY)throw new IntegrationError('LLM_NOT_CONFIGURED','请先配置百炼 API Key。',503)
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),600_000)
  try{
    const response=await fetch(`${config.DASHSCOPE_BASE_URL.replace(/\/$/,'')}/images/generations`,{
      method:'POST',headers:{Authorization:`Bearer ${config.DASHSCOPE_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({model:input.model,prompt:input.prompt,n:1,size:'1024x1024',prompt_extend:true,watermark:false,...(input.sourceUrl?{image:input.sourceUrl}:{})}),signal:controller.signal
    })
    const body=await response.json().catch(()=>null) as {data?:Array<{url?:string}>}|null
    if(!response.ok)throw new IntegrationError('IMAGE_MODEL_FAILED',`千问图像模型返回 HTTP ${response.status}。请检查模型权限、图片或提示词。`,response.status===429?429:502)
    if(body?.data?.length!==1||typeof body.data[0]?.url!=='string')throw new IntegrationError('IMAGE_MODEL_RESPONSE','千问没有返回单张有效图片。',502)
    return generatedImageUrl(body.data[0].url)
  }catch(error){if(error instanceof IntegrationError)throw error;if(error instanceof Error&&error.name==='AbortError')throw new IntegrationError('IMAGE_MODEL_TIMEOUT','千问图像生成超时，本次未保存草稿。',504);throw new IntegrationError('IMAGE_MODEL_NETWORK','千问图像服务暂时不可用。',502)}finally{clearTimeout(timeout)}
}
