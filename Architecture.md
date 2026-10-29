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

排表介面每場直接編輯最後保存的名單, 儲存後繼續編輯, 手動另存範本保留或復用配置。沒有工作區／歷史版本選單或儲存確認視窗。前端以 getLineupEditor／getLineupEvent 讀最新一筆，既有 getLineupHistory／confirmLineup 契約保留相容；lineup_versions 保留相容快照及 expectedVersion／eventRevision／requestId 並行與重試保護, 不做刪除或資料搬移。刪除／改類型的場次只顯示最新快照且封存唯讀, 可另存範本。

GAS 已提供對應工作表、應用程式角色驗證、script lock、重試及提交日誌；登入未與遊戲 UID 綁定，仍不作本人操作驗證。本機仍限 loopback，尚未實作 Google OAuth 或驗證正式公開部署。

## 排表按需讀取（v1.0.28，已同步 GAS、尚未更新部署）

| 介面 | 資料與時機 |
| --- | --- |
| GET /api/lineups/editor?eventId=…／getLineupEditor | 首載或顯式重載；同一 SQLite 讀取交易／GAS commits 快照回傳 events、members、professions、duties、selected（eventId、event、versions 最多一筆、participation）。有效選定場次優先，否則取台北今天起最近一場；不讀 templates。 |
| GET /api/lineups/events/:id/current／getLineupEvent | 換場一次回傳最新排表與本場參與；封存 participation=null，回傳最新事件 revision／archived 狀態。選填 includeCatalogs boolean 可附名冊職業職責；一般換場不重載這些來源。 |
| GET /api/lineups/events/:id/sources／getLineupSources | 更新名單或套用範本後重讀現況，一次回傳有效戰鬥事件、名冊職業職責及 participation；不讀 lineup_versions／templates，不清除前端草稿或擅自更新 expectedVersion。 |
| GET /api/lineups/templates／getLineupTemplates | 首次開範本選單才讀 id／name／createdAt 清單；沒有 teams、成員引用或 UID 投影。完整配置仍由原 applyLineupTemplate 按需讀取與資格檢查。 |

新端點維持 admin／manager 權限，匿名／member 拒絕，GAS 明確列入 READ_ONLY，無 Drive／通知／Properties 寫入或業務寫入鎖。前端範本清單只在當頁重用，顯式重載清除，失敗不快取且可重試；換場／卸載丟棄過期回應，另存成功也阻止較早清單回應蓋掉新項目。不新增表或索引記錄、不搬移或改寫既有快照／重試資料，舊 index／history 保持格式與全量資料。

SQLite 以索引 ORDER BY version DESC LIMIT 1 查本場最新，只讀封存場次的事件快照、範本摘要只選三欄。GAS 現有五欄索引不含 eventId／業務 version，仍須 store.all(lineup_versions) 讀取快照後選最新，沒有消除歷史掃描／payload 解碼；本次只投影／傳回選定的最新一筆，首載免讀模板、同次重用名冊與職業並減少 RPC。GAS 範本摘要仍需讀該表 JSON，只有完整配置傳輸與投影延後；不可將模擬讀取下降解讀為已實測正式秒數。

## 登入介面與平台差異

`src/api/auth.js` 提供 getSession／login／logout, `src/api/session.js` 在記憶體保存 CSRF token, 共用 HTTP 呼叫附加 cookie／CSRF 並通知 session 失效。App 啟動先向後端確認身分, 不以 localStorage 或網址判定登入；伺服器採公開端點白名單, 其他 API 全部須登入。

`server/auth-repository.js` 使用獨立 auth_accounts／auth_sessions 表, 密碼 scrypt 雜湊及 salt, session token 隨機且只存 SHA-256 雜湊, 到期 8 小時；重啟保留 session, 登出或重新登入撤銷舊 token。`server/create-account.js` 接受本機 stdin 建立帳號, 另提供 admin-only manager 建立／更新與共用 member 通行密碼介面, 無公開註冊。

首頁所有場次與約戰／幫戰／龍虎戰報名、請假、場次選人及影片提交均公開。舊 /api/calendar/members 保留登入限制，完整名冊／歷史及既有成員管理仍須 member／manager／admin；登入帳號未綁定 UID。

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

`src/domain/lineup-image.js` 由當前顯示排表、成員／職業／職責或封存快照建立只含顯示文字的圖片資料；下載時快照 document 的 data-theme，指定 light／dark 調色盤（缺省 light），透過瀏覽器 Canvas 以固定 2000px 邏輯版面及 2.7 倍解析度產生 5400px 寬的 image/jpeg Blob，基準高度 3771px。職業／姓名／職責備註分欄並提高文字比例，不繪製位置小數字或「（副）」；主／副職業仍按排表選擇解析。淺色／米黃匯出時職業文字使用 PRINT_JOB_COLORS 印刷色票（未列職業以 HSL 加深的網站色），深色匯出職業字色保留色相並依背景提升至 4.5:1，圖例 4.5:1；長姓名／職業先縮小字級維持單行，最小字級仍放不下才換行；儲存格內縮以格線底色形成間隔；等待字型載入，按長文字／雙場內容測量並對齊同團列高。省略重複欄名與多餘留白；短內容將剩餘空間平均分配至資料列，超出基準高度時延長圖片，不縮小／壓扁或裁切內容。下載為本機操作, 不呼叫保存 API、不改草稿／保存狀態、不新增依賴或寫入 Google 試算表；一般／專注模式及手機共用匯出流程。

## 數據分析

