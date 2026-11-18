# Fly.io 部署

公開 repository 只保留 `fly.toml.example` 和 Dockerfile。真正的 App 名稱、資料庫位址與網址放在被忽略的 `fly.toml`, 秘密用 Fly Secrets, 不放 TOML、build args 或 Git

## 首次設定

1. 複製 `fly.toml.example` 為 `fly.toml`, 填入 App、HTTPS 網址（`APP_ORIGIN`）、MySQL 位址／資料庫與 R2 bucket。映像使用 Dockerfile 的 `runtime` target, Node 同一個 3001 埠提供前端與 `/api`
2. 用 Fly Secrets 設定 `DB_USERNAME`、`DB_PASSWORD`、`DB_SSL_CA_BASE64`、`R2_ENDPOINT`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`。從 stdin 匯入, 不把值放在指令參數：`flyctl secrets import --stage -a <app> < 私人檔案`
3. App 的 DB 帳號只給 runtime（限本 schema 的 DML）, migration 帳號不放進 App。部署前用 migration 帳號在受信任的機器執行 `npm run db:migrate`, 再依 [本機開發](development.md#本機登入) 用 bootstrap 檔建立 admin
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

## GitHub Actions 發布與回退

`Verify` 會跑隔離 MySQL 測試與 build；`Deploy` 共用相同驗證, 全部通過後才進入 `fly` Environment。部署只有手動 `workflow_dispatch` 或推送 `v*` Tag 會觸發, 一般 branch push 不發布。建立版本 Tag 前先完成版本確認, 不以部署流程自動修改版本或建立 Tag

在 GitHub 的 `fly` Environment 設定 `FLY_DEPLOY_CONFIG`（私人 `fly.toml` 全文）及 `FLY_API_TOKEN`（限該 App 的 deploy token, 設合理期限並定期輪替）。依團隊發布權限設定 Environment 的核准人與允許分支／Tag；不要將部署 Secrets 提供給一般測試 job

發布使用通過測試的 commit 建置, 映像標籤為 `git-<完整 commit SHA>`。私人設定只在部署 job 以 0600 暫存檔還原, Fly 原始輸出不進公開 log 或 artifact, 結束清除。失敗時到受限的 Fly 控制台查 Machine 與應用日誌。部署不自動執行 migration、初始化帳號或匯入資料, 有 schema 變動時先另行備份與驗證相容性

回退時手動執行 `Deploy`, 在 `image` 填入該 App 已驗證的 `registry.fly.io/<app>@sha256:<digest>`。不接受其他 App、可變標籤或任意命令。先從私人發布紀錄取得前一映像 digest, 確認與目前 schema 相容；回退映像不還原資料庫。首次部署沒有前一版本時不能宣稱回退演練已完成

流程檔須先推送到 GitHub 才能執行。首次導入時, 尚未註冊的 workflow 可能使手動派送回 404；先用已核准的預發布驗收 Tag 觸發一次, 確認 `gh workflow list` 已列出 Deploy 後, 可用 `gh workflow run deploy.yml --ref <branch>` 指定分支執行, 回退另加 `-f image=<同一 App 的映像 digest>`。網頁手動入口以預設分支的流程為準, 不必為首次驗收提前合併產品分支或打正式版本 Tag。runner 通過、Fly health 成功與實際 HTTPS／登入／休眠驗收分開記錄, 本機測試不能取代 runner 或部署結果
