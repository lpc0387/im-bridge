# 外贸英文单据生成 Skill

## 概述

根据用户提供的外贸订单信息，生成排版清晰的英文版 Word 单据，重点支持：

- Proforma Invoice / 形式发票
- Packing List / 箱单

适用于用户只掌握部分信息的场景：已知产品、数量、单价、包装、重量、体积等，其余出口方、买方、港口、银行、日期等信息可先留空。

## 触发场景

当用户需要以下任一工作时使用：

- 生成外贸英文版箱单、形式发票、商业发票模板
- 将零散中文订单信息整理成英文单据
- 修正 `.docx` 单据的排版、字体、表格溢出、标题与数据错位
- 将 RMB 报价换算为 USD 参考价，并加入汇率浮动说明
- 在单据中保留空白字段，等待后续补充

## 工作流

### 1. 收集和确认关键信息

优先从用户描述中提取以下字段：

- 产品英文名称
- 数量与单位
- 单价与币种
- 总重量、总体积
- 包装方式，例如 carton packing
- 每箱数量，例如 300 pcs/carton
- 特殊备注，例如 hooks to be installed by buyer/user
- 定金比例与付款条款
- 是否需要 USD 参考价

若信息缺失，不要阻塞生成；可先留空，并在最后列出仍需补充的信息。

### 2. 金额和包装计算

常用计算方式：

- 金额 = 数量 × 单价
- 总金额 = 各产品金额合计
- 定金 = 总金额 × 定金比例
- 尾款 = 总金额 - 定金
- 箱数 = 数量 ÷ 每箱数量，可用 `~` 标注约数
- 总重量、总体积如果用户说“大概”，使用 `~` 表示，例如 `~3,000 KG`、`~10 CBM`

示例：

- Clothes Hangers: 20,000 PCS × RMB 1.80 = RMB 36,000.00
- Pants Hangers: 10,000 PCS × RMB 1.80 = RMB 18,000.00
- Subtotal: RMB 54,000.00
- Deposit 20%: RMB 10,800.00
- Balance 80%: RMB 43,200.00
- 300 pcs/carton → total approx. 100 cartons

### 3. RMB 转 USD 参考价

当用户说明价格单位是 RMB，但希望给 USD 参考价时：

- RMB 为准价，USD 仅作参考
- 如无法实时查询可靠汇率，使用明确说明的近似汇率
- 可加入 2%–5% 汇率浮动或手续费缓冲
- 金额建议四舍五入成便于报价的数字

推荐备注写法：

```text
RMB unit price is authoritative. USD amount is for reference only, calculated at approx. 1 USD = RMB [rate] plus ~[buffer]% buffer.
```

若使用折算后单价，也可写：

```text
RMB 1.80/pc, approx. USD 0.26/pc for reference only.
```

### 4. 英文措辞规范

产品名称可按用户中文语义翻译，例如：

- 衣服的衣架 → Clothes Hangers
- 裤子的衣架 → Pants Hangers

特殊备注示例：

```text
Hooks of the hangers need to be installed by buyer/user.
```

包装表达示例：

```text
Carton packing; 300 pcs/carton; total approx. 100 cartons.
```

付款条款示例：

```text
20% deposit; balance before shipment
```

### 5. Word 排版要求

生成 `.docx` 时应注意：

- 字体使用 Arial 或 Calibri
- 标题居中加粗，如 `PROFORMA INVOICE`、`PACKING LIST`
- 表格使用固定布局，避免内容挤出边界
- 金额栏要足够宽，金额过长时拆成独立 summary 表
- 表头和数据必须逐列对应，尤其是箱单：
  - Qty → 数量
  - Unit → PCS / SETS 等
  - Packages → CTNS
  - N.W. KG → 净重
  - G.W. KG → 毛重
  - CBM → 体积
- 空格不要过多，字段名可用紧凑写法：
  - Exporter/Seller
  - Buyer/Consignee
  - Vessel/Flight
  - ETD/ETA
- 未知字段留空，不要用大量占位符撑开排版
- 对约数使用 `~`，如 `~100 CTNS`

### 6. 推荐单据结构

#### Proforma Invoice

建议包含：

1. 标题
2. Exporter/Seller、Buyer/Consignee、Invoice No.、Date
3. Incoterms、Payment Terms、Currency、Port 信息
4. 产品明细表
5. 金额汇总表：Subtotal / Deposit / Balance
6. 包装、重量、体积、汇率备注、特殊备注
7. Bank Information
8. Authorized Signature & Company Stamp

#### Packing List

建议包含：

1. 标题
2. Exporter/Seller、Buyer/Consignee、Packing List No.、Date
3. Invoice No.、Shipping Marks
4. Port、Vessel/Flight、ETD/ETA
5. 箱单明细表
6. 包装详情、总毛重、总体积、备注
7. Authorized Signature & Company Stamp

### 7. 生成文件

默认建议输出到：

```text
docs/export-templates/
```

文件名建议：

```text
Proforma_Invoice_Filled_EN.docx
Packing_List_Filled_EN.docx
```

如果仓库中没有 `python-docx`、`pandoc` 或 `libreoffice`，可以直接用 Python 标准库 `zipfile` 生成基本 DOCX：

- 写入 `[Content_Types].xml`
- 写入 `_rels/.rels`
- 写入 `word/document.xml`
- 写入 `docProps/core.xml`
- 写入 `docProps/app.xml`
- 最后用 `ZipFile.testzip()` 校验结构

### 8. 交付说明

完成后告诉用户：

- 已生成或覆盖的文件名
- 文件会通过 IM Bridge 自动作为附件发送
- 已填入的关键内容
- 仍留空、需要用户补充的字段
- 若使用了估算汇率，说明 RMB 为准、USD 为参考

硬性规则：不要在回复正文中包含任何以 `/` 开头的绝对路径，也不要暴露主机目录信息。文件由 IM Bridge 自动从工作区安全下发；如果当前平台不支持附件，会给出仅含文件名的降级提示。

示例交付：

```text
已生成最新版文件，并将作为附件发送：
- Proforma_Invoice_Filled_EN.docx
- Packing_List_Filled_EN.docx

RMB 单价为准，USD 金额仅供参考，已在形式发票中注明汇率和浮动说明。
```
