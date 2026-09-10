const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3001'
export const COLLECTOR_SCRIPT_URL = `${API_BASE}/api/product-collections/collector-script.user.js`
const TOKEN_KEY = 'ai_crm_access_token'

export type SessionUser = {
  sub?: string
  id?: string
  tenantId?: string
  email: string
  displayName: string
  roles: string[]
  permissions?: string[]
}

export type Lead = {
  id: string
  company_name: string
  contact_name: string | null
  email: string | null
  phone: string | null
  province: string | null
  city: string | null
  source: string | null
  interested_products: string | null
  status: string
  priority: string
  allocation_score: number | null
  next_follow_up_at: string | null
  owner_name: string | null
  owner_id: string | null
  created_at: string
}

export type LeadInput = {
  companyName: string
  contactName?: string | null
  email?: string | null
  phone?: string | null
  website?: string | null
  province?: string | null
  city?: string | null
  source?: string | null
  interestedProducts?: string | null
  inquiryText?: string | null
  priority?: 'low' | 'medium' | 'high' | 'urgent'
  nextFollowUpAt?: string | null
  status?: Lead['status']
  ownerId?: string | null
}

export type DuplicateCandidate = { id: string; entity_type: 'lead' | 'account'; name: string; email: string | null; phone: string | null; status: string; score: number; match_reason: string }
export type AssignableUser = { id: string; display_name: string; email: string; roles: string[] }
export type LeadActivity = { id: string; activity_type: string; subject: string | null; content: string; occurred_at: string; next_action: string | null; next_action_at: string | null; ai_generated: boolean; actor_name: string | null }

