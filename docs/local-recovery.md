# 本地備份與還原

此工具只接受本機 MySQL 的 GM 開發／隔離庫及明確的 `sp_guildmanager_local_preview`, 不操作正式資料庫。使用限庫帳號, 不接受 root；憑證透過 stdin 傳入容器內的 MySQL client, 不放在命令列或輸出。需 Docker 與本機 MySQL 容器

設定放在 `.local/backup/mysql.json`, 權限 0600：

```json
{
  "purpose": "guildmanager-local-backup",
  "container": "your-mysql-container",
  "environment": {
    "DB_HOST": "127.0.0.1",
    "DB_PORT": "13306",
    "DB_DATABASE": "sp_guildmanager_local_dev",
    "DB_USERNAME": "example_local_user",
    "DB_PASSWORD": "replace-in-private-config",
    "DB_SSL_MODE": "disabled"
  }
}
```

```sh
python3 tools/backup-local.py backup --config .local/backup/mysql.json
python3 tools/backup-local.py restore --config .local/backup/restore.json --file .local/backups/mysql-snapshot.sql
```

備份以 `mysqldump --single-transaction` 取得 InnoDB 一致快照, 原始檔、SHA-256 manifest 與驗證副本只允許保存在 `.local/`, 新檔權限 0600, 不覆寫同名檔。維護期間不要同時執行 DDL migration。檔案包含私有資料及密碼雜湊, 不提交 Git 或放到公開 artifact

還原設定必須指定獨立的 `sp_guildmanager_<name>_restoretest` 庫（可加數字區分演練）, 工具先驗證 checksum 與空庫；既有表或日常庫一律拒絕。還原後重新 dump 並比對全部 DDL 與資料；只正規化 MySQL 重新列印的冗餘 `CHARACTER SET utf8mb4` 欄位宣告, 原本 collation 必須相同。失敗保留隔離目標供檢查, 不自動清庫或重試覆寫

macOS 可由私人 launchd plist 定時執行同一個 backup 命令；排程設定、來源連線、輸出及錯誤紀錄都留 `.local/backup/`。這只提供本機快照, 沒有自動刪除舊備份, 請依空間需求另行封存。正式備份的離機保存、保留政策、加密、排程與正式還原演練另行配置, 不以本地演練代替

## 私有物件的本地保護與復原

物件服務不假設具有可用的版本回溯。維護／移轉前, 依 MySQL `file_metadata` 明確列出要保護的 key 與 MIME 類型, 將這份清單與同一批 SQL 快照一起保存在私人備份位置；不要把僅依 metadata 找到的物件當成全部歷史／孤兒物件盤點。既有原始 CSV／共用圖片不隨戰績刪除立即刪除；staging 回收採保留期與現存引用保護, 詳見 [檔案服務](r2-storage.md)

物件工具只接受 `purpose: "guildmanager-r2-local-recovery"` 與名稱以 `-local` 結尾的測試 bucket, 設定格式沿用 R2 server-only environment。設定檔須在 `.local/` 且權限 0600

```sh
node tools/recover-local-object.js backup --config .local/backup/r2.json --key files/example/object --type text/csv --file .local/backups/object.json
node tools/recover-local-object.js restore --config .local/backup/r2.json --file .local/backups/object.json --receipt .local/backups/object-restore.json
```

快照保存原始 bytes、MIME、size、SHA-256 與來源 key, 新檔權限 0600。還原前驗證備份, 使用全新 key, 寫前先保存私人 receipt, 寫後讀回驗證；不覆寫來源物件、不自動修改 MySQL 關聯。若要接回網站, 需另行核對 SQL 快照與 receipt 的新舊 key 對應後再執行明確的關聯修復, 本工具不冒充整站自動災難復原

正式 bucket 的權限、刪除保護、離機備份、保留期與排程須在正式環境另行配置；本地復原驗證不能代表正式保護已啟用

安全測試：`python3 tests/backup-local.test.py`、`node --test tests/local-object-recovery.test.js`。真物件演練只使用專用測試 bucket 的隨機合成物件, 不刪除現有業務附件

## 本地網站檢查與錯誤追查

```sh
node tools/check-local-site.js http://localhost:5173
docker compose ps
docker compose logs --tail 50 api frontend
```

檢查只接受明確的 HTTP loopback origin, 分開確認首頁 HTML、前端 module、API 存活與 MySQL readiness。每個請求最多 3 秒, 回應讀取有大小上限；成功 exit 0, 任一失敗 exit 1, 只輸出固定檢查名稱、狀態與耗時, 不轉印回應內容或 provider 例外

Compose 的 API 透過 `/api/health` 驗資料庫, frontend 另有 HTTP healthcheck。macOS 的私人 launchd 設定可每 5 分鐘執行檢查並保存 `.local/monitor/site.jsonl`；這是本地狀態紀錄, 不會發送外部通知。正式站的外部探測、警報收件人、日誌保存及告警演練仍須在部署階段配置

安全測試另含 `node --test tests/local-site-check.test.js`, 確認資料庫故障時仍能辨識 API 存活, 且不輸出故障回應中的秘密
