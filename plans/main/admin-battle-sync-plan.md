# 將歷史戰績同步移至 admin

## 需求與範圍

- 移除管理總覽同步入口，改在 admin 帳號管理的「資料維護」分頁開啟既有預覽視窗。
- 前端及 HTTP／GAS 後端均僅限 admin；manager／member 不可預覽或確認同步。現有舊名比對、同名衝突、交易及重試規則保持。
- 更新操作手冊、截圖及權限說明；說明目前 npm test 為 Node.js 內建測試，瀏覽器驗證／截圖則使用臨時 Playwright 腳本操作 Chrome，尚無專案內的正式 Playwright 套件。
- 不讀私人帳號檔、不操作正式戰績、不上傳或發布 GAS。

## 步驟與驗證

1. 搬移入口及收緊後端權限；測試 admin 成功、manager／member／匿名拒絕、CSRF 與同步流程，編譯本機及 GAS。
2. 以編譯 HTML 和隔離 GAS 模擬驗證桌面／手機及焦點、同步成功；更新截圖及 Markdown／離線 HTML／PDF，提交功能及文件。

## 結果

- npm test：216 項通過，含 HTTP／GAS 的 manager／member 拒絕、admin 成功與 CSRF。
- npm run build／build:gas 通過，GAS 產物無外部 JS／CSS 依賴。
- Playwright 操作 Chrome 已確認管理總覽無同步入口、admin 資料維護可開預覽、manager 無帳號管理入口且不能直接開頁、member 不提供此入口。沿用隔離測試確認載入、錯誤重試、舊名／衝突、過期預覽、安全重試、手機分頁及焦點返回。
- 手冊第 8 版與 admin 預覽截圖已更新，離線 HTML／PDF 驗證進行中。
- 未上傳 GAS、更新部署或執行正式戰績同步。
