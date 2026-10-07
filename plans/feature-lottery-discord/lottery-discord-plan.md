# 整併 game 專案的抽獎賽馬與 Discord 通知

## 需求與假設

- 使用者要求把相鄰 `../game`（舊版 GAS 約戰報名系統）的「抽獎賽馬」頁面與 Discord Webhook 通知整併進本專案；此需求取代 AGENTS.md 先前「不新增 Discord 整合」的註記。
- 抽獎沿用 game 的玩法：獎品由上往下逐一抽，每場由尚未中獎的人參賽，伺服器先決定並保存冠軍，前端只演出賽馬動畫；重整或動畫中斷不改變結果，重複按同一獎品回傳原得獎者。
- game 以手動編輯「抽獎」工作表 A／B 欄提供名單；本專案沒有可自由編輯的業務表，改為頁面內「編輯名單」視窗（參加人員、獎品各一行一筆），可一鍵帶入幫會成員名稱。
- 名單修改後，名稱仍存在的已抽獎品保留得獎者（同名獎品依順序對應），其餘視為新獎品。
- 清空得獎紀錄改用登入後的 admin／manager 權限＋確認視窗，取代 game 的管理密碼 prompt。
- 抽獎頁 `#/lottery` 僅 admin／manager；member 與匿名不可讀寫。
- Discord 通知沿用 game 的兩類：
  - 請假通知：成員／外援請假、請假後改回報名、管理者在出勤閱覽取消請假。一般報名不通知（game 亦不通知）。
  - 名冊通知：新增、修改（實際有變更才通知）、移至編外；CSV 匯入合併為一則摘要，避免大量訊息觸發 Discord 限流。
- game 的「去洗澡提醒」綁定個人 Discord ID，屬個人用途，不搬入。
- game 程式註解內的舊 Webhook 網址屬憑證，不複製到本專案。
- Webhook 網址屬私密設定：本機用環境變數 `DISCORD_WEBHOOK_LEAVE`／`DISCORD_WEBHOOK_MEMBER`，GAS 用同名 Script Properties；未設定時不送出。只接受 `https://discord.com/api/webhooks/…`（含 discordapp.com）網址。
- 通知在資料成功保存後才送出，失敗只記錄、不影響原操作；相同 requestId 重試回傳既有結果時不重複通知。
- GAS 需新增 `script.external_request` OAuth scope，部署者需重新授權。

## 步驟

1. 抽獎資料層：共用驗證／抽獎邏輯、SQLite、Express API、GAS RPC、前端資料介面與測試。
2. 抽獎頁面：Vue 頁面、賽馬動畫、編輯名單／清空確認、導覽與管理總覽入口。
3. Discord 通知：共用訊息格式、本機發送器、GAS 發送、請假／名冊事件與測試。
4. 文件：AGENTS.md、Architecture.md、README.md、GASDeployment.md。

## 驗證

- `npm test`、`npm run build`、`npm run build:gas`。
- 隔離 SQLite／模擬 GAS：抽獎保存、重複抽同一獎品、所有人中獎、名單修改保留得獎者、清空版本檢查、權限（member 拒絕）。
- 通知：只在實際變更後送出、重試不重送、未設定網址不送、非 Discord 網址拒絕、失敗不影響原操作。
- 本機瀏覽器實測抽獎頁桌面／手機；真實 Discord 與 Apps Script 需使用者提供 Webhook 並部署後確認。

## 完成與驗證

- 分支 `feature/lottery-discord`；`454599d` 抽獎資料層、`9945d47` 抽獎頁面、`38c6ff7` Discord 通知，文件另行提交。
- `npm test`：223／223 通過（原 212 項 + 抽獎 6 項 + 通知 5 項）；`npm run build`、`npm run build:gas` 通過，GAS HTML 仍為單檔。
- 隔離 SQLite＋本機 API＋內建瀏覽器（1280／1440 桌面、375 手機）：編輯名單、帶入幫會成員、開跑全螢幕演出、冠軍視窗、獎品清單更新與下一個獎品自動選取、重新載入保存、清空確認皆正常，無主控台錯誤或手機橫向捲動。
- 實測發現第 9 個桌面導覽項會讓全部標籤換行，改為僅在管理總覽卡片與手機抽屜提供入口；並修正賽後前三名看板依到線名次顯示（game 原版在全員到線後會顯示任意順序）。
- 通知以假 notifier／模擬 UrlFetchApp 驗證：僅實際變更送出、requestId 重試與失敗請求不送、429 重試一次、網址錯誤停用且紀錄不含網址、Webhook 失敗不影響保存。
- 未驗證：真實 Discord 送達、Apps Script 新授權範圍與 UrlFetchApp 配額、正式部署；未同步或發布 GAS，未修改正式試算表。
