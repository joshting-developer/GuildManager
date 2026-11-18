# 正式環境

部署到 Fly.io 的步驟見 [Fly.io 部署](fly-deployment.md)

## 同源網站與 HTTPS

一般 `npm run build` 產生 `dist/`, Node 在 `NODE_ENV=production` 時同時提供前端靜態檔案及 `/api`。正式啟動使用 `node server/index.js`, 除既有 MySQL／R2 設定外, HTTP 設定名稱見 [範本](../config/http.env.example)。缺少 `dist/index.html` 或設定無效時拒絕啟動, 只記錄固定的 `HTTP_CONFIGURATION` 錯誤分類

- `APP_ORIGIN` 是瀏覽器使用的完整來源, 例如 `https://guild.example.test`, 包含非預設埠時須一併指定；不接受路徑、結尾斜線、帳密、query 或 hash。production 必須是 HTTPS, 不沿用本機 Origin 白名單
- HTTPS 由前置反向代理終止, 前端與 `/api` 經同一網站轉入 Node。Node 本身仍以 HTTP 監聽, 部署時應限制其只能由受信任入口存取；本設定不會建立憑證、DNS 或部署服務
- `TRUSTED_PROXY_CIDRS` 預設空白, 不信任任何代理標頭。需要依真實訪客 IP 限流時, 按實際拓樸填入可信代理 IP／CIDR, 多個以逗號分隔；不支援 `true` 或跳數。代理必須覆寫或正確追加實際來源 IP, 不可直接透傳訪客提供的標頭；不要用全網 CIDR。實際代理路徑與限流須在部署時驗收
- production 的登入及登出 Cookie 都使用 `Secure`、`HttpOnly`、`SameSite=Lax` 與 `Path=/api`, 不設定跨網域 Domain。登入維持 8 小時, 重新整理透過 `/api/auth/session` 恢復登入及 CSRF token
- 寫入 Origin 採精確比對, 不根據 Host 或轉送標頭自動放行；無 Origin 的 CLI 請求沿用既有契約, 仍須 JSON 與對應 Session／CSRF／角色驗證。未設定 `APP_ORIGIN` 的非 production 環境保留原本 localhost 開發來源
- 網址保留 `#/members` 等 hash 路由, `#/magament` 與 `#/management` 均可使用。未知 API 與缺少的靜態資源不會改回首頁 HTML

Dockerfile 預設產出 production 映像, Compose 明確使用 development target。實際代理、TLS 與 DNS 仍需另行配置及驗收。

## 正式 Docker 映像

預設映像以非 root 的 `node` 帳號直接執行 Express, 同一個 HTTP 埠提供 Vue 的 `dist/` 與 `/api`, 不啟動 Vite。開發仍使用[本機開發](development.md)的 Docker Compose 流程

```sh
docker build -t guild-manager:production .
docker build --target development -t guild-manager:development .
```

建置不需要 DB／R2 憑證。建置 context 採允許清單, 排除私人設定、資料與憑證；新增建置輸入時需同步檢查 `.dockerignore`。runtime 只包含 production dependencies、`package.json`、`dist/`、`server/` 與後端引用的 `src/domain/`, 不包含編譯工具或 dev dependencies

執行前在私有環境檔設定 [HTTP](../config/http.env.example)、[MySQL](../config/mysql.env.example) 與 [R2](../config/r2.env.example) 變數。秘密只於執行時注入, 不使用 build args 或 `VITE_*`。例如將設定保存在已忽略的 `.local/runtime.env`, CA 保存在 `.local/mysql-ca.pem`, 並設定 `DB_SSL_CA_FILE=/run/secrets/mysql-ca.pem`：

```sh
docker run -d --name guild-manager-production \
  --env-file .local/runtime.env \
  --mount type=bind,src="$(pwd)/.local/mysql-ca.pem",dst=/run/secrets/mysql-ca.pem,readonly \
  -p 127.0.0.1:3001:3001 \
  --stop-timeout 20 \
  guild-manager:production
```

- 預設 `API_HOST=0.0.0.0`、`API_PORT=3001`；若覆寫埠號, 同步調整 port mapping 與反向代理。映像 healthcheck 依實際 `API_PORT` 探測 `/api/health`, 逾時 2 秒；`/api/live` 僅驗程序存活, 兩者不驗 R2
- `APP_ORIGIN` 必須是精確 HTTPS origin, 外部 HTTPS 由可信反向代理提供；上例只綁本機 HTTP 埠供代理轉入。`TRUSTED_PROXY_CIDRS` 僅填實際可信入口, Docker 不會自動建立 HTTPS
- production 的 MySQL 必須使用 `DB_SSL_MODE=verify_identity`, 提供可信 CA 與符合憑證的 hostname；CA 掛載檔須可由容器的 `node` 使用者讀取。資料庫若位於其他 Docker 網路, 另指定對應 `--network` 與可驗證的 hostname
- 啟動前由具資格的獨立步驟套用 migration（見 MySQL 開發說明）, runtime 使用限庫 CRUD 帳號。啟動只核對連線及 migration, 不建表、不建帳號、不匯入資料
- 資料保存在外部 MySQL／R2, 正式映像不需要掛載資料 volume
- `docker stop --time 20 guild-manager-production` 直接傳送 `SIGTERM` 給 Node, 為服務的 10 秒關閉期限保留餘裕

建置成功不代表 production 啟動、真 R2 存取或實際 HTTPS 代理已通過驗收；各項需使用隔離資料與對應環境另驗

## R2 私有檔案服務

Node 後端的可注入檔案讀寫服務與隔離驗證見 [R2 私有檔案服務](r2-storage.md)。戰績原始 CSV／圖片與平台圖示的新寫入已改存 R2, MySQL 保存 metadata 與關聯；啟動 API 需要完整 R2 設定與 migration, 正式舊檔案尚未移轉。
