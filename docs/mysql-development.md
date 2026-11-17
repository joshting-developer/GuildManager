# MySQL 開發與隔離驗證

2.0.0 將 Node 後端資料來源改為 MySQL, 保留現有功能與 API。目前已完成連線、migration、資料表、各領域非同步 Repository 與 HTTP API 接線, `server/index.js` 只接 MySQL；舊 SQLite Repository 與測試保留在原位置供對照, 不再由服務或 `npm test` 使用。GAS 舊來源在正式資料移轉與驗收前保留

## 連線設定

以 [mysql.env.example](../config/mysql.env.example) 建立自己的私有設定, 不把填妥檔案提交 Git。後端不隱式讀取另一個專案或根目錄的帳密, 所有選項由執行程序的環境提供

```sh
node --env-file=.local/mysql.env tools/check-mysql.js
```

也可由部署環境提供變數後執行 `npm run db:check`。成功輸出只有固定狀態、driver、版本與 TLS 是否啟用, 失敗只有固定錯誤分類；不輸出 host、帳號、schema、密碼、SQL 或原始 driver 錯誤

- `DB_HOST`、`DB_DATABASE`、`DB_USERNAME`、`DB_PASSWORD` 必填, `DB_PORT` 預設 3306
- `DB_SSL_MODE` 預設 `verify_identity`, 需提供 `DB_SSL_CA_FILE` 或 `DB_SSL_CA_BASE64` 其中一個。保留 CA、主機名稱與 TLS 1.2 以上驗證, 不提供略過憑證驗證的模式
- 本機 loopback、`mysql` 或共用服務的 `side-project-mysql` 可明確使用 `DB_SSL_MODE=disabled`, production 一律禁止停用 TLS
- 每程序一個 pool, 預設 5 條連線及最多 20 個排隊要求, 可由 `DB_POOL_SIZE`／`DB_QUEUE_LIMIT` 調整；不接受無限佇列。`DB_CONNECT_TIMEOUT` 預設 10000ms
- UTF-8 使用 utf8mb4, BIGINT、DECIMAL 與日期保持不失真的傳輸值, 由各 Repository 按 API 契約明確轉換；不能把 UID 或大整數統一轉 Number

## 交易與錯誤

執行網站的 runtime 帳號只授予本專案 schema 的 SELECT／INSERT／UPDATE／DELETE；migration 使用另一個帳號, 另有本 schema 的 CREATE／ALTER／DROP／INDEX／REFERENCES。兩者都不具全域權限或 GRANT OPTION, 遠端帳號由伺服器強制要求 TLS

正式環境先建立獨立空 schema 與帳號, 寫後核對當前 schema、TLS 與 grants 並驗跨庫拒絕；不為確認帳號而對既有正式表試寫。正式與開發帳密分開保存, 應用程序不持有管理帳號, 未完成業務遷移前也不自動建表或匯入舊資料

`createMysqlDatabase` 提供 `query`、`transaction`、`withConnection`、`probe`、`close`。交易 callback 取得專用 connection, 每個查詢都需 await；成功 commit, 失敗 rollback 並釋放。rollback 失敗則丟棄連線, 已結束的交易不能繼續使用。`withConnection` 供需要固定 session 的 migration 使用, 結束後同樣不可保留連線引用

不在連線層自動重試寫入、死鎖或未知 commit 結果, 呼叫端保留原 requestId 並依業務契約確認。業務版本、唯一性及 requestId 檢查仍須在同一交易與適當行鎖內完成, 後續 Repository 遷移另驗多人操作

`probe` 只查當前 schema、版本及字元集, TLS 模式再確認已加密；不讀業務資料或自動建立／更新資料表。DDL 另走明確的 migration, 不放進 HTTP 啟動流程

## 真實 MySQL 測試

使用自己專用的隔離庫與限庫帳號, 不使用正式庫、TT 庫或使用者的日常開發資料。連線測試只接受 `sp_guildmanager_<agent>_test`, migration 測試另用 `sp_guildmanager_<agent>_migrationtest` 空庫, schema 契約另用 `sp_guildmanager_<agent>_schematest` 空庫, Repository 業務測試另用 `sp_guildmanager_<agent>_repositorytest` 空庫, agent 使用自己的小寫識別。主機須為本機或明確的本機 Docker MySQL, 不從 DB 環境自動推測測試目標

