# GAS admin 資料維護程式同步

## 範圍與驗證

- 使用者要求同步 GS；來源 a9afe73，包含歷史戰績／過去名稱同步，以及搬至 admin 帳號管理「資料維護」的入口與權限調整。
- 來源已通過 216 項測試、一般／GAS 編譯及 Playwright／Chrome 隔離瀏覽器驗證；本次由 gas:push 再次編譯、備份遠端、上傳四檔並讀回比對。
- 沿用指定指令碼與既有 clasp 授權，不讀出憑證，不執行 setupGas 或正式戰績同步，不更動私有設定、試算表、Drive 或 Web App 部署版本。
- 成功後記錄備份及同步來源，更新部署文件與專案狀態，提交紀錄。

## 結果

- 2026/10/05 執行 npm run gas:push 成功：重新編譯、備份原程式，上傳四檔後讀回內容完全一致。
- 同步來源 a9afe73；新增歷史戰績同步的入口／RPC，以及 admin 專屬權限均包含於此次套件。
- 私有遠端前後備份：data/gas-backups/2026-10-05T07-10-49-344Z/before 與 after（忽略、不提交）。
- 套件為 Index.html、Code.gs、Backend.gs、appsscript.json；前端約 1000.6 KB，HTML 無外部 JS／CSS 依賴，Google 接受上傳程式語法。
- 未執行初始化或正式戰績同步，未修改帳號、Script Properties、試算表／Drive、Web App 部署版本；本次未重新查詢已發布部署版本，正式頁面仍需由使用者更新既有部署。
