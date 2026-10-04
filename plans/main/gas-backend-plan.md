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

使用者於此步驟要求暫停，先調整 member 戰績閱覽與登入 tab。成員／活動／報名模組與排表／戰績、GAS 入口／包裝程式草稿保留工作樹，尚未完成雲端整合驗證與部署文件，不視為完成或可直接部署。下一次恢復需納入已確認的 member 分析讀取權限。

使用者已要求繼續 GAS 化；恢復後沿用成員登入預設、member 可讀分析、未登入隱藏幫戰／龍虎戰及取消報名內嵌登入的規則。先驗證並提交成員／活動／報名模組，再完成排表／戰績與全入口整合。生成可貼入 Apps Script 的套件與初始化／部署文件，不自行登入 Google、寫入正式試算表或發布 Web App。

第二步完成：成員／名稱歷史／四欄匯入、活動批次與版本、職責、成員及外援報名／請假已使用 Sheets store；補上超過工作表預設列數時擴充及提交標記前後 flush。隔離測試涵蓋保留所屬狀態、擴充職業、整批拒絕、過期版本、重試及部分失敗，GAS 模組與基礎測試 10/10 通過。權限入口與完整編譯沙盒留在第三步驗證。

第三步完成：排表與範本、戰績 CSV／私人 Drive 附件、戰績與個人分析、完整角色／CSRF／行事曆入口及四檔部署套件均已生成；修正 GAS 登出參數，補上摘要與玩家快照分表及選取讀取，避免清單載入全部玩家資料。初始化保留既有工作表，不播種假成員；部署設定與限制記錄於 GASDeployment.md。

驗證結果：完整測試 167/167 通過，新增資料損壞檢查後整合測試 7/7 通過；一般與 GAS 編譯成功，實際四檔產物於無 Node／TextEncoder 的 V8 相容沙盒完成初始化。編譯單檔頁面以模擬 google.script.run 驗證成員／管理登入、sessionStorage 重新載入、私人行事曆、戰績與分析、登出、排表儲存／JPG、第二場 CSV 預覽／上傳／下載與手機版面。未使用外部資產或退回本機 HTTP API。真實 Google 授權、效能、iframe 下載與部署仍未驗證，未寫入正式試算表或發布 Web App。
