# GAS 自動上傳

使用者提供目標指令碼 ID：1rkY7EI6rHYNoH8TZmIOKQ-MWSCexXUdFTOqInqyfxBR1qMoI8DAf9hG5，已開啟 Apps Script API，明確授權覆蓋目前無程式的專案。

範圍：鎖定 clasp 版本、配置只上傳 build/gas 四檔的本機流程及忽略私有登入憑證；由使用者完成 Google OAuth 瀏覽器登入，再上傳並讀回比對。此步不建立對外 Web App、初始化正式試算表或設定明文 admin 密碼。

驗證：上傳前檢查目標 ID、編譯四檔及 clasp 檔案清單；上傳後讀回遠端內容比對。文件與本機步驟依規範提交；Google 登入需使用者本人完成，憑證保存於被忽略的 data 目錄。

完成：使用者已在瀏覽器完成 Google OAuth，私有憑證保存於 data/clasp-auth.json（600 權限且 Git 忽略）。首次上傳被 Google class 欄位語法檢查拒絕；修正後端目標為 ES2019、同步沙盒並補 Object.hasOwn 相容實作，移除 GAS 路徑的 Array.at／String.replaceAll 依賴。再次上傳 Google 接受四檔，遠端讀回內容與本機逐檔一致；前後快照保存於 data/gas-backups/2026-10-04T17-04-23-250Z（UTC 資料夾時間，台北為 2026/10/05）。

驗證：完整測試 170/170 通過，一般／GAS 編譯、clasp 清單與遠端讀回比對通過。程式已同步；未初始化正式試算表、執行業務資料操作或發布 Web App。尚未驗證 Google 業務執行效能／配額或真實前端登入；npm audit 的未修補開發工具依賴提示記錄於部署文件。
