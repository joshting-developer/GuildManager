# 本機開發與 GAS 部署架構

## 開發方向

使用者已確認先做 Vue＋Vuetify 首頁, 搭配 Docker、小型 API 與 SQLite 本機測試, 後期切換 GAS 與 Google 試算表

| 層級 | 本機開發 | GAS 部署 |
| --- | --- | --- |
| 頁面 | Vue 3＋Vuetify＋Vite, 支援熱更新 | 相同前端來源, 編譯為單一 HTML |
| 前端資料介面 | `src/api/` 呼叫 HTTP 成員／職業／活動／排表 API | 同名資料函式包裝 `google.script.run` |
| 執行入口 | Node.js／Express | GAS `.gs` 函式與 `doGet()` |
| 資料存取 | SQLite repository | Google 試算表 repository |
| 環境 | Docker Compose | Apps Script Web App |

首頁元件不直接操作 SQLite、Google 試算表或 `google.script.run`, 只透過前端資料介面取得相同格式的資料

## 單檔編譯

- Vuetify 支援 Vite 開發, 參考 [官方安裝說明](https://vuetifyjs.com/en/getting-started/installation/)
- 使用 [vite-plugin-singlefile](https://github.com/richardtallent/vite-plugin-singlefile) 將 JS 與 CSS 內嵌到輸出 HTML
- 預設 Vite build 會分出資源檔, GAS build 需另行配置單檔輸出
- 不依賴 `public/` 的相對路徑資源, 該目錄不會被插件自動內嵌
- 圖示採 SVG path, 字體採系統字體, 避免額外字體檔或 CDN 依賴
- 日常編輯 `.vue`、JS 與 CSS 原始碼, 不手改編譯產物
- GAS 前端可以只有一個 HTML, 但資料讀寫仍需要 `.gs` 後端與 manifest
- 前端編譯產物使用 `createHtmlOutputFromFile()` 提供, 不需要對 bundle 執行 Apps Script 模板解析

## 切換時要處理的差異

- GAS 不是 Node.js, 不直接搬入 Express、SQLite driver、`fs`、`process` 或未打包的模組；參考 [GAS V8 限制](https://developers.google.com/apps-script/guides/v8-runtime#v8_runtime_limitations)
- GAS 請求走 [非同步 `google.script.run`](https://developers.google.com/apps-script/guides/html/communication), adapter 包成 Promise, 錯誤需交給畫面處理
- 日期統一傳 ISO 8601 字串, 活動的日曆日期傳 YYYY-MM-DD 不轉成時刻, 不跨介面傳 `Date`、資料庫連線或工作表物件
- 可共用不依賴執行環境的資料驗證與運算, 平台入口及資料存取仍要各自實作
- SQLite 的交易、唯一鍵與外鍵不會自動變成試算表功能, GAS 需補固定 ID、驗證、鎖定與部分失敗處理
- 多頁面使用 hash 路由, 不依賴伺服器 rewrite；`#/` 為公開行事曆首頁, `#/magament`／`#/management` 為管理總覽, `#/members`、`#/events` 與 `#/lineups` 為成員清單、活動安排及戰場排表, 管理頁須登入, 尚無 Router 套件
- GAS 使用 iframe sandbox, 外部資源、導覽與瀏覽器功能需依 [HTML Service 限制](https://developers.google.com/apps-script/guides/html/restrictions) 實測
- 本機測試不能代替 Google 授權、部署身分與試算表權限驗證, 不等到全部功能完成才做第一次 GAS 整合
- SQLite 測試資料不會自動匯入正式試算表, 後續依確認的欄位另做資料遷移

## Docker 與資料保存

- 前端 dev server 與 API 分為兩個服務, SQLite 在 API 服務內操作, 不需另開資料庫容器
- 前端以開發代理轉送 `/api`, 避免元件綁定本機 API 網址
- SQLite 檔案放入獨立 volume, 容器重建時保留資料；參考 [Docker volumes](https://docs.docker.com/engine/storage/volumes/)
- 初始化只在沒有首頁設定資料時建立空白設定, 不播種示範資料或覆寫既有資料
- 本機服務只發布到 loopback, 管理 API 已使用帳號密碼／session 驗證, 正式公開部署仍需另外設定
- SQLite 成員、職業、名稱歷史與活動安排已依確認需求實作, 活動以安排表與日期表關聯, 約戰單日、活動可多日；幫戰／龍虎戰多選日期批次建立獨立單日安排, 每場可分別連結後續紀錄, 批次請求用於防重複

## 驗證狀態

官方文件確認此架構具備可行性, 實際單檔編譯、本機 API、Docker 與首頁驗證結果記錄於 `plans/main/step.md` 與 `plans/main/members-step.md`

GAS 資料函式與正式試算表 repository 尚待後續實作, 不宣稱本機 Node 後端可以原樣部署至 GAS

## 場次參與與無 UID 排表

`server/participation-repository.js`／`src/api/participation.js` 保存單日戰鬥的成員回應及額外報名。`event_member_responses` 主鍵為 event_id／member_uid, status=registered／leave／none；`event_registrations` 另以固定 UUID 主鍵關聯 event_id、profession_id, 保存姓名、備註、active、revision 及唯一 request_id。

統一 `submitParticipation(eventId, input)` 依名稱比對名冊／本場報名, 只接受 registered／leave。名冊成員沿用 UID 回應, 不修改名冊職業；外援沿用獨立 ID, active=false 表示請假, 再報名恢復同一筆。找不到可請假對象時拒絕, 同名不明確時不寫入。資料讀取附帶 revision 雜湊及 registrationLeaves, 回應含顯示名稱／職業；舊 none／取消介面保留相容, 不刪除資料或快照。`event_participation_requests` 在同一交易保存輸入及回應, 重試不反轉較新的狀態, 新送出以整場 revision 防止覆寫其他更新。

排表 slot／secondRound 使用 uid 或 registrationId 互斥引用, 空位仍 uid=null；舊成員引用與 requestId 正規化保持相容。participantKey 以 member／registration 命名空間支援拖曳、選人及唯一檢查, 不當成遊戲 UID 保存。三類來源與每場請假由前後端檢查, 未在幫派／俱樂部的編外人員必須先回應 registered。

儲存重新讀取本場有效報名與請假, 將額外報名姓名、職業、ID／場次及原報名備註嵌入不可變快照。跨場套用範本不複製額外報名, 不符合或取消者留空並提示。取消／請假不修改已保存版本。前端更新來源保留目前排表並標示無效人員, 不默默刪掉排表。

排表介面每場直接編輯最後保存的名單, 儲存後繼續編輯, 手動另存範本保留或復用配置。沒有工作區／歷史版本選單或儲存確認視窗。底層沿用既有 getLineupHistory／confirmLineup 契約, 前端只採最新一筆；lineup_versions 保留相容快照及 expectedVersion／eventRevision／requestId 並行與重試保護, 不做刪除或資料搬移。刪除／改類型的場次只顯示最新快照且封存唯讀, 可另存範本。

GAS 需新增對應工作表、本人操作驗證、鎖定／防重複／部分失敗處理；目前只有明確回報未串接的資料函式。本機帳號密碼登入已驗證且仍限 loopback, 尚未驗證 Google 登入或正式公開部署。

## 登入介面與平台差異

`src/api/auth.js` 提供 getSession／login／logout, `src/api/session.js` 在記憶體保存 CSRF token, 共用 HTTP 呼叫附加 cookie／CSRF 並通知 session 失效。App 啟動先向後端確認身分, 不以 localStorage 或網址判定登入；伺服器採公開端點白名單, 其他 API 全部須登入。

`server/auth-repository.js` 使用獨立 auth_accounts／auth_sessions 表, 密碼 scrypt 雜湊及 salt, session token 隨機且只存 SHA-256 雜湊, 到期 8 小時；重啟保留 session, 登出或重新登入撤銷舊 token。`server/create-account.js` 只接受本機 stdin 建立帳號, 無公開註冊。

首頁行事曆與統一報名／請假保持公開, 表單只填名稱, 不載入成員選單；`/api/calendar/members` 保留舊介面相容, 完整名冊／歷史僅管理端可讀。登入帳號尚未綁定遊戲 UID。

後續 GAS 需實作 Google 身分驗證與允許管理的帳號, 不能直接移植 Node cookie middleware 或 scrypt。GAS「以開發者身分執行」並不保證 `Session.getActiveUser().getEmail()` 有值, 不可用 effective user 當訪客身分；需確認部署方式並實測。[GAS Session 官方文件](https://developers.google.com/apps-script/reference/base/session#getActiveUser())。雲端 auth 函式目前明確回報未設定, 不接受本機登入作為 Google 身分。

## 排表與歷史

`src/domain/lineups.js` 共用固定版型與 UID 安排運算, Docker API 另掛載 `src/domain/` 以維持熱更新。`server/lineup-repository.js` 使用獨立版本與範本表, 確認快照不 JOIN 可變成員資料, 場次刪除後仍可讀。快照 JSON 為可序列化資料, 不以 SQLite 列號當 ID。

後續 GAS 須依同一契約保存範本及不可變快照, 並補資格、唯一 UID、版本及 requestId 檢查與 script lock／部分失敗處理；目前 `.gs` 排表函式只明確回報尚未串接。

職責來源使用 `server/duty-repository.js`／`src/api/duties.js`, 職責表只追加初始化, 不更動成員與場次。排表位置以 dutyIds 引用, 確認時將職責 ID／名稱嵌入不可變快照, 範本套用則重新驗證 active。缺 dutyIds 的舊 payload 以正規化比較維持 requestId 相容, 不修改舊 JSON 或觸發快照 UPDATE。後期試算表須另建職責工作表並保留相同規則。

同位置分場沿用 slot.uid／profession 作第一場, 可空的 secondRound 保存第二場 UID／profession, 確認快照另保存第二位 member。slotAssignments 統一列舉兩人的 UID／職業供唯一檢查、資格、計數及範本處理；拖曳 addMemberToSlot 在空位或第二場加入, 明確編輯 placeMember 可交換指定場次。位置 duties／note 共用, 不跟人移動。缺 secondRound 的舊 payload 經 validateLineup／editableLineup 正規化為 null, 讀取舊歷史及重試不改寫 JSON。

幫戰／龍虎戰 title 可留空或省略, validateEvent 正規化為空字串, 仍保留文字格式／120 字限制、日期與重試規則；活動／約戰維持必填。SQLite TEXT NOT NULL 可保存空字串, 不需改表。eventDisplayTitle 只於前端產生類型顯示回退, 不修改資料／表單／既有歷史, GAS 後續須遵守相同驗證契約。
