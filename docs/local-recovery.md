# 本地備份與還原

此工具只接受共用 MySQL 的 GM 開發／隔離庫, 不操作正式資料庫。使用限庫帳號, 不接受 root；憑證透過 stdin 傳入容器內的 MySQL client, 不放在命令列或輸出。需 Docker 與共用 MySQL 容器

設定放在 `.local/backup/mysql.json`, 權限 0600：

```json
{
  "purpose": "guildmanager-local-backup",
  "container": "side-project-environment-mysql-1",
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

還原設定必須指定獨立的 `sp_guildmanager_<agent>_restoretest` 庫（可加數字區分演練）, 工具先驗證 checksum 與空庫；既有表或日常庫一律拒絕。還原後重新 dump 並比對全部 DDL 與資料；只正規化 MySQL 重新列印的冗餘 `CHARACTER SET utf8mb4` 欄位宣告, 原本 collation 必須相同。失敗保留隔離目標供檢查, 不自動清庫或重試覆寫

macOS 可由私人 launchd plist 定時執行同一個 backup 命令；排程設定、來源連線、輸出及錯誤紀錄都留 `.local/backup/`。這只提供本機快照, 沒有自動刪除舊備份, 請依空間需求另行封存。正式備份的離機保存、保留政策、加密、排程與正式還原演練另行配置, 不以本地演練代替