export type Account = {
  id: string; owner_id: string | null; owner_name: string | null; name: string; website: string | null; domain: string | null;
  province: string | null; city: string | null; district: string | null; address: string | null; industry: string | null; tax_id: string | null;
  credit_level: 'A' | 'B' | 'C' | 'D' | null; lifecycle_status: string; source: string | null; last_contact_at: string | null;
  created_at: string; updated_at: string; contact_count?: number; open_opportunity_count?: number; pipeline_amount?: string; order_total?: string;
}
export type AccountInput = {
  name: string; website?: string | null; domain?: string | null; province?: string | null; city?: string | null;
  district?: string | null; address?: string | null; industry?: string | null; taxId?: string | null; creditLevel?: Account['credit_level'];
  lifecycleStatus?: 'active' | 'silent' | 'public_pool' | 'lost'; source?: string | null; ownerId?: string | null;
}
export type Contact = { id: string; full_name: string; job_title: string | null; department: string | null; email: string | null; phone: string | null; wechat: string | null; preferred_channel: string | null; employment_status: string; is_primary: boolean; created_at: string; updated_at: string }
export type ContactInput = { fullName: string; jobTitle?: string | null; department?: string | null; email?: string | null; phone?: string | null; wechat?: string | null; preferredChannel?: 'email' | 'phone' | 'wechat' | 'meeting' | null; employmentStatus?: 'active' | 'left' | 'unknown'; isPrimary?: boolean }
export type AccountOpportunity = { id: string; name: string; amount: string; currency: string; expected_close_date: string | null; probability: string | null; ai_predicted_probability: string | null; status: string; stage_name: string; stage_code: string; created_at: string }
export type AccountTask = { id: string; title: string; description: string | null; priority: string; status: string; due_at: string | null; completed_at: string | null; assignee_name: string | null }
export type AccountOrder = { id: string; order_number: string; status: string; currency: string; total_amount: string; delivery_date: string | null; created_at: string }
export type AccountDetail = { account: Account; contacts: Contact[]; opportunities: AccountOpportunity[]; activities: LeadActivity[]; tasks: AccountTask[]; orders: AccountOrder[]; summary: { contactCount: number; openOpportunityCount: number; openPipeline: number; orderTotal: number; planned_amount: string; received_amount: string; overdue_count: number } }
export type OpportunityStage = { id:string;name:string;code:string;position:number;default_probability:string;is_won:boolean;is_lost:boolean;opportunity_count?:number;total_amount?:number;weighted_amount?:number }
export type Opportunity = { id:string;account_id:string;primary_contact_id:string|null;owner_id:string|null;stage_id:string;name:string;description:string|null;amount:string;currency:string;expected_close_date:string|null;probability:string|null;ai_predicted_probability:string|null;ai_recommended_action:string|null;status:'open'|'won'|'lost'|'cancelled';lost_reason:string|null;created_at:string;updated_at:string;account_name:string;province:string|null;primary_contact_name:string|null;owner_name:string|null;stage_name:string;stage_code:string;stage_position:number;default_probability:string;is_won:boolean;is_lost:boolean }
export type OpportunityInput = { accountId:string;primaryContactId?:string|null;ownerId?:string|null;stageId:string;name:string;description?:string|null;amount:number;expectedCloseDate?:string|null;probability?:number|null;lostReason?:string|null }
export type OpportunityHistory = { id:string;note:string|null;created_at:string;from_stage_name:string|null;to_stage_name:string;to_stage_code:string;changed_by_name:string|null }
export type OpportunityDetail = { opportunity:Opportunity;history:OpportunityHistory[];activities:LeadActivity[];tasks:AccountTask[] }
export type OpportunityBoard = { data:Opportunity[];stages:OpportunityStage[];summary:{ totalCount:number;totalAmount:number;weightedAmount:number;closingThisMonth:number } }
export type ProductPrice = { id?:string;min_quantity:number|string;unit_price:number|string;customer_level:'A'|'B'|'C'|'D'|null;valid_from:string|null;valid_until:string|null }
export type Product = { id:string;sku:string;name:string;category:string|null;description:string|null;specifications:Record<string,string>;base_price:string;base_currency:string;status:'draft'|'active'|'inactive';created_at:string;updated_at:string;prices:ProductPrice[] }
export type ProductInput = { sku:string;name:string;category?:string|null;description?:string|null;specifications?:Record<string,string>;basePrice:number;status:'draft'|'active'|'inactive';prices:Array<{minQuantity:number;unitPrice:number;customerLevel?:'A'|'B'|'C'|'D'|null;validFrom?:string|null;validUntil?:string|null}> }
export type CollectedProduct = { id:string;source:'1688'|'alibaba';source_product_id:string;source_url:string;title:string;main_image_url:string|null;gallery_images:string[];detail_images:string[];video_url:string|null;description_url:string|null;currency:string;price_min:string|null;price_max:string|null;attributes:Record<string,string>;sku_props:unknown[];seller_name:string|null;seller_id:string|null;category_path:string|null;source_category_id:string|null;source_category_attributes:unknown[];tags:string[];collector_note:string|null;source_collected_at:string|null;raw_data:Record<string,unknown>;collector_mode:string|null;collector_version:string|null;processing_status:'collected'|'ai_processing'|'ai_completed'|'ready'|'published'|'failed';product_id:string|null;collector_name:string|null;variant_count:number;min_price:string|null;max_price:string|null;collected_at:string;created_at:string;updated_at:string }
export type CollectedVariant = { id:string;position:number;external_sku_id:string|null;label:string;attributes:Record<string,string>;image_url:string|null;price_text:string|null;price:string|null;stock_text:string|null;stock:string|null;raw_data:Record<string,unknown> }
export type CollectedProductDetail = { product:CollectedProduct;variants:CollectedVariant[] }
export type AiModel = 'qwen3.7-flash'|'qwen3.7-plus'|'qwen3.6-plus'
export type AiMessage = { id:string;role:'user'|'assistant';content:string;input_tokens:number|null;output_tokens:number|null;latency_ms:number|null;created_at:string }
export type Quote = { id:string;account_id:string;opportunity_id:string|null;contact_id:string|null;owner_id:string|null;quote_number:string;version:number;status:string;currency:string;valid_until:string|null;payment_terms:string|null;shipping_cost:string;subtotal:string;discount_amount:string;tax_amount:string;total_amount:string;notes:string|null;created_at:string;updated_at:string;account_name:string;opportunity_name:string|null;contact_name:string|null;owner_name:string|null;item_count:number }
export type QuoteItem = { id:string;quote_id:string;product_id:string|null;line_number:number;sku:string|null;description:string;specifications:Record<string,string>;quantity:string;unit:string;unit_price:string;discount_rate:string;line_total:string }
export type QuoteInputItem = { productId:string;quantity:number;unit:string;unitPrice?:number|null;discountRate:number;description?:string|null;specifications?:Record<string,string> }
export type QuoteInput = { accountId:string;opportunityId?:string|null;contactId?:string|null;validUntil?:string|null;paymentTerms?:string|null;shippingCost:number;discountAmount:number;taxAmount:number;notes?:string|null;items:QuoteInputItem[] }
export type QuoteDetail = { quote:Quote&{province:string|null;credit_level:string|null};items:QuoteItem[] }

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message)
  }
}

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const clearToken = () => localStorage.removeItem(TOKEN_KEY)

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...(options.body != null ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  })
  if (response.status === 401 && path !== '/api/auth/login') {
    clearToken()
    window.dispatchEvent(new Event('crm:unauthorized'))
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string; details?: unknown }
    throw new ApiError(response.status, body.message ?? '请求未能完成，请稍后重试。', body.details)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export async function login(email: string, password: string) {
  const result = await request<{ token: string; user: SessionUser }>('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email, password, tenant: 'default' }),
  })
  localStorage.setItem(TOKEN_KEY, result.token)
  return result.user
}