`BattleRecordsPage.vue` 沿用 getRecords 每頁 20 筆, `BattleRecordDetail.vue` 點開後才透過 getRecord 讀取單筆保存的玩家快照, 不讀可變名冊或活動來重建歷史。App 的 hash 導覽支援 `#/battle-records/:id`, 保留登入後直接連結, 同頁切換詳情以記錄 ID 重建元件並丟棄卸載後的回應；返回清單保留該頁頁碼。

`src/domain/battle-statistics.js` 只依快照計算雙方職業分布、十項合計與差距, null 不當零, 部分缺值有明確標示。battlePlayerValue 只在顯示時計算一命數值（原值 ÷ max(重傷, 1), 重傷欄仍為原次數, 缺少分母或原值保留 null）, 排序使用當前模式未四捨五入的數字與文字, 職業及陣營條件交集, 缺值固定最後, 不修改原 players, 先篩選／排序完整陣營再分頁。BATTLE_TABLE_COLUMNS 僅調整閱覽欄序將資源置於最右, 不改 CSV 契約或上傳預覽欄序。職業 API 只提供顯示色彩, 失敗使用中性色點並可重試, 不阻止戰績閱讀。沒有新增資料表／後端寫入／依賴；GAS 已提供相同資料介面，實際 Google 部署與資料權限尚待驗證。

## Admin 帳號權限

`auth_accounts` 升級新增 admin／manager／member 角色與 revision, 舊資料優先名稱 admin, 否則最早帳號, 僅一位取得 admin；其餘為 manager。session 每次 JOIN 當前角色, `/api/admin/*` 在後端檢查 admin 並沿用 CSRF。`src/api/admin.js` 統一帳號管理資料介面, `AdminPage.vue` 提供 admin 密碼、manager 帳號與共用成員通行密碼管理, `#/admin` 路由及導覽同時檢查角色。

改密碼先驗證目前密碼, scrypt 完成後交易重新檢查 revision, 防止並行覆寫；admin 保留目前 session, manager／member 修改撤銷全部 session。登入完成 scrypt 後重新檢查 revision, 避免密碼更新期間建立舊密碼 session。GAS 已提供相同帳號契約，使用 PBKDF2 及私有屬性保存，尚未部署驗證。

## 公開報名登入與選人

公開 MonthCalendar 的 getEvents 與 App.restoreSession 並行，不因登入完成或失敗重載同一份公開活動；目前 visibleCalendarEvents 對所有角色相同，管理模式仍等待登入且清除身分切換的舊結果。沿用 60 秒事件清單快取及寫入／登入登出失效，不改 protected 頁或 CSRF／送出驗證。公開總人數及職業統計隱藏，管理行事曆的出勤計數保留；今日／未來仍保留身分與 expectedParticipant 所需回應，不以隱藏 UI 宣稱取消 API 資料。

GET /api/events/:id/video-form／GAS getEventVideoForm 於同一 SQLite 讀取交易／GAS commits 快照回 `{ event, eventId, members, professions }`，必要名冊欄位沿用既有 participation-members。三種有效單日戰鬥公開，不讀 responses／registrations／requests／videos 或 Drive，也不取寫入鎖或跨請求快取。過期入口與一般手動重載使用它；回傳最新事件更新上層並同步 VideoUploadForm 本地 revision，草稿保留。過期場次改至未來後補載正常 participation-form；跨午夜直接重用已載名冊，不增加 RPC。原影片內錯誤重試仍可先 getEvent 再刷新表單，舊 API 與所有寫入檢查保留。

App 提供 calendarAuth 的使用者及確認登入狀態；三種戰鬥名稱來源統一為手填／幫會／俱樂部成員。NameSourcePicker 共用分頁／選人介面，ParticipationDialog 今日／未來一次讀取場次回應、職業與必要名冊；過期影片改為獨立精簡表單，名冊／職業傳給影片表單使用；過期／撤銷後保留公開操作，登入狀態變化重讀但不清草稿。

今日／未來的報名視窗首次及手動重讀使用 `GET /api/events/:id/participation-form`／GAS `getEventParticipationForm` 一次取得 `{ eventId, revision, responses, registrations, registrationLeaves, members, professions }`；SQLite 使用同一讀取交易，GAS 在唯讀 commits 快照內先載入名冊供回應重用。送出成功只查原 participation，舊三個查詢端點與 DTO 保留。GAS 版本雜湊與 DTO 共用本次回應／外援陣列，有效外援名稱 Set 取代逐列互相比較，不跨請求快取。

公開 `GET /api/events/:id`／GAS `getEvent` 回傳單筆有效安排，沿用清單可見資料；刪除／不存在回傳錯誤。影片重載僅查該場並確認仍是三種戰鬥，刷新表單名冊仍走整併端點，失敗保留草稿。排表以 computed Map／Set 索引目前成員、職業、職責及資格，相關來源變更時失效重算，封存顯示仍直接讀不可變快照。

後端先驗證有效單日戰鬥，再開放 GET／POST／PATCH participation、GET participation-members、POST／DELETE registrations 與 POST videos 的匿名操作；登入寫入維持 CSRF。完整名冊、出勤／影片閱覽及管理 API 不因公開場次而放寬。場次選人僅回傳 uid／name／主副職業 ID／所屬狀態，不含舊名、revision 或備註。

名單選人傳送可選 memberUid；同一交易檢查 UID、姓名與目前幫派／俱樂部狀態, 同名仍可指定人員, 過期名單拒絕。不傳 memberUid 時維持原姓名比對, 舊 requestId 的 input_json 不變；新引用包含於重試比對, 不修改名冊或排表快照。GAS 已提供相同選人驗證與角色限制，尚未部署驗證。