將專用帳密填入忽略的 `.local/mysql-test.json`, 權限設為 0600。範例中的所有值皆為測試用途：

```json
{
  "purpose": "guildmanager-integration-test",
  "environment": {
    "NODE_ENV": "test",
    "DB_HOST": "127.0.0.1",
    "DB_PORT": "13306",
    "DB_DATABASE": "sp_guildmanager_codex_test",
    "DB_USERNAME": "example_test_user",
    "DB_PASSWORD": "replace-in-private-config",
    "DB_SSL_MODE": "disabled"
  }
}
```

```sh
GUILD_MYSQL_TEST_CONFIG=.local/mysql-test.json \
GUILD_MYSQL_MIGRATION_TEST_CONFIG=.local/mysql-migration-test.json \
GUILD_MYSQL_SCHEMA_TEST_CONFIG=.local/mysql-schema-test.json \
GUILD_MYSQL_REPOSITORY_TEST_CONFIG=.local/mysql-repository-test.json \
npm run test:mysql
```

第二個設定檔格式相同, purpose 改成 `guildmanager-migration-test`, DB_DATABASE 與帳密改用自己獨立的 migrationtest 庫。第三個 schema 設定 purpose 為 `guildmanager-schema-test`, 使用獨立 schematest 庫。第四個 Repository 設定 purpose 為 `guildmanager-repository-test`, 使用獨立 repositorytest 庫。migration、schema 與 Repository 測試都要求空庫, 有既有表就停止, 不重設或清空舊資料

此入口缺任一設定會失敗, 不會將全部 skip 當成 MySQL 通過。`npm test` 與 `npm run test:mysql` 都執行這套 MySQL 驗證, 沒有明確的隔離設定就失敗, 不回退 SQLite。額外指定 `GUILD_MYSQL_TEST_CA` 可測試共用 MySQL 的自簽伺服器憑證主機名稱不符時會被拒絕

連線測試僅建立帶隨機名稱的人造表, 在 finally 移除自己的測試表並關閉 pool；驗證中文／emoji、前導零、BIGINT、交易回滾、單連線 pool 釋放、跨系統庫拒絕及錯誤不洩密。這些是開發與連線驗證, 不代表所有產品功能或正式站已切換 MySQL