export async function getCurrentUser() {
  return (await request<{ user: SessionUser }>('/api/auth/me')).user
}

export async function getLeads(params: { search?: string; status?: string } = {}) {
  const query = new URLSearchParams({ page: '1', pageSize: '50' })
  if (params.search) query.set('search', params.search)
  if (params.status) query.set('status', params.status)
  return request<{ data: Lead[]; pagination: { page: number; pageSize: number; total: number } }>(`/api/leads?${query}`)
}

const cleanLeadInput = (data: Partial<LeadInput>) => Object.fromEntries(Object.entries(data).map(([key, value]) => [key, typeof value === 'string' && value.trim() === '' ? null : value]))
export const createLead = (data: LeadInput) => request<{ data: Lead }>('/api/leads', { method: 'POST', body: JSON.stringify(cleanLeadInput(data)) })
export const updateLead = (id: string, data: Partial<LeadInput>) => request<{ data: Lead }>(`/api/leads/${id}`, { method: 'PATCH', body: JSON.stringify(cleanLeadInput(data)) })
export const deleteLead = (id: string) => request<void>(`/api/leads/${id}`, { method: 'DELETE' })
export const checkLeadDuplicates = (data: { companyName: string; email?: string | null; phone?: string | null; website?: string | null; excludeLeadId?: string }) => request<{ data: DuplicateCandidate[] }>('/api/leads/check-duplicates', { method: 'POST', body: JSON.stringify({ ...data, email:data.email || null, phone:data.phone || null, website:data.website || null }) })
export const getAssignableUsers = () => request<{ data: AssignableUser[] }>('/api/users/assignable')
export const getLeadActivities = (id: string) => request<{ data: LeadActivity[] }>(`/api/leads/${id}/activities`)
export const createLeadActivity = (id: string, data: { activityType: string; content: string; nextAction?: string | null; nextActionAt?: string | null }) => request<{ data: LeadActivity }>(`/api/leads/${id}/activities`, { method: 'POST', body: JSON.stringify(data) })
export const convertLead = (id: string, data: { accountName?: string; createOpportunity: boolean; opportunityName?: string; amount?: number; expectedCloseDate?: string | null; force?: boolean }) => request<{ data: { account: { id: string; name: string }; opportunity: { id: string; name: string } | null } }>(`/api/leads/${id}/convert`, { method: 'POST', body: JSON.stringify(data) })

