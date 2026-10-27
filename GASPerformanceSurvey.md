# GAS 效能調查與 GuildManager 可行性評估

調查日期：**2026-10-27（Asia/Taipei）**  
程式基準：main `8ca722d`，package **1.0.28**，另含尚未交付的 **Unreleased**。  
範圍：官方文件、開發者第一手案例、目前原始碼及既有隔離驗證紀錄。這份文件是研究與提案，沒有實作下列候選方案。

## 1. 建議先做什麼

**我們適合繼續用 GAS，但下一階段要優先處理「實際讀了哪些歷史、用了幾次服務呼叫、成功回應還在等什麼」，不能只繼續合併前端 API。**

建議順序：

1. 建立一般讀取與請假成功路徑的分段量測，確認 p50／p95、鎖等待與鎖持有時間。
2. 小範圍試作 Sheets API `values.batchGet`，對付目前分散 payload 的多次 Range 讀取；以相同資料比較，不直接替換整個 storage。
3. 排表若確認受歷史拖累，設計「每場最新排表目錄／摘要」，讓首頁排表不必解碼所有歷史快照。這項預期效益較大，也需要新的相容協議。
4. 依量測結果處理請假通知等待、品牌冷快取及登入分段存取；各自評估，不一起重構。

上述是**本專案的工程判斷**，不是 Google 對秒數的保證。尚未取得正式環境的新量測、完整表大小或部署驗證，不能承諾幾秒內完成，也不能認定正式資料已經太大。

## 2. 證據與交付邊界

| 證據 | 能支持的判斷 | 不能支持的判斷 |
| --- | --- | --- |
| 官方 API 文件 | 介面、限制、批次與快取語意 | 我們實際會快幾秒 |
| 開發者自行測試／問題敘述 | 可重現方向、值得比較的方法 | 不同資料／年代／帳號也有相同加速比例 |
| 本機原始碼 | 讀寫依賴、鎖範圍、可能的資料放大量 | 真正 Google 服務延遲 |
| 既有隔離 GAS 測試 | 結果一致、呼叫次數及併發保護 | 正式 p95 或真實網路吞吐量 |

本輪沒有連到正式試算表查看資料列，沒有讀取私有憑證、執行正式 benchmark、修改 Script Properties、安裝 trigger、同步 GAS 或更新 Web App。

[GASDeployment.md](GASDeployment.md) 記錄的最後成功程式同步仍是 **v1.0.28／06c3532**。本機 Unreleased 的公開行事曆、影片閱覽整併、對戰資訊精簡讀取等，不應當成正式環境已套用。正式 Web App 的實際部署版本本輪未查詢。

## 3. 官方文件給我們的關鍵原則

### 3.1 服務往返優先於小幅 JavaScript 優化