開發中兩角色 schema 升級支援 member 時, 先以 VACUUM INTO 備份完整資料庫（記憶體測試除外）, 再暫停 FK enforcement 並於同一交易換表, 防止 DROP TABLE 的 ON DELETE CASCADE 刪掉 session。交換後檢查 foreign_key_check, 失敗回滾, 最終恢復 FK enforcement。既有帳號 ID／hash／role／revision 與 session 不變, 重啟不重複備份。


## 共用成員通行密碼

member 改為固定後端帳號，所有介面及登入回應隱藏名稱。admin 在帳號管理設定／修改 6–128 個英文字母或數字的通行密碼（區分大小寫，純數字仍可使用），初次不提供預設值，前導零保留。右上登入預設成員通行密碼；三種戰鬥的行事曆與報名均公開，報名視窗不提供登入表單。`POST /api/auth/member-login` 由後端指定帳號，與管理登入共用限流；`PATCH /api/admin/member-token` 須 admin、CSRF 及 revision。修改密碼撤銷共用 member 全部 session。舊個別 member 資料保留但不能再登入或沿用舊 session；舊新增／改名 member API 停用。admin／manager 密碼為 6–128 字元，CLI 建帳號、GAS 初始與復原沿用相同下限；既有雜湊與長密碼不重設，manager 修改留空保留原密碼。GAS 已生成對應資料功能，尚未部署驗證。


## 個人戰績

成員清單（含編外人員）提供「查看數據」；數據分析中已關聯的人名可開啟 `#/member-records/:uid`，已登入 member／manager／admin 均可使用。UID 只作路由及內部引用，頁面、名稱、標籤與 title 不顯示。未關聯人名保持純文字。

未手動指定歸屬的上傳數據列，在同一交易以當時名冊現在名稱精確比對，包含編外；唯一符合才保存 UID，不以職業、敵我、過去名稱或模糊搜尋推測。同名／未知名稱不關聯。`battle_player_links(record_id, player_index, member_uid)` 使用外鍵、逐列唯一索引及 member_uid 查詢索引，保留不可變的 players_json、原始 CSV、requestId／content_hash；詳情回應在讀取時加入 memberUid。單筆新增與 CSV 匯入共用成員建立流程；新增後依現在名稱精確比對尚未關聯的歷史玩家列，唯一同名才寫入關聯，已歸屬他人的資料不轉移。CSV 先完成整批建立再判斷唯一性，包含既有及同批同名；成員與關聯於同一 SQLite 交易／GAS 提交中保存。既有 UID 匯入仍跳過；改名、移至編外及重啟不觸發回填。原始 CSV、玩家快照與請求雜湊保持不變，戰績重試不重新比對名稱；本機詳情與重試讀取最新關聯，GAS 已保存的重試回應保持原樣。

`GET /api/members/:uid/battle-records?page=1&startDate=2026-10-01&endDate=2026-10-31&profession=碎夢` 支援選填的台北起訖日期（含當天、可只填一邊）與當場職業名稱。日期須為有效 YYYY-MM-DD、結束不得早於開始；職業依不可變玩家快照精確篩選，選項涵蓋該成員全部已關聯紀錄。回傳現在名稱／職業、篩選條件、職業選項、全部符合條件參戰的統計，以及每頁 20 筆最新優先明細。包含保存的場次類型、日期、場序、當時姓名／職業、陣營、對手與十二欄數據，點日期可回對戰詳情。無資料、找不到成員、載入／失敗／重試均有提示，直接連結登入後保留目標。

個人統計提供參戰場數、勝／敗／內推或未判定場數、十項合計、每筆平均及一命貢獻。平均僅使用各欄已知數值；一命貢獻使用有該欄數值及重傷的紀錄合計，除以這些紀錄各筆 max(重傷, 1) 的總和；重傷欄仍保留合計。缺值顯示 — 並標示缺少筆數，不當作 0。不依隊名或其他數據推測勝敗，內推及結果未填不計勝敗。同場重複玩家列均保留且場數只計一次；兩邊結果衝突時歸未判定。明細可切總計／一命，資源維持最右。統計涵蓋全部符合篩選條件的紀錄，不受明細分頁影響。套用或清除條件回第一頁，無符合資料明確提示，原有 member／manager／admin 讀取權限不變。GAS `getMemberBattleRecords` 已實作相同分析契約，未部署或寫入正式試算表。

## 成員數據分析權限

已登入 member／manager／admin 可使用戰績清單、對戰詳情、原始 CSV／既有附件下載及個人數據分析。各角色的導覽皆提供「回首頁」返回行事曆，member 另顯示成員清單與數據分析，點左上平台名稱亦可返回，從對戰表格點已關聯人名可開啟個人頁；成員清單開放 member／manager／admin，「移至編外」按鈕及端點僅供 admin／manager，其他管理功能仍只供 admin／manager。共用 member 通行密碼不綁遊戲 UID，因此可查看所有已關聯成員的數據，不限制為本人。匿名不可讀，member 不可上傳／修改戰績、活動、排表或帳號。後端分別放行明確戰績 GET 路徑及成員清單的讀寫路徑／方法，不以 URL 前綴放寬其他管理操作。

右上登入視窗包含「成員登入」「管理者登入」兩個 tab；前者只填 admin 發行的通行密碼（英數 6–128 字），後者沿用 Manager／Admin 帳號密碼。共用視窗一律預選成員登入，首頁登入後留在行事曆，直接開啟戰績／個人分析或管理連結成功後保留原目標及權限；切換 tab 清除密碼及登入錯誤。


## 行事曆可見性與登入入口

