# 多店商品叫貨管理系統

基於 React + Firebase 的連鎖門市叫貨管理平台，手機優先設計。

## 技術棧
- React 18 + Vite + TypeScript
- Tailwind CSS + Lucide Icons
- Firebase (Auth / Firestore / Functions / Hosting)
- i18next 多語系（繁中、簡中、英、日、韓、越、泰、印尼）
- PWA 支援

## 開發階段
- [x] 階段一：專案骨架、登入、權限、多語系、PWA
- [ ] 階段二：商品、分店、供應商基礎資料
- [ ] 階段三：叫貨單核心流程
- [ ] 階段四：庫存管理
- [ ] 階段五：報表、通知、ERP 串接

## 本機開發
1. `npm install`
2. 複製 `.env.example` 為 `.env`，填入 Firebase 設定
3. `npm run dev`

## 部署
推送到 main 分支自動部署，或本機執行 `npm run deploy`。
