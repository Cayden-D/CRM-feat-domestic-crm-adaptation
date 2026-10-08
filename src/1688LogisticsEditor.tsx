import {updateItemLogistics,validateLogistics} from '../shared/1688-logistics'
export default function LogisticsEditor({fields,value,disabled,onChange,title='件重尺 · 按商品设置',labelPrefix=''}:{fields:Record<string,any>;value:Record<string,any>|undefined;disabled:boolean;onChange:(value:unknown)=>void;title?:string;labelPrefix?:string}){
  const info=value?.offerInfo||{}
  const errors=validateLogistics(fields,value)
  return <fieldset className="shop-property-fields"><legend>{title}{fields.required||fields.logisticsRequired?' *':''}</legend>
    <p className="shop-note">适用于所有规格使用相同销售包装重量的商品。填写商品含销售包装的实际重量；尺寸可全部留空，填写时需满足长 ≥ 宽 ≥ 高。</p>
    <div className="shop-form-columns">{([{key:'weight',label:'含包装重量（g）',step:1},{key:'length',label:'包装长（cm）',step:0.1},{key:'width',label:'包装宽（cm）',step:0.1},{key:'height',label:'包装高（cm）',step:0.1}] as const).map(field=><label key={field.key}>{field.label}{field.key==='weight'?' *':''}<input aria-label={`${labelPrefix}${field.label}`} type="number" min={field.step} step={field.step} disabled={disabled} value={info[field.key]===0&&field.key!=='weight'?'':info[field.key]??''} onChange={e=>onChange(updateItemLogistics(value,field.key,e.target.value))}/></label>)}</div>
    <p className="shop-note">体积：{info.volume>0?`${info.volume} cm³`:'未填写尺寸'}（填写长宽高后自动计算）</p>
    {errors.length>0&&<p className="shop-local-error" role="status">{errors.join('；')}</p>}
  </fieldset>
}
