# MySQL 開發與隔離驗證

2.0.0 將 Node 後端資料來源改為 MySQL, 保留現有功能與 API。現在已加入 mysql2 連線與交易工具, HTTP 服務仍走原本的 SQLite Repository；後續完成資料表、Repository 與非同步 API 後才切換。GAS 舊來源在正式資料移轉與驗收前保留

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

使用自己專用的隔離庫與限庫帳號, 不使用正式庫、TT 庫或使用者的日常開發資料。連線測試只接受 `sp_guildmanager_<agent>_test`, migration 測試另用 `sp_guildmanager_<agent>_migrationtest` 空庫, schema 契約另用 `sp_guildmanager_<agent>_schematest` 空庫, agent 使用自己的小寫識別。主機須為本機或明確的本機 Docker MySQL, 不從 DB 環境自動推測測試目標

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
npm run test:mysql
```

第二個設定檔格式相同, purpose 改成 `guildmanager-migration-test`, DB_DATABASE 與帳密改用自己獨立的 migrationtest 庫。第三個 schema 設定 purpose 為 `guildmanager-schema-test`, 使用獨立 schematest 庫。migration 與 schema 測試都要求空庫, 有既有表就停止, 不重設或清空舊資料

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

## 非同步名冊讀取（GM-5 進行中）

MySQL 名冊 Repository 已提供職業清單、完整名冊與單人成員讀取。名冊以成員與職業 JOIN 加一次相關舊名查詢組裝, 不逐人成員查詢；單人查詢只讀指定 UID。名冊與詳情使用 REPEATABLE READ 的唯讀快照, 不取得業務寫入鎖, 不做跨請求快取；保留文字 UID、明確舊名排序與安全整數 revision

這是 GM-5 的讀取階段, 尚未包含寫入、其他領域 Repository 或 API 接線。npm test 目前只執行 MySQL 測試, schema 契約從 tests/fixtures/mysql-schema-contract.json 讀取, 不再建立或開啟 SQLite