Google 建議減少其他服務呼叫、批次讀寫，避免逐格讀寫交錯；UI 頻繁呼叫 GAS 時，也應留意 Apps Script Library 的啟動成本。這支持我們的整併讀取與前端分析方向，但不表示所有資料都應整表讀取。[官方 Best Practices](https://developers.google.com/apps-script/guides/support/best-practices)

本專案後端是 Vite 編譯的單一 IIFE，`GuildGas` 是 bundle 名稱，並非另外載入的 Apps Script Library；不能套用「移除 Library 就會大幅變快」的結論。

### 3.2 非同步不等於無限制平行

`google.script.run` 不保證執行順序，官方列出最多 **10 個同時進行中的呼叫**，超過會排隊。這是該通訊 API 的限制，並非全站可容納的人數。[官方 HTML Service 通訊](https://developers.google.com/apps-script/guides/html/communication)

適用方式：獨立公開資料可並行；有相依的表單應同次組裝。不要把一次整併讀取改成十幾個平行 RPC，也不要用整頁提前預取增加請假尖峰的競爭。

### 3.3 CacheService 是可丟失的加速層

每 key 最大 **100 KB**，key 最長 **250 字元**；預設保存 **600 秒**，可指定最多 **21,600 秒**，但資料可能提前被移除；文件列出的項目上限是 **1,000**。要有 miss／錯誤回退，不能把它當資料庫或可靠互斥鎖。[官方 Cache](https://developers.google.com/apps-script/reference/cache/cache)

Script Cache 為同一 script 共用；Document Cache 在 standalone／Web App 環境可能是 `null`。User Cache 的 Google 使用者範圍也不等於我們自訂的 member／manager 帳號。[官方 CacheService](https://developers.google.com/apps-script/reference/cache/cache-service)

### 3.4 批次 API 有價值，也有導入成本

`values.batchGet` 能一次取多個範圍；`spreadsheets.batchUpdate` 將多項結構操作放進同一請求，官方明載驗證與套用的原子性。這兩者不是同一個方法，不能混為「讀取也有跨請求資料庫交易」。[官方 batchGet](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/batchGet)、[官方 Batch requests](https://developers.google.com/workspace/sheets/api/guides/batch)

Advanced Sheets Service 要顯式啟用，使用標準 Cloud project 時也要確認對應 API 設定；現有 manifest 沒有宣告這項進階服務。新增設定與重新授權需求必須先驗證。[官方 Advanced services](https://developers.google.com/apps-script/guides/services/advanced)

### 3.5 配額是容量約束，不是延遲保證

| 官方目前列出的限制 | 值 | 我們的解讀 |
| --- | --- | --- |
| 一般 Apps Script 執行時間 | 6 分鐘／次 | 不能用長等待維持互動體驗 |
| 同時執行／Google 使用者 | 30 | 不等於可有 30 個互不干擾的寫入 |
| 同時執行／script | 1,000 | 不會繞過共用寫入鎖 |
| Script Properties 單值／整個 store | 9 KB／500 KB | 不適合搬入整份業務歷史 |
| Sheets API 讀／寫，各自每專案每分鐘 | 300 | 啟用進階 API 後須監測 |
| Sheets API 讀／寫，各自每使用者每專案每分鐘 | 60 | 批次減少 quota 消耗，但大量 RPC 仍可能相撞 |

前四項見 [Apps Script Quotas](https://developers.google.com/apps-script/guides/services/quotas)；後兩項是 **Sheets API** 的配額，不可直接套成每次 `SpreadsheetApp.getValues()` 的計費方式。[Sheets API Usage limits](https://developers.google.com/workspace/sheets/api/limits)

我們的 manifest 要求 `USER_DEPLOYING`，官方說此模式以部署者身分執行。因此不能把每位幫眾當成各自擁有一份 Google 帳號配額；這是依執行身分作出的容量推論，實際仍需看 Cloud／Apps Script 用量。[官方 Web Apps 權限](https://developers.google.com/apps-script/guides/web#permissions)

## 4. 其他開發者的第一手經驗

### A. Tanaike：SpreadsheetApp 與 Sheets API 比較

作者在 2018 年提供測試方式與程式，變更列／欄數，每個點取逾百次平均；報告中 API 的讀寫較快，但也觀察到小量寫入用 `setValues` 更適合的交叉點。[原始 benchmark 與程式](https://gist.github.com/tanaikech/d102c9600ba12a162c667287d2f20fe4)

**對我們的價值：**值得比較 batchGet／批次寫入，尤其非連續範圍與大 payload。**限制：**年代久、測試不是我們的五欄／Base64／commits 協議；不把其百分比或舊 runtime 限制帶進預估。

### B. Stack Overflow：一個很小的 RPC 也有等待

2020 年提問者描述側邊欄寫入一格仍等約 3–5 秒；討論指出瀏覽器到伺服器的呼叫成本，與編輯器直接執行不同。[原始提問、留言與回答](https://stackoverflow.com/questions/61605560/why-is-google-script-run-is-slow)

**對我們的價值：**量測應從使用者點擊到畫面完成，不能只看編輯器的業務函式。**限制：**單一使用者自述、非受控 Web App 測試；不是「GAS 固定需要 3–5 秒」的官方結論。

### C. GQuery 作者：精準範圍與原生／進階服務各有適用處

專案 README 公開讀寫測試表，也說明精準欄位批次讀取與明確 snapshot；其中作者對原生讀取與進階寫入的評價不同。[作者 README 的效能與讀取設計](https://github.com/EdsallRd/GQuery#benchmarking-performance)

**對我們的價值：**可以借鏡投影讀取、一次快照重用，以及寫入後快取失效的做法。**限制：**作者測試環境與模型不同，部分效能主張缺少此頁可獨立核對的完整實驗控制；不引用其倍數，也不直接導入 ORM。其表格式條件查詢無法直接理解我們的 Base64 歷史。

三類證據共同支持「減少往返、按實際資料測量」。沒有足夠證據支持「全部改 API」「全部放快取」或「一直定時呼叫保溫」是通用答案。

## 5. 對照目前實作：已做與仍可能慢的地方

| 區域 | 程式碼事實 | 狀態／剩餘成本 |
| --- | --- | --- |
| Storage | [storage.js](gas/src/storage.js) 固定 commits 快照、每 ID 選最新提交、同交易索引／解碼重用 | 已完成；仍掃 commits 與業務索引 |
| payload | 小表 all 一次五欄；指定 key／大表先四欄索引，再讀最新 payload | 已完成；非連續最新列會分多個 Range |
| 排表首頁 | [lineups.js](gas/src/lineups.js) 的 `getLineupEditor` 先 `all('lineup_versions')`，再取該場最新 | 只回傳最新版，**但仍解碼每個不同版本 ID 的快照** |
| 排表儲存 | `confirmLineup` 用 `versions(eventId)[0]` 檢查版本 | 仍可能投影該場舊快照；這段處於寫入保護內 |
| 報名／請假 | [participation.js](gas/src/participation.js) 對 responses／registrations 做 all 後依 eventId 篩選 | 個人版本已減少無關衝突；不等於只讀這一人的資料 |
| 對戰詳情 | [battles.js](gas/src/battles.js) 讀當筆玩家，但 battle_links 仍 all；分團另找最新排表 | 保留同次最小對應，開分析零新增 RPC；來源掃描尚在 |
| 精簡編輯 | `getBattleMetadata` 只讀 battles 指定 ID | Unreleased 已完成，不應重做一份 |
| 唯讀／寫入鎖 | [backend.js](gas/src/backend.js) READ_ONLY 不拿業務鎖；共享寫入仍 Script Lock | 已完成；持鎖長度仍決定尖峰排隊 |
| 請假通知 | `deliverNotices` 在鎖外，但在 RPC return 前；429 另有一次等待／重送 | 不擋其他寫入，**本人仍等通知送完才收到成功** |
| 品牌首載 | [Code.gs](gas/Code.gs) 的 doGet 呼叫 `pagePlatform`，6 小時 Script Cache | miss／被提前淘汰時會回退 Sheets／可能 Drive，延後 HTML 送出 |
| 登入狀態 | [storage.js](gas/src/storage.js) 的 private store 逐段讀 Properties、再次驗 pointer | 一般 RPC 也有這層成本；穩定快照／撤銷不能移除 |
| 前端 | GAS 單檔；圖表已選必要 ECharts 模組，抽屜延後畫圖 | 模組仍在單檔下載中；延後初始化不等於延後下載 |

這裡的「大」應用四個量判斷：實體歷史／分段列數、有效邏輯紀錄數、payload bytes、最新列的分散範圍數。現有 **128 列**只是 storage 選擇單次五欄或索引分階段讀取的門檻，不是容量上限。少量大型排表也可能比數千筆小回應昂貴；本輪沒有正式表的這四項統計。

Base64 對 n 個輸入 bytes 的編碼長度為 `4 × ceil(n / 3)`，大型內容約增加三分之一；在本專案另有 JSON envelope 與分段列。這能解釋部分傳輸成本，不能單憑它推定主要瓶頸，尤其當等待集中在服務往返或鎖時。

既有隔離證據：排表首載 getValues **17→9**、影片冷首載 **7→4**、對戰編輯 **6→3**。來源見 [GASDeployment.md](GASDeployment.md)。這些是不同 fixture 的歷次比較，不能相加或換算正式加速比例。

本輪只檢視現有本機編譯產物：Index.html **1,737,487 bytes**，本機 gzip 比較 **500,699 bytes**；Backend.gs **202,025 bytes**。前者包含整個前端，後者為伺服器程式，不是給玩家額外下載的前端檔。gzip 數字只是本機壓縮參考，沒有量測 Google 實際 Content-Encoding／傳輸量。

## 6. 候選改善的可行性與順序

效益欄是瓶頸成立時的預期方向；工期是熟悉本專案的一位開發者之粗估，含實作與回歸，不含等待授權／正式觀察。P0＝先建立判斷依據；P1＝優先試作；P2＝依證據另立設計；P3＝目前保留。

| 優先 | 方案 | 預期收益 | 可行性／成本 | 主要邊界 |
| --- | --- | --- | --- | --- |
| P0 | 一般 RPC 成功路徑量測 | 找出真正等待來源 | 高；1–2 天 | 不記個資，量測自身須低負擔 |
| P1 | 最新 payload 分散範圍 batchGet | 降低 Sheets 往返 | 中高；2–4 天 PoC | API 啟用、quota、空值形狀及快照不變 |
| P1 | 排表鎖內只比較版本摘要 | 減少儲存時不必要投影 | 高；1–2 天 | 若仍 all，不能宣稱已省歷史解碼 |
| P1 | 新增每場最新排表目錄 | 排表讀取隨歷史成長較平穩 | 中；3–6 天 | 新協議、回填、刪除／重建／封存及回退 |
| P2 | 職業等小型共用快取 | 重複讀取少一次／幾次服務存取 | 高；1–2 天 | 效益可能小；cache miss 不得擋請假 |
| P2 | 品牌冷 miss 不阻擋 HTML | 改善冷首頁首屏 | 高；1–2 天 | 初始標題／品牌短暫回退須接受 |
| P2 | Properties 分段批次化 | 減少登入／RPC 基礎成本 | 中；2–3 天 | pointer、撤銷、限流與容量保護原樣 |
| P2 | 通知 outbox／背景 worker | 縮短請假成功回覆等待 | 中；3–5 天 | 延遲、重複通知、trigger quota 與維運 |
| P2 | 單次 Sheets 原子批次提交 PoC | 降低多表寫入與 flush 往返 | 中低；4–7 天 | 高風險儲存協議變更，不能直接上線 |
| P3 | 外部靜態資源／後端或資料庫搬遷 | 改善首載或突破結構瓶頸 | 中低；另估專案 | 會動發布、驗權、資料及維運架構 |

### 6.1 P0：先把「慢」分層

目前完整分段診斷主要針對戰績上傳失敗，見 [battle-upload-diagnostics.js](gas/src/battle-upload-diagnostics.js)；成功的一般 RPC 沒有同等觀測。

建議記錄：operation、固定階段名稱、總耗時、鎖等待／持有時間、各表讀取範圍次數／列數／payload bytes、解碼筆數、cache hit/miss、通知耗時。表名固定白名單，不記 UID、姓名、CSV、網址、token 或整份 payload。採樣並在一次執行尾端彙整，不逐格 logging。

瀏覽器另量測「點擊→成功呈現」與 RPC round-trip；伺服器階段使用自己的時鐘。兩者差額僅表示尚未解釋的傳輸／排程／序列化等時間，不能直接命名為 cold start。巢狀計時不能直接相加。

官方支援 execution log 與較適合持續排查的 Cloud Logging；接標準 Cloud project 可取得更多查詢能力。[官方 Logging](https://developers.google.com/apps-script/guides/logging)

### 6.2 P1：先試 batchGet 的 payload 階段

現有 storage 已把連續列合併，但若最新資料散在 50 個不連續範圍，仍可能讀 50 次。可在**相同 store 介面後方**將這批範圍交給一次或有限批次的 `values.batchGet`。

適用流程：先固定 commits → 讀索引 → 選相同最新已提交資料 → 批次取 payload → 沿用分段、刪除、損毀檢查。不能把「最後一個實體列」改當最新。首次只替換最後一階段，跨表索引預抓等確定有收益再評估。

注意：API 預設 FORMATTED_VALUE，須明確設定合適的值呈現模式，讓 part_number／part_count 保持數字；API 可能省略尾端空白列／格，adapter 要補齊且維持範圍對應。小型單一連續範圍保留舊路徑比較，不強迫全部走 API。[batchGet 參數契約](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/batchGet)

依 Sheets API 文件，建議單一請求 payload 不超過 2 MB，處理逾 180 秒會 timeout；2 MB 是建議值而非硬上限。大批次應限制範圍數與預估量。[官方 API limits](https://developers.google.com/workspace/sheets/api/limits)

風險：啟用服務／授權、quota、整批失敗與回退。讀取的有限退避可另評估；不把通用自動重試包到 append／寫入上。現有 BUSY 重試不需要再外包第二層。

### 6.3 P1：最新排表目錄，比通用 Base64 微調更接近瓶頸

`lineup_versions` 每次存檔都是新 ID；因此「每 ID 只解碼最新提交」仍會讀出所有舊版。下一步可新增小型可重建目錄，保存 eventId → 最新 snapshotId／version 與必要封存摘要。讀歷史清單另用輕量摘要，實際查看某版才讀內容。

目錄必須和排表快照在**同一提交**發布，且讀取使用相同 commits；名冊 UID 維護造成的引用覆寫，仍在取出指定快照後投影，不把投影結果當永久真相。既有紀錄先保留全掃回退；正式回填需另行規劃與授權。

只把目錄加成一般五欄工作表，依然會掃目錄索引；它主要省去大型歷史 payload 的傳輸／解碼，不能宣稱 O(1) 或完全不掃歷史。更進一步的實體 row directory 需另處理排序、行位移、損毀及驗證。

較小的先行改善是 `confirmLineup` 只選最高 version 做衝突比較，避免為了取版本號投影全部舊排表；這個改動本身仍不會省掉 `all('lineup_versions')` 的解碼，必須分開報告成果。

### 6.4 P2：快取只放有邊界的資料

| 資料 | 建議 |
| --- | --- |
| 職業、預設顯示設定等低變動小資料 | 可用 Script Cache；明確 TTL、schema key 與設定更新失效 |
| 公開月曆 | 可考慮短 TTL，但要接受短暫舊活動；顯式重載應可繞過 |
| 精確的不可變原始快照 | 可依已提交 ID／transaction 做 key；先確認權限，不快取含動態覆寫的最終投影 |
| 請假表單與 expectedParticipant | 不以長期快取代替新鮮版本，寫入仍須鎖內重驗 |
| 登入是否有效、角色、撤銷結果 | 不以 TTL 命中代替權限檢查 |
| requestId 成功回應 | 沿原持久化 requests，不改成可能消失的快取 |

若用 revision 當 cache key，就要從可信來源拿當前 revision；讀版本本身仍有成本。若用「寫後清除」，必須處理慢讀者在清除後把舊值填回的競爭。最容易落地的是小型低變動資料，而非一次快取整個 database。

不要把資料按千筆拆成千個 key；容量、逐筆服務呼叫、失效成本可能比原讀取更差。快取失敗直接回來源，不為了填快取取得全域業務鎖。

### 6.5 P2：品牌與登入各有小幅機會

**品牌：**官方提醒模板送出前的伺服器工作會延後頁面呈現。[HTML Service Best Practices](https://developers.google.com/apps-script/guides/html/best-practices)

我們的 doGet 是字串注入，但等待效果相同。可保留 cache hit 的品牌，miss 時先回通用標題，前端再用既有設定流程補上；不強迫讀取 Sheets／Drive 完成才送 HTML。需要驗證 App 是否仍能完成補讀、避免多打設定 RPC，並接受初始頁籤標題改變。圖片 key／更新失效競爭也要處理。

**登入：**可比較新 generation 的 chunks 用一次 `setProperties` 後，再另外發布 pointer；讀取則比較逐段與一次 `getProperties` 的成本。後者會載入其他 Script Properties，只能留在伺服器記憶體、絕不回傳／記錄；帳號量少時未必值得。

官方只提供多值操作契約，沒有說它是我們所需的跨步驟交易；因此 pointer 前後檢查、舊段清理競爭、重讀、帳號撤銷與限流都要保留。[官方 Properties](https://developers.google.com/apps-script/reference/properties/properties)

### 6.6 P2：讓請假成功不再等 Discord，需要可靠佇列

目前通知在鎖外是正確的，但仍位於 return 前；單純移出鎖不會消除本人等待。如果量測顯示通知占很大比例，可把通知 intent 與請假結果同交易保存，再由背景 worker 處理。

這是新的持久化 outbox／狀態機，不能改成「先回成功，丟一個沒有 await 的 Promise」。GAS 的同步 UrlFetch 與執行生命週期不提供此種 fire-and-forget 保證。

worker 的 claim／結果回寫需要短鎖，HTTP 必須在鎖外；worker 和一般請假仍共享寫入資源，因此要限制每批數量。通知發送成功但回寫失敗可能產生重複，對 Discord 要明確接受至少一次投遞與重複風險，不能宣稱 exactly-once。

時間 trigger 最密可每分鐘執行，但不是可靠的秒級排程；會增加延遲、配額與監控工作。若管理者要求通知立即到達，先保留現況，以量測確認是否真值得交換。[官方 Installable Triggers](https://developers.google.com/apps-script/guides/triggers/installable)

### 6.7 P2：批次寫入是可研究的協議替代，不可直接刪 flush

現有流程是各表追加 → flush → commits 追加 → flush，這是目前可見性協議的一部分。官方指出 flush 會立即套用待處理變更，不能因範例說它慢就拔掉。[官方 SpreadsheetApp.flush](https://developers.google.com/apps-script/reference/spreadsheet/spreadsheet-app#flush())

可隔離研究一次 `spreadsheets.batchUpdate`，將多表 appendCells 與 commit marker 放進同一原子請求；是否能保留舊 reader 的快照語意，須實驗驗證。一般 `values.batchUpdate` 則是指定範圍寫值，與 appendCells 的結構請求不同，不能直接互換。[官方 values.batchUpdate](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/batchUpdate)

無論哪種方法，都要保留 Script Lock、revision／requestId／唯一性檢查，處理「服務完成但回應遺失」，以及 Sheets 與 Drive／Properties 之間沒有同一原子交易的事實。舊格式、公式防護與跨分段內容也要比較。這是獨立設計與回退工作，不列為第一批低風險修改。

### 6.8 P3：前端打包與資料庫搬遷

先檢查實際 bundle 組成、圖表初始化與 Chrome long tasks。現有 ECharts 已採按需模組；只加 dynamic import，在 GAS singlefile 下仍可能內嵌全部內容，不能宣稱首載 bytes 自動下降。

外部 HTTPS 靜態資源可以在 HTML Service iframe 中載入，但會引入另一套資產發布與快取版本管理。[官方 HTML Restrictions](https://developers.google.com/apps-script/guides/html/restrictions)

若整個前端搬離 HTML Service，現有 `google.script.run` adapter 不能原樣當外部網站的通訊層，需另設認證與 API。若歷史索引掃描與寫入排隊在前述優化後仍是主因，再評估搬至專用後端／資料庫。判斷應依延遲、成長與維運需求，不只以幾千列或 Sheets 儲存格上限作結論；此處不做產品選型或預估雲端帳單。

## 7. 不建議現在採用的做法

| 常見建議 | 為什麼不適合直接用在我們身上 |
| --- | --- |
| 不同業務表就分開鎖／改 User Lock | commits、requests、append 位置與登入讀改寫仍共用；自訂帳號不是 Google 身分 |
| Web App 改用 Document Lock | 官方列出 Web App／standalone 無 containing document 時會回 null，不能拿來當 table lock |
| 把 lock timeout 拉很長 | 只是把 BUSY 改成更久等待，不提升單位時間完成量 |
| 只顯示已保存，後端晚點再寫 | 會讓使用者以為請假成功，實際可能沒提交 |
| 只靠 CacheService 保存回應與 requestId | 可被提前淘汰，會破壞安全重試與併發版本 |
| 每分鐘 ping 保溫 | 本次來源沒有提供可靠 SLA；增加配額，不解決歷史掃描及共用鎖 |
| 全部改成平行 RPC／fetchAll | 不消除資料相依與全域寫入鎖，還會增加尖峰負載 |
| 改 getDisplayValues 就一定更快 | 我們需要精確的數字索引、ID 與編碼字串，格式化值不是無成本替代 |
| 直接 QUERY／TextFinder 查 eventId | eventId 等欄位多在 Base64 payload 裡；目前五欄不是一般業務欄表 |
| 移除 Base64／直接改寫舊列／清掉歷史 | 會改到公式防護、分段及版本協議；尚無證據支持這是首要瓶頸 |
| 啟用 gzip payload 就能解決 | 可能省傳輸但增加 CPU／codec 相容成本；須另設格式版本，不解決索引與往返 |

Lock 類型與 Document Lock 限制見 [官方 LockService](https://developers.google.com/apps-script/reference/lock/lock-service)。其餘拒絕理由是依本專案結構作出的評估。

## 8. 下一輪實驗與驗收

### 測試資料與量測方式

使用隔離 script／試算表，建立同一批**固定 ID 與邏輯內容**，變更歷史與實體分布，不使用正式幫眾資料寫入驗證。小型資料不可只測空表。

| 維度 | 建議案例 |
| --- | --- |
| 歷史 | 每個有效 ID 1／10／100 次修改；另測不同 ID 的 100／1,000 份舊排表 |
| 分布 | 最新資料連續／交錯分散；含分段 payload 與失敗未提交列 |
| 流量 | 單人、2／5／10 人同時請假；不同人、同人衝突及一般讀取並行 |
| 路徑 | 匿名／member／manager；冷 cache／熱 cache／cache 不可用 |
| 錯誤 | 最新損毀、讀取失敗、部分寫入、提交回應遺失、同 requestId 重試 |
| 通知 | 不發真實通知的 stub：快速、慢速、429 與例外；若需真實測試另指定測試頻道 |

第一階段每個主要案例先做 **30 次獨立執行**，交錯新舊方法，記錄 p50／p95／最慢值；不要只在同一 execution 的 for 迴圈連跑後取平均。需有一批刻意間隔的冷路徑觀察；30 筆的 p95 仍容易波動，接近決策門檻時增加樣本。控制帳號配額與時間區段，保留失敗樣本。

### 建議的接受門檻（本專案提案，非官方標準）

1. **正確性先行：**既有測試保持原樣，補新舊讀取一致、歷史／分段／缺值／刪除及權限測試。成功回覆必須已提交。
2. **請假必測：**不同人使用相同舊表單能完成；同人衝突可理解；BUSY 退避不丟草稿；同 requestId 不重複寫入。
3. **batchGet PoC：**分散範圍案例的 p95 目標至少下降 20%；常見小表案例不能穩定退化超過 10%。此數字是試作決策線，未達就保留原方法或限定適用範圍。
4. **最新排表目錄：**選一場時僅解碼該場所需的最新配置，不隨其他舊快照數增加解碼份數；目錄索引掃描量另計，不能藏起來。
5. **寫入優化：**同時比較鎖持有 p95、整體完成率與重試數；不能只讓一人更快而其他人更容易 BUSY。
6. **可回退：**精簡讀取、API transport、目錄各自可退回舊路徑；回退不得漏讀已成功寫入的資料。

## 9. 建議交付批次

- **第一批：量測與小改動。**一般 RPC／請假計時、排表版本號檢查避免不必要投影、batchGet 隔離 PoC。先交數據，不改正式儲存格式。
- **第二批：針對最大瓶頸。**只有排表歷史確定主導時才做最新目錄；只有通知等待主導時才決定是否接受 outbox 延遲。兩者各自交付與回歸。
- **第三批：寫入協議或架構。**有數據證明需要後，才另設原子批次提交／資料分區／資料庫搬遷方案。

**本次最值得用到我們身上的不是再換一種迴圈，而是「可量測的分散範圍批次讀取」與「業務層最新版本目錄」。**前者較容易隔離試作；後者更直接對應排表越存越多就越慢的結構。快取、背景通知與前端資產則依各自瓶頸逐項導入。

## 10. 維護與來源說明

外部規則與配額可能變動；要實作時重新核對上方原始連結。未採用的提案不寫成 AGENTS.md 的強制常態要求；採用並驗證後，才更新 [Architecture.md](Architecture.md)、[GASConcurrency.md](GASConcurrency.md)、[Style.md](Style.md) 與 [AGENTS.md](AGENTS.md)。

純研究不升版、不新增 release note、不改套件或程式。本文提案與工期皆尚未成為交付承諾，正式執行依使用者選定的範圍進行。
