# GAS 功能與鎖範圍盤點

> 閱讀順序：本文件前段是 v1.0.18 的原始盤點與改善前驗證，其中「全部 RPC 持鎖」「沒有 BUSY 自動重試」等敘述屬歷史。v1.0.19 起的實際做法見文末「v1.0.19 實作結果」；後續開發預設遵循 [AGENTS.md 的效能與併發開發規則](AGENTS.md#效能與併發開發規則後續功能預設適用)，新增 RPC 時同步更新本文件的讀寫依賴。最新程式同步／部署狀態見 [GASDeployment.md](GASDeployment.md)。

2026-10-19；盤點來源 `efe13f9`／v1.0.18。以下「目前／現況」指盤點基準；後續 v1.0.19 已完成的調整見文末，程式已同步 GAS，尚未更新 Web App 部署。

## 結論

鎖應保護會競爭的共享資料與檢查／提交過程。不同功能不必整段互相等待，但目前不能只按業務工作表拆鎖：所有 Sheets 寫入還共用 `GM_commits`，多個功能也共用 `GM_requests`，登入資料則是 Script Properties 裡整份狀態的讀改寫。

目前 61 個 RPC 全部先取得同一把 Script Lock，最多等 10 秒；涵蓋登入資料讀取、權限檢查、業務資料讀取、計算、Drive I/O 和 Sheets 提交。單一慢操作會擋住其他所有 RPC，包含匿名首頁的登入確認、行事曆與請假表單讀取。`WRITES` 清單只決定 CSRF 檢查，並沒有區分哪些操作要取得鎖。

61 個 RPC 可分成 **25 個純讀取、2 個可能延遲建表的讀取、34 個寫入**（7 個登入／帳號寫入、27 個業務寫入）。建議優先讓純讀取離開寫入鎖，移出耗時檔案作業，再處理不同成員誤用整場版本的衝突；實際寫入與提交仍需互斥。

## 共用資源與現在的保護

| 資源 | 實際使用方式 | 鎖的需求 |
| --- | --- | --- |
| 各業務表 | 追加版本列，`getLastRow()` 決定下一個寫入範圍；不原地更新舊版本 | 同表寫入必須防止範圍碰撞；相同實體的版本檢查與寫入必須一致 |
| `commits` | 所有業務寫入先寫資料、flush，再追加提交標記、flush；沒有標記的資料不可見 | 所有業務寫入目前必須共用提交保護；不同業務表仍可能搶同一列 |
| `requests` | requestId 結果、防重複雜湊，也存 UID 退休版本和歷史引用覆寫 | 同 requestId 的查詢與提交不可同時通過；不能只當成某個功能的私有表 |
| 私有登入狀態 | `GM_AUTH_POINTER` 指向多個 `GM_AUTH_*` 分段，包含 accounts／sessions／limits；整份保存後刪除舊分段 | 所有登入／帳號寫入需共用讀改寫保護；直接解鎖讀取前須處理指標切換競爭 |
| 場次、名冊、回應、職業及職責 | 排表、請假、影片和戰績驗證會讀取其他功能管理的資料 | 除寫入集合，也要防止檢查後來源變動；拆鎖後須有鎖內重讀／版本核對 |
| Drive 新檔 | 戰績 CSV／舊圖片及平台圖示使用新檔 ID，之後才在 Sheets 引用 | 建立獨立新檔通常不必持有業務寫入鎖；引用提交前仍須重新驗權與驗證 |
| Drive 讀檔 | 戰績附件下載、平台圖示讀取 | 純讀檔不需要業務寫入鎖；先取得經權限檢查的引用，不移除下載權限 |
| Discord | 資料提交成功並釋放鎖之後才發送通知 | 現在已在鎖外，保留；失敗不回滾已保存資料 |
| 公開品牌快取 | `pagePlatform()` 命中快取直接回傳，未命中才走 RPC；設定更新後清除 | 可容忍重複填入，不需業務鎖；需另驗證失效與舊值回填競爭 |

表名省略可設定的前綴，預設為 `GM_`。以下所有 RPC 現在都讀取私有登入狀態；業務 RPC 都先讀取 `commits`。業務寫入有變更時都會追加 `commits`；有排入通知時，後端另讀 `settings` 取得通知頁尾。矩陣不逐列重複這些共用存取。

## 完整方法矩陣

「讀」表示業務上可無寫入鎖，仍須完成下方的只讀與登入快照保護。「寫」表示保留必要檢查到提交的互斥，後續才縮短持鎖範圍。讀取不代表公開，既有登入／角色檢查必須保留。

### 登入與帳號（9 個）

| RPC | 讀取 | 寫入 | 建議 |
| --- | --- | --- | --- |
| `getAuthSession` | 登入狀態 | 無 | 讀；沒有 token 可直接回匿名，有 token 使用穩定快照 |
| `getAccountSettings` | 登入狀態 | 無 | 讀；仍限 admin |
| `login` | 帳號、session、限流 | session、限流及過期清理 | 寫；失敗登入也更新限流，密碼計算可評估移出鎖 |
| `loginMember` | 帳號、session、限流 | session、限流及過期清理 | 寫；和管理登入共用限流及整份狀態 |
| `logout` | 登入狀態 | 移除 session | 寫；不能覆蓋別人的新 session |
| `changeAdminPassword` | 帳號及登入狀態 | 密碼、帳號 revision、session 撤銷／保留 | 寫；計算後須重驗密碼版本與權限 |
| `createManager` | 帳號及登入狀態 | 新帳號 | 寫；唯一帳號與容量檢查 |
| `updateManager` | 帳號及登入狀態 | 帳號、revision、session 撤銷 | 寫；版本與名稱唯一性檢查 |
| `setMemberToken` | 帳號及登入狀態 | member 帳號／密碼、revision、session 撤銷 | 寫；不能與登入整份覆寫互相遺失 |

登入與密碼變更的 PBKDF2 為 600,000 輪，目前也在全域鎖內。移出計算時須先保護限流預算，再於提交前重讀帳號版本、撤銷狀態及權限；不能直接把整個登入方法解鎖。

### 首頁、品牌與名冊（15 個）

| RPC | 業務讀取 | 業務寫入 | 建議 |
| --- | --- | --- | --- |
| `getHomeData` | events | 無 | 讀 |
| `getPlatformSettings` | settings、Drive 圖示 | 無 | 讀；圖示讀取移出業務鎖 |
| `updatePlatformSettings` | settings、Drive 目前圖示 | settings、Drive 新圖示 | 寫；新圖示可先準備，提交前重驗設定 revision |
| `getProfessions` | professions | 無 | 讀 |
| `getMembers` | members、professions、name_history | 無 | 讀 |
| `getParticipationMembers` | members | 無 | 讀；相容舊入口，維持需登入 |
| `previewMemberImport` | members、professions | 無 | 讀；正式匯入重新檢查 fingerprint |
| `addMember` | members、professions、name_history、requests、battles、battle_players、battle_links | members、battle_links | 寫；新增時會補歷史戰績關聯，不只是名冊表 |
| `updateMember` | members、professions、name_history | members、name_history（改名時） | 寫；個人 revision、改名與歷史須一起提交 |
| `removeMember` | members、professions、name_history | members | 寫；所屬狀態與個人 revision |
| `importMembers` | members、professions、name_history、requests、battles、battle_players、battle_links | members、battle_links | 寫；整批名冊與歷史戰績關聯同次提交 |
| `getMemberMaintenance` | members、professions、name_history | 無 | 讀 |
| `maintainMember` | members、professions、name_history、responses、battle_links、lineup_versions、templates、battles、battle_players、requests | members、name_history、responses、battle_links、requests | 寫；修 UID 會搬關聯及歷史引用，必須跨功能保護 |
| `saveMemberNameHistory` | members、professions、name_history、requests | name_history、members、requests | 寫；整批舊名及成員 revision |
| `deleteMemberPermanently` | members、name_history、responses、battle_links、lineup_versions、templates、battles、battle_players、requests | members、name_history、responses、battle_links、requests | 寫；移除關聯並保存 UID 退休版本／歷史引用 |

### 活動安排及職責（8 個）

| RPC | 業務讀取 | 業務寫入 | 建議 |
| --- | --- | --- | --- |
| `getEvents` | events | 無 | 讀；公開行事曆不應被上傳擋住 |
| `getEvent` | events | 無 | 讀 |
| `createEvent` | requests | events、requests | 寫；批次日期與 requestId 同次提交 |
| `updateEvent` | events | events | 寫；revision 檢查不可移到鎖外後直接保存 |
| `deleteEvent` | events | events | 寫；保留刪除標記及重試語意 |
| `getDuties` | duties | 無 | 讀 |
| `addDuty` | duties | duties | 寫；同名檢查與新增 |
| `updateDuty` | duties | duties | 寫；revision 與同名檢查 |

### 報名、請假及出勤（10 個）

| RPC | 業務讀取 | 業務寫入 | 建議 |
| --- | --- | --- | --- |
| `getEventParticipation` | events、responses、registrations、members、professions | 無 | 讀；同次已提交快照 |
| `getEventParticipationForm` | events、responses、registrations、members、professions | 無 | 讀；表單整併讀取仍保留 |
| `getEventParticipationMembers` | events、members | 無 | 讀 |
| `getEventVideoForm` | events、members、professions | 無 | READ_ONLY；公開單日戰鬥，不讀 responses／registrations／requests／videos／Drive |
| `getEventAttendance` | events、responses、registrations、members、professions | 無 | 讀；維持管理者限制 |
| `submitParticipation` | events、responses、registrations、members、professions、requests | responses 或 registrations，加 requests | 寫；改進整場版本造成的跨人成員衝突，仍保護同一人的更新 |
| `saveMemberResponse` | events、members、responses、professions | responses | 寫；相容入口已使用個人回應 revision |
| `addGuestRegistration` | events、members、registrations、professions、requests | registrations、requests | 寫；同名查核、取消後恢復原 ID |
| `cancelGuestRegistration` | events、registrations、professions | registrations | 寫；該筆報名 revision |
| `cancelEventLeave` | events、responses、registrations、members、professions | responses 或 registrations | 寫；只取消仍符合指定版本的請假 |

### 戰場排表與範本（9 個）

| RPC | 業務讀取 | 業務寫入 | 建議 |
| --- | --- | --- | --- |
| `getLineupEditor` | events、lineup_versions、requests、members、professions、duties、responses、registrations | 無 | 純讀；一次首載、不讀 templates |
| `getLineupEvent` | events、lineup_versions、requests、responses、registrations、professions、相關 members；includeCatalogs 時全名冊與 duties | 無 | 純讀；最新一筆，封存不讀參與 |
| `getLineupSources` | events、members、professions、duties、responses、registrations | 無 | 純讀；不讀排表版本與範本，草稿保留 |
| `getLineupTemplates` | templates | 無 | 純讀；只有三欄摘要，不讀 requests／不投影成員引用 |
| `getLineupIndex` | events、lineup_versions、templates、requests | 無 | 讀；requests 包含 UID 維護的引用覆寫 |
| `getLineupHistory` | lineup_versions、requests | 無 | 讀 |
| `applyLineupTemplate` | events、templates、requests、members、responses、registrations、duties | 無 | 讀；只是產生草稿，沒有保存排表 |
| `confirmLineup` | events、lineup_versions、requests、members、responses、registrations、professions、duties | lineup_versions、requests | 寫；場次／排表版本與當前請假資格須一起核對 |
| `createLineupTemplate` | requests、members、registrations、professions、duties | templates、requests | 寫；保存快照及重試回應 |

瀏覽器下載 JPG、切換主題、前端搜尋／排序、編輯尚未保存的排表都不取得 GAS 鎖。

### 戰績、分析及歷史關聯（10 個）

| RPC | 業務讀取 | 業務寫入 | 建議 |
| --- | --- | --- | --- |
| `getBattleRecords` | battles | 無 | 讀 |
| `getBattleMetadata` | battles（指定 ID）及 commits 快照、登入驗證 | 無 | READ_ONLY／admin、manager；只回編輯欄位、日期／場次與最新 revision，不讀玩家／關聯／排表／Drive，不取業務寫入鎖 |
| `getBattleRecord` | battles、battle_players、battle_links、requests；includeTeamContext 時追加 lineup_versions | 無 | 讀；同次快照帶最小分團對應，不讀 Drive／不占寫入鎖 |
| `getBattleTeamAnalysis` | battles、battle_players、battle_links、lineup_versions、requests | 無 | 讀；分析計算不需持寫入鎖 |
| `getMemberBattleRecords` | members、professions、battles、battle_players、battle_links | 無 | 讀；摘要與明細使用同次快照 |
| `getBattleAttachment` | battles、Drive 附件 | 無 | 讀；下載不需擋住請假 |
| `previewBattleMemberSync` | members、name_history、battles、battle_players、battle_links、requests | 無 | 讀；確認同步再核對 fingerprint |
| `saveBattleRecords` | events、members、battles、battle_players、battle_links、requests | battles、battle_players、battle_links、requests，及 Drive 附件 | 寫；CSV 解析／Drive 新檔可先準備，提交前重驗場次、權限、重複內容／場序及 requestId |
| `updateBattleRecord` | battles、requests | battles、requests | 寫；該筆對戰資訊 revision |
| `syncBattleMembers` | members、name_history、battles、battle_players、battle_links、requests | battle_links、requests | 寫；預覽 fingerprint 與新增關聯同次保護 |

### 影片與抽獎（7 個）

| RPC | 業務讀取 | 業務寫入 | 建議 |
| --- | --- | --- | --- |
| `getVideoBrowser` | events、videos（有選定場次時） | videos 缺表時鎖內重驗權限後建立 | READ_ONLY／admin、manager；同一 commits，首載與重載整併 |
| `getEventVideos` | events、videos | videos 缺表時鎖內重驗權限後建立 | READ_ONLY；換場只讀本場回應，無 Drive |
| `submitEventVideo` | events、requests、professions、members（選人時） | videos、requests；可能建表 | 寫；同一請求只保存一次，重驗場次與成員 |
| `getLottery` | lottery | lottery 缺表時會建立表及表頭 | 先移除／隔離延遲建表，之後可作純讀取 |
| `saveLottery` | lottery | lottery；可能建表 | 寫；整份抽獎盤及 revision |
| `drawLotteryPrize` | lottery | lottery；可能建表 | 寫；抽籤與扣除剩餘人選必須互斥 |
| `resetLottery` | lottery | lottery；可能建表 | 寫；重設不可與開獎同時覆寫 |

### 非一般 RPC 入口

| 入口／作業 | 現況 | 建議 |
| --- | --- | --- |
| `doGet`／`pagePlatform` | 品牌快取命中不鎖；未命中透過品牌 RPC 取得全域鎖 | 品牌讀取改為穩定快照後，不需業務寫入鎖 |
| `setupGas`／內部 `setupGas_` | 全域鎖；建立／驗證各表、預設資料、Drive 資料夾及登入狀態 | 保留初始化互斥，不從一般讀取或測試自動執行 |
| `resetAdminPassword` | 全域鎖；修改私有登入狀態並撤銷 session | 保留與其他登入寫入相同的保護 |
| `testDiscordWebhooks` | 無資料寫入鎖；只讀設定及送測試訊息 | 不需業務鎖；維持執行帳號身分檢查，非前台測試入口 |
| 一般 Discord 通知 | 已在交易成功及釋放鎖之後執行 | 維持鎖外；429 等待／重試也不占用寫入鎖 |

`Code.gs` 的初始化／復原／測試入口另有 Google 執行帳號檢查，不因鎖調整移除。內部 `setupGas_` 是既有相容實作，不是新增的對外入口。

## 兩人同時請假的兩種問題

1. **BUSY**：任一 RPC 持有全域鎖超過另一個請求的 10 秒等待時間，後者回 BUSY。這時甚至還沒進行表單驗證，畫面出現「重新確認登入」也不代表密碼錯誤或登入被撤銷。
2. **PARTICIPATION_CHANGED**：兩人先讀到相同表單版本，A 送出後，整場回應雜湊改變，B 即使順利取得鎖也被拒絕。這不是同一列互相覆蓋，而是檢查範圍過大；單純延長等鎖時間無法解決。

可採用目標成員／外援自己的版本加場次版本；若先保留既有 API，可在收到明確版本衝突後重讀，確認「場次及這次要修改的人員資料沒有改變」才有限次重送。其他人新增回應可繼續，同一人被另一端改過則要求確認。未知傳輸失敗不得任意產生新 requestId 重送；已成功請求的重播也不得把較新的請假狀態改回去。SQLite 的統一報名也使用整場版本，若調整需維持本機／GAS 規則一致。

## 建議保留哪些鎖、先改哪些範圍

| 優先順序 | 工作 | 保留的必要保護 |
| --- | --- | --- |
| 1 | 25 個純讀取改走只讀路徑；影片／抽獎讀取先隔離建表；匿名登入確認避免不必要的登入資料載入 | 固定本次 commits 快照、拒絕只讀路徑的 put／remove／建表；私有登入指標穩定讀取與有限次重讀；既有權限 |
| 2 | 戰績／圖示的 Drive 建檔、附件讀取與純計算移出全域寫入區段 | 新檔只在最終交易成功後公開引用；鎖內重驗授權、來源版本、唯一性及 requestId，保留整批提交和原始資料 |
| 3 | 請假改為區分目標人員與其他人造成的版本變動；BUSY 提供有限次退避重試並保留輸入 | 同一人的更新仍檢查版本；相同請求不可重複保存；超過重試次數仍明確提示，不自動重新登入 |
| 4 | 再評估 auth／業務、場次／人員等邏輯資源分組；大型維護預先準備計畫 | 鎖內驗證完整讀取依賴；任何多鎖有固定取得順序；提交／同表 append 仍互斥；失敗及重試可恢復 |

第一輪建議仍保留**一把實際 Script Lock 管理必要寫入**，先解除讀取與慢 I/O 的連帶阻塞。不能只把 `transaction()` 最後幾個 setValues 包住，讓之前的讀取／revision 檢查全部在鎖外：兩個同人更新會同時通過舊版檢查。要再縮短到提交區段，必須在持鎖後重驗讀取依賴、檢查 requestId，再依最新狀態提交。

若未來真的需要不同功能同時寫入，須另設可恢復的命名資源鎖／租約，並處理共用 commits、requests 及 append 的短暫互斥；這是儲存協議調整，不能只把 `getScriptLock()` 改一個名字。以 Script Properties 寫入「某人占用」旗標也不會自動安全：取得旗標本身須互斥，還要處理到期、持有者驗證、過期持有者繼續提交及跨資源死鎖。

移出 Drive 後，最終版本／權限驗證失敗仍可能留下未被引用的私人檔案，這也是目前上傳提交失敗既有的限制；不得為了清理而誤刪其他請求使用的檔案。本次盤點沒有執行任何正式寫入或自動清理。

## Google API 能力查核

- 官方 LockService 提供 Script／User／Document 三種範圍，沒有任意表名或場次名稱的鎖 API；`getScriptLock()` 保護同一 script 中的執行區段。Web App 情境的 `getDocumentLock()` 回傳 null，不能當成 `openById()` 指向某試算表的鎖。[LockService 官方文件](https://developers.google.com/apps-script/reference/lock/lock-service)
- `getUserLock()` 是 Google 執行身分的範圍，不是本平台的 member／manager 帳號或玩家 UID；本案以部署者執行，也不能用它建立每位玩家的鎖。[LockService 官方文件](https://developers.google.com/apps-script/reference/lock/lock-service)、[Web Apps 執行權限](https://developers.google.com/apps-script/guides/web)
- Script Properties 是同一 script 共享的設定儲存；不同 key 不等於不同互斥鎖。[PropertiesService 官方文件](https://developers.google.com/apps-script/reference/properties/properties-service)
- 官方建議 Sheets 寫入在釋放鎖前執行 flush；本案既有提交前後 flush 應保留。[Lock.releaseLock 官方文件](https://developers.google.com/apps-script/reference/lock/lock#releaseLock())

以上 API 能力來自官方文件；表格分類、競爭分析及優先順序來自本專案來源碼與隔離模擬，不是 Google 對本專案儲存協議的保證。

## 隔離驗證結果

使用既有 `gasRuntime`／`gasEnvironment` 載入目前後端，沒有修改產品程式或原有測試。腳本 `/private/tmp/guild-lock-audit/check.mjs`，摘要 `/private/tmp/guild-lock-audit/results.json`，只含隔離資料及結果。8 項查核均符合來源碼分析：

| 查核 | 結果 |
| --- | --- |
| 模擬其他執行持鎖，再呼叫全部 61 個 RPC | 全部在驗證參數與權限前回 BUSY，包含公開讀取 |
| 不同兩位成員使用同一份原始表單版本依序請假 | A 成功、B 回 PARTICIPATION_CHANGED；B 讀取新版後可成功，兩人資料都保留 |
| 在上傳的 Drive createFile 步驟插入其他呼叫 | 登入確認、行事曆及請假表單讀取都回 BUSY |
| 在通知發送步驟檢查寫入鎖 | 通知送出前已釋放，可取得鎖 |
| 繞過外層鎖，讓 settings／duties 兩筆交易在 commits 寫入範圍交錯 | 兩者選到同一列，後寫提交標記蓋掉另一筆；duties 實體列存在但交易後讀不到 |
| 讀取先固定 commits，兩張資料表載入前插入另一筆完整提交 | 本次兩表都不讀到後續提交；下一次讀取兩表都看得到，支持既有追加版本的快照方向 |
| 登入讀取拿到舊指標後，插入另一個保存／清除舊分段 | 現行 load 回 AUTH_STORAGE_INVALID；所以不能只移掉外層鎖 |
| 移除隔離 videos／lottery 表後呼叫各自 getter | getter 會重新建表，證實兩者目前不是嚴格純讀 |

這是可控制交錯時序的模擬，不是正式 GAS 壓力測試，也沒有測量 Google 實際延遲或證明正式 CSV 失敗原因。後續實作應保留原測試，再增加讀寫交錯、同人／不同人、權限撤銷、重試、部分失敗及提交後回應遺失的回歸測試。

既有 GAS foundation／business／integration／videos、戰績診斷及 Webhook 診斷共 31 項測試全部通過，原測試未修改；日誌 `/private/tmp/guild-lock-audit/regression.log`。另以 Code.gs 的 RPC 名稱比對矩陣，61 個均有對應列，沒有遺漏或重複。

## 來源定位

- [backend.js](gas/src/backend.js)：全 RPC 鎖、角色／CSRF、Drive 服務、通知發送、初始化與復原。
- [storage.js](gas/src/storage.js)：追加版本、提交標記、分段登入資料及清理。
- [participation.js](gas/src/participation.js)：整場報名 revision、個人回應 revision、外援及取消請假。
- [members-events.js](gas/src/members-events.js)、[member-maintenance.js](gas/src/member-maintenance.js)、[member-battle-links.js](gas/src/member-battle-links.js)：名冊、活動與跨功能關聯。
- [lineups.js](gas/src/lineups.js)、[battles.js](gas/src/battles.js)、[battle-member-sync.js](gas/src/battle-member-sync.js)：排表、戰績及同步的驗證與提交。
- [auth.js](gas/src/auth.js)、[common.js](gas/src/common.js)、[videos.js](gas/src/videos.js)、[lottery.js](gas/src/lottery.js)：登入寫入、共用 requestId、延遲建表。
- [Code.gs](gas/Code.gs)：61 個 RPC wrapper 及編輯器入口；[gas.js](src/api/gas.js)、[ParticipationDialog.vue](src/pages/ParticipationDialog.vue)：前端目前沒有 BUSY 自動重試，也沒有跨人版本衝突的自動處理。

## v1.0.19 實作結果（已同步 GAS，尚未更新部署）

使用者確認調整並要求優先保障請假體驗，功能提交 `629dd6d`，本輪完成：

- 27 個已盤點讀取方法走嚴格唯讀交易，固定本次 commits 快照，禁止 put／remove／建立缺表及保存登入狀態。影片／抽獎缺表時才重新驗權並取得寫入鎖初始化，平時不占寫入鎖；新方法預設仍序列化，不依 get／preview 字首推測。
- 匿名 getAuthSession 直接回傳匿名；有 token 的讀取採登入指標前後核對，遇到世代切換最多重讀三次，穩定缺段仍回資料錯誤。角色／CSRF 保護保留。
- 戰績 CSV 在鎖外解析、預先驗證並建立私人附件，平台圖示亦先建檔。最終持鎖後重新載入已提交快照、驗權、檢查來源／版本／唯一性及 requestId，再一起提交；CSV 解析結果僅在該次執行內重用，不信任外部傳入的檔案 ID。圖示讀取使用該次執行的內容快取，避免最終鎖內 Drive I/O。
- 已辨識成員／外援的前端送出新增可選 `expectedParticipant`（場次 revision＋人員 ID／姓名／身分／個人回應 revision）。本機 SQLite 與 GAS 在交易內核對；別人送出不再使整份表單失效，同人改動、改名／所屬變化及場次修改仍要求確認。新欄位有白名單／型別檢查並納入 requestId 指紋；原請求重播不反轉後續變更。
- 舊呼叫不帶新欄位時維持整場 revision；未知／同名直接輸入沿用既有驗證。沒有變更原讀取回應格式，也沒有增加正常報名／請假的雲端往返。
- 前端只針對明確 BUSY 最多呼叫三次，退避 350／700ms 加隨機延遲，沿用同一組輸入、requestId 與登入 context。等待顯示「內容已保留」，停用重複送出並只顯示一個轉圈；未知傳輸失敗、版本衝突或授權失敗不盲目重送，草稿保留供重試。

原有登入／密碼計算、管理寫入及共用提交仍使用 Script Lock；沒有引進命名鎖／租約，也沒有把版本檢查移到鎖外後直接保存。Script Lock 最多等待仍為 10 秒，前端 BUSY 重試有上限；正式 Google 延遲與多人負載仍需同步後觀察，不能把隔離驗證當成服務時限保證。私人未引用檔案保留既有限制。

新增 13 項測試，完整 291 項全通過；唯一修改的舊測試是與新需求相反的 getEvents 持鎖必須回 BUSY 斷言，改為讀取成功並驗證 createEvent 仍回 BUSY，其餘原測試不變。新版欄位白名單／型別強化後，6 項目標測試覆核通過。日誌 `/private/tmp/guild-concurrency-full-tests.log`、`/private/tmp/guild-concurrency-target-validation-tests.log`。一般／GAS 編譯通過。

隔離 Chrome 以真正的 GAS 前端編譯與模擬後端驗證桌面／390px 手機：持鎖時首頁與表單仍可載入、不同人同舊表單送出成功、BUSY 自動重試保留原 payload、同人舊表單衝突保留輸入、手機失敗後使用相同 requestId 再送出成功，最終三筆請假、無頁面例外。腳本／摘要／截圖 `/private/tmp/guild-concurrency-preview/`；驗證未使用正式 GAS 或發送 Discord 訊息。

2026-10-19 使用者要求同步後，來源 `ded5752` 已透過 `npm run gas:push` 重新編譯、備份、同步並讀回四檔一致，沿用 1.0.19；備份 `data/gas-backups/2026-10-19T14-39-28-254Z/`。本輪未更新 Web App 部署或修改正式資料，線上須由使用者更新既有部署才會生效，見 [GASDeployment.md](GASDeployment.md)。

## v1.0.21 進攻／防守分析補充（已同步 GAS，尚未更新部署）

詳情選填 includeTeamContext，在既有 READ_ONLY 快照內讀最後儲存排表與成員引用投影，只返回實際玩家的最小對應；不擴充鎖白名單、不新增表、put／remove 或 Drive 作業。後續團隊合計、比例、配對、排序與圖表在前端進行，開啟或互動不再次查詢 team-analysis。顯式重新載入詳情才重讀。編譯後 GAS 已驗證其他寫入持鎖時可讀，資料／Properties／Drive／通知均未變，舊 API／wrapper 與匿名拒絕維持相容。初次讀取仍有 Sheets／排表成本，未量測正式 Google 秒數。

2026/10/20 來源 `f33db9c` 已同步 v1.0.21、四檔讀回一致；未查詢或更新 Web App 部署，實際備份與交付狀態見 [GASDeployment.md](GASDeployment.md)。

## v1.0.28 排表按需讀取（已同步 GAS、尚未更新部署）

四個新讀取 RPC 已盤點完整依賴並列入 READ_ONLY，保留 admin／manager 檢查。單次交易共用 commits 與名冊／職業，getLineupEditor 不讀 templates，getLineupSources 不讀 lineup_versions／templates。隔離 GAS 驗證寫入持鎖仍能讀，Sheets／Properties／Drive／通知內容不變。confirmLineup、createLineupTemplate 及刪除外援等寫入的版本／資格／requestId 與鎖維持原規則，未因減少讀取而移除保存時重新驗證。

## Unreleased 公開行事曆並行與影片精簡表單（本機待定版／同步）

getEvents 本來就是公開 READ_ONLY，本次只解除公開前端等待 auth 的順序；管理行事曆與寫入檢查維持原狀。新增 getEventVideoForm 已盤點依賴、列入 PARTICIPATION 與 READ_ONLY，同次只讀 events／必要 members／professions 與 commits 快照，沒有 ensureTable、put／remove、Drive、通知或 auth 狀態寫入；匿名／member 沿用三種有效單日戰鬥範圍，不開放影片閱覽。隔離持寫入鎖驗證可讀且資料／Properties／Drive／通知保持不變。submitParticipation／submitEventVideo 原版本、身分／CSRF、requestId 及提交鎖不改。

## Unreleased 影片閱覽整併首載

getVideoBrowser 已盤點依賴並加入 READ_ONLY 與 LAZY_TABLE_READS，預設管理者驗權保留。正常唯讀只用 events／videos／commits，同次重用事件與 commits，不讀旁表或 Drive／通知，不修改登入狀態或取寫入鎖；沒有場次時不碰 videos。缺表才於既有 locked execute 內重驗角色並初始化，匿名／member 不能藉此建表。隔離持寫入鎖純讀與缺表角色保護已驗證。submitEventVideo 的版本／CSRF／requestId、共用寫入鎖與其他功能不變。
