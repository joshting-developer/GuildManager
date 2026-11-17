# Fly.io 部署

公開 repository 只保留 `fly.toml.example` 和 Dockerfile。真正的 App 名稱、資料庫位址與網址放在被忽略的 `fly.toml`, 秘密用 Fly Secrets, 不放 TOML、build args 或 Git

## 首次設定

1. 複製 `fly.toml.example` 為 `fly.toml`, 填入 App、HTTPS 網址（`APP_ORIGIN`）、MySQL 位址／資料庫與 R2 bucket。映像使用 Dockerfile 的 `runtime` target, Node 同一個 3001 埠提供前端與 `/api`
2. 用 Fly Secrets 設定 `DB_USERNAME`、`DB_PASSWORD`、`DB_SSL_CA_BASE64`、`R2_ENDPOINT`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`。從 stdin 匯入, 不把值放在指令參數：`flyctl secrets import --stage -a <app> < 私人檔案`
3. App 的 DB 帳號只給 runtime（限本 schema 的 DML）, migration 帳號不放進 App。部署前用 migration 帳號在受信任的機器執行 `npm run db:migrate`, 再依 [README](../README.md#本機登入) 用 bootstrap 檔建立 admin
4. `flyctl deploy --config fly.toml -a <app> --ha=false`

## 設定說明

- `auto_stop_machines = "stop"`、`min_machines_running = 0`：GM 使用頻率低, 閒置時停機, 有請求時自動喚醒。健康檢查打 `/api/health`（會檢查 MySQL）, `/api/live` 只確認程序還活著
- MySQL 一律 `verify_identity`, CA 放在 `DB_SSL_CA_BASE64`。不關 TLS, 也不設定 `NODE_TLS_REJECT_UNAUTHORIZED=0`
- `APP_ORIGIN` 只接受一個來源。換成正式網域時要一起改, 改完舊的 `*.fly.dev` 網址就不能登入或寫入
- `TRUSTED_PROXY_CIDRS` 要包含 Fly Proxy 連進機器的位址（實測是 `172.16.0.0/16`）, 以及 `flyctl ips list` 列出的 App 公開 IP。Fly 的 `X-Forwarded-For` 最右邊是 App 自己的 IP, 只信任 Proxy 的話, 所有訪客會被當成同一個 IP 一起限流。重新配置 IP 後要同步更新

## 驗收

- `/api/live`、`/api/health` 200, 首頁與編譯資源可開, HTTP 會轉 HTTPS
- admin 登入後 Cookie 有 `Secure`、`HttpOnly`、`SameSite=Lax`, 登出後 Session 失效, 錯誤 Origin 的登入回 403
- 同一個 IP 連續登入失敗會被限流（429）, 偽造的 `X-Forwarded-For` 繞不過, 不同 IP 不受影響
- 閒置後機器變成 stopped, 下一個請求會自動喚醒

回退使用已驗證、相容目前 schema 的舊映像（`flyctl releases`／`flyctl deploy --image`）。映像回退不會還原資料庫
