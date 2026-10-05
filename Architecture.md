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

GAS 資料函式與 Sheets store 已生成，使用 mock Google 服務及編譯 V8 沙盒驗證，尚未部署或寫入正式資料。初始化及部署步驟見 [GASDeployment.md](GASDeployment.md)。

## 場次參與與無 UID 排表

`server/participation-repository.js`／`src/api/participation.js` 保存單日戰鬥的成員回應及額外報名。`event_member_responses` 主鍵為 event_id／member_uid, status=registered／leave／none；`event_registrations` 另以固定 UUID 主鍵關聯 event_id、profession_id, 保存姓名、備註、active、revision 及唯一 request_id。

統一 `submitParticipation(eventId, input)` 依名稱比對名冊／本場報名, 只接受 registered／leave。名冊成員沿用 UID 回應, 不修改名冊職業；外援沿用獨立 ID, active=false 表示請假, 再報名恢復同一筆。找不到可請假對象時拒絕, 同名不明確時不寫入。資料讀取附帶 revision 雜湊及 registrationLeaves, 回應含顯示名稱／職業；舊 none／取消介面保留相容, 不刪除資料或快照。`event_participation_requests` 在同一交易保存輸入及回應, 重試不反轉較新的狀態, 新送出以整場 revision 防止覆寫其他更新。

成員回應的可空 `profession_id` 保存本場報名選擇, 查詢回傳 professionId／職業／色彩；舊回應為 null 時沿用名冊主職業, 不反推或回填既有報名。初始化只補缺少欄位, 不重寫舊列；請假保留先前報名職業, 再報名可更新本場職業, 不修改名冊及排表快照。舊 saveMemberResponse 未提供 professionId 時保留原值, 並行／重試判定包含此欄位。GAS 已採相同資料契約，使用獨立 Sheets store。

排表 slot／secondRound 使用 uid 或 registrationId 互斥引用, 空位仍 uid=null；舊成員引用與 requestId 正規化保持相容。participantKey 以 member／registration 命名空間支援拖曳、選人及唯一檢查, 不當成遊戲 UID 保存。三類來源與每場請假由前後端檢查, 未在幫派／俱樂部的編外人員必須先回應 registered。

儲存重新讀取本場有效報名與請假, 將額外報名姓名、職業、ID／場次及原報名備註嵌入不可變快照。跨場套用範本不複製額外報名, 不符合或取消者留空並提示。取消／請假不修改已保存版本。前端更新來源保留目前排表並標示無效人員, 不默默刪掉排表。

排表介面每場直接編輯最後保存的名單, 儲存後繼續編輯, 手動另存範本保留或復用配置。沒有工作區／歷史版本選單或儲存確認視窗。底層沿用既有 getLineupHistory／confirmLineup 契約, 前端只採最新一筆；lineup_versions 保留相容快照及 expectedVersion／eventRevision／requestId 並行與重試保護, 不做刪除或資料搬移。刪除／改類型的場次只顯示最新快照且封存唯讀, 可另存範本。

GAS 已提供對應工作表、應用程式角色驗證、script lock、重試及提交日誌；登入未與遊戲 UID 綁定，仍不作本人操作驗證。本機仍限 loopback，尚未實作 Google OAuth 或驗證正式公開部署。

## 登入介面與平台差異

`src/api/auth.js` 提供 getSession／login／logout, `src/api/session.js` 在記憶體保存 CSRF token, 共用 HTTP 呼叫附加 cookie／CSRF 並通知 session 失效。App 啟動先向後端確認身分, 不以 localStorage 或網址判定登入；伺服器採公開端點白名單, 其他 API 全部須登入。

`server/auth-repository.js` 使用獨立 auth_accounts／auth_sessions 表, 密碼 scrypt 雜湊及 salt, session token 隨機且只存 SHA-256 雜湊, 到期 8 小時；重啟保留 session, 登出或重新登入撤銷舊 token。`server/create-account.js` 接受本機 stdin 建立帳號, 另提供 admin-only manager 建立／更新與共用 member 通行密碼介面, 無公開註冊。

首頁行事曆及約戰報名／請假保持公開；幫戰／龍虎戰要求帳號登入, 可填名或讀取名冊選人。`/api/calendar/members` 保留舊契約但改須登入, 完整名冊／歷史僅 admin／manager 可讀。登入帳號尚未綁定遊戲 UID。

