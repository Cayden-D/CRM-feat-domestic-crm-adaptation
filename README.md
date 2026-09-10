# 销途 AI CRM

面向国内 B2B 销售团队的 AI 客户管理系统。产品范围见 [PRD.md](./PRD.md)。

## 已实现

- 销售作战台：AI 晨报、关键指标、销售全链路、优先跟进和实时动态
- 线索 CRUD、查重、分配、跟进、待办以及线索转客户/商机
- 客户档案、国内省市区地址、统一社会信用代码、联系人和客户 360
- 商机 CRUD、阶段推进、跟进待办、阶段历史、销售看板和人民币加权预测
- 产品库 CRUD、人民币阶梯价格和客户分级价格
- 人民币报价单、服务器自动计价、国内运费、税额、账期和报价预览
- JWT 登录、租户隔离、RBAC、审计日志和 PostgreSQL 迁移

销售作战台指标目前包含演示数据；全局 AI 助手已接入阿里云百炼千问。

## 技术栈

- 前端：React、TypeScript、Vite
- 后端：Fastify、TypeScript、Zod
- 数据库：PostgreSQL

## 本地启动

```powershell
npm install
Copy-Item .env.example .env
./database/init-db.ps1
npm run create-admin
```

分别启动前端和 API：

```powershell
npm run dev
npm run dev:api
```

前端默认地址为 `http://127.0.0.1:5173`，后端默认地址为 `http://127.0.0.1:3001`。

## 验证

```powershell
npm run build
npm run build:api
npm run test:api
npm run test:customers
npm run test:opportunities
npm run test:products-quotes
npm run test:product-collection
npm run test:ai
```

## 1688 商品采集

1. 登录 CRM，进入“1688 商品采集 → 配置采集器”。
2. 安装 Tampermonkey 脚本，生成并复制专用采集密钥。
3. 在 1688 商品详情页点击右下角商品采集器，填写 CRM API 地址与密钥。
4. 点击“采集此商品”即可保存完整商品；在列表页可启动本页或多页批量采集。

采集结果会按来源商品 ID 幂等更新，完整保留标题、主图、详情图、视频、卖家、源类目、商品属性、价格区间、SKU 维度、规格价格、库存和原始商品快照，作为后续 AI 清洗与官方接口发布的输入。重新生成采集密钥会立即吊销旧密钥。

## 千问大模型

服务端通过阿里云百炼 OpenAI 兼容接口调用千问。将配置写入 `.env.local` 后重启 API：

```env
DASHSCOPE_API_KEY=YOUR_DASHSCOPE_API_KEY
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_DEFAULT_MODEL=qwen3.7-flash
QWEN_TIMEOUT_MS=60000
```

使用业务空间时，将 `DASHSCOPE_BASE_URL` 替换为 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`。允许使用 `qwen3.7-flash`、`qwen3.7-plus` 和 `qwen3.6-plus`，默认优先选择 `qwen3.7-flash`。API Key 仅由后端读取，不会发送到浏览器。

## 数据模型约定

- 所有业务金额统一使用人民币 `CNY`，数据库使用定点数存储。
- 客户和线索使用省、市、区县及详细地址描述国内区域。
- 产品价格按数量和客户等级匹配，不维护外币或海外区域价格。
- 报价总额由产品小计、国内运费、整单折扣和税额组成。
- 时间统一存储为 UTC，界面按 `Asia/Shanghai` 展示。
- 已部署结构只通过新的编号迁移演进，不改写历史迁移。
