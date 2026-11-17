# GM v2 Node.js 分層與開發方式

2.0.0 的後端是 Node.js 22／Express 5／mysql2, 原始碼維持 JavaScript ESM。這份文件定義 Codex／Claude 與其他協作者寫 `server/` 時共同遵守的分層與寫法, 目標是讓後續功能用同一套簡單規則開發, 而不是每次各寫各的

參考來源是 wshobson/agents 的 [nodejs-backend-patterns](https://github.com/wshobson/agents/tree/main/plugins/javascript-typescript/skills/nodejs-backend-patterns) Agent Skill。它是開發時的參考文件, 不是 package.json 依賴；上游範例用 TypeScript、PostgreSQL、JWT 與 DI 容器, 這裡只取分層、錯誤處理與交易的觀念, 語言、資料庫、登入與 API 契約一律依本專案既有文件。本文與 [MySQL 開發說明](mysql-development.md)、[工程契約](engineering-contracts.md) 衝突時, 以安全與資料契約為準

## 四層與各自的邊界

| 層 | 位置 | 負責 | 不做 |
| --- | --- | --- | --- |
| HTTP 入口 | `server/app.js`、`server/auth.js` | 解析 request、檢查 Origin／JSON／大小／session 與角色、`await` Repository 或 Service、組 response、把錯誤交給統一 handler | 不寫 SQL, 不做業務判斷, 不自己開交易, 不直接送通知 |
| Service | 跨功能流程才建立, 放 `server/services/<流程>.js`；目前跨領域組合先放在 `server/mysql/repository.js` 的組合區 | 串接兩個以上領域的流程, 例如排表編輯器要同時讀場次、職業目錄與報名；決定呼叫順序與回傳形狀 | 不寫 SQL, 不自己管連線；單一領域的增刪改查不需要 Service |
| Repository | `server/mysql/<領域>-repository.js`, 由 `server/mysql/repository.js` 組裝 | 參數化 SQL、交易、主列鎖、revision／requestId／唯一性檢查、把資料列轉成 API 契約的純物件、丟出領域錯誤 | 不處理 HTTP、cookie 或 header；不假設呼叫端已經驗證過輸入 |
| Domain | `src/domain/*.js` | 純驗證與純運算：欄位規則、日期、戰績統計、排表索引、錯誤類別；Node API 與前端共用 | 不 import `node:` 模組、`server/`、mysql2 或任何 I/O |

基礎設施不算業務層：`server/database/mysql.js` 管 pool／交易／TLS, `server/database/migrate.js` 與 `migrations/` 管版本, `server/mysql/store.js` 包查詢、交易與通知上下文, `server/discord-notifier.js` 只負責送出。這些檔案不含業務規則, 新功能不應該改到它們

## async／await

- Repository 每個公開方法都是 `async`, 每次查詢都 `await`；不保留同步版本, 不提供 callback 介面
- Express 5 會把 async handler 的 rejected Promise 交給錯誤 middleware, 所以路由寫成 `async (request, response) => { response.json(await repository.getEvent(id)); }` 就好, 不需要每條都包 try／catch 或 asyncHandler
- 不要 fire-and-forget。唯一允許在回應後繼續跑的是 Discord 通知佇列, 而且只在交易提交成功後才排入
- 交易裡逐筆 `await` 是刻意的, 因為同一條連線要維持順序；`server/mysql/collections.js` 的 `asyncMap` 等工具就是做這件事。交易外的清單讀取優先一次 SQL 取回, 不用迴圈逐筆查；是否有 N+1 由 GM-37 量測後再處理, 不先猜

## 交易、鎖與版本

- 寫入一律在 Repository 內用 `db.transaction(async () => { ... })`, 入口層與 Service 不自己開交易。巢狀呼叫會沿用外層交易（AsyncLocalStorage）, 所以跨領域流程只要在最外層開一次
- 交易內的順序固定：取寫入鎖（store 自動做）→ 查 requestId 是否已處理 → 比對 revision → 檢查唯一性／關聯存在 → 寫入 → 回傳最新資料。相同 requestId 重送回傳既有結果, 不重做也不覆蓋後來的更新
- 唯讀方法進 `server/mysql/store.js` 的審核清單, 走 READ ONLY 快照, 不拿寫入鎖；新增唯讀方法要記得補清單, 否則會以一般方法執行
- 密碼雜湊、CSV 解析這類昂貴且不需要鎖的工作放在交易外先做, 入鎖後只重驗相依資料
- 資料庫層不重試寫入、不猜測未知的 commit 結果；失敗就 rollback 並把錯誤往上丟, 呼叫端保留原 requestId 由使用者決定是否重送

## 錯誤處理

- 業務錯誤用既有的領域錯誤類別（`EventError`、`MemberError`、`LineupError`、`BattleRecordError` 等）, 物件要有 `status`、`code`、`message`, 需要時加 `fields`；訊息直接給使用者看, 說原因與下一步, 不含 SQL、帳號或憑證
- 入口層只有一個錯誤 handler（`server/app.js` 最後的 `app.use`）負責把領域錯誤轉成 `{ error: { code, message, fields } }`；route 裡不各自 try／catch 回 JSON
- 不是領域錯誤的（mysql2、程式錯誤）一律 500 加固定訊息, 細節只進 log。`DatabaseError` 的訊息本來就是固定分類, 不要把 driver 原文往外傳
- 新領域加錯誤類別時, 要同時加進 handler 的判斷清單並補一個測試；後續可以改成共用的 `ApiError` 基底類別用 `status`／`code` 判斷, 但那是逐步重構, 不在單一功能卡裡順手做

## 驗證與資料形狀

- 輸入驗證放 Domain 的 `validateXxx`, Repository 在開交易前呼叫；HTTP 層只做 Origin、Content-Type、body 大小、session 與角色。不用 Zod／Joi 之類的套件取代既有驗證
- 回傳只給可序列化的純物件：時間 ISO 8601 字串、日期 `YYYY-MM-DD`、UID 保持字串、revision／count 轉安全整數。不把 mysql2 的列物件、Buffer 以外的 Node 物件或 `Date` 直接丟出去
- API 路徑、欄位與錯誤碼依各領域契約, 遷移期間不改既有前端用到的格式；需要改契約另開卡並同步 `src/api/` 與測試

## 依賴注入

- 用工廠函式加明確參數, 例如 `createApp(repository, { notifier, authNow })`、`createMysqlRepository(database, { authNow })`、`createParticipationRepository(db, { notify })`。需要替身的只有外部 I/O 與時間, 測試就從參數換掉
- 不引入 DI 容器、裝飾器或全域 registry；不為了注入而把每個模組改成 class。能用閉包與參數解決的就用閉包與參數

## 測試

- 業務行為測試放 `tests/mysql-contracts/*.test.js`, 透過 `tests/helpers/mysql-repository.js` 在自己的隔離空庫跑真 MySQL；一個情境一個 `test`, 用 `node:test` 與 `node:assert/strict`, 不加測試框架
- HTTP 層測試用 `createApp(repository)` 接隔離的 MySQL Repository 驗 status、JSON 形狀與錯誤碼（GM-7 補齊）；不用 SQLite 代替, 也不 mock Repository 來假裝交易通過
- 多人操作、同 requestId 重送、持鎖時唯讀與故障回滾已有既有案例, 新寫入功能要照樣補一個並行案例
- `npm test` 只接受四個隔離設定檔, 缺設定直接失敗, 不把 skip 當通過。指令與設定格式見 [MySQL 開發說明](mysql-development.md)

## 什麼時候該拆 Service, 什麼時候不用

用 GM 現有功能當例子：

- **不拆**：新增場次（`createEvent`）是驗證加一個交易, 留在 `event-repository.js`；成員回覆報名（`saveMemberResponse`）雖然會產生 Discord 通知, 但通知只是交易內 `notify()` 記一筆, 由入口層在提交後送出, 仍是單一領域, 不需要 Service
- **不拆**：成員匯入（`importMembers`）解析 CSV、比對既有成員、寫入並記通知, 看起來步驟多, 但全部在一張表的一個交易內, 保持在 Repository
- **已經是 Service 的角色**：排表編輯器（`getLineupEditor`）同時讀場次、職業目錄與報名；UID 修正（`member-maintenance.js`）要改成員並重寫排表、範本與戰績的參照。這類跨領域組合現在放在 `server/mysql/repository.js` 的組合區與 `member-maintenance.js`, 這就是本專案的 Service 層, 不需要再包一層
- **何時搬到 `server/services/`**：同一個跨領域流程超過幾個函式、或需要在交易外協調外部服務（例如 R2 上傳加 MySQL metadata）時, 才新建 `server/services/<流程>.js`, 由 `server/index.js` 組裝並注入 Repository。第一個可能的候選是戰績上傳接 R2, 到 R2 卡片再決定

## 不採用的模式

- 不改 TypeScript、不換 Fastify、不拆微服務、不換 PostgreSQL／MongoDB／ORM
- 不強制每個功能用 class、interface、factory 或 DI 容器；不為了「模式」加 Controller 類別包一層再呼叫 Repository
- 不加 JWT、refresh token、Redis 快取、rate-limit 套件或 `@Cacheable` 這類上游範例；登入沿用 scrypt＋HttpOnly cookie＋CSRF, 需要快取或限流先有量測數據再開卡
- 不在連線層自動重試、不用 ORM 的 lazy loading、不用全域 singleton 持有連線
- 不為了分層把 `src/domain` 的純函式搬進 Repository, 也不把 SQL 搬進 Domain

## 現況盤點與改進清單

2026-11-16 盤點 patch-2.0.0（b89657b）：`server/app.js` 70 條路由, 只有 4 條已是 async, 其餘仍同步呼叫原 SQLite Repository；`server/mysql/` 11 個檔案約 2.8 千行已完成非同步 MySQL 實作, 46 個 MySQL 契約測試通過；舊 SQLite 版 `server/*-repository.js` 與 `server/repository.js` 約 4 千行仍在, 由 `server/index.js` 使用。`src/domain` 37 個檔案都沒有 import `node:` 模組, 只有 `member-maintenance.js` 反向引用 `server/member-validation.js`

| 順序 | 項目 | 歸屬 |
| --- | --- | --- |
| 1 | `server/index.js` 改用 `createMysqlDatabase`＋`createMysqlRepository`, 啟動時用 `db:status` 的方式核對 migration 版本, 缺版本直接失敗 | GM-7 |
| 2 | `server/app.js` 全部路由改 `await`, `notifying()` 改成 `await repository.invoke(name, args)` 後才送通知；`server/auth.js` 的 `getSession`／`participationRequiresLogin` 改 await | GM-7 |
| 3 | 補 HTTP 層契約測試：status、JSON 形狀、錯誤碼、通知只在提交後送出、失敗不送 | GM-7 |
| 4 | 錯誤類別建構子順序不一致（`MemberError(status, code, message, fields)` 對 `EventError(message, fields, status, code)`）, 逐個領域對齊到共用基底, 每次只動一個領域並跑該領域測試 | 後續重構 |
| 6 | 舊 SQLite Repository 與 better-sqlite3 依賴在 API 切換、正式資料匯入驗證後才移除, GM-27 前保留以便對照 | GM-27 之後 |
| 7 | 戰績同步預覽（`syncPlan`）整表讀 `players_json` 再逐筆 `project()`、個人戰績與排表讀取是否有 N+1, 先量測再決定 | GM-37／GM-38 |
| 8 | `server/app.js` 若在 GM-7 後超過約 500 行, 再按領域拆成 `server/routes/<領域>.js`；現在不先拆 | 視 GM-7 結果 |

這份清單是可核實的改進項目, 不是立即重構授權；每一項都要有自己的卡片或併入上表指定的卡片, 完成時以測試與 commit 回報