右上登入預設「成員登入」，管理者可切換「管理者登入」。首頁一般活動、約戰、幫戰與龍虎戰均公開可見；三種戰鬥皆可匿名報名／請假、選取成員及上傳影片。GET /api/events 不再依 session 隱藏幫戰／龍虎戰；管理頁、完整名冊、出勤閱覽與影片閱覽仍沿用原角色限制。

報名視窗不含登入表單，三種戰鬥都有「直接輸入名稱／幫會成員名單／龍虎戰成員名單」。登入過期或撤銷後仍可使用公開場次操作；有效登入寫入維持 CSRF，登入狀態變動時重讀資料並拒絕過期回應，不清除未送出草稿。


## 場次影片連結

本機 event_video_submissions／event_video_requests 與 GAS GM_videos／GM_requests 分別保存雙場連結、團別、備註及 requestId 回應；不遷移兩端資料、不保存影片檔案。getEventVideos／submitEventVideo RPC 沿用場次資格與 CSRF，admin／manager 可讀清單，member 僅能提交；約戰可匿名提交。GAS 在 script lock 內追加資料，影片與重試結果由同一提交 marker 生效，未提交資料不讀取；已初始化的舊專案首次有效使用補建 GM_videos。

共用純 JS 網址驗證不依賴 GAS 缺少的 Web URL 全域，前端只呈現可複製文字。CSV 由瀏覽器依當前場次／團別／名稱篩選產生，不新增後端匯出或 HTTP fallback。隔離測試及編譯 HTML 的模擬 RPC 驗證不代表真實 Sheets 授權或 Google iframe 下載已完成。

## 管理出勤閱覽

管理總覽當日安排視窗與活動安排清單的約戰／幫戰／龍虎戰提供「出勤閱覽」。預設請假；約戰保留請假／報名分頁與實際人數，幫戰／龍虎戰只顯示請假分頁。表格顯示名稱、當場職業、備註，不顯示 UID；未回應及舊 none 不計入，有效外援歸報名，已取消外援歸請假。只有 admin／manager 可用，公開行事曆與 member 不提供名單入口。

`GET /api/events/:id/attendance` 與 GAS `getEventAttendance` 共用 DTO，回傳 eventId、leave、registered；列含 name／profession／colorcode／note，source／id／revision 僅供操作識別及版本檢查，不呈現在畫面。每次開啟重讀，包含載入、空名單、失敗／重試、手動重載及過期回應保護，成功後才顯示人數。

請假列提供「取消請假」，透過 `PATCH /api/events/:id/attendance`／GAS `cancelEventLeave`。成員回應改回 none，保留職業、備註與名冊所屬狀態，幫會／俱樂部成員恢復可排表資格；外援恢復原報名 ID 及有效狀態。成員自行再次報名則改為 registered，也會解除請假，不轉成編外或建立外援。修改檢查 revision，資料已更新必須重載；相同成功操作可安全重試。本機使用 SQLite 交易，GAS 在 script lock 內透過現有提交標記生效；API 僅限管理角色，寫入檢查 CSRF，不加入公開 participation 白名單。

沿用現有資料表，不需要新增工作表或重新初始化。本次生成 GAS 套件，未同步或發布新部署。

## 已上傳對戰資訊編輯

admin／manager 可由上傳數據已保存卡片，或數據分析詳情的「編輯對戰資訊」後補雙方名稱、我方及獲勝方。約戰可逐場開啟內推，保存時清除敵我／勝方；幫戰與龍虎戰不可設內推。member 只可閱讀，結果修改後重新讀取個人分析及清單會使用最新值。

本機 `PATCH /api/battle-records/:id` 與 GAS `updateBattleRecord` 共用欄位驗證，檢查管理角色、CSRF、revision 及 requestId；SQLite 追加 revision（舊資料初值 0）與 battle_metadata_requests，交易保存修改和重試結果。GAS 舊戰績 revision 缺值視為 0，GM_battles 及 GM_requests 沿用既有鎖定與提交標記，不需新增工作表。原 CSV、Drive 檔案、玩家快照及成員連結、日期／類型／場序與原上傳重試資料保留；不重算或覆寫原 content hash。

傳錯的戰績不可覆寫，改由 admin／manager 刪除後重傳（本機 `DELETE /api/battle-records/:id`、GAS `deleteBattleRecord`）。同一交易移除 battles／battle_players／battle_links 及成員參照覆寫，釋放場次與 content hash，讓同場可重新上傳；Drive 檔案與上傳重試紀錄保留。檢查管理角色、CSRF 與 revision，重複刪除為無動作。

編輯視窗每次開啟讀最新資料，儲存成功更新卡片／詳情及快取；失敗保留草稿，衝突須重新載入，相同請求重試不重複修改。兩場各自修改，不清除另一場待上傳 CSV。GAS 套件已生成，本次未同步或發布新部署。

## member 開放成員管理

App 對 member 開放 members 路由及導覽，直接連結登入後保留目標；成員頁與 admin／manager 共用同一元件及資料介面。SQLite 及 GAS 資料結構不變，不修改帳號角色或本人 UID 綁定。

本機白名單為 GET／POST `/api/members`、POST `/api/members/import/preview` 及 `/api/members/import`、PATCH／DELETE `/api/members/:uid`；GAS 業務白名單為 getMembers／addMember／updateMember／removeMember／previewMemberImport／importMembers。有效 session 才可使用，寫入保留 CSRF 及原有驗證／並行保護，其他管理功能仍依角色檢查。新增及匯入仍沿用歷史戰績關聯流程。

## 抽獎活動

