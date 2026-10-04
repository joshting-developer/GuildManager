# GAS 初始化與部署

目前已生成 Vue 單檔頁面與完整 GAS 後端，涵蓋登入／帳號管理、行事曆、成員／匯入／名稱歷史、活動、職責、報名／請假、排表／範本、戰績上傳／下載／閱覽及個人分析。本機 SQLite 環境保留。

尚未部署到 Google，也未寫入你提供的正式試算表。本機 mock 與瀏覽器驗證不能代替 Google 授權、配額、執行速度與 iframe 下載測試。

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
| `appsscript.json` | 專案 manifest | V8、Asia/Taipei、Sheets／Drive 授權範圍 |

在 Apps Script 建立獨立專案，建立以上 HTML／指令碼檔並貼入內容。在專案設定開啟「在編輯器中顯示 appsscript.json 資訊清單檔案」，以生成檔取代 manifest。日常修改仍在本機原始碼，重新編譯後同步四個檔案，不直接修改生成的 `Backend.gs`。

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

可在本機終端產生 `AUTH_SECRET`，只將結果填入私有指令碼屬性：

```sh
openssl rand -hex 32
```

這些設定不放 `.env.gas`。`.env.gas` 只保留 `VITE_DATA_SOURCE=gas`。雲端帳號與本機帳號互相獨立，不複製 `data/local-admin.json`、SQLite 或示範資料。請妥善保存管理密碼及 `AUTH_SECRET`；不要把指令碼編輯權限或試算表／Drive 分享給所有使用者。

## 3. 初始化測試資料來源

在 Apps Script 編輯器選擇並執行 `setupGas_()`，授予 Sheets／Drive 權限。尾端底線使此函式無法透過瀏覽器的 `google.script.run` 呼叫。[官方通訊規則](https://developers.google.com/apps-script/guides/html/communication#private_functions)

初始化會建立專用工作表、九個職業、保鑣／山盟／輔潮及第一個 admin；不建立假成員或假活動，不修改原始 `gid=0` 工作表，也不覆寫已存在的成員、職責或帳號。重跑時只補缺少的表及初始資料；同名前綴工作表的欄位不符時會停止，需先確認資料來源，勿直接刪表重建。

登入 admin 後，在「帳號管理」建立 manager，設定共用 member 通行密碼。member 密碼可使用 6–128 個英文字母／數字，區分大小寫，可保留前導零。member 不顯示固定帳號名稱。

測試資料與正式資料須使用不同 Apps Script 專案、試算表及 Drive 資料夾，避免測試 session／帳號或附件沿用到正式來源。確認測試完成後，在正式專案設定提供的正式試算表 ID，再由編輯器執行初始化。

## 4. 測試 Web App

先使用測試部署。[Google Web App 部署說明](https://developers.google.com/apps-script/guides/web)

此版本採應用程式自己的 admin／manager 帳密與 member 通行密碼，Web App 需「以部署者身分執行」，由部署者讀寫試算表及私人 Drive。不要改成要求每位使用者自行授權 Sheets／Drive；目前沒有以 Google Email 識別訪客。

先限自己存取做測試。正式對外若要支援匿名約戰，需將可存取對象設為「任何人」（實際可用選項取決於 Google 帳號／網域政策）；若帳號政策不允許匿名，訪客仍須先通過 Google 的存取限制。應用程式角色檢查會繼續生效：

| 身分 | 可使用範圍 |
| --- | --- |
| 未登入 | 活動、約戰行事曆及約戰報名／請假 |
| member | 額外可見幫戰／龍虎戰及其報名／請假、戰績清單／詳情／原始檔、個人分析 |
| manager | 所有既有管理功能；無帳號管理權限 |
| admin | 管理功能及帳號／通行密碼管理 |

右上登入預設成員 tab。雲端 token 只保留於該分頁的 sessionStorage，後端保存雜湊、到期時間及帳號版本，8 小時到期。重新整理可恢復；關閉分頁通常需重新登入，瀏覽器封鎖儲存時退回記憶體狀態。修改 member 密碼或 manager 帳號會撤銷其全部 session。admin 改密碼保留目前 session、撤銷其他 session。不能把本機 cookie 或前端角色旗標當作雲端登入。

測試至少確認：

1. 未登入看不到幫戰／龍虎戰與其筆數；登入後顯示，登出／撤銷後收起。
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
| `GM_requests` | requestId、輸入雜湊與重試回應 |
| `GM_lineup_versions` | 不可變排表與當時姓名／職業／職責快照 |
| `GM_templates` | 名單範本 |
| `GM_battles` | 場次與逐場戰績摘要、私人 Drive 檔案引用 |
| `GM_battle_players` | 按對戰保存玩家資料快照 |
| `GM_battle_links` | 上傳時唯一同名對應的 UID／對戰／玩家列關聯 |
| `GM_commits` | 已完成寫入的 transaction_id 與時間 |

業務表標題固定為 `record_id, transaction_id, part_number, part_count, payload_base64`；提交表為 `transaction_id, created_at`。record_id 以帶引號的 JSON 文字保存，payload 為 UTF-8 JSON 的 Base64 分段（每段 36,000 字元），避免 UID 被轉數字、輸入被當公式及大型 JSON 超過單格限制。最新已提交紀錄才有效，勿直接編輯、排序或刪除這些列；日常操作透過管理介面。

寫入由 script lock 保護；同一份試算表只由同一 Apps Script 專案寫入，不同專案的 script lock 不會互相協調。所有資料列 flush 後才發布提交標記，再 flush。部分失敗未提交的列不會被讀取；成功但回應遺失可使用原 requestId 重試。[SpreadsheetApp.flush](https://developers.google.com/apps-script/reference/spreadsheet/spreadsheet-app#flush())、[LockService](https://developers.google.com/apps-script/reference/lock/lock-service)

帳號密碼雜湊、session 雜湊與限流保存在 Script Properties，不在工作表。密碼採 PBKDF2-SHA256 600,000 次（純 JS 打包），尚待 Google 環境實測登入時間。登入限流以帳號與全域失敗次數計算，GAS 無本機 API 的來源 IP 限流；共用 member 連續失敗可能暫時影響其他成員。

CSV 原始檔及相容圖片保存在專用 Drive 資料夾，不產生公開連結；下載先查角色，再以檔案內容回傳。Drive 與 Sheets 沒有跨服務交易：Drive 已成功但提交失敗時可能留下未引用附件，重試會建立新的檔案，只有已提交引用可從前台下載；初版保留孤立附件，不自動刪除以免誤刪成功但回應遺失的檔案。

初版保留完整追加日誌，尚未自動壓縮；資料量增大時仍需掃描 ID／提交紀錄及摘要。戰績清單不讀全部玩家資料，詳情才讀該場快照，個人統計只讀有關聯的場次。雲端並非無限資料庫，需按實際使用觀察 [Google 服務配額](https://developers.google.com/apps-script/guides/services/quotas)。

備份需同時涵蓋試算表全部 GM_ 表、私人 Drive 原始檔、Script Properties 與程式版本。只複製試算表不會包含帳號或附件；搬移及回復資料需另行規劃，初版不自動遷移 SQLite 或改寫既有正式資料。
