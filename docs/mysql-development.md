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

`createMysqlDatabase` 提供 `query`、`transaction`、`probe`、`close`。交易 callback 取得專用 connection, 每個查詢都需 await；成功 commit, 失敗 rollback 並釋放。rollback 失敗則丟棄連線, 已結束的交易不能繼續使用

不在連線層自動重試寫入、死鎖或未知 commit 結果, 呼叫端保留原 requestId 並依業務契約確認。業務版本、唯一性及 requestId 檢查仍須在同一交易與適當行鎖內完成, 後續 Repository 遷移另驗多人操作

`probe` 只查當前 schema、版本及字元集, TLS 模式再確認已加密；不讀業務資料或自動建立／更新資料表。DDL 另走明確的 migration, 不放進 HTTP 啟動流程

## 真實 MySQL 測試

使用自己專用的隔離庫與限庫帳號, 不使用正式庫、TT 庫或使用者的日常開發資料。測試目前只接受共用環境建立的 `sp_guildmanager_codex_test`／`sp_guildmanager_claude_test`, 不從 DB 環境自動推測測試目標

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
GUILD_MYSQL_TEST_CONFIG=.local/mysql-test.json npm run test:mysql
```

此入口缺設定會失敗, 不會將全部 skip 當成 MySQL 通過。一般 `npm test` 仍可跑原 SQLite／GAS 與純函式回歸, 沒有明確測試設定時略過真 MySQL 案例。額外指定 `GUILD_MYSQL_TEST_CA` 可測試共用 MySQL 的自簽伺服器憑證主機名稱不符時會被拒絕

連線測試僅建立帶隨機名稱的人造表, 在 finally 移除自己的測試表並關閉 pool；驗證中文／emoji、前導零、BIGINT、交易回滾、單連線 pool 釋放、跨系統庫拒絕及錯誤不洩密。這些是開發與連線驗證, 不代表所有產品功能或正式站已切換 MySQL

實作依據：[mysql2 Promise pool](https://sidorares.github.io/node-mysql2/docs/examples/connections/create-pool)、[TLS 設定](https://sidorares.github.io/node-mysql2/docs/documentation/ssl)