`src/domain/lottery.js` 共用名單驗證、獎品保留、抽獎與清空規則，`server/lottery-repository.js` 以 SQLite 單列 JSON（`lottery_boards`）保存，`gas/src/lottery.js` 以 `GM_lottery` 單一紀錄保存並於首次使用補建工作表；兩端都由後端決定冠軍並在同一交易／提交中保存，抽同一獎品可安全重試。`src/api/lottery.js` 提供 getLottery／saveLottery／drawLotteryPrize／resetLottery 同名介面（本機 `GET/PATCH /api/lottery`、`POST/DELETE /api/lottery/draws`），未登入／member 由既有權限規則拒絕。

`src/domain/lottery-race.js` 只規劃動畫：冠軍固定在 20 秒到線，其他人較晚，突發狀況（摔倒、睡著、吃草、跑錯方向、暴衝）皆在各自到線前結束，因此動畫順序永遠與保存結果一致。頁面分成殼層與玩法：`src/pages/lottery/LotteryPage.vue` 負責名單、獎品、抽獎 API、全螢幕舞台、播報框與結果視窗；玩法元件（`RaceStage.vue`、`WheelStage.vue`）只接收參加者名稱、演出並在揭曉後 resolve `play(winnerIndex)`，由 `modes.js` 登記並顯示為玩法卡片。結果視窗關閉後才把新得獎者套用到獎品清單；減少動畫設定下停用晃動與彩帶。轉盤的停點與三種結局計算在 `src/domain/lottery-wheel.js`，台詞在 `src/domain/lottery-commentary.js`。

## Discord 通知

`src/domain/discord-notifications.js` 共用 Webhook 網址檢查、請假狀態轉換判斷與 embed 內容。業務寫入在交易內把通知排入佇列：本機 repository 以 `takeNotifications()` 交給 `server/app.js`，只在呼叫成功後交由 `server/discord-notifier.js` 非同步依序送出；GAS `rpc()` 收集通知並在 script lock 釋放後以 UrlFetchApp 送出。資料保存為準，通知失敗不回滾或影響回應；重試回應不重送。GAS 未設定頻道靜默停用，已填無效網址、HTTP 失敗及傳送例外僅記錄設定名稱、固定分類與最終 HTTP 狀態，不保存網址、例外原文、回應本文或玩家資料；日誌失敗同樣不影響已保存回應。設定見 README「Discord 通知」與 GASDeployment。

## 進攻／防守戰績分析

對戰詳情以 `GET /api/battle-records/:id?includeTeamContext=true`／GAS `getBattleRecord(id, { includeTeamContext: true }, context)`，在同次 SQLite 讀取交易或 GAS 唯讀 commits 快照，取玩家、既有成員引用投影與同 eventId 最新儲存排表。`includeTeamContext` 僅接受 boolean（HTTP 僅 true／false 字串），省略保持原詳情契約；GAS wrapper 亦相容舊第二參數 session context。不新增 RPC 或資料表、不讀 Drive、不占寫入鎖，也不修改原 CSV／排表／玩家快照。

後端共用 `matchBattlePlayers` 身分判定，再由 `battleTeamContext` 只傳 recordId、unavailable、lineup.savedAt 與逐玩家 playerIndex／teamId／teamName／reason。最小 context 不含排表 UID、報名 ID、備註、職責或未出場人員。日期／類型不符、缺場序／活動／排表時不推測；已刪活動仍可用最後排表。第一場取 slot，第二場取 secondRound 或沿用 slot；已關聯 memberUid 優先對應 UID，無關聯才唯一精確姓名，同名、跨陣營重複及同人多列保持未分類。

前端 `analyzeBattleTeamContext` 使用當頁原始玩家快照及已驗證對應，形成進攻團、機動團、防守1–4 六組資料；兩個彈窗的合計、比例、排序、分頁、配對與圓餅由前端處理，開啟／切陣營／tab／配對不讀 API。比較頁每列一團／隊，固定數值與占全場比例兩表。防守 A 選兩隊，B 取其餘兩隊，互斥且四隊各一次。全場分母含同陣營未分類、團內只含本團玩家，圓餅分母為被比較兩組合的合計；缺值／部分資料／零分母保留未知，不造百分比。

戰績未固定排表版本，詳情顯示分團來源保存時間；顯式重載詳情才更新排表對應並拒絕過期回應。首載增加排表讀取；目前 GAS 仍讀 lineup_versions 集合再篩選同活動，不宣稱已消除全表索引或其他排表 payload 的讀取。member／manager／admin 可讀，匿名及撤銷 session 不可讀，member 排表管理權限不變。舊 `GET /api/battle-records/:id/team-analysis`／GAS `getBattleTeamAnalysis` 保留原四團格式與名稱相容，新 UI 不再呼叫。

## 成員資料維護與 UID 修正

`src/domain/member-maintenance.js` 共用欄位白名單、UID／舊名驗證及紀錄引用投影；`server/member-maintenance.js` 與 `gas/src/member-maintenance.js` 各自處理資料交易。新增 GET／PATCH `/api/members/:uid/maintenance`、PATCH `/api/members/:uid/history`、POST `/api/members/:uid/permanent-delete`，GAS 對應四個具名 RPC。這些路徑／RPC 不加入 member 白名單，沿用 admin／manager 驗證、CSRF、revision 及 requestId 防重試；原 updateMember 仍拒絕 UID。

UID 修正先建立新鍵、移動 member_name_history／event_member_responses／battle_player_links，再移除舊鍵；刪除只清除名冊和這些成員關聯，不刪 battle_records／原始 CSV、lineup_versions 或整場資料。舊名管理只改名冊歷史，不變更戰績數字或立即轉移戰績；admin 同步仍先預覽唯一精確名稱及衝突。