實作依據：[mysql2 Promise pool](https://sidorares.github.io/node-mysql2/docs/examples/connections/create-pool)、[TLS 設定](https://sidorares.github.io/node-mysql2/docs/documentation/ssl)

## 明確執行版本更新

使用獨立 migration 資格與私有設定檔：

```sh
node --env-file=.local/mysql-migration.env tools/migrate-mysql.js --status
node --env-file=.local/mysql-migration.env tools/migrate-mysql.js
```

部署已提供環境變數時可分別執行 `npm run db:status`、`npm run db:migrate`。前者只查 ledger 是否存在與版本紀錄, 空庫也不建立表、不取得 migration 鎖；後者在同一條專用連線持有依 schema 命名的 advisory lock, 套用完成才釋放, 不把鎖交回其他請求

版本清單在 `server/database/migrations.js`, 每個版本有固定 ID 與明確的 SQL statements。`schema_migrations` 保存內容 checksum、started／applied、已完成 statement 數與時間；完成版本重跑會跳過, 已套用內容變更、未知版本或不連續歷史會停止

MySQL 的 DDL 會隱含 commit, 不能假稱 rollback 可還原整批建表。因此先保存 started, 每個 statement 完成後記錄進度；中斷或失敗留下 started, 後續執行會以 `MIGRATION_INCOMPLETE` 停止。維護者須先檢查 ledger、實際 schema 與備份再處理, 工具不自動續跑、刪表或改 checksum

只有明確執行 `db:migrate` 才建立／改動表, HTTP 啟動與 `db:check` 不自動 migration。執行帳號無 DDL 權限會直接失敗, 不回退管理帳號或略過 migration

設計依據：[MySQL DDL 隱含 commit](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html)、[GET_LOCK 的連線生命週期](https://dev.mysql.com/doc/refman/8.4/en/locking-functions.html)

## 初始業務 schema

`0001_initial_schema` 明確建立 32 張業務表與必要索引, 使用 InnoDB／utf8mb4。僅寫入九個職業、三項固定職責及空平台設定, 不建立帳號、成員、活動、報名或戰績

- 文字 UID 及關聯保留字串與前導零, 外鍵實際建立並驗證；角色、所屬布林、版本、場序與影片至少一個網址等規則保留 CHECK
- 帳號名稱限定 ASCII 並不分大小寫。其他名稱與 ID 依原規則區分；有效外援的唯一鍵用 nullable binary generated column 保留 SQLite NOCASE 只折疊 ASCII 的語意, 取消外援不佔用有效名稱
- 同場已指定場序的戰績唯一, 未指定場序的舊戰績可多筆。舊影片完整 URL 用 SHA-256 generated key 參與唯一索引, 不以網址前綴去重
- 不可變 JSON 快照與 requestId 的輸入／結果使用 LONGTEXT＋JSON_VALID, 不採用會重新排列內容的原生 JSON 儲存。缺值仍為 NULL, 不以空字串或 0 補未知勝敗／數據
- 原查詢依 SQLite rowid 排序的帳號、職責、舊名、戰績與範本加 `created_order` 作明確插入次序。後續 Repository 使用明確欄位 INSERT, 不依賴實體列次序
- 過渡 schema 保留原始 CSV、舊圖片與品牌圖示欄位供既有 Node 契約對照；R2 階段會另設 metadata／關聯並驗證原始檔, 不表示最終正式架構將檔案內容存在 MySQL

schema 測試以固定的 MySQL 契約清單核對所有表／原欄位／外鍵, 執行時不建立或讀取 SQLite, 再用真 MySQL 驗有效／無效寫入、中文與 emoji、前導零、ASCII／Unicode 名稱差異、JSON 原文、nullable 場序、重跑與排序。測試只刪除自己在專用空庫建立的表

目前實測引擎為共用 MySQL 8.4, 不把它當作 Oracle MySQL 8.0.46 的 migration 實測。正式庫仍不自動建表或匯入, 後續部署前另核對目標引擎與發布資格

## 非同步 Repository

`server/mysql/repository.js` 的 `createMysqlRepository(database, { authNow })` 接受明確的 MySQL 連線工具, 所有公開方法均回傳 Promise。涵蓋名冊／預覽匯入、帳號與 session、活動／批次、報名／請假／外援、排表與範本、戰績／附件／成員關聯、UID 與舊名維護、平台設定及抽獎；保留原本輸入、結果與業務錯誤類別。建立 factory 不讀寫資料、不建表、不補種子；需先明確執行 migration

名冊以一次成員／職業 JOIN 加一次相關舊名查詢組裝, 單人成員只讀指定 UID 與其舊名, 均為兩次查詢；職業清單一次查詢。不做跨請求快取, 寫後重新查詢可讀最新已提交資料。BIGINT 版本、到期時間與計數按欄位轉成安全整數, UID 維持字串；超出安全範圍報錯

`store.js` 只封裝參數化的 MySQL 查詢與交易, SQL 已明確改成 MySQL 語法, 不在執行期翻譯 SQLite SQL。原本 rowid 順序改用 created_order, 歷史戰績玩家關聯改用 JSON_TABLE, nullable 欄位與 JSON 快照原文維持原契約。UID 修正／刪除透過關聯及投影覆蓋層保留歷史快照原文, 不重寫快照

### 交易與多人操作

migration `0002_repository_lock` 建立單列 `repository_write_lock`。業務寫入在同一條交易連線取得該列的 FOR UPDATE 鎖後, 才檢查最新 revision、唯一性與 requestId 並提交。跨領域操作及巢狀寫入共用同一交易, 失敗全數回滾。鎖列遺失會拒絕寫入, 不自動補建

這一階段保守維持原本共用寫入保護, 所有合作中的 Repository 寫入會互斥, 尚未按不同成員／場次拆鎖。不同人送出保留個人版本檢查, 同人或相依場次變更會回報衝突；相同 requestId 重送返回既有結果, 不覆蓋後來更新。此鎖協議要求同一 schema 的所有業務寫入者共同遵守, 不保護繞過 Repository 的管理 SQL

唯讀操作使用明確審核清單與 REPEATABLE READ／READ ONLY 快照, 不取得業務寫入鎖, 可在其他連線持寫入鎖時讀取已提交資料。getSession 因清除失效 session 仍屬寫入交易。密碼雜湊與 CSV 解析保留在最終寫入鎖外準備, 入鎖後重驗相依資料；資料庫層不自動重放失敗或結果不明的寫入

### 提交後通知

一般方法只回傳業務結果。需要發送通知的 API 呼叫端改用 `await repository.invoke(name, args)` 取得 `{ data, notifications }`, 只在成功提交後處理通知。每次操作透過 AsyncLocalStorage 保存自己的通知, 不提供跨請求共用的 takeNotifications 佇列；失敗交易不回傳通知。Repository 本身不發送 Webhook, API 接線須保留提交後發送與既有失敗處理

### 驗證邊界

Repository 測試將既有業務斷言改成 async MySQL 呼叫, 不改掉原本預期行為；另驗兩個獨立 Repository 的版本衝突、不同成員並行送出、相同 requestId 重送、持鎖時唯讀、故障注入回滾、通知隔離及重新建立 Repository 後的持久化。每個案例只在空的專用 repositorytest 庫建表及使用人造資料, finally 移除自己建立的表, 不初始化或驗證 SQLite

Repository 與 HTTP 路由的 await／錯誤處理及提交後通知分別由業務契約與 HTTP 測試驗證。GAS 編譯只驗封裝相容, 不代表 GAS RPC、正式站或 Oracle 已完成切換；Oracle 目標引擎與正式舊資料另行驗收

## MySQL 帳號與權限

`npm run account:create` 或 `docker compose exec -T api node server/create-account.js` 從 stdin 讀取帳號 JSON, 使用與 API 相同的明確 `DB_*` 設定與已完成的 migration, 不自動建表、不回退 SQLite、不覆寫同名帳號。第一個帳號預設 admin, 後續預設 manager；既有 SQLite 帳號未自動匯入

HTTP 權限回歸使用真實 MySQL 驗匿名／member／manager／admin, 涵蓋登入登出、cookie／session 輪替與到期、CSRF、角色與密碼變更撤銷、共用成員通行密碼、平行登入限流及 CLI 建帳號。授權範圍沿用 [成員契約](member-contracts.md) 與 [平台契約](platform-contracts.md), 不因換資料庫放寬

## HTTP API 接線

`server/index.js` 啟動時依環境變數建立 pool、`probe` 連線, 再以 `migrationStatus` 核對所有版本都是 applied；有 pending 或連線失敗就輸出固定代碼並結束, 不自動建表。`server/app.js` 全部路由 `await` Repository, 回應格式、狀態碼與錯誤 envelope 維持原契約；需要通知的寫入改走 `repository.invoke(name, args)`, 只在交易提交後把該次操作的通知交給 notifier, 失敗操作不送。`server/auth.js` 的 session 讀取、公開路徑判斷與撤銷同樣 `await`

Docker 的 API 服務加入共用 `side-project-environment` 網路, 沿用自己的 MySQL schema／帳號；需先啟動共用服務並明確套用 migration。遠端 TLS 連線可透過 `DB_SSL_CA_BASE64` 提供 CA, 不把主機私有檔案路徑直接傳入容器

HTTP 契約測試在 `tests/mysql-http/`, 由 `tests/mysql-http.test.js` 在同一程序依序載入, 使用與 Repository 測試相同的 repositorytest 空庫；不要直接把多個檔案交給 `node --test` 平行跑, 會在同一個 schema 互相干擾。目前覆蓋存取／登入／錯誤 envelope、活動、成員與匯入、報名、排表／職責／範本、戰績上傳／附件／刪除、平台設定／抽獎／影片；角色／session／CSRF 的回歸另見 `auth.test.js`, CLI 回歸見 `account-cli.test.js`；完整健康檢查與 Discord 投遞行為另由後續卡片補
