import {useState} from 'react'
import {deleteShopListing,type PlatformListing} from './1688Api'
export default function DeleteListing({listing,disabled,onBusy,deleted}:{listing:PlatformListing;disabled:boolean;onBusy:(busy:boolean)=>void;deleted:()=>void}){
  const [open,setOpen]=useState(false),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false)
  const state=listing.deletion_state||'active'
  if(state==='deleted')return <span className="shop-note" role="status">已移入平台回收站</span>
  if(state!=='active'||uncertain)return <span className="shop-local-error" role="status">删除结果待核对，请在 1688 回收站查看。</span>
  async function remove(){
    setBusy(true);onBusy(true);setError('')
    try{await deleteShopListing(listing.id,{confirmed:true,offerId:listing.offer_id,syncedAt:listing.synced_at});setOpen(false);deleted()}
    catch(e){setError(e instanceof Error?e.message:'删除未成功，请核对平台结果。');if(e instanceof Error&&e.message.includes('删除结果尚未确认')){setOpen(false);setUncertain(true)}}
    finally{setBusy(false);onBusy(false)}
  }
  return <><button className="shop-button danger" disabled={disabled} onClick={()=>{setConfirmed(false);setError('');setOpen(true)}}>移入回收站</button>
    {open&&<div className="dialog-layer shop-dialog"><button className="drawer-scrim" aria-label="取消删除" disabled={busy} onClick={()=>setOpen(false)}/><section className="shop-modal" role="alertdialog" aria-modal="true" aria-label="确认移入回收站"><header><h2>确认移入回收站</h2></header><div className="shop-modal-body"><p>店铺：{listing.display_name||'当前店铺'}</p><p>{listing.title}</p><p>商品 ID：{listing.offer_id}</p><p>商品将从店铺移入 1688 回收站，可在平台网站手动恢复。本地正式产品和历史关联记录保留。</p><label className="shop-review-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>确认移除上述平台商品</label>{error&&<p className="shop-local-error" role="alert">{error}</p>}</div><footer><button className="shop-button" disabled={busy} onClick={()=>setOpen(false)}>取消</button><button className="shop-button danger" disabled={!confirmed||busy} onClick={()=>void remove()}>{busy?'正在提交…':'确认移入回收站'}</button></footer></section></div>}
  </>
}