不可變排表／範本／戰績快照不改寫。SQLite `member_reference_overrides(kind, record_id, overrides_json)` 和 GAS `requests` 的保留鍵 `member-ref:<kind>:<id>`，只對受影響的舊紀錄記下原 UID→新 UID／null。讀取排表、範本套用、戰績及團隊分析時投影內部引用；姓名／職業快照不變，連續改 UID 可累積修正，但新紀錄重用舊 UID 不會跟著轉址。GAS 的排表／範本成功請求重試也套用目前有效引用，保留原請求雜湊。

SQLite `member_maintenance_requests` 保存管理操作結果；`member_uid_revisions` 及 GAS requests 的 `member-revision:<uid>` 保留移除前版本下限，新建或移入曾使用的 UID 採更高版本，避免舊畫面修改另一個新身分。SQLite 全流程同一交易；GAS 保留 script lock／提交標記及既有工作表，不需重做 setupGas。GAS 刪除採日誌的移除標記，歷史列及備份不物理清除。

## 影片職業快照

影片提交新增必填 professionId 與選填 memberUid（只供驗證目前姓名與幫會／俱樂部資格，不寫入影片身分關聯）。SQLite event_video_submissions 追加可空 profession_id／profession_name／profession_colorcode，GAS videos 保存相同快照；舊列與重試資料不修改。新版提交驗證有效職業，保存快照後名冊職業改變不影響影片；舊影片回應容許未記錄職業。閱覽與 CSV 使用六欄並顯示職業名稱。

影片團別選項與顯示共用 `VIDEO_GROUP_OPTIONS`／`videoGroupLabel`：進攻團對應既有值進攻一、機動團對應進攻二、防守團不變。上傳選擇、閱覽篩選及表格／CSV 使用同一對應；儲存值、SQLite CHECK、舊影片與 requestId 內容保持相容，不遷移或覆寫資料。


## GAS 上傳數據診斷

`saveBattleRecords` 的未知例外由 `battle-upload-diagnostics.js` 追蹤失敗步驟、固定表別與耗時，RPC 回傳保留 `GAS_ERROR` 並附步驟／類型／診斷碼的訊息。執行紀錄只含固定分類及耗時，不記錄原始錯誤文字、stack、輸入、玩家、檔名、資源 ID 或憑證；原始錯誤只用來選擇固定類型。已知業務／權限錯誤維持原回應；紀錄失敗不改操作結果。

Sheets storage 以可選的同步 run 包裝讀寫、flush 與提交標記，預設直接執行；未新增服務呼叫、資料搬移或改變提交順序。巢狀步驟時間包含其子步驟，不能相加視為總耗時。提交後錯誤回報結果未確認，由原 requestId 機制安全重試；Drive 未引用附件仍依既有規則保留。

## GAS 最新已提交版本讀取（v1.0.20）

`createSheetStore` 在交易開始固定 commits 次序；每張表首次存取時，按 record_id 與 transaction_id 選擇該快照中最新的已提交版本，再驗證該版本的分段及解碼 JSON。最新的刪除標記代表不存在，之後的新建版本可恢復；最新版本缺段／重複分段或內容損毀仍報錯，不退回舊資料。已被取代的舊 payload 不再是一般查詢的必要資料，歷史列仍原樣保留；這個讀取流程不作完整歷史健全性稽核。

指定 key 的 get／getMany，以及超過 128 個資料列的大表 all，先讀前四欄索引，再依最新版本的相鄰列批次讀 payload_base64；不讀取其他歷史版本的 payload。不超過 128 列的小表 all 保留一次五欄批次讀取，避免多一次雲端往返，但仍只解碼最新版本。同一交易重用索引、已解碼值及不存在的查詢結果，並疊加本交易 put／remove；快取不跨請求。列數每次讀取只取得一次，避免重複 getLastRow。

保留五欄格式、Base64／UTF-8 分段、全部歷史、write lock、flush 及提交標記，不需資料搬移或 setupGas。業務 API 的顯式排序維持原規則，不以內部 Map 枚舉當作業務排序。commits 與前四欄索引仍需掃描；若最新列分散，payload 可能需要多個範圍呼叫，因此效益依資料分布而異，呼叫量比較不等於正式 GAS 秒數。

## 顯示設定、場次選擇與數據格式

`src/theme.js` 管理色系（light／sepia／dark，對應 Vuetify `guild`／`guildSepia`／`guildDark` 與 document 的 data-theme）及字級（normal／large／larger，以 documentElement 的 CSS zoom 套用），兩者各存 localStorage，讀寫失敗回預設。`src/main.js` 掛載前套用，App 頂欄「顯示」選單直接切換。排表 JPG 讀取 data-theme，lineup-image 有對應三色調色盤。

`src/domain/battle-events.js` 提供戰鬥場次篩選、標籤、台北今日與 upcoming／recent 排序；排表用 upcoming，上傳數據與影片閱覽用 recent，預設取排序第一筆。`src/domain/number-format.js` 依整欄是否達 1 萬決定「萬」單位、0／缺值顯示淡色 —，並以 compactStat 將單一總數轉為萬／億；只影響顯示，不改資料與排序。

## 載入效能（v1.0.25）

`getLineupIndex` 接受選用 `{ include: 'default' }`（本機 `/api/lineups?include=default`），以 `src/domain/lineup-index.js` 選出今天或之後最近的場次，並附上該場排表版本與報名資料；排表頁初次載入因此只需一輪雲端呼叫。舊呼叫方式（`getLineupIndex(context)`）不變。`src/api/events.js` 的場次清單在同一傳輸方式內共用 60 秒，場次寫入、登入／登出／角色變更及登入過期時清除；首頁行事曆仍等登入確認後才讀取（使用者要求）。

