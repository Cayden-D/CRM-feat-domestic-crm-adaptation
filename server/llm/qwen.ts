import { config } from '../config.js'

export const QWEN_MODELS=['qwen3.7-flash','qwen3.7-plus','qwen3.6-plus'] as const
export type QwenModel=typeof QWEN_MODELS[number]
export type LlmMessage={role:'system'|'user'|'assistant';content:string}
export type LlmResult={content:string;model:string;inputTokens:number|null;outputTokens:number|null;finishReason:string|null}

export class LlmConfigurationError extends Error{}
export class LlmRequestError extends Error{constructor(message:string,public status:number,public details?:unknown){super(message)}}

export function isQwenModel(value:string):value is QwenModel{return QWEN_MODELS.includes(value as QwenModel)}

export async function generateQwenText(input:{messages:LlmMessage[];model?:QwenModel;temperature?:number;maxTokens?:number}):Promise<LlmResult>{
  if(!config.DASHSCOPE_API_KEY)throw new LlmConfigurationError('尚未配置 DASHSCOPE_API_KEY。')
  const model=input.model??config.QWEN_DEFAULT_MODEL
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),config.QWEN_TIMEOUT_MS)
  try{
    const response=await fetch(`${config.DASHSCOPE_BASE_URL.replace(/\/$/,'')}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${config.DASHSCOPE_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model,messages:input.messages,temperature:input.temperature??0.4,max_tokens:input.maxTokens??2000}),signal:controller.signal})
    const body=await response.json().catch(()=>({})) as {message?:string;error?:{message?:string;code?:string};choices?:Array<{message?:{content?:string};finish_reason?:string}>;model?:string;usage?:{prompt_tokens?:number;completion_tokens?:number}}
    if(!response.ok)throw new LlmRequestError(body.error?.message||body.message||`千问接口返回 HTTP ${response.status}`,response.status,body.error)
    const content=body.choices?.[0]?.message?.content?.trim()
    if(!content)throw new LlmRequestError('千问接口没有返回可用内容。',502,body)
    return{content,model:body.model||model,inputTokens:body.usage?.prompt_tokens??null,outputTokens:body.usage?.completion_tokens??null,finishReason:body.choices?.[0]?.finish_reason??null}
  }catch(error){if(error instanceof LlmRequestError||error instanceof LlmConfigurationError)throw error;if(error instanceof Error&&error.name==='AbortError')throw new LlmRequestError('千问响应超时，请稍后重试。',504);throw new LlmRequestError(error instanceof Error?error.message:'无法连接千问服务。',502)}finally{clearTimeout(timeout)}
}
