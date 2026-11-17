# 私有檔案服務

Node 後端提供 `server/storage/r2.js` 的 `createR2Storage(environment)` 與 `server/services/private-files.js` 的 `createPrivateFileService({ storage, authorize })`。設定範本見 `config/r2.env.example`；只由後端明確傳入, 不使用 VITE 變數、不把憑證或供應商網址傳給前端。R2 透過 AWS SDK v3 存取, 參考 [Cloudflare 官方範例](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/)。

Node HTTP 的戰績 CSV、共用陣容圖片與平台圖示已接入 R2。新寫入的 MySQL 只保存 file_metadata（bucket、object key、原檔名、MIME、大小、SHA-256）與外鍵關聯；原始 CSV 內容欄位保留空字串、圖片與圖示內容欄位保存 NULL。既有 inline 資料仍可讀取, 不自動搬移正式舊資料。場次影片只有外部網址, 不屬於 R2 檔案上傳。

啟動 API 必須同時提供 MySQL 與 R2 設定, 並先明確執行包含 `0003_file_metadata` 的 migration；缺 R2 或 schema 未就緒就停止啟動。Compose 從忽略的 `.env` 轉交設定, 不自動建立 bucket 或回退把新檔案寫回 MySQL。

`server/services/file-backed-repository.js` 在組裝階段裝飾既有 Repository。戰績上傳先在短交易驗證內容與關聯、requestId, 釋放鎖後寫 R2, 再開交易重驗場次／版本／requestId 與授權, 同交易保存 metadata 和業務資料。已提交的重送直接回原結果, 不再寫物件。外部 I/O 不持有 MySQL 寫入鎖。

既有 API 格式保留：戰績附件走原本的下載路徑、no-store／nosniff／Content-Disposition；平台設定依原公開讀取規則回傳 data URL, bucket 仍為私有, 不公開物件網址。下載只讀單筆 metadata 與指定物件, 驗 bytes 與 SHA-256；不符回固定 STORAGE_UNAVAILABLE, 不回傳損壞內容。HTTP 上傳／下載仍先由既有登入／角色／CSRF 保護, 並在檔案上傳後的最終交易重驗 Session；下載結束重驗 Session 與戰績存在狀態。下載許可 member／manager／admin, 上傳限 manager／admin, 平台修改限 admin。

## 保存與復原範圍

兩場戰績共用 upload 圖片, 刪除單場只移除該場及既有關聯, 不刪仍可能被另一場或重送紀錄引用的 R2 物件。替換／移除平台圖示會更換或清除關聯, 舊 metadata／物件先保留。

目前不自動回收上傳成功但 finalize 失敗的物件, 也不重試未知寫入結果；並行相同 requestId 可能產生未引用物件, 最終仍只保存一份業務紀錄。完整 staging ledger、失敗補償、孤兒清理與保留政策留後續復原階段, 不能把本階段當成跨 MySQL／R2 原子交易。不得靠刪除整個 bucket 或清空 metadata 回收物件。

## 呼叫與授權契約

Service 的 `upload(sessionToken, resourceId, bytes)`、`download(sessionToken, resourceId)`、`remove(sessionToken, resourceId)` 每次都先呼叫 `authorize({ sessionToken, resourceId, operation })`。此 callback 必須讀取目前有效 session, 按既有角色與資源關聯重驗權限, 並由可信 metadata 回傳 `{ key, name, mimeType }`；找不到或無權限回傳 null。不可以直接採信瀏覽器的角色、key、檔名或 MIME。

沒有 authorize callback 無法建立 Service；回傳 null 會以 `FILE_ACCESS_DENIED`／403 拒絕且不執行儲存 I/O。此獨立 Service 供需要自行按資源查權限的內部呼叫端使用；現有 HTTP 接線由 file-backed Repository 與可信 assertAccess callback 負責, 不接受瀏覽器提供 callback 或 descriptor。既有統一錯誤 handler 已映射 FileStorageError, 不新增任意 key 的檔案端點。

`upload` 回傳 `{ size, sha256 }`, `download` 回傳 `{ name, mimeType, bytes }`, `remove` 無回傳資料。儲存層限 `files/<分類>/<識別碼>` 形式的安全 key, 禁止路徑跳脫、query、URL 與特殊字元。Service 不會建立或提交 MySQL metadata, 也不提供 requestId 重播或失敗補償；呼叫端須使用不可覆寫的唯一 key 並處理未知上傳結果, 不盲目產生新請求重試。

## 有界存取與錯誤

- 僅接受 HTTPS 的 Cloudflare 全球 R2 S3 根端點, bucket 與憑證必填；TLS 使用 SDK 預設驗證, 不提供停用開關
- 單次操作預設期限 15 秒、連線 3 秒, SDK maxAttempts=1, 不自動重試寫入
- CSV 最多 1 MB, PNG／JPEG／WebP 最多 4 MB；Service 驗圖片簽章, CSV 語意仍由既有 domain parser 驗證
- 下載檢查 ContentLength 與實際串流長度, 超限、截斷或逾時會終止串流；不列 bucket、不預載其他檔案、沒有跨請求快取
- `STORAGE_UNAVAILABLE`／503 代表外部儲存失敗, `FILE_NOT_FOUND`／404 代表讀取物件不存在, `INVALID_FILE`／422 代表內容或描述不合法。錯誤不包含原始 SDK 訊息、key、endpoint 或秘密
- 下載只回傳經 metadata 指定的 MIME, 不使用供應商回傳的 ContentType 建立信任

正常停機時由組裝端在檔案工作結束後呼叫 storage.close()。不得開啟公開 bucket、建立 presigned URL 或讓瀏覽器直接接觸 R2 憑證。

## 驗證

`node --test tests/private-files.test.js` 驗證本地安全邊界與故障情境。真 R2 測試使用明確設定的私有 JSON, 不回退應用程式環境：

```json
{
  "purpose": "guildmanager-r2-test",
  "environment": {
    "R2_ENDPOINT": "https://00000000000000000000000000000000.r2.cloudflarestorage.com",
    "R2_BUCKET": "example-local",
    "R2_ACCESS_KEY_ID": "",
    "R2_SECRET_ACCESS_KEY": ""
  }
}
```

```sh
GUILD_R2_TEST_CONFIG=/path/to/private-r2-test.json node --test tests/r2-integration.test.js
```

真 R2 測試只接受 `-local` bucket, 使用隨機 UUID 合成檔案, finally 僅清理此次物件並驗證不存在。此獨立服務測試的 callback 是授權替身；`tests/mysql-http/file-metadata.test.js` 另透過真 MySQL 與既有 HTTP 路徑驗 metadata／原始檔關聯, 提供同一 R2 設定時也實際驗 R2 讀寫, 並清理此次隨機物件。多個 MySQL 測試檔案須在單一程序載入或使用 `--test-concurrency=1`, 不同程序不可平行共用 schema。匿名檢查僅證明 S3 端點拒絕讀取, 不代替 Console 所有公開網域審查。`npm test` 也包含上述測試, 未提供 R2 專用設定時真 R2 案例會略過, 不視為外部服務通過。