## 行事曆過期戰鬥入口（v1.0.28）

前端 isPastBattleEvent 依既有 YYYY-MM-DD 日期與 Asia/Taipei 的今天比較，僅日期早於今天的戰鬥場次隱藏報名／請假與職業統計、報名人數，改以影片上傳為入口及預選 tab；今天及未來仍提供原功能，一般活動不變。MonthCalendar 以本地午夜 timer 與 focus／visibilitychange 更新 today，傳入 ParticipationDialog；提交前也以當下台北日期擋下已過期的舊表單。卸載清理 timer／事件，日期更新不呼叫 API、不寫資料或占寫入鎖。

影片保留原 getEventParticipationForm 的名冊與職業整併讀取，開啟仍只需原本一次 RPC，沒有新增伺服器時鐘或第二份資料請求。影片表單不因跨日重新掛載或清除草稿。這是首頁操作入口的前端規則，後端報名／請假 API 權限、版本、requestId 與資料契約不變，不能視為新增伺服器截止限制。

## 影片閱覽整併首載（Unreleased）

GET /api/videos/browser?eventId=…／GAS getVideoBrowser(preferredId) 只供 admin／manager，回 `{ events, selected }`，selected 是原 getEventVideos 的 `{ eventId, eventRevision, videos }` 或空清單時的 null。同一 SQLite 讀取交易／GAS commits 快照先取有效戰鬥清單，依原影片頁 prefer=recent 與台北今天排序；有效 preferredId 優先，否則今天或最近過去、再未來。selected 不存在時不讀影片表。前端首載／顯式重載一次取得，不再 getEvents 後由 watcher 呼叫 getEventVideos，換場仍用原端點一次，舊 DTO 與提交契約保留。

新方法在 READ_ONLY，缺 videos 表沿 getEventVideos 原有 LAZY_TABLE_READS 於鎖內重驗權限補建；正常只讀 events／videos／commits，不讀 Drive、名冊、報名、排表或戰績。匿名／member 拒絕，submitEventVideo、CSRF、eventRevision、requestId、儲存格式及歷史不變。

顯式重載不使用導覽用 60 秒事件快取，保留有效場次與篩選，失效才回退。當頁事件與影片用 shallowRef 承接不可變快照，篩選不寫後端、不跨請求快取影片，資料失敗可重試，換場／卸載用 operation token 丟棄舊回應。固定 GAS 往返成本比少量影片的前端篩選更值得優先處理；原事件快取熱時已可只用一次 RPC，因此不宣稱所有進頁都少一次。GAS 仍須 all(events)／all(videos) 後篩選，沒有消除索引或歷史掃描／解碼，不新增 schema 或 eventId 索引。

## 對戰資訊精簡讀取與清單一致性（Unreleased）

GET /api/battle-records/:id/metadata／GAS getBattleMetadata(id) 限 admin／manager，回 `{ record }`，只含 id、type、playedAt、roundNumber、redTeam、blueTeam、winner、ourSide、isInternal、revision。編輯視窗每次開啟／重載都讀最新版本，不跨請求快取；SQLite 明確選取必要欄位，不解析 CSV／players_json 或投影成員關聯。GAS 依同次 commits 快照 get(battles,id)，加入 READ_ONLY，保留登入檢查，不讀 battle_players／battle_links／lineup_versions／requests／Drive 或取得寫入鎖。既有內嵌玩家的舊 battles payload 仍須整筆解碼；此優化不更動格式或消除索引／歷史掃描。

寫入仍用原 updateBattleRecord 的 revision、CSRF 與 requestId。成功回應更新詳情及當頁快取清單的對應列，返回時不新增清單 RPC；單純查看返回亦重用。成功刪除標記清單失效，返回時只刷新清單頁，依剩餘總數先校正已知末頁；若伺服器回應顯示頁碼另已失效，最多再讀一次有效末頁，持續變動則提示重試。變更會淘汰先前進行中的清單回應，卸載／換頁 token 及讀取失敗重試保留。返回聚焦原對戰，已刪則回第一筆或空清單標題。詳情 includeTeamContext、進攻／防守分析的零新增 RPC 與舊 getBattleRecord／getBattleTeamAnalysis 契約維持現況。

## 影片職業更正（Unreleased）

PATCH /api/events/:eventId/videos/:videoId/profession／GAS updateEventVideoProfession(eventId,videoId,input)，只供 admin／manager，input 僅 professionId／revision／requestId，回 `{ video }`。職業驗證共用 validateVideoProfessionUpdate，單筆影片 revision 與場次歸屬／可用性、有效職業在寫入交易內核對；不以場次 revision 阻止另一筆影片更正。只更新 professionId／professionName／professionColorcode 及 revision，保留名稱、網址、團別、備註、createdAt 與其他場次／名冊／排表。

SQLite 為 event_video_submissions 追加 revision=0，另建 event_video_profession_requests 保存編輯指紋與結果；舊 event_videos 七欄及舊列不改，用 event_video_profession_overrides 保存人工更正並於清單 LEFT JOIN。初始化只補欄／表，沒有自動猜測職業或修改原提交 receipts。GAS 舊缺 revision 視0，在既有 videos／requests 表追加版本，沿 commits／flush；新 RPC 加 WRITES，不加入公開白名單或 READ_ONLY，保留 CSRF 與 Script Lock。讀取範圍是 events、指定 videos、professions、requests 與共用 commits／登入；未新增 GAS 表或 Drive／通知。

