# GAS 後端生成

## 範圍及設定

- 補齊既有全部 google.script.run 介面，保留本機 SQLite，雲端沿用 admin／manager 帳密與 member 英數通行密碼。
- 正式試算表 ID 沿用已提供值；工作表使用 GM_ 前綴，初始化只新增專用工作表，不動原 gid=0。初始化／部署由使用者在 Apps Script 編輯器執行，目前不向 Google 寫入。
- 帳號、session 與登入限流存 Script Properties，業務資料存試算表，原 CSV／相容圖片存私人 Drive，不共用公開連結。
- 使用已鎖定純 JS KDF，從私有 AUTH_SECRET 衍生 token，不把密碼、secret 或 token 放進編譯 HTML／版控。GAS session 改採瀏覽器 sessionStorage + 後端雜湊／到期／撤銷檢查，獨立於本機 HttpOnly cookie。
- 所有公開 callable function 經權限白名單；初始化及内部 helper 不可由 google.script.run 呼叫。
- Script Lock 包住版本檢查與寫入；業務表採追加日誌，commit marker 最後寫入，忽略未完成交易。大型 JSON 拆分，避免試算表單格限制；公式字首不可執行。
- 共用純資料驗證與統計，不搬 Node API／SQLite SQL 到 GAS。

## 步驟及提交

1. 儲存、私有設定與登入基礎、共用驗證、GAS session adapter 與打包。
2. 成員／歷史／匯入、活動、職責與報名／請假。
3. 排表／範本、戰績／附件／個人頁、初始化工具與部署文件。

## 驗證

- 使用 mock Sheets／Properties／Lock／Drive 的隔離測試驗證保存、重啟、權限、版本、重試、部分失敗、缺值及契約。
- 全部本機測試、一般與 GAS 編譯；在無 Node／TextEncoder 的 V8 相容沙盒執行 Backend.gs。
- 使用模擬 google.script.run 驗證前端成功／失敗、登入恢復與過期；不稱為真實 Google 端到端驗證。
- 真實部署仍需驗證授權、服務配額、Drive 與試算表權限及 GAS 執行效能。

第一步已完成：雲端 session adapter、私有登入資料、PBKDF2 密碼雜湊、工作表提交日誌與共用驗證。隔離測試 150/150 通過；本機與 GAS 前端編譯成功。真實 Apps Script 執行時間及 Google 服務權限留待測試部署確認。
