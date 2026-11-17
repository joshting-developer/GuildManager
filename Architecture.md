# 網站架構

前端使用 Vue 3、Vuetify 與 Vite, 由 `src/api/` 透過同源 `/api` 呼叫 Node.js／Express。元件不直接讀寫資料庫或檔案服務

後端以 Route／Service／Repository／Domain 分工, 沿用 JavaScript ESM。`server/index.js` 只接 MySQL 非同步 Repository, 不回退 SQLite。詳細分層、交易及錯誤處理見 [Node.js 分層規範](docs/nodejs-architecture.md)

## 儲存與啟動

- MySQL 保存帳號、Session、成員、活動、報名、排表、戰績與檔案 metadata
- 私有物件儲存保存原始 CSV、圖片與平台圖示, 後端驗證權限後提供讀寫, 憑證不進前端
- migration 必須明確執行, HTTP 啟動只檢查連線與版本, 不自動建表或匯入資料
- 本地使用共用 MySQL 的專用開發庫, 測試使用另外四組隔離庫, 詳見 [MySQL 開發說明](docs/mysql-development.md)
- development 由 Vite `localhost:5173` 代理 `/api` 至 Express `localhost:3001`
- production 由 Express 同時提供 `dist/` 與 `/api`, HTTPS 由可信反向代理終止, 設定見 [README](README.md)

## 安全與一致性

登入沿用 HttpOnly Session cookie、角色檢查及寫入 CSRF 驗證。修改使用 revision 偵測衝突, requestId 保存重試結果, 不可變排表與戰績快照不因名冊更新而改寫

MySQL 交易只有一個 owner, 所有查詢必須 await。通知在成功提交後送出；物件寫入與資料庫的失敗復原見 [檔案服務](docs/r2-storage.md)

產品契約由 [工程入口](docs/project-engineering-bindings.md) 索引, 介面規範見 [Style](Style.md)。舊版資料尚未匯入, 本地驗證不代表正式服務已切換