GAS 已實作獨立帳密及通行密碼，PBKDF2-SHA256 600,000 次與私有 Script Properties 保存帳號／session；不使用 Node cookie、scrypt 或 Google Email 判定訪客。瀏覽器每分頁保存 token，後端檢查雜湊、到期、帳號版本與角色。部署需由部署者執行以讀寫其 Sheets／Drive；Google OAuth 尚未實作。[GAS Web App 執行身分](https://developers.google.com/apps-script/guides/web#permissions)

## 排表與歷史

`src/domain/lineups.js` 共用固定版型與 UID 安排運算, Docker API 另掛載 `src/domain/` 以維持熱更新。`server/lineup-repository.js` 使用獨立版本與範本表, 確認快照不 JOIN 可變成員資料, 場次刪除後仍可讀。快照 JSON 為可序列化資料, 不以 SQLite 列號當 ID。

GAS 已依同一契約保存範本與不可變快照，檢查資格、唯一人員引用、版本及 requestId，由 script lock 與提交日誌保護寫入；尚未部署驗證。

職責來源使用 `server/duty-repository.js`／`src/api/duties.js`, 職責表只追加初始化, 不更動成員與場次。排表位置以 dutyIds 引用, 確認時將職責 ID／名稱嵌入不可變快照, 範本套用則重新驗證 active。缺 dutyIds 的舊 payload 以正規化比較維持 requestId 相容, 不修改舊 JSON 或觸發快照 UPDATE。後期試算表須另建職責工作表並保留相同規則。

同位置分場沿用 slot.uid／profession 作第一場, 可空的 secondRound 保存第二場 UID／profession, 確認快照另保存第二位 member。slotAssignments 統一列舉兩人的 UID／職業供唯一檢查、資格、計數及範本處理；拖曳 addMemberToSlot 在空位或第二場加入, 明確編輯 placeMember 可交換指定場次。位置 duties／note 共用, 不跟人移動。缺 secondRound 的舊 payload 經 validateLineup／editableLineup 正規化為 null, 讀取舊歷史及重試不改寫 JSON。

幫戰／龍虎戰 title 可留空或省略, validateEvent 正規化為空字串, 仍保留文字格式／120 字限制、日期與重試規則；活動／約戰維持必填。SQLite TEXT NOT NULL 可保存空字串, 不需改表。eventDisplayTitle 只於前端產生類型顯示回退, 不修改資料／表單／既有歷史, GAS 已共用相同驗證契約。

## 戰績與附件

`src/domain/battle-records.js` 共用 CSV 表頭／解析及台北日期時間驗證, 不使用 Node API；支援遊戲的隊名／人數摘要並檢查玩家列數。`src/api/battle-records.js` 提供本機 HTTP／GAS 同名資料介面, 元件不直接送 HTTP。`server/battle-record-repository.js` 追加 battle_uploads（requestId／輸入雜湊／圖片 BLOB）及 battle_records（活動 ID／基本資料／快照／原始 CSV／玩家 JSON／內容雜湊）, 同批最多兩筆以交易寫入。

`battle_records.round_number` 為可空場序, 舊資料不推測或回填；新增場序需關聯有效活動, 約戰與幫戰允許 1／2, 龍虎戰僅 1。部分唯一索引保障每活動每場最多一筆, 同批重複、已占用位置拒絕且不覆寫；舊 requestId／內容雜湊保持相容。列表可用 eventId 只讀取該活動已指定場序的記錄, 供上傳區呈現保存狀態；一般列表仍包含舊記錄。

`winner`／`our_side` 可空且有值時只接受 red／blue, 不從戰績推論內推敵我或勝負。舊 winner NOT NULL 表以交易複製全部欄位並重建索引, 原有勝方、原檔與快照保留；舊請求雜湊不加入空 ourSide, 以保持重試相容。

`is_internal` 保存 boolean（SQLite 0／1）, 舊資料 default=false, 只有約戰可為 true 且此時 winner／our_side 必須空。兩場各自獨立開關並保存各筆標記, 不覆寫另一場；false 不加入舊請求正規化雜湊, 保持重試相容。

戰績頁只選行事曆既有戰鬥場次, 日期／類型由活動資料取得, 不提供日期／時間欄位或讀取檔名時間；行事曆入口預選相同場次 ID。約戰與幫戰各場一張卡片、龍虎戰單張, 幫戰兩場各自保存對手／結果, 單場週不要求第二場；可分次補傳且切換活動前保護未上傳資料。下方表格共用待上傳檔案的解析資料與已保存玩家快照, 分場 tab 切換與每頁 20 筆, 送出集中在表格下方；不查詢全部歷史列表, 仍讀取所選活動場序以防重複上傳。已有資料依 tab 透過 getRecord 讀取並快取, 保存回應包含 players 時直接顯示, 提供載入／失敗／重試與活動切換過期回應保護；不再使用逐場查看按鈕或詳情對話框, 下載保留於表格區。後端寫入前驗證活動仍有效且日期／類型符合, 快照不 JOIN 後續可變活動或成員。新頁面 playedAt 保存 YYYY-MM-DD；舊契約與歷史仍支援帶 +08:00 的 ISO 字串, 不以虛構零點填缺值。

戰績頁已移除陣容圖片上傳及前端預覽, 陣容從所選場次的戰場排表查看。原 CSV 與舊圖片仍由登入後的附件端點下載, 回傳 attachment 與 nosniff, 檔名使用 RFC 5987 編碼；保留既有 SQLite 圖片 BLOB 與後端契約, 不清除歷史附件。

GAS 已以試算表分開保存摘要、玩家快照及個人關聯，Drive 保存原檔及相容圖片；實作角色、script lock、重試與重複檢查。跨服務失敗可重試且忽略未提交資料，可能保留未引用的私人 Drive 檔案，不自動刪除。尚未部署或寫入正式來源。

## 排表圖片匯出

`src/domain/lineup-image.js` 由當前顯示排表、成員／職業／職責或封存快照建立只含顯示文字的圖片資料, 透過瀏覽器 Canvas 產生 2000px 寬的 image/jpeg Blob, 等待字型載入並按長文字與雙場內容計算列高。下載為本機操作, 不呼叫保存 API、不改草稿／保存狀態、不新增依賴或寫入 Google 試算表；一般／專注模式及手機共用匯出流程。

## 戰績閱覽

`BattleRecordsPage.vue` 沿用 getRecords 每頁 20 筆, `BattleRecordDetail.vue` 點開後才透過 getRecord 讀取單筆保存的玩家快照, 不讀可變名冊或活動來重建歷史。App 的 hash 導覽支援 `#/battle-records/:id`, 保留登入後直接連結, 同頁切換詳情以記錄 ID 重建元件並丟棄卸載後的回應；返回清單保留該頁頁碼。

`src/domain/battle-statistics.js` 只依快照計算雙方職業分布、十項合計與差距, null 不當零, 部分缺值有明確標示。battlePlayerValue 只在顯示時計算一命數值（原值 ÷ max(重傷, 1), 重傷欄仍為原次數, 缺少分母或原值保留 null）, 排序使用當前模式未四捨五入的數字與文字, 職業及陣營條件交集, 缺值固定最後, 不修改原 players, 先篩選／排序完整陣營再分頁。BATTLE_TABLE_COLUMNS 僅調整閱覽欄序將資源置於最右, 不改 CSV 契約或上傳預覽欄序。職業 API 只提供顯示色彩, 失敗使用中性色點並可重試, 不阻止戰績閱讀。沒有新增資料表／後端寫入／依賴；GAS 已提供相同資料介面，實際 Google 部署與資料權限尚待驗證。

## Admin 帳號權限

`auth_accounts` 升級新增 admin／manager／member 角色與 revision, 舊資料優先名稱 admin, 否則最早帳號, 僅一位取得 admin；其餘為 manager。session 每次 JOIN 當前角色, `/api/admin/*` 在後端檢查 admin 並沿用 CSRF。`src/api/admin.js` 統一帳號管理資料介面, `AdminPage.vue` 提供 admin 密碼、manager 帳號與共用成員通行密碼管理, `#/admin` 路由及導覽同時檢查角色。

改密碼先驗證目前密碼, scrypt 完成後交易重新檢查 revision, 防止並行覆寫；admin 保留目前 session, manager／member 修改撤銷全部 session。登入完成 scrypt 後重新檢查 revision, 避免密碼更新期間建立舊密碼 session。GAS 已提供相同帳號契約，使用 PBKDF2 及私有屬性保存，尚未部署驗證。

## 公開報名登入與選人

App 提供 calendarAuth 的使用者及確認登入狀態，報名視窗沿用右上共用登入，不內嵌登入表單。auth adapter 與 HttpOnly session 保留共用 member 通行密碼。幫戰／龍虎戰才要求登入且有三個名稱來源, 約戰維持直接填名；有效登入可跨場次沿用。過期或修改帳號撤銷後，收起私人場次與報名視窗，需由右上重新登入；錯誤登入不清除已有 session／CSRF。

後端依目前場次類型檢查, GET／POST／PATCH participation 與 POST／DELETE registrations 均保護幫戰／龍虎戰, 不因使用舊介面繞過。member 允許報名端點、必要選單、登出，以及 GET 戰績清單／詳情／附件及個人分析；其他管理端點拒絕。所有已登入寫入檢查 CSRF。`GET /api/events/:id/participation-members` 驗證場次, 回傳 uid／name／primaryProfessionId／secondaryProfessionId／isInGuild／isInClub, 不含歷史與備註。

名單選人傳送可選 memberUid；同一交易檢查 UID、姓名與目前幫派／俱樂部狀態, 同名仍可指定人員, 過期名單拒絕。不傳 memberUid 時維持原姓名比對, 舊 requestId 的 input_json 不變；新引用包含於重試比對, 不修改名冊或排表快照。GAS 已提供相同選人驗證與角色限制，尚未部署驗證。

開發中兩角色 schema 升級支援 member 時, 先以 VACUUM INTO 備份完整資料庫（記憶體測試除外）, 再暫停 FK enforcement 並於同一交易換表, 防止 DROP TABLE 的 ON DELETE CASCADE 刪掉 session。交換後檢查 foreign_key_check, 失敗回滾, 最終恢復 FK enforcement。既有帳號 ID／hash／role／revision 與 session 不變, 重啟不重複備份。


## 共用成員通行密碼

member 改為固定後端帳號，所有介面及登入回應隱藏名稱。admin 在帳號管理設定／修改 6–128 個英文字母或數字的通行密碼（區分大小寫，純數字仍可使用），初次不提供預設值，前導零保留。右上登入預設成員通行密碼；幫戰／龍虎戰僅在有效 member／manager／admin 登入後出現在行事曆，報名視窗不再提供登入表單。`POST /api/auth/member-login` 由後端指定帳號，與管理登入共用限流；`PATCH /api/admin/member-token` 須 admin、CSRF 及 revision。修改密碼撤銷共用 member 全部 session。舊個別 member 資料保留但不能再登入或沿用舊 session；舊新增／改名 member API 停用。admin／manager 密碼維持 12–128 字元。GAS 已生成對應資料功能，尚未部署驗證。


## 個人戰績

成員清單（含編外人員）提供「查看數據」；戰績閱覽中已關聯的人名可開啟 `#/member-records/:uid`，已登入 member／manager／admin 均可使用。UID 只作路由及內部引用，頁面、名稱、標籤與 title 不顯示。未關聯人名保持純文字。

戰績上傳的同一交易以當時名冊現在名稱精確比對，包含編外；唯一符合才保存 UID，不以職業、敵我、過去名稱或模糊搜尋推測。同名／未知名稱不關聯。`battle_player_links(record_id, player_index, member_uid)` 使用外鍵、逐列唯一索引及 member_uid 查詢索引，保留不可變的 players_json、原始 CSV、requestId／content_hash；詳情回應在讀取時加入 memberUid。單筆新增與 CSV 匯入共用成員建立流程；新增後依現在名稱精確比對尚未關聯的歷史玩家列，唯一同名才寫入關聯，已歸屬他人的資料不轉移。CSV 先完成整批建立再判斷唯一性，包含既有及同批同名；成員與關聯於同一 SQLite 交易／GAS 提交中保存。既有 UID 匯入仍跳過；改名、移至編外及重啟不觸發回填。原始 CSV、玩家快照與請求雜湊保持不變，戰績重試不重新比對名稱；本機詳情與重試讀取最新關聯，GAS 已保存的重試回應保持原樣。

`GET /api/members/:uid/battle-records?page=1&startDate=2026-10-01&endDate=2026-10-31&profession=碎夢` 支援選填的台北起訖日期（含當天、可只填一邊）與當場職業名稱。日期須為有效 YYYY-MM-DD、結束不得早於開始；職業依不可變玩家快照精確篩選，選項涵蓋該成員全部已關聯紀錄。回傳現在名稱／職業、篩選條件、職業選項、全部符合條件參戰的統計，以及每頁 20 筆最新優先明細。包含保存的場次類型、日期、場序、當時姓名／職業、陣營、對手與十二欄數據，點日期可回對戰詳情。無資料、找不到成員、載入／失敗／重試均有提示，直接連結登入後保留目標。

個人統計提供參戰場數、勝／敗／內推或未判定場數、十項合計、每筆平均及一命貢獻。平均僅使用各欄已知數值；一命貢獻使用有該欄數值及重傷的紀錄合計，除以這些紀錄各筆 max(重傷, 1) 的總和；重傷欄仍保留合計。缺值顯示 — 並標示缺少筆數，不當作 0。不依隊名或其他數據推測勝敗，內推及結果未填不計勝敗。同場重複玩家列均保留且場數只計一次；兩邊結果衝突時歸未判定。明細可切總計／一命，資源維持最右。統計涵蓋全部符合篩選條件的紀錄，不受明細分頁影響。套用或清除條件回第一頁，無符合資料明確提示，原有 member／manager／admin 讀取權限不變。GAS `getMemberBattleRecords` 已實作相同分析契約，未部署或寫入正式試算表。

## 成員戰績閱覽權限

已登入 member／manager／admin 可使用戰績清單、對戰詳情、原始 CSV／既有附件下載及個人數據分析。member 的導覽顯示行事曆與戰績閱覽，從對戰表格點已關聯人名可開啟個人頁；完整名冊及其他管理功能仍只供 admin／manager。共用 member 通行密碼不綁遊戲 UID，因此可查看所有已關聯成員的數據，不限制為本人。匿名不可讀，member 不可上傳／修改戰績、名冊、活動、排表或帳號。後端只放行明確的 GET 路徑，不以 URL 前綴放寬寫入。

右上登入視窗包含「成員登入」「管理者登入」兩個 tab；前者只填 admin 發行的通行密碼（英數 6–128 字），後者沿用 Manager／Admin 帳號密碼。共用視窗一律預選成員登入，首頁登入後留在行事曆，直接開啟戰績／個人分析或管理連結成功後保留原目標及權限；切換 tab 清除密碼及登入錯誤。


## 行事曆可見性與登入入口

右上登入預設「成員登入」，只填通行密碼；管理者切換至「管理者登入」填帳號密碼。未登入只顯示一般活動及約戰，幫戰／龍虎戰在 member／manager／admin 有效登入後才顯示。`GET /api/events` 依伺服器 session 過濾，未登入回應不含私人場次及其筆數，原始資料與管理功能不改。前端於登入／登出重新載入，立即收起私人場次及視窗，舊請求回應不能覆蓋新登入狀態。

報名視窗移除通行密碼輸入及驗證按鈕，已登入直接使用既有三種名稱來源及報名／請假表單。登入過期或撤銷後收起私人場次，需使用右上共用入口重新登入；約戰仍可匿名報名。GAS 已同步此規則並完成後端生成，尚未部署驗證。


## 場次影片連結

本機 event_video_submissions／event_video_requests 與 GAS GM_videos／GM_requests 分別保存雙場連結、團別、備註及 requestId 回應；不遷移兩端資料、不保存影片檔案。getEventVideos／submitEventVideo RPC 沿用場次資格與 CSRF，admin／manager 可讀清單，member 僅能提交；約戰可匿名提交。GAS 在 script lock 內追加資料，影片與重試結果由同一提交 marker 生效，未提交資料不讀取；已初始化的舊專案首次有效使用補建 GM_videos。

共用純 JS 網址驗證不依賴 GAS 缺少的 Web URL 全域，前端只呈現可複製文字。CSV 由瀏覽器依當前場次／團別／名稱篩選產生，不新增後端匯出或 HTTP fallback。隔離測試及編譯 HTML 的模擬 RPC 驗證不代表真實 Sheets 授權或 Google iframe 下載已完成。
