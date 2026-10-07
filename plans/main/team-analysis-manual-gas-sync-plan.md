# 團隊分析手冊更新與 GAS 同步

## 授權與範圍

- 使用者要求更新附圖操作手冊，並同步最新團隊分析及先前的單一儲存進度至既有 Apps Script 專案。
- 最新功能來源為 `9974bcf`，補上本團合計／全場占比與個人排序；此前已通過 226 項測試、一般／GAS 編譯及本機隔離畫面驗證。
- 沿用目前上傳工具的四檔完整套件、遠端備份及讀回比對。這次同步程式碼，不執行正式資料操作或更新 Web App 部署版本。
- 手冊圖片使用虛構姓名及數據的隔離 GAS 模擬環境，不使用日常本機戰績姓名、不讀取帳號私密檔。

## 步驟與驗證

1. 更新團隊分析章節與示範截圖，包含合計／全場占比／個人排序；重製離線 HTML 與有頁碼／書籤的 PDF。
2. 驗證圖片、章節錨點、離線讀取、圖片放大／Escape、手機排版及 PDF，提交手冊步驟。
3. 執行 `npm run gas:push`，重新編譯、備份遠端、同步四檔並讀回比對；不輸出憑證。
4. 更新 GASDeployment.md 與開發指引的同步狀態，記錄實際備份及部署尚未更新的限制，提交同步紀錄。

## 執行結果

- 手冊已更新至第 11 版，補上獨立合計表的全場占比、個人表升降排序、缺值／部分資料及分頁規則。
- 重新拍攝圖 28（36-team-analysis.png），使用最新 GAS 單檔及隔離 mock，均為虛構姓名與數據；延遲／錯誤重試、四團、陣營、第二場／內推、過期回應及手機操作驗證通過。
- Markdown、離線 HTML 與 PDF 均已更新。驗證 18 章＋目錄、36 張圖片、所有錨點、離線無網路請求、圖片放大／Escape 及 390px 手機無頁面溢出；PDF 有標籤、書籤、頁碼，約 4.82 MB。
- 手冊步驟提交 `9817861`；以該工作目錄來源執行 `npm run gas:push`，重新編譯成功（Index.html 約 1016.7 KB、Backend.gs 約 147.23 kB），四檔清單及無外部 JS／CSS 驗證通過。
- 2026/10/05 約 18:03（Asia/Taipei）Google 接受四檔上傳，隨後 pull 讀回 Backend.gs／Code.gs／Index.html／appsscript.json，全部與本機套件比對一致。
- 遠端前後程式備份：`data/gas-backups/2026-10-05T10-02-44-053Z/before` 及 `after`，私有並被 Git 忽略，不包含 Script Properties／Sheets／Drive 或部署設定。
- 指定專案為 `1rkY7EI6rHYNoH8TZmIOKQ-MWSCexXUdFTOqInqyfxBR1qMoI8DAf9hG5`，未執行 setupGas、正式資料讀寫、部署發布或重新查詢部署版本；本機測試資料未上傳。既有 Web App 須選新版本發布後才顯示更新。
- 已更新 GASDeployment.md 與 AGENTS.md 的同步來源、功能及部署檢查步驟。真實 Google 授權、服務配額、效能及 iframe 行為仍須測試部署確認。