原 submit receipts 保留；相同編輯 requestId 重試回傳原成功結果，與新增影片 receipts 分開，並納入 eventId／videoId／professionId／revision 指紋，不能用同 ID 改內容。新清單／新提交 DTO 加 revision，舊無值讀取相容0，原欄位與 CSV 六欄不變。

VideoProfessionDialog 首次掛載才讀同 transport 的共用職業快取，未更動影片頁首載 RPC；重試失敗選項不黏住。草稿與版本不跨請求快取；正常送出一次修改，成功回應替換該列，原篩選與排序不變，不整頁重讀。衝突由明確操作重讀本場 getEventVideos 更新版本，保留已選更正供確認；失敗保留草稿，相同內容用相同 requestId。視窗卸載／關閉淘汰過期回應，儲存中不能重複送出或關閉，取消先確認未儲存變更，焦點回入口。詳見 Style.md／GASConcurrency.md，尚未同步或部署。


## 上傳前數據歸屬（Unreleased）

GET /api/battle-upload/roster／GAS getBattleUploadRoster() 限 admin／manager，回 `{ members: [{ uid, name, revision, isInGuild, isInClub, profession }] }`。SQLite 單次 JOIN，GAS 同次唯讀快照只讀 members／professions／commits；不讀名稱歷史、報名、排表、戰績或 Drive，不取業務寫入鎖。前端進頁背景一次；當頁 Map 分類／搜尋，無跨請求快取，HTTP no-store；明確重載／失敗重試取得新資料，離頁 token 丟棄舊回應。名冊未確認不阻擋解析／普通上傳。

原 saveBattleRecords 的每筆 record 可選 attributions 陣列，每項恰有 playerIndex／sourcePlayer／sourceSide／memberUid／memberName／memberRevision。共用 validator 驗證完整鍵、型別、索引唯一／範圍及 CSV 原角色與陣營一致；undefined／空陣列與舊呼叫等價，不改舊指紋形狀。成員存在且姓名／revision 一致才可指定，包含編外；不依職業／敵我推測限制，不接受任意改名或偽造玩家快照。

原 CSV 仍由後端解析，player 保留角色 B，新增 creditedName 保存歸屬 A 的顯示快照，原數字／職業／陣營不變；links 的 UID 才是實際個人戰績依據。手動指定優先於 B 的現名自動匹配，未指定沿唯一現名匹配，已關聯歷史不移轉。詳情、個人頁、團隊明細由 battlePlayerName 顯示歸屬名；詳情姓名排序使用歸屬名，詳情與個人頁另顯示原角色。重複 UID 不合併或刪列，預覽警告後沿原個人場數去重／逐列統計規則。

歸屬參與原 requestId 指紋，內容變更同 ID 拒絕；contentHash 排除 attributions，避免以換歸屬重複匯入。SQLite 一次讀名冊建索引，在同交易重驗全部記錄後寫快照／links／receipts。GAS 鎖外 prepare 在有手動歸屬時先讀名冊驗證，未指定時不增加 prepare 名冊讀取；獨立 Drive 建檔後，最終 Script Lock 內重新讀名冊／驗權及原唯一性、場次版本、requestId，再一起提交快照／links／requests／commits，保留 flush。最終衝突不提交業務資料，鎖外未引用檔保留原復原策略。

前端草稿獨立於解析快照，key 為 roundNumber＋file.id，列用原 playerIndex，不用分頁位置；調整不使預覽回第一頁。僅待上傳可調整，搜尋視窗按需掛載；跨頁／雙場保留，換場／檔案替換清除，普通失敗保留，名冊更新後失效的指定標示待確認並重新套用。選人與清除零 RPC，和原上傳同一請求保存，不新增逐列 API、資料表或永久別名。既有歷史更正不在此範圍。


## 分析未分類玩家臨時分隊（Unreleased）

新增前端專用 src/domain/analysis-assignments.js，applyAnalysisAssignments(analysis, assignments) 以原analyzeBattleTeamContext結果為基礎，只接受原unclassified列與既有六個團隊ID。key為該戰績原playerIndex，來源已全域唯一，不依姓名、UID或目前分頁位置；每列只有一個目標，保留紅藍分開，不修改玩家／teamContext／原analysis。沒有指定或只有無效／自動分組列的指定時直接回原來源，不複製資料。

有指定時只重建受影響陣營與團：將原未分類列加入指定組，依原列序排列，以未捨入的metrics.value重算合計、missing、團內％與占全場％；全場totals與count沿原值，分母不變。缺值不補零、部分分母／零分母沿原比例規則。防守配對與圓餅重用現有函式。輸出列帶temporary與團名（臨時），保留原來源警示／lineup資料；無排表也只在使用者明確選擇後分隊，不改後端自動判定。

BattleTeamAnalysisDialog在當頁保存一份assignments，進攻／防守共用且各提供最後一頁未分類設定；原候選資料始終從props.analysis取得，已指定列不會消失。computed只依來源和assignments重建統計，設定頁排序／分頁與分析tab分開，選隊保留頁碼；每頁最多20個選單。選單限定保持未分類／進攻團／機動團／防守1–4，可逐列還原或全清除。圖表只在可見比較頁掛載，設定頁不繪製。

關閉／重開、切模式及切陣營保留記憶體內指定，詳情新快照時清除，詳情載入期間既有元件卸載也清除；換紀錄／離頁同樣失效。不保存瀏覽器持久儲存、URL或後端。設定／分類／排序／清除零RPC；僅原明確重新載入詳情才走既有getBattleRecord。SQLite／GAS／READ_ONLY／CSRF／鎖與舊分析API完全沿用，沒有新增讀寫或表，不需要資料搬移。
