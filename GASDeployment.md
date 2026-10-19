# GAS 初始化與部署

目前已生成 Vue 單檔頁面與完整 GAS 後端，涵蓋登入／帳號管理、行事曆、成員／匯入／名稱歷史、活動、職責、報名／請假、排表／範本、戰績上傳／下載／閱覽、個人分析及團隊分析。本機 SQLite 環境保留。

## 2026/10/19：本機 v1.0.18 待同步

來源 `1fd4f4d`，本機已補戰績上傳未知例外的失敗步驟、錯誤類型與診斷碼，以及固定分類的雲端紀錄。278 項測試、一般／GAS 編譯與兩份實際 CSV 的隔離匯入／重試驗證通過；未確定正式故障原因。這輪未同步 GAS、更新部署或改正式資料，後續交付沿用 1.0.18，不再次升版。

使用者目前線上頁尾為 v1.0.17；前輪唯讀查詢與下載為第 21 版（v1.0.17），使用者後續截圖為第 22 版。下方 v1.0.16 是較早由本代理完成的同步紀錄，不能作為最新正式部署狀態。

套用新診斷需先依授權同步程式，再更新既有 Web App 部署。從網站重試上傳後，畫面會提供步驟／類型／診斷碼；執行項目中的 `BATTLE_UPLOAD_FAILURE` 紀錄包含表別與各步驟耗時，不含原始例外文字、玩家資料、CSV 或憑證。各巢狀步驟耗時有重疊；提交後回應失敗可能已保存資料，應保留相同請求重試。不要從編輯器直接執行 saveBattleRecords 或為診斷重跑 setupGas。

## 2026/10/19：v1.0.16 同步狀態（歷史）

來源 `8911155`（功能 `cee0849`、`1ce3a75`），平台版本 **1.0.16**，沿用已準備的同批版本，不再次升版。單張排表 JPG 以 5400×3771 為橫向基準，放大文字、調整欄寬並縮減重複欄名與留白，移除位置小數字及「（副）」；雙場與長文字需要時增加高度，保留所選職業及明暗主題。

`npm run gas:push` 已編譯、備份遠端、上傳 `Index.html`／`Code.gs`／`Backend.gs`／`appsscript.json`，四檔讀回比對一致。私有前後備份 `data/gas-backups/2026-10-19T10-05-21-896Z/before` 與 `after` 不提交；package／lockfile／release note／GAS 套件版號及圖片更新內容核對通過，無外部 JS／CSS。沿用前輪 271 項測試、一般／GAS 編譯與隔離 Chrome 真實 JPG 驗證，本輪重新 GAS 編譯及套件檢查，未重跑完整測試。

**本輪只同步 GAS 程式，未 push Git 或更新 Web App 部署，未執行 setupGas、修改 Script Properties／正式試算表或傳送 Discord 訊息。** 仍需由使用者更新既有 Web App 部署才會套用 1.0.16。本輪未重查對外部署版本；先前第 17 版 v1.0.12 僅為歷史查詢，不代表目前部署狀態。

## 2026/10/19：v1.0.15 同步狀態（歷史）

來源 `e762276`，平台版本 **1.0.15**，沿用本批已升版的版本，不重複升版。活動搜尋及排表重用排序與人員索引，報名名冊／職業／回應整併一次讀取，GAS 重用同次陣列；影片重載只查單場。Webhook 加入安全診斷並保留未設定頻道靜默，排表 JPG 改為三欄／姓名放大並跟隨明暗主題，更新紀錄已涵蓋全部內容。

`npm run gas:push` 已重新編譯、備份遠端、上傳 `Index.html`／`Code.gs`／`Backend.gs`／`appsscript.json`，四檔讀回比對一致；私有備份 `data/gas-backups/2026-10-19T09-42-16-962Z/before` 與 `after`，不提交。package／lockfile／release note／GAS 套件皆為 1.0.15，新 RPC、通知診斷及 JPG 主題打包檢查通過，無外部 JS／CSS。沿用功能回合已通過的 271 項測試（原 260 項未修改，新增 11 項）、一般編譯、桌面手機及實際 JPG／草稿／封存驗證，本輪未重跑整套測試。

**本輪僅同步 GAS 程式，未 push Git 或更新 Web App 部署，未執行 setupGas、改動 Script Properties／正式試算表或傳送 Discord 訊息。** 仍需由使用者更新既有 Web App 部署才會套用 1.0.15。對外部署本輪未查詢，最近一次歷史唯讀確認仍為第 17 版 v1.0.12，不能當成本輪部署結果；真實 Google／Discord 延遲及送達仍待發布後正常使用確認。

