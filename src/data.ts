export const pipeline = [
  { name: '线索', count: 126, amount: '—', tone: 'slate' },
  { name: '客户', count: 84, amount: '—', tone: 'blue' },
  { name: '商机', count: 38, amount: '¥1280万', tone: 'cyan' },
  { name: '报价', count: 24, amount: '¥830万', tone: 'teal' },
  { name: '订单', count: 11, amount: '¥412万', tone: 'green' },
  { name: '回款', count: 8, amount: '¥286万', tone: 'gold' },
]

export const priorities = [
  { company: '华东智控科技', region: '上海', contact: '李雯', action: '确认 C23 报价有效期', time: '16:30', score: 96, risk: '高意向' },
  { company: '岭南供应链', region: '广东', contact: '陈杰', action: '发送新品样品清单', time: '15:00', score: 91, risk: '复购窗口' },
  { company: '京华商贸', region: '北京', contact: '王璐', action: '回复交期与包装要求', time: '17:00', score: 87, risk: '待回复' },
  { company: '成渝机电', region: '四川', contact: '赵楠', action: '跟进逾期定金', time: '14:00', score: 79, risk: '回款风险' },
]

export const activities = [
  { icon: 'mail', title: '华东智控回复了报价消息', detail: '询问 2,000 件的阶梯价格', time: '12 分钟前' },
  { icon: 'spark', title: 'AI 识别到一组相似线索', detail: '2 条记录可能属于岭南供应链', time: '28 分钟前' },
  { icon: 'deal', title: '京华商贸商机推进', detail: '需求确认 → 方案报价', time: '1 小时前' },
  { icon: 'task', title: '样品寄送任务即将到期', detail: '负责人：陈薇 · 今天 18:00', time: '2 小时前' },
]

export const leads = [
  { company: '苏州恒新商贸', region: '江苏', source: '官网咨询', product: 'C23 智能温控器', owner: '待分配', status: '新线索', score: 92 },
  { company: '青岛宜居科技', region: '山东', source: '行业展会', product: 'H8 空气净化器', owner: '陈薇', status: '已联系', score: 86 },
  { company: '武汉拓能设备', region: '湖北', source: '抖音企业号', product: 'P12 便携电源', owner: '周凯', status: '跟进中', score: 81 },
  { company: '宁波海曙电器', region: '浙江', source: '客户转介绍', product: 'C23 智能温控器', owner: '陈薇', status: '待转化', score: 77 },
]

export const customers = [
  { company: '华东智控科技', region: '上海', level: 'A', owner: '陈薇', value: '¥186.4万', last: '今天', health: 94 },
  { company: '岭南供应链', region: '广东', level: 'A', owner: '周凯', value: '¥142.8万', last: '昨天', health: 89 },
  { company: '京华商贸', region: '北京', level: 'B', owner: '陈薇', value: '¥78.2万', last: '3 天前', health: 82 },
  { company: '成渝机电', region: '四川', level: 'B', owner: '林森', value: '¥63.5万', last: '12 天前', health: 61 },
]

export const opportunities = [
  { company: '华东智控科技', name: 'Q3 智能家居采购', stage: '商务谈判', value: '¥128万', probability: 82, close: '8月 20日' },
  { company: '京华商贸', name: '门店空气净化项目', stage: '方案报价', value: '¥86.5万', probability: 64, close: '9月 5日' },
  { company: '岭南供应链', name: '秋季新品补货', stage: '需求确认', value: '¥54.8万', probability: 46, close: '9月 18日' },
  { company: '青岛宜居科技', name: '旗舰店试单', stage: '初步接触', value: '¥32万', probability: 28, close: '10月 2日' },
]
