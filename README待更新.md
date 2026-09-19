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

### 階段 1：各店菜單 + 各店獨立安全量  ← 【目前在這裡，尚未開始】
- [ ] 給 products 加 storeIds 欄位（陣列，標記哪些店在賣；空或含 '*' = 全部店）。
- [ ] products.html 商品編輯彈窗加「販售分店」多選 checkbox（列出所有分店 + 全部）。
- [ ] products-page.js：載入分店清單、彈窗渲染勾選、儲存寫入 storeIds。
- [ ] 過濾邏輯：商品頁與叫貨頁依登入者 storeId 過濾（admin 全看，分店只看自己店的）。
- [ ] 各店獨立安全量：inventory 每筆已有 safetyStock，確認各店可各自設定。
- 決策已定：商品仍由 admin 維護（分店進不了商品頁）；
  舊資料無 storeIds 者視為「全部店都賣」。
- 此階段不依賴跨專案，風險最低，先做。

### 階段 2：結班盤點功能
- [ ] 新增結班盤點頁（或在 inventory 加盤點模式）：盤點實際庫存、寫 stockMovements。
- [ ] 結班盤點後觸發安全量比對與補貨警報。

### 階段 3：原料↔成品配方(BOM)
- [ ] 新增資料結構：成品由哪些原料、各多少量組成。
- [ ] 新增配方管理介面。
- [ ] 區分品項類型：原料 / 成品。

### 階段 4：跨 Firebase 抓 POS 銷售報表
- [ ] 【前置】取得各店 POS 專案的 Firebase 設定與結班報表資料結構（collection/欄位）。
      參考舊專案 033123 的結班報表格式。
- [ ] 在 2345 用 initializeApp(posConfig, 'posApp') 建第二個 Firebase 連線。
- [ ] 確認 POS 專案安全規則允許該帳號讀報表。
- [ ] 結班時抓 POS 報表（賣了哪些成品、各幾個）進 2345。

### 階段 5：銷售反扣原料 + 自動補貨 + 警報
- [ ] 銷售成品 → 依 BOM 反扣原料庫存 → 寫 stockMovements。
- [ ] 依各店安全量計算補貨量（目標安全水位 - 現有庫存）。
- [ ] 低於/逼近安全量 → 警報提醒叫貨（可串到現有 orders 流程）。

---

## 四、待使用者提供 / 待確認
- [ ] 各店 POS 專案的 Firebase config（apiKey、projectId 等）。
- [ ] POS 結班報表在 Firestore 的 collection 名稱與欄位結構（賣出品項、數量）。
- [ ] 補貨公式確認：目前定為「補到安全量水位」。
- [ ] 「逼近安全量」的門檻定義（例如低於安全量 120% 就提醒？）。

---

## 五、進度記錄（每次做完更新這裡）
- 2026-XX-XX：完成系統全面盤點；修好 settings-page.js 致命 import bug。
- （下次繼續：從階段 1 開始）
