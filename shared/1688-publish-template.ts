export const publishTemplateFields = [
  {key:'cbuUnit',label:'计量单位',options:[]},
  {key:'invReduce',label:'库存扣减设置',options:[{value:'1',text:'下单时扣减'},{value:'2',text:'支付时扣减'}]},
  {key:'supplyType',label:'供货方式',options:[{value:'1',text:'现货'},{value:'2',text:'定制'}]},
  {key:'onlineTrade',label:'网上订购',options:[{value:'17410',text:'支持'},{value:'-1',text:'不支持（仅限平台允许的类目）'}]},
  {key:'quotationType',label:'报价方式',options:[{value:'2',text:'按产品数量报价'},{value:'1',text:'按产品规格报价'}]},
] as const
export type ItemLogisticsTemplate = {
  showLogisticsCategory:'item'
  offerInfo:{weight:number;length:number;width:number;height:number;volume:number}
}
export type PublishTemplateValues = Partial<Record<typeof publishTemplateFields[number]['key'],string>> & {officialLogistics?:ItemLogisticsTemplate}
