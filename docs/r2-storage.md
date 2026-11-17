# 私有檔案服務

Node 後端提供 `server/storage/r2.js` 的 `createR2Storage(environment)` 與 `server/services/private-files.js` 的 `createPrivateFileService({ storage, authorize })`。設定範本見 `config/r2.env.example`；只由後端明確傳入, 不使用 VITE 變數、不把憑證或供應商網址傳給前端。R2 透過 AWS SDK v3 存取, 參考 [Cloudflare 官方範例](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/)。

本階段完成可注入的基礎服務, 尚未接入現有戰績／平台圖示的 HTTP 路由與 MySQL metadata。現有功能仍使用原保存方式, 不因服務存在就視為已移轉。後續接線必須保留原 API DTO、登入／角色／CSRF、revision 與 requestId 規則, 不新增讓瀏覽器提交任意 object key 的入口。

## 呼叫與授權契約

Service 的 `upload(sessionToken, resourceId, bytes)`、`download(sessionToken, resourceId)`、`remove(sessionToken, resourceId)` 每次都先呼叫 `authorize({ sessionToken, resourceId, operation })`。此 callback 必須讀取目前有效 session, 按既有角色與資源關聯重驗權限, 並由可信 metadata 回傳 `{ key, name, mimeType }`；找不到或無權限回傳 null。不可以直接採信瀏覽器的角色、key、檔名或 MIME。

沒有 authorize callback 無法建立 Service；回傳 null 會以 `FILE_ACCESS_DENIED`／403 拒絕且不執行儲存 I/O。callback 的權限查詢與資源描述屬後續 metadata 接線的責任, 本階段沒有新增公開檔案 API。HTTP 接線時須在既有統一錯誤 handler 映射檔案錯誤, 並維持私有 no-store、nosniff 與安全的下載檔名。

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

真 R2 測試只接受 `-local` bucket, 使用隨機 UUID 合成檔案, finally 僅清理此次物件並驗證不存在。測試 callback 是授權替身, 不代表實際 HTTP／MySQL metadata 權限接線已通過。匿名檢查僅證明 S3 端點拒絕讀取, 不代替 Console 所有公開網域審查。`npm test` 也包含上述測試, 未提供 R2 專用設定時真 R2 案例會略過, 不視為外部服務通過。