## 2026/10/19：v1.0.14 同步狀態（歷史）

來源 `bb53187`，平台版本 **1.0.14**，本批沿用已升版的版本，不重複升版。影片上傳、閱覽、篩選及 CSV 統一顯示進攻團／機動團／防守團，保留原儲存值與舊資料；活動安排清單新增名稱搜尋，可搭配類型篩選，依安排日期由新到舊顯示。

已執行 `npm run gas:push`：重新編譯、備份遠端、上傳 `Index.html`／`Code.gs`／`Backend.gs`／`appsscript.json`，四檔讀回比對一致。私有前後備份 `data/gas-backups/2026-10-19T08-05-03-858Z/before` 與 `after`，不提交。package／lockfile／更新紀錄版本一致，套件含 v1.0.14、搜尋／排序及三團名稱，無外部 JS／CSS；沿用功能回合已通過的 14 項影片測試與桌面／手機 Chrome 驗證（活動清單另以 27 筆隔離資料驗證）。

**本輪只同步 GAS 程式，未 push Git 或更新 Web App 部署，未執行 setupGas、修改正式試算表／Script Properties 或傳送 Discord 訊息。** 使用者更新既有 Web App 部署至新版本後才會套用 v1.0.14。本輪未重新查詢對外部署；最近一次唯讀確認仍為下方 Webhook 調查的第 17 版 v1.0.12，不視為本輪部署狀態。

## 2026/10/19：v1.0.13 同步狀態（歷史）

來源 `783cddd`，平台版本 **1.0.13**。member 隱藏「移至編外」按鈕，該端點限 admin／manager，其餘名冊功能維持現況；三角色的桌面及手機選單新增「回首頁」連回行事曆。package／lockfile／更新紀錄已對齊，本批只升版一次。

已執行 `npm run gas:push`：重新編譯、備份、上傳 `Index.html`／`Code.gs`／`Backend.gs`／`appsscript.json`，四檔讀回比對一致；最新私有備份 `data/gas-backups/2026-10-19T07-28-50-025Z/before` 與 `after`，不提交。GAS 套件版本、更新紀錄、回首頁文字及無外部 JS／CSS 檢查通過。功能沿用已通過的 260 項回歸測試、三角色桌面／手機驗證及最近 6 項通知測試，未重複執行完整測試。

**本輪只同步 GAS 程式，沒有 push Git、更新 Web App 部署、執行 setupGas、修改正式資料／Script Properties 或傳送 Discord 測試訊息。** 使用者更新既有 Web App 的部署版本後，公開網站才會套用 1.0.13。

**最近一次對外部署確認（2026/10/19 Webhook 調查）：第 17 版，說明 v1.0.12。** 已下載該版核對後端與 1.0.12 已同步備份一致，manifest 含 `script.external_request`、USER_DEPLOYING。使用者自行補授權後執行 `testDiscordWebhooks`，請假頻道成功 HTTP 204；名冊頻道未設定或網址不符。請假問題優先判斷與原先授權不足有關，仍待新的正常請假狀態變更實測；已保存的舊通知不自動補送，同筆重試不重複通知。本次沒有更新部署或寫入正式資料，下載檔案私有不提交。

## 2026/10/19：v1.0.12 同步狀態（歷史）

使用者確認每批新的 GAS 功能／修正同步應遞增 patch。本批版本提交 `61caa9b`，版本由 1.0.11 升為 **1.0.12**，package／lockfile／頁尾及更新紀錄已對齊；1.0.11 保留先前成員維護紀錄。本批包含 CSV 摘要人數提醒、三種戰鬥公開報名／影片選人及職業、排表請假者置底與空人員儲存修正。

`npm run gas:push` 已編譯、備份、上傳 `Index.html`／`Code.gs`／`Backend.gs`／`appsscript.json`，四檔讀回比對一致。最終遠端前後備份為 `data/gas-backups/2026-10-19T06-57-29-237Z/before` 與 `after`（私有、不提交）。使用者更正版號前的 1.0.11 中間同步備份 `data/gas-backups/2026-10-19T06-56-10-090Z/` 保留，最終遠端程式以 1.0.12 為準。

