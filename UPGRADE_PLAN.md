# 2345 多店叫貨系統 — 升級計畫與進度追蹤

> 用途：對抗對話壓縮遺忘。每次繼續工作前，AI 先讀這份文件接上進度。
> 專案：lcym346-byte/2345（多店商品叫貨管理系統）
> 線上：https://lcym346-byte.github.io/2345/index.html
> Firebase 專案：stockflow-web-pro
> 部署：GitHub Pages（Firebase 部署 workflow 一直失敗，但不影響，可無視或停用）

---

## 一、系統現況（已盤點確認）

- 架構：純 JS 多頁（每頁一個 .html + js/pages/*.js），非 React。React 版(src/)是半成品，不用。
- 核心檔：js/core/auth.js（登入守衛，requireLogin 為 async）、firebase-config.js、i18n.js（語言 key = 'app_lang'）。
- 資料模型：products（全公司共用，含 availableFor: all/hq_only/stores_only）、
  stores、categories、suppliers、inventory（storeId_productId）、orders（8 種狀態流程）、
  stockMovements（異動紀錄，只可新增不可改）、settings/global、users。
- 商品目前「全公司共用一份」，沒有「哪些店在賣」的欄位。
- 系統目前「沒有銷售概念」，不是 POS，是純叫貨+庫存。

### 已修正的 Bug
- [x] settings-page.js 開頭 import 錯誤（原本 import 不存在的 auth-check.js、
      requireLogin() 當同步用）→ 已改為 import '../core/auth.js' + await requireLogin(['admin'])，
      db 改用 window.firebaseDB。（已由使用者套用）

### 已知待處理小問題（低優先）
- [ ] settings-page.js 語言切換存的 key 是 'lang'，但 i18n.js 讀的是 'app_lang'，
      改語言不生效。修法：把 localStorage.setItem('lang', ...) 改成 'app_lang'。
- [ ] Firestore 複合索引：order/inventory/report 有 where+orderBy 查詢，
      第一次遇到載入失敗時，照錯誤訊息點連結建索引即可（非程式 bug）。
- [ ] 刪使用者時 Firebase Auth 帳號要手動去 Console 刪（純前端限制）。

---

## 二、目標藍圖：原料→成品→銷售→補貨 完整鏈

需求全貌：
1. 各店賣的品項不同，各店自動讀取自己店的菜單（不用手動輸入）。
2. 進貨進來的是「原料」；各店把原料轉成「備貨成品」；賣出的是成品。
3. 賣出成品 → 依配方(BOM)換算 → 扣對應原料庫存。
4. 各店設定各自的安全量；結班盤點後，庫存低於或逼近安全量 → 警報提醒叫貨。
5. 補貨量依安全量計算（補到安全水位）。
6. 銷售資料來源：各店有各自的 POS 專案（如 033123 那種），
   開班/結班會產生報表，要「跨 Firebase 專案」把結班報表抓進 2345。
   跨專案：POS 在別的 Firebase，2345 在 stockflow-web-pro；帳密相同
   （注意：帳密相同 ≠ 同帳號，兩個 Firebase 各自獨立的使用者系統）。

---

## 三、分階段實作計畫（依此順序做）
> 規約（每次動工前後都要遵守）：
> 1. 資料結構先定死再寫程式，不邊做邊改欄位。
> 2. 一次只做一個子階段，做完 commit 並更新「五、進度記錄」再往下。
> 3. 每個子階段都要記：動了哪些檔、用了哪些 Firestore 指令、完成定義、commit 位置。
> 4. 依賴順序不可跳：2A→2B 純內部可先做；3 純計算；4 卡在使用者提供 POS 資料；5 整合。

### 資料結構定案（BOM 與品項類型）— 實作前的地基，勿更動
- products 新增欄位 `itemType`：`'raw' | 'prep' | 'product'`（原料/備料/成品）。
  舊資料無此欄位者一律視為 `'product'`（現有品項皆為可下單品）。
  定義：raw=最原始進貨（生雞翅、麵粉）；prep=加工半成品（醃雞翅、發酵麵糰）；
  product=菜單實際賣品（雞翅裹粉、麵包）。
- 配方採「遞迴式 BOM」：每個品項都可有自己的配方 components，
  component 指向另一個品項 → 支援不固定層數（原料→備料→成品，或原料→成品）。
  範例：product「雞翅」recipe = [醃雞翅×1, 炸粉, 油, 胡椒, 紙袋×1, 塑膠袋×1]；
       prep「醃雞翅」recipe = [生雞翅, 醃料]。賣 1 份雞翅 → 遞迴展開扣到最底層原料。
- 配方儲存位置【階段 3 開工前二選一，尚未拍板】：
  選項A：products 每筆加 `recipe` 陣列欄位 `[{componentId, qty, unit}]`（傾向此案，規模適合）。
  選項B：獨立 `boms` collection（配方量極大時才用）。
- 基準量：沿用 inventory 每筆的 `safetyStock`（各店獨立，已具備）。
  警示邏輯＝逐品項各比各的 safetyStock，結班報表列出 `qty < safetyStock` 的品項。
  （非「某類加總比一個總基準」，不需新增總基準結構。）
- 套餐/變動配方（如套餐改紙袋塑膠袋）：第一版只做單品遞迴 BOM，
  套餐覆寫規則列為後續增強，勿在第一版一起吞。
### 階段 1：各店菜單 + 各店獨立安全量  ← 【目前在這裡，尚未開始】
- [已添加] 給 products 加 storeIds 欄位（陣列，標記哪些店在賣；空或含 '*' = 全部店）。
- [已添加] products.html 商品編輯彈窗加「販售分店」多選 checkbox（列出所有分店 + 全部）。
- [已添加 ] products-page.js：載入分店清單、彈窗渲染勾選、儲存寫入 storeIds。
- [已添加] 過濾邏輯：商品頁與叫貨頁依登入者 storeId 過濾（admin 全看，分店只看自己店的）。
- [已添加] 各店獨立安全量：inventory 每筆已有 safetyStock，確認各店可各自設定。
- 決策已定：商品仍由 admin 維護（分店進不了商品頁）；
  舊資料無 storeIds 者視為「全部店都賣」。
- 此階段不依賴跨專案，風險最低，先做。

### 階段 2A：品項類型 itemType  ← 【下一步從這裡開始，純 2345 內部，不碰 POS/BOM】
## 階段 2A — 品項類型欄位 itemType（基礎，先做）

### 目標
在 products 加一個 `itemType` 欄位，值為 `raw`(原料) / `prep`(備料) / `product`(成品)。
這是後續階段 3（BOM 遞迴扣庫存）與階段 2B（結班盤點分類警示）的前置基礎，
本階段只加欄位＋UI＋讀寫，不動任何扣庫存邏輯。

### 完成定義（做到這裡才算 2A 完成）
- [ ] products.html 商品彈窗新增「品項類型」下拉，插在「分類 fCategory」select 之後
- [ ] products-page.js 的 f 物件加 itemType
- [ ] openModal 讀取 item.itemType（新品預設 'product'）
- [ ] saveProduct 寫入 itemType 進 data
- [ ] renderList 商品卡片顯示類型標籤（可選，方便肉眼分辨）
- [ ] 舊資料沒有 itemType 時視為 'product'（向後相容，不需批次補寫）

### 影響檔案與確切改法

**檔案 1：products.html**（sha 564b3b7）
在「分類」select 區塊之後、「供應商」label 之前，插入：
```html
      <label>品項類型 <span class="required">*</span></label>
      <select id="fItemType">
        <option value="product">成品（可販售 / 對應菜單）</option>
        <option value="prep">備料（半成品，如已醃雞翅、發酵麵糰）</option>
        <option value="raw">原料（如生雞翅、麵粉）</option>
      </select>


### 階段 2B：純手動結班盤點 + 逐品項基準量警示  【不碰 POS/BOM】
- [ ] 新增「結班盤點」批次流程：進入模式 → 列全店原料+備料（成品選配）→ 逐項填實際量 → 一次送出。
- [ ] 送出時每項差異寫 stockMovements（type='stocktake'），更新 inventory.qty。
- [ ] 產生一筆結班盤點記錄（新結構，如 stocktakeSessions）。
- [ ] 結班報表（report-page.js）列出 qty < safetyStock 的品項當警示清單。
- 會動的檔：inventory-page.js（批次盤點 modal 與送出）、report-page.js（警示區）、
  可能新增結班盤點記錄結構。
- Firestore 指令：writeBatch（批次寫 inventory qty + 多筆 stockMovements）；
  addDoc/setDoc 寫結班盤點記錄。
- 完成定義：能一次盤完全店、留記錄、報表出警示。此時「賣出自動扣」仍為手動。

### 階段 3：遞迴 BOM 配方結構 + 維護介面  【開工前先拍板 recipe 存法 A/B】
- [ ] 決定並套用 recipe 存法（A：products.recipe 欄位 / B：boms collection）。
- [ ] 新增配方維護介面（選 component 品項、填用量 qty/unit）。
- [ ] 新增 js/core/bom.js：遞迴展開函式 explodeBOM(productId, qty)
      → 回傳「最終要扣的各原料/備料數量」（純計算，不扣庫存）。
- 會動的檔：products-page.js 或新頁（配方維護）、新增 js/core/bom.js。
- Firestore 指令：setDoc(merge) 寫 recipe；讀取用現有 getDocs。
- 完成定義：給一個成品+份數，能正確算出跨層要扣的原料總量（純算，先不動庫存）。

### 階段 4：接 POS 第二條 Firebase 連線，讀當日賣出成品  【擋住：需使用者提供 POS 資料】
- 前置（未提供則此階段無法開工）：
  - [ ] POS（033123）的 firebaseConfig 全包（apiKey/authDomain/projectId/databaseURL 等）。
        來源：033123 專案的 firebase-config.js。
  - [ ] POS 當日銷售/結班在 Firestore 的 collection 名稱與欄位
        （賣出品項 id/名、數量、日期）。
  - [ ] 確認 POS 專案 security rules 允許此帳號讀該資料。
- 注意：2345 與 POS 是兩個獨立 Firebase 專案；帳密相同 ≠ 同帳號。
  做法是在 2345 用 initializeApp(posConfig, 'posApp') 開「第二條連線」，
  不是改讀取路徑。POS config 會出現在前端原始碼（Firebase config 設計可公開，安全靠 rules）。
- [ ] 新增 js/core/pos-firebase.js：initializeApp(posConfig,'posApp') + getFirestore。
- [ ] 讀 POS 當日賣出成品清單並在 2345 列出。
- 會動的檔：新增 js/core/pos-firebase.js、結班盤點流程接入。
- Firestore 指令：initializeApp(第二 app)、getFirestore(posApp)、getDocs/query/where。
- 完成定義：能在 2345 列出「POS 今天賣了哪些成品各幾份」。

### 階段 5：自動盤點總整合（賣出成品 × BOM → 理論消耗 → 初盤值 → 人工核對 → 送出）  【整合 2B+3+4】
- [ ] 當日賣出（階段4）逐筆丟進 explodeBOM（階段3）→ 加總「今日理論消耗」。
- [ ] 用「昨日結存 − 理論消耗」當本次盤點初始值，填入階段2B的盤點表。
- [ ] 結班人員核對修改後送出（走 2B 的 writeBatch 批次寫入）。
- 會動的檔：結班盤點流程（整合既有模組）。
- 完成定義：結班時一鍵匯入 POS → 自動算好初盤值 → 人工改 → 送出 → 報表警示，全流程打通。

---

## 四、待使用者提供 / 待確認
- [ ] 各店 POS 專案的 Firebase config（apiKey、projectId 等）.讀取dawang0699-cmd/033123專案查看POS 專案的的架構.兩個專案的Firebase不同但是登入的帳號密碼與權限相同。
- [ ] POS 結班報表在 Firestore 的 collection 名稱與欄位結構（賣出品項、數量）。
- [ ] 補貨公式確認：目前定為「補到安全量水位」。
- [ ] 「逼近安全量」的門檻定義（例如低於安全量 120% 就提醒？）。

---

## 五、進度記錄（每次做完更新這裡）
- 2026-XX-XX：完成系統全面盤點；修好 settings-page.js 致命 import bug。
- 2026-09-19：完成階段 1（各店菜單 + 各店獨立安全量）。
  - 修正 order-page.js `renderProductPicker` 的巢狀 filter bug
    （storeIds 過濾原本寫在外層 filter callback 內導致失效）→ 改為 availableFor、storeIds 兩道獨立 filter。
  - 確認 inventory-page.js：各店安全量讀寫皆為 inventory/{storeId}_{productId}（saveSafety、applyStockChange 均 merge 寫該筆），各店互不影響；filterProductsByStore 為正確單層過濾。
  - 確認 products-page.js 販售分店 UI + storeIds 寫入已完成；auth.js requireLogin 回傳含 storeId。
  - 實際動到的檔：僅 order-page.js。其餘為確認無需修改。
- （下次繼續：從階段 2A「品項類型 itemType」開始。實作前先讀本檔「資料結構定案」段。）
