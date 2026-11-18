# 本機效能量測

使用合成資料與本機 MySQL 的專用空測試庫, 不連日常或正式資料。`tests/helpers/mysql-repository.js` 會驗證測試用途、loopback 主機與資料庫名稱, 空庫檢查未通過就停止；成功取得測試庫後會清掉自己建立的資料表

```sh
CHROME_PATH=/path/to/chrome \
GUILD_MYSQL_REPOSITORY_TEST_CONFIG=.local/mysql-repository-test.json node tools/benchmark-local.js
```

量測 20／100／500 位成員與相同數量的歷史戰績, 每筆戰績 120 位玩家。各端點暖機一次後連續執行 100 次, 記錄 HTTP p50／p95／p99、回應 bytes、SQL 次數、SQL 累計時間與回傳列數, 並記錄 Node event loop delay 與硬體條件

結果只包含測試路徑與合成資料統計, 保存在忽略的 `.local/benchmarks/latest.json`。比較前後須先保存結果, 使用同一台機器、相同資料量與樣本數。SQL 累計時間包含本機網路往返, 不等於伺服器 execution plan 時間；此工具未啟用 MySQL 全域慢查詢日誌, 不改 MySQL 服務設定

這是單程序本地 lab, 使用記憶體物件儲存替身, 不代表正式 MySQL 網路延遲、真 R2 傳輸、正式使用者 Core Web Vitals 或多人壓測。瀏覽器與真 R2 整合另行驗證, 不用 API 數字冒充畫面效能

需要先執行 `npm run build`, 並以 `CHROME_PATH` 指定已安裝的 Chrome。工具另開 loopback 網站, 只在此合成服務代理注入測試登入, 觀察首頁 LCP／CLS、資源 bytes、TTFB 與點選成員清單的 Event Timing 最大值；這個互動觀察值不是正式 INP。各資料量重新開 Chrome 使用冷瀏覽器 profile, 不套用日常帳號或個人瀏覽器設定