**最新再次同步：** 使用者再次要求同步 GAS，來源 `9457e3a`（與 `61caa9b` 程式及版本一致，僅文件改動），沿用 1.0.12。`npm run gas:push` 重新編譯與備份，clasp 回報 `Script is already up to date.`，再讀回四檔比對一致。最新備份為 `data/gas-backups/2026-10-19T06-59-30-424Z/before` 與 `after`；未升版、push Git、更新 Web App 或操作正式資料。

260 項功能回歸測試及隔離 48 人 Chrome 保存／重載已於前一步通過；本輪一般／GAS 編譯、版本／新舊更新紀錄與無外部 JS／CSS 檢查通過。程式包含排表修正，但使用者正式錯誤請求尚未取得，仍待發布後確認實際問題。

**只完成 GAS 程式同步，未 push Git、未更新 Web App 部署、未執行 setupGas 或變更正式資料／Script Properties。** 本機來源提交尚未推送 origin/main；本輪未查詢部署版本，不能用過往第 3 版紀錄代表現況。使用者更新既有 Web App 為新版本後，公開網站才會套用 1.0.12。

## 2026/10/19：v1.0.11 交付狀態（歷史）

本機已完成 admin／manager 成員永久刪除、UID 修正、過去名稱管理及深色模式操作列修正，使用者已確認本機畫面。平台版本升為 `1.0.11`，與 package-lock.json 一致。

**最新同版補充：** `687b01b` 已補上更新紀錄頁的 v1.0.11 條目及 AGENTS.md 的交付規則，並推送至 `origin/main`。再次執行 `npm run gas:push` 成功，四檔讀回比對一致；最新遠端前後備份為 `data/gas-backups/2026-10-19T05-17-07-633Z/before` 與 `after`（私有、不提交）。一般／GAS 編譯及編譯產物中的四項更新說明核對通過。版本仍為 1.0.11，Web App 部署與正式資料未更動。以下為首次成員維護同步紀錄。

來源提交 `f02e43a`（`feat(members): 新增成員資料維護並交付 v1.0.11`）已推送至 `origin/main`，並核對 GitHub main 的完整 SHA 為 `f02e43a84446e2346976448f68d1fc1b93acfe17`。沿用既有 `1.0.11`，本輪未重複升版。

2026/10/19 已執行 `npm run gas:push`，將 `Index.html`／`Code.gs`／`Backend.gs`／`appsscript.json` 四檔同步至 `gas/upload-target.json` 指定的 Apps Script 專案；Google 接受上傳，四檔讀回比對一致。遠端前後備份位於 `data/gas-backups/2026-10-19T05-13-09-376Z/before` 與 `after`（私有、不提交）。先前自動核准服務容量不足的交付阻礙已解除。

本輪只同步程式，未更新 Web App 部署、執行初始化或修改正式試算表／私有設定；新功能仍需日後更新既有 Web App 部署版本才會對外生效。成員維護沿用既有 GAS 工作表，不需重跑 setupGas；本次未重新查詢目前部署版本。

本輪重新執行維護功能四項隔離測試全部通過，含 SQLite／模擬 GAS、交易回滾與程序內 Express 權限驗證；一般與 GAS 編譯、package／lockfile／GAS HTML 的 `1.0.11` 版本及無外部 JS／CSS 依賴檢查皆通過。完整測試先前受 localhost 沙箱權限限制，依交接決定未重跑完整 HTTP 或瀏覽器測試。實際 Google 服務／業務操作仍未驗證。以下 2026/10/05 同步／部署段落為過往紀錄。

2026/10/05 已將來源 `9817861`（團隊分表／排序功能為 `9974bcf`）的四檔程式上傳至指定 Apps Script 專案，包含團隊分析與唯讀 API、本團合計／全場占比、個人明細排序、共用儲存／送出單一進度，以及先前日期雙模式與 admin 資料維護。Google 接受程式語法且四檔讀回比對一致；遠端前後備份位於 `data/gas-backups/2026-10-05T10-02-44-053Z/`（私有、不提交）。此次未執行初始化、正式業務操作或發布，亦未重新查詢部署版本；前次部署 API 記錄為第 3 版（說明 `v1.0.2`）。上傳驗證不能代替實際 Sheets／Drive 授權、執行速度、服務配額與 iframe 下載測試。