const cleanInput = <T extends object>(data: T) => Object.fromEntries(Object.entries(data).map(([key, value]) => [key, typeof value === 'string' && value.trim() === '' ? null : value]))
export async function getAccounts(params: { search?: string; lifecycleStatus?: string; creditLevel?: string } = {}) {
  const query = new URLSearchParams({ page: '1', pageSize: '50' })
  if (params.search) query.set('search', params.search)
  if (params.lifecycleStatus) query.set('lifecycleStatus', params.lifecycleStatus)
  if (params.creditLevel) query.set('creditLevel', params.creditLevel)
  return request<{ data: Account[]; pagination: { page: number; pageSize: number; total: number } }>(`/api/accounts?${query}`)
}
export const getAccount = (id: string) => request<{ data: AccountDetail }>(`/api/accounts/${id}`)
export const createAccount = (data: AccountInput) => request<{ data: Account }>('/api/accounts', { method: 'POST', body: JSON.stringify(cleanInput(data)) })
export const updateAccount = (id: string, data: Partial<AccountInput>) => request<{ data: Account }>(`/api/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(cleanInput(data)) })
export const deleteAccount = (id: string) => request<void>(`/api/accounts/${id}`, { method: 'DELETE' })
export const createContact = (accountId: string, data: ContactInput) => request<{ data: Contact }>(`/api/accounts/${accountId}/contacts`, { method: 'POST', body: JSON.stringify(cleanInput(data)) })
export const updateContact = (accountId: string, contactId: string, data: Partial<ContactInput>) => request<{ data: Contact }>(`/api/accounts/${accountId}/contacts/${contactId}`, { method: 'PATCH', body: JSON.stringify(cleanInput(data)) })
export const deleteContact = (accountId: string, contactId: string) => request<void>(`/api/accounts/${accountId}/contacts/${contactId}`, { method: 'DELETE' })

export async function getOpportunities(params:{ search?:string;status?:string;ownerId?:string;accountId?:string }={}) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key,value]) => { if (value) query.set(key,value) })
  return request<OpportunityBoard>(`/api/opportunities?${query}`)
}
export const getOpportunityStages = () => request<{ data:OpportunityStage[] }>('/api/opportunities/stages')
export const getOpportunity = (id:string) => request<{ data:OpportunityDetail }>(`/api/opportunities/${id}`)
export const createOpportunity = (data:OpportunityInput) => request<{ data:Opportunity }>('/api/opportunities',{ method:'POST',body:JSON.stringify(cleanInput(data)) })
export const updateOpportunity = (id:string,data:Partial<Omit<OpportunityInput,'stageId'|'accountId'|'primaryContactId'>>) => request<{ data:Opportunity }>(`/api/opportunities/${id}`,{ method:'PATCH',body:JSON.stringify(cleanInput(data)) })
export const advanceOpportunity = (id:string,data:{ stageId:string;note:string;nextAction?:string|null;nextActionAt?:string|null;lostReason?:string|null }) => request<{ data:Opportunity }>(`/api/opportunities/${id}/stage`,{ method:'POST',body:JSON.stringify(cleanInput(data)) })
export const createOpportunityActivity = (id:string,data:{ activityType:string;content:string;nextAction?:string|null;nextActionAt?:string|null }) => request<{ data:LeadActivity }>(`/api/opportunities/${id}/activities`,{ method:'POST',body:JSON.stringify(cleanInput(data)) })
export const deleteOpportunity = (id:string) => request<void>(`/api/opportunities/${id}`,{ method:'DELETE' })
export async function getProducts(params:{search?:string;category?:string;status?:string}={}){const query=new URLSearchParams();Object.entries(params).forEach(([key,value])=>{if(value)query.set(key,value)});return request<{data:Product[]}>(`/api/products?${query}`)}
export const getProduct=(id:string)=>request<{data:Product}>(`/api/products/${id}`)
export const createProduct=(data:ProductInput)=>request<{data:Product}>('/api/products',{method:'POST',body:JSON.stringify(cleanInput(data))})
export const updateProduct=(id:string,data:Partial<ProductInput>)=>request<{data:Product}>(`/api/products/${id}`,{method:'PATCH',body:JSON.stringify(cleanInput(data))})
export const deleteProduct=(id:string)=>request<void>(`/api/products/${id}`,{method:'DELETE'})
export async function getCollectedProducts(params:{search?:string;source?:string;status?:string}={}){const query=new URLSearchParams();Object.entries(params).forEach(([key,value])=>{if(value)query.set(key,value)});return request<{data:CollectedProduct[]}>(`/api/product-collections?${query}`)}
export const getCollectedProduct=(id:string)=>request<{data:CollectedProductDetail}>(`/api/product-collections/${id}`)
export const deleteCollectedProduct=(id:string)=>request<void>(`/api/product-collections/${id}`,{method:'DELETE'})
export const createCollectorKey=()=>request<{data:{id:string;name:string;key_prefix:string;key:string;created_at:string}}>('/api/product-collections/access-key',{method:'POST'})
export const getAiModels=()=>request<{data:{provider:'qwen';configured:boolean;defaultModel:AiModel;models:AiModel[]}}>('/api/ai/models')
export const sendAiMessage=(data:{message:string;conversationId?:string|null;model?:AiModel;context?:{page?:string;pageTitle?:string}})=>request<{data:{conversationId:string;message:AiMessage;model:string}}>('/api/ai/chat',{method:'POST',body:JSON.stringify(data)})
export async function getQuotes(params:{search?:string;status?:string}={}){const query=new URLSearchParams();Object.entries(params).forEach(([key,value])=>{if(value)query.set(key,value)});return request<{data:Quote[]}>(`/api/quotes?${query}`)}
export const getQuote=(id:string)=>request<{data:QuoteDetail}>(`/api/quotes/${id}`)
export const createQuote=(data:QuoteInput)=>request<{data:{quote:Quote;items:QuoteItem[]}}>('/api/quotes',{method:'POST',body:JSON.stringify(cleanInput(data))})
export const updateQuote=(id:string,data:Partial<Omit<QuoteInput,'accountId'|'opportunityId'|'contactId'>>)=>request<{data:Quote}>(`/api/quotes/${id}`,{method:'PATCH',body:JSON.stringify(cleanInput(data))})
export const deleteQuote=(id:string)=>request<void>(`/api/quotes/${id}`,{method:'DELETE'})