團隊分析沿用既有資料，不需新增工作表或重新初始化；本機完整 226 項測試、兩種編譯及隔離瀏覽器驗證通過。附圖操作手冊已更新至第 11 版，Markdown／離線 HTML／PDF 及團隊分析圖片同步更新。本機示範成員改名與排表僅在日常 SQLite 測試資料，未上傳正式試算表。

## 這次更新的部署步驟

最新同步程式為 v1.0.16，排表 JPG 改為 5400×3771 橫向基準並簡化標示、縮減留白；先前報名整併讀取、單場影片重載、效能與通知診斷功能保留。驗證與部署限制以上方最新交付紀錄為準，不需重新初始化資料。

最新唯讀確認的部署說明為 `v1.0.12`，第 17 版，該版 manifest 為「以部署者身分執行（USER_DEPLOYING）」及「任何人（ANYONE_ANONYMOUS）」；發布時仍請核對管理部署畫面的目前設定。若先前已完成初始化，可沿用既有專用資料表發布新版本，本次更新不需另建表。

1. 開啟 [Apps Script 專案](https://script.google.com/home/projects/1rkY7EI6rHYNoH8TZmIOKQ-MWSCexXUdFTOqInqyfxBR1qMoI8DAf9hG5/edit)。
2. 右上「部署 → 管理部署作業」，選擇目前使用的既有 Web App。
3. 點鉛筆「編輯」，版本選「新版本」；說明可填 `v1.0.16 單張排表圖片放大與簡化標示`。
4. 點「部署」，若 Google 要求新增授權，由部署者本人完成。
5. 使用[原 Web App 網址](https://script.google.com/macros/s/AKfycbwk1B2IdFlpLbeFF2Ti4hgkYTdLsWlcZVGyiSlb2OXDS1TNpoFTUUtlCAf52QTNTP0i/exec)重新開啟，確認頁尾為 v1.0.16；在一般／專注排表下載 JPG，確認單張三團十隊、5400px 寬、明暗主題、無位置數字或「（副）」、實際所選職業及雙場／長文字完整換行。手機下載應為同一完整版型，未儲存修改下載後仍保留；既有功能依操作手冊確認。

更新既有部署可保留網址；直接同步程式不會更新已發布版本。[Google 版本部署說明](https://developers.google.com/apps-script/concepts/deployments)

最新同步與備份紀錄見上方 v1.0.16 交付狀態；[2026/10/05 手冊與團隊分析同步計畫](plans/main/team-analysis-manual-gas-sync-plan.md)、[前次日期模式同步](plans/main/gas-date-mode-sync-plan.md)、[前次 admin 同步](plans/main/gas-admin-sync-plan.md)及[先前部署準備紀錄](plans/main/gas-release-preparation-plan.md)保留過往資訊。本節是已存在部署的更新流程；以下首次建立、私有屬性與初始化章節供尚未設定的環境參考。

## 本機自動上傳

已鎖定 clasp 3.4.1。上傳目標記錄於 `gas/upload-target.json`，目前為使用者提供的空白專案 `1rkY7EI6rHYNoH8TZmIOKQ-MWSCexXUdFTOqInqyfxBR1qMoI8DAf9hG5`，已獲准覆蓋程式內容。Apps Script API 已由使用者開啟。

```sh
npm run gas:login   # 首次由本人完成 Google 瀏覽器登入與授權
npm run gas:auth    # 確認目前登入身分
npm run gas:status  # 檢查上傳清單，需先有 build/gas 套件
npm run gas:push    # 編譯、備份遠端、上傳四檔、讀回比對
```

登入須使用有目標專案編輯權限的 Google 帳號。工具產生的 `.clasp.json` 僅指向 `build/gas`；OAuth 憑證保存於 `data/clasp-auth.json`，兩者均被 Git 忽略，憑證不輸出、不放前端。不要貼出此憑證檔。更換上傳目標時先確認現有 `.clasp.json`，工具遇到不同 ID 會停止。

`gas:push` 每次在 `data/gas-backups/<時間>/before` 備份遠端，再覆蓋同一專案的全部程式檔，最後於 `after` 讀回比對四檔。未登入、編譯失敗、清單不符或備份失敗時不會上傳；若上傳後的比對失敗，訊息明確指出程式可能已上傳，需檢查遠端。備份不包含 Script Properties、試算表、Drive 資料或部署設定。

此命令只同步程式碼，不執行 `setupGas()`、不寫入正式試算表、不建立或更新對外 Web App 版本。首次設定與初始化仍依下方步驟進行。[clasp 官方原始碼與使用說明](https://github.com/google/clasp)

目前 npm audit 的高風險提示來自開發工具共用的 micromatch／braces 模式解析依賴，尚無相容的修補版本；本專案僅以固定本機檔案模式使用，不將此 CLI 打包進 GAS 或前端。未為消除提示而降級編譯或上傳工具。

後端打包目標集中於 `gas/build-options.js`，採 ES2019 降階，避免依賴的 class 欄位及邏輯賦值語法被 Google 解析器拒絕；僅在缺少 `Object.hasOwn` 時提供標準相容實作。此差異曾於首次實際上傳被檢出，已修正並成功上傳。沙盒測試同步使用相同編譯目標，移除新式 helper 驗證相容性。[GAS V8 限制](https://developers.google.com/apps-script/guides/v8-runtime)

## 1. 編譯與建立 Apps Script 專案

```sh
npm ci
npm test
npm run build:gas
```

`build/gas/` 會產生四個檔案，全部屬於同一份套件：

| 本機檔案 | Apps Script 專案檔案 | 用途 |
| --- | --- | --- |
| `Index.html` | HTML 檔 `Index` | Vue／Vuetify、內嵌 JS／CSS |
| `Code.gs` | 指令碼檔 `Code` | `doGet()` 及前端可呼叫入口 |
| `Backend.gs` | 指令碼檔 `Backend` | 已打包的驗證、登入、Sheets 與 Drive 邏輯 |
| `appsscript.json` | 專案 manifest | V8、Asia/Taipei、Sheets／Drive／外部請求（Discord 通知）授權範圍 |

在 Apps Script 建立獨立專案，建立以上 HTML／指令碼檔並貼入內容。在專案設定開啟「在編輯器中顯示 appsscript.json 資訊清單檔案」，以生成檔取代 manifest。日常修改仍在本機原始碼，重新編譯後同步四個檔案，不直接修改生成的 `Backend.gs`。

已使用自動上傳的指定專案可略過手動貼檔，直接進行第 2 節的私有屬性設定。

前端沒有外部 JS／CSS／字體依賴，後端沒有 Node.js、Express 或 SQLite 依賴；`Backend.gs` 不能省略。

## 2. 設定私有 Script Properties

專案設定 → 指令碼屬性。首次先使用獨立空白測試試算表，執行帳號須有編輯權限。試算表「檔案 → 設定」的時區設為 Asia/Taipei，與 manifest 一致。

| 屬性 | 值與用途 |
| --- | --- |
| `SPREADSHEET_ID` | 測試試算表 ID；正式來源為 `1svNzAG9MxLVkPCaGboo6xj7tIFPJbvujYz0-D49LqgE` |
| `AUTH_SECRET` | 自行產生的 64 位十六進位私密亂數，用於 token／CSRF，勿貼入 HTML 或 Git |
| `BOOTSTRAP_ADMIN_USERNAME` | 初次 admin 帳號，3–32 個英數字、底線、點或減號；不得使用 `guild_member` |
| `BOOTSTRAP_ADMIN_PASSWORD` | 初次 admin 密碼，12–128 個字元；成功初始化會自動刪除此明文屬性 |
| `GUILD_NAME` | 幫會顯示名稱，選填；未設定顯示「你的幫會」 |
| `TABLE_PREFIX` | 選填，預設 `GM_`；只能英數字／底線，以英文開頭、最多 20 字元；上線後勿任意更改 |
| `DRIVE_FOLDER_ID` | 初次可不填，初始化建立新的戰績資料夾並自動保存 ID；若指定既有資料夾，確認僅授權必要管理者 |
| `DISCORD_WEBHOOK_LEAVE` | 選填，請假通知的 Discord Webhook 網址；未設定不發送 |
| `DISCORD_WEBHOOK_MEMBER` | 選填，名冊通知的 Discord Webhook 網址；未設定不發送 |

可在本機終端產生 `AUTH_SECRET`，只將結果填入私有指令碼屬性：

```sh
openssl rand -hex 32
```

這些設定不放 `.env.gas`。`.env.gas` 只保留 `VITE_DATA_SOURCE=gas`。雲端帳號與本機帳號互相獨立，不複製 `data/local-admin.json`、SQLite 或示範資料。請妥善保存管理密碼及 `AUTH_SECRET`；不要把指令碼編輯權限或試算表／Drive 分享給所有使用者。

## 3. 初始化測試資料來源

在 Apps Script 編輯器點選左側 `Code.gs`，重新整理後，於上方「執行」旁的函式選單選擇 `setupGas`（沒有尾端底線），按「執行」，授予 Sheets／Drive 及 Google 執行身分 email 權限。

原 `setupGas_` 保留為私有實作；使用者的編輯器函式選單會略過它，因此新增可選取的 `setupGas` 入口。公開入口由 Google Session 取得 active／effective email，兩者均非空且相同才可執行；不採用前端 app 帳號、角色或參數。依本專案「以部署者身分執行」設定，一般訪客的 email 為空或不同，會在寫入前拒絕；部署者本人可執行。這是 Google 身分限制，不能視為 GAS 提供了編輯器／網頁呼叫辨識。前端不提供初始化入口，不回傳或記錄 email。[Google Session 身分規則](https://developers.google.com/apps-script/reference/base/session)

初始化會建立專用工作表、九個職業、保鑣／山盟／輔潮及第一個 admin；不建立假成員或假活動，不修改原始 `gid=0` 工作表，也不覆寫已存在的成員、職責或帳號。重跑時只補缺少的表及初始資料；同名前綴工作表的欄位不符時會停止，需先確認資料來源，勿直接刪表重建。

### 無法登入 admin 時

首頁預設「成員登入」，初始 admin 請切換「管理者登入」，使用初始化時的 `BOOTSTRAP_ADMIN_USERNAME`／`BOOTSTRAP_ADMIN_PASSWORD`；`AUTH_SECRET` 是簽章金鑰，不是登入密碼。初始密碼成功初始化後已轉為雜湊並刪除明文，重填 `BOOTSTRAP_ADMIN_PASSWORD` 再執行 `setupGas` 不會改已有帳號。

如需重設，於「專案設定 → 指令碼屬性」新增 `RECOVERY_ADMIN_PASSWORD`，填寫 12–128 字元的新密碼並儲存；重新整理編輯器，點選 `Code.gs`，函式選單選 `resetAdminPassword` 後執行。沿用與 `setupGas` 相同的 Google 執行身分檢查，成功紀錄只顯示實際登入帳號，不顯示密碼；回網站重新整理後，使用該帳號與新密碼從「管理者登入」登入。若尚無唯一 admin 會拒絕，請先確認初始化結果。

成功會刪除 `RECOVERY_ADMIN_PASSWORD` 明文、增加 admin revision、撤銷 admin sessions 並清除該帳號失敗計數；manager／member 帳號與 sessions、試算表及 Drive 不改。此函式只作部署者復原，不加入網頁或業務 RPC；無法辨識 Google 執行帳號時不做任何變更。若已觸發全站嘗試限制，仍須待該限制到期（5 分鐘）。

登入 admin 後，在「帳號管理」建立 manager，設定共用 member 通行密碼。member 密碼可使用 6–128 個英文字母／數字，區分大小寫，可保留前導零。member 不顯示固定帳號名稱。

測試資料與正式資料須使用不同 Apps Script 專案、試算表及 Drive 資料夾，避免測試 session／帳號或附件沿用到正式來源。確認測試完成後，在正式專案設定提供的正式試算表 ID，再由編輯器執行初始化。

## 4. 測試 Web App

先使用測試部署。[Google Web App 部署說明](https://developers.google.com/apps-script/guides/web)

此版本採應用程式自己的 admin／manager 帳密與 member 通行密碼，Web App 需「以部署者身分執行」，由部署者讀寫試算表及私人 Drive。不要改成要求每位使用者自行授權 Sheets／Drive；目前沒有以 Google Email 識別訪客。

先限自己存取做測試。正式對外若要支援三種戰鬥匿名報名及影片提交，需將可存取對象設為「任何人」（實際可用選項取決於 Google 帳號／網域政策）；若帳號政策不允許匿名，訪客仍須先通過 Google 的存取限制。應用程式角色檢查會繼續生效：

| 身分 | 可使用範圍 |
| --- | --- |
| 未登入 | 活動及三種戰鬥行事曆、約戰／幫戰／龍虎戰報名／請假、名單選人與影片提交 |
| member | 額外可用完整成員清單與既有操作、戰績清單／詳情／原始檔、個人分析；「移至編外」及三項成員維護限管理者 |
| manager | 所有既有管理功能；無帳號管理權限 |
| admin | 管理功能及帳號／通行密碼管理 |

右上登入預設成員 tab。雲端 token 只保留於該分頁的 sessionStorage，後端保存雜湊、到期時間及帳號版本，8 小時到期。重新整理可恢復；關閉分頁通常需重新登入，瀏覽器封鎖儲存時退回記憶體狀態。修改 member 密碼或 manager 帳號會撤銷其全部 session。admin 改密碼保留目前 session、撤銷其他 session。不能把本機 cookie 或前端角色旗標當作雲端登入。

測試至少確認：

1. 未登入可見約戰／幫戰／龍虎戰與其報名／請假、三頁選人及影片職業表單；完整名冊與管理 API 仍檢查權限。
2. 成員新增／改名／編外／匯入，包含前導零 UID、同名成員選擇、既有 UID 跳過、錯誤匯入整批拒絕。
3. 多日活動與批次戰鬥、修改／刪除、版本衝突與重複提交。
4. 報名／請假、職業統計、額外報名、請假後排表資格變化。
5. 雙場排表、職責、範本、封存、JPG 下載；手機與 iframe 中的下載行為。
6. 約戰／幫戰兩場 CSV、龍虎戰單場、內推與結果留空、預覽及原 CSV 下載。
7. member 閱覽戰績／個人數據，拒絕直接呼叫管理與帳號 API；manager 拒絕帳號管理。
8. 以實際 100 人名冊與常見戰績檔確認載入、登入及保存時間；觀察 Apps Script 執行紀錄與服務配額。

正式更新時同步四個檔案並建立新的部署版本；不要只更新 HTML。保留前一版程式套件及資料備份，回退程式版本不會自動回退已寫入的資料。

## 資料表與保存方式

初版採追加式紀錄與最後提交標記，避免 Sheets 多表寫入中途失敗後讀到半筆資料。每個工作表代表一類資料；不是 SQLite 檔案或 SQL 格式。

| 工作表（預設前綴） | 資料 |
| --- | --- |
| `GM_professions` | 職業 ID／名稱／顏色 |
| `GM_members` | UID／名稱／主副職業／幫派與俱樂部狀態／revision |
| `GM_name_history` | UID 與過去名稱 |
| `GM_events` | 活動、日期陣列、revision、刪除標記 |
| `GM_duties` | 職責／啟用狀態／revision |
| `GM_responses` | 成員場次報名／請假／職業／備註 |
| `GM_registrations` | 無 UID 外援報名 |
| `GM_videos` | 角色名稱、雙場影片連結、團別、備註及提交時間 |
| `GM_requests` | requestId、輸入雜湊與重試回應 |
| `GM_lineup_versions` | 不可變排表與當時姓名／職業／職責快照 |
| `GM_templates` | 名單範本 |
| `GM_battles` | 場次與逐場戰績摘要、私人 Drive 檔案引用 |
| `GM_battle_players` | 按對戰保存玩家資料快照 |
| `GM_battle_links` | 上傳時唯一同名對應的 UID／對戰／玩家列關聯 |
| `GM_lottery` | 抽獎參加人員、獎品與得獎者（單一紀錄） |
| `GM_commits` | 已完成寫入的 transaction_id 與時間 |

業務表標題固定為 `record_id, transaction_id, part_number, part_count, payload_base64`；提交表為 `transaction_id, created_at`。record_id 以帶引號的 JSON 文字保存，payload 為 UTF-8 JSON 的 Base64 分段（每段 36,000 字元），避免 UID 被轉數字、輸入被當公式及大型 JSON 超過單格限制。最新已提交紀錄才有效，勿直接編輯、排序或刪除這些列；日常操作透過管理介面。

寫入由 script lock 保護；同一份試算表只由同一 Apps Script 專案寫入，不同專案的 script lock 不會互相協調。所有資料列 flush 後才發布提交標記，再 flush。部分失敗未提交的列不會被讀取；成功但回應遺失可使用原 requestId 重試。[SpreadsheetApp.flush](https://developers.google.com/apps-script/reference/spreadsheet/spreadsheet-app#flush())、[LockService](https://developers.google.com/apps-script/reference/lock/lock-service)

帳號密碼雜湊、session 雜湊與限流保存在 Script Properties，不在工作表。密碼採 PBKDF2-SHA256 600,000 次（純 JS 打包），尚待 Google 環境實測登入時間。登入限流以帳號與全域失敗次數計算，GAS 無本機 API 的來源 IP 限流；共用 member 連續失敗可能暫時影響其他成員。

CSV 原始檔及相容圖片保存在專用 Drive 資料夾，不產生公開連結；下載先查角色，再以檔案內容回傳。Drive 與 Sheets 沒有跨服務交易：Drive 已成功但提交失敗時可能留下未引用附件，重試會建立新的檔案，只有已提交引用可從前台下載；初版保留孤立附件，不自動刪除以免誤刪成功但回應遺失的檔案。

初版保留完整追加日誌，尚未自動壓縮；資料量增大時仍需掃描 ID／提交紀錄及摘要。戰績清單不讀全部玩家資料，詳情才讀該場快照，個人統計只讀有關聯的場次。雲端並非無限資料庫，需按實際使用觀察 [Google 服務配額](https://developers.google.com/apps-script/guides/services/quotas)。

備份需同時涵蓋試算表全部 GM_ 表、私人 Drive 原始檔、Script Properties 與程式版本。只複製試算表不會包含帳號或附件；搬移及回復資料需另行規劃，初版不自動遷移 SQLite 或改寫既有正式資料。

## 場次影片更新

同步四檔後更新既有 Web App 部署版本，行事曆即可使用三頁選人與必填職業的影片表單；admin／manager 另可使用含職業的影片閱覽、團別／名稱篩選及 CSV 匯出。三種戰鬥均可匿名提交，member 可提交但不能讀清單。只保存網址，不需要額外 Drive 資料夾或 R2。

已初始化的專案首次有效讀取／提交影片時自動補建 `GM_videos`，不需要為此重新執行 `setupGas()`；其餘工作表、帳號及 Script Properties 保留。影片與重試結果經同一提交標記生效。本機影片不會自動搬入試算表。發布後仍需確認真實 Sheets 授權、提交後重載及 Google iframe 中的 CSV 下載，隔離模擬驗證無法取代這些操作。

## 平台名稱

admin 可在「帳號管理 → 平台設定」修改左上角名稱，預設「逆水寒」，長度 1–30 個字。保存後即時更新頂欄、頁尾及網頁標題；不修改 `GUILD_NAME` 或戰績快照。匿名／member／manager 可讀取名稱，但無法修改。

設定保存於新增的 `GM_settings` 工作表，格式沿用提交日誌。更新舊 GAS 專案時，同步四檔並先於編輯器重跑 `setupGas()` 補上此表，再更新部署版本；重跑保留既有資料與平台名稱。本機設定獨立存於 SQLite `platform_settings`。

admin 可於同一頁保存 PNG／JPEG／WebP 平台圖示（最多 256 KB）。GAS 將圖片寫入 `DRIVE_FOLDER_ID` 的私人資料夾，`GM_settings` 僅保存引用；公開設定回傳目前圖示內容的 data URL，不公開 Drive ID 或分享連結。名稱與圖片引用採同一提交，重試相同成功結果不建立新檔。替換／移除時舊檔保留，Drive 成功但 Sheets 失敗可能留下未引用私檔，備份及日後清理需涵蓋這些檔案。真實 Drive 授權、讀取速度與配額仍須測試部署驗證。

## 抽獎活動與 Discord 通知更新

此版本新增 `script.external_request` 授權範圍供 Discord 通知使用。同步程式後，部署者需在編輯器執行任一函式（例如 `setupGas`）或發布新版本時完成 Google 的新授權提示，否則送出通知會失敗（通知失敗不影響原操作）。

- Discord：在指令碼屬性新增 `DISCORD_WEBHOOK_LEAVE`／`DISCORD_WEBHOOK_MEMBER`（Discord 頻道設定 → 整合 → Webhook → 複製網址）。只填需要的頻道；從舊 game 專案搬移時，舊屬性名稱 `WEBHOOK_LEAVE`／`WEBHOOK_MEMBER` 的值可直接複製到新名稱。
- 抽獎：已初始化的專案首次開啟抽獎頁會自動補建 `GM_lottery`，不需重新執行 `setupGas()`。舊 game 試算表「抽獎」分頁不會自動匯入，請在抽獎頁「編輯名單」貼上人員與獎品。

通知在 script lock 釋放後送出，會增加該次操作的回應時間；真實 Discord 送達、UrlFetchApp 配額與授權需於測試部署確認，隔離模擬驗證無法取代。
