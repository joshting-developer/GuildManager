# 本機開發

## 使用 Docker 開發

2.0.0 的 MySQL 連線設定與隔離測試見 [MySQL 開發說明](mysql-development.md), 後端分層與寫法見 [Node.js 分層規範](nodejs-architecture.md), 其參考的上游 Skill 是 wshobson/agents 的 nodejs-backend-patterns, 只作開發參考, 不是執行依賴。HTTP 服務已改接 MySQL, `npm run server` 需要 MySQL 開發說明中的連線環境變數與已套用的 migration

需要 Docker Engine 與 Docker Compose v2, 先依 [MySQL 開發說明](mysql-development.md) 啟動本機 MySQL、提供專用連線設定並套用 migration

```sh
docker compose up --build -d
```

開啟 [首頁](http://localhost:5173)、[成員清單](http://localhost:5173/#/members) 、[活動安排](http://localhost:5173/#/events) 或 [戰場排表](http://localhost:5173/#/lineups), 前端支援熱更新, API 使用 Node watch

原首頁總覽改為 [管理總覽](http://localhost:5173/#/magament), `magament` 沿用既有拼字, 也接受 `#/management`。未登入時直接開管理網址會回到首頁並開啟登入視窗；網址使用 hash 供同源網站導覽。

- API／MySQL 就緒檢查：`http://localhost:3001/api/health`（成功 200, 無法連線或逾時 503）
- API 存活檢查：`http://localhost:3001/api/live`（不讀資料庫）
- 成員資料：`http://localhost:3001/api/members`
- 活動安排：`http://localhost:3001/api/events`
- 戰場排表：`http://localhost:3001/api/lineups`
- 職責清單：`http://localhost:3001/api/duties`
- 職業清單：`http://localhost:3001/api/professions`
- API 服務由 compose.yaml 旁的 `.env`（忽略檔, 變數名稱依 `config/mysql.env.example`）取得 MySQL 連線, 預設指向本機 Docker 網路的 `side-project-mysql`
- 本機資料庫啟動時不自動加入示範資料, 重啟不覆寫既有設定
- `src/` 與 `server/` 修改會反映至服務, 依賴或 Dockerfile 變更後重新執行 `docker compose up --build -d`
- 若 Docker Desktop 的檔案事件通知不穩定, 再依需要開啟 polling

查看狀態與停止服務：

```sh
docker compose ps
docker compose logs --tail 50
docker compose down
```

`down` 保留資料 volume, 加上 `-v` 會刪除資料, 不作為一般停止方式

## 本機登入

帳號建立工具寫入明確設定的 MySQL, 啟動前須先套用 migration, 不會自動建表

首頁右上「登入」使用本機帳號密碼, 登入後顯示帳號、登出及管理導覽。登入維持 8 小時, 重新整理仍保留；登出立即撤銷伺服器 session。管理操作未儲存時沿用離開確認。

MySQL 開發環境套用 migration 後可建立自己的帳號, 隨機密碼會存到被 Git 忽略的 `data/local-admin.json`：

```sh
node --input-type=module -e 'import {mkdirSync,writeFileSync} from "node:fs"; import {randomBytes} from "node:crypto"; mkdirSync("data",{recursive:true}); writeFileSync("data/local-admin.json",JSON.stringify({username:"admin",password:randomBytes(24).toString("base64url")},null,2)+"\n",{mode:0o600,flag:"wx"});'
docker compose exec -T api node server/create-account.js < data/local-admin.json
```

工具從 stdin 讀取帳號 JSON, 帳號為 3–32 個英數字／底線／點／減號, 密碼 6–128 字元。既有帳號拒絕覆寫；其他 manager 可由帳號管理頁建立, CLI 仍可新增帳號。直接使用 Node API 的環境改用 `npm run account:create < data/local-admin.json`, 需提供與 API 相同的 MySQL 連線環境變數。

- `auth_accounts` 保存 scrypt 密碼雜湊與獨立 salt, 不保存明文密碼
- `auth_sessions` 保存 session token 的 SHA-256 雜湊及到期時間；瀏覽器使用 HttpOnly／SameSite=Lax cookie, 不使用 localStorage 保存登入憑證
- 管理資料讀取須有 session, 管理修改另須 `X-CSRF-Token`；前端 adapter 自動附加, API 的 Origin／JSON 檢查仍保留
- 登入失敗訊息不區分帳號不存在或密碼錯誤, 同一來源 5 分鐘最多 10 次嘗試
- admin 與 manager 均可使用既有管理功能；只有 admin 可開啟 `#/admin` 管理帳號。第一個 CLI 帳號預設 admin, 後續預設 manager, 沒有公開註冊。舊帳號升級時優先將名稱 admin（不分大小寫）設為 admin, 否則選最早建立者, 其他設為 manager, 不重設密碼。
- 所有行事曆場次公開，約戰／幫戰／龍虎戰可匿名報名、請假、選人及上傳影片；有效登入寫入仍須 CSRF。舊 /api/calendar/members 及完整名冊仍須登入，帳號不綁遊戲 UID。

| 方法 | 路徑 | 用途 |
| --- | --- | --- |
| GET | `/api/auth/session` | 查詢登入狀態；匿名回傳 user=null |
| POST | `/api/auth/login` | 帳號密碼登入, 設定 session cookie |
| POST | `/api/auth/logout` | 驗證 session／CSRF 後登出 |
| GET | `/api/calendar/members` | 登入後的舊 UID／名稱選單（不在畫面顯示 UID） |

本機 cookie 使用 HTTP loopback；正式 Node 網站使用 HTTPS、`NODE_ENV=production` 與明確的 `APP_ORIGIN`, 設定方式見[正式環境](production-environment.md)。

v2 的初始管理員與歷史操作者歸屬見 [帳號契約](platform-contracts.md#v2-初始管理員與歷史操作者)。部署初始化使用 `admin` 與私人 bootstrap 檔案, 不沿用舊站管理帳號。先確認目標資料庫與 migration, 再執行：

```sh
node --env-file=.local/runtime.env server/create-account.js < .local/deployment/bootstrap-admin.json
```

`bootstrap-admin.json` 包含 `username`、`password` 與 `role: "admin"`, 權限設為 0600。此指令只建立不存在的帳號, 不放進每次啟動或自動重設密碼流程；實際秘密不提交 Git

## 建立示範成員

啟動本機 API 並建立登入帳號後, 在專案目錄手動執行；指令讀取 `data/local-admin.json` 登入, 結束時登出, 可用 `LOGIN_CREDENTIALS_PATH` 指定其他私有設定檔：

```sh
npm run seed:demo
```

透過 `http://127.0.0.1:3001/api` 新增 100 位示範成員：80 位同時在幫派與俱樂部、20 位只在俱樂部, 因此示範俱樂部成員合計 100 位。主、副職業循環分配九種職業, 名稱含「示範資料」, UID 為 `DEMO-GUILD-001`～`080` 與 `DEMO-CLUB-001`～`020`。既有成員另計。

重複執行會跳過已存在的 UID, 保留既有資料及後續編輯；中斷後可重試。此指令只操作上述本機 API。成員清單搜尋「示範資料」即可單獨查看與篩選這批人員。

## 不使用 Docker

需要 Node.js 22.12 以上, 目前以 Node 22 驗證

```sh
npm ci
npm run server
```

另開一個終端：

```sh
npm run dev
```

首頁仍在 `http://localhost:5173`, API 使用明確提供的 MySQL 連線設定與已套用的 migration

API 可透過 `DB_*`、`API_PORT`、`API_HOST` 設定；Discord 通知見[功能說明](product-features.md#discord-通知)

## 驗證與編譯

```sh
npm test
npm run build
```

- `npm test`：需指定四個隔離 MySQL 設定檔（見 [MySQL 開發說明](mysql-development.md)）, 使用 Node.js 內建 `node:test` 驗證 MySQL 保存、成員 CRUD、歷史交易回滾、職業擴充、舊欄位遷移、活動日期規則、排表資格／唯一 UID／不可變快照／範本、版本與重複提交、API 與 adapter 錯誤處理
- `npm run build`：一般本機前端 build, 輸出到 `dist/`
- 編譯產物不納入 Git, 原始碼與 lockfile 納入 Git

目前桌面／手機的瀏覽器驗證使用 Playwright 操作 Chrome，開啟編譯後前端並使用隔離示範資料。這些驗證腳本目前放在臨時目錄，未納入專案的可重跑套件，`npm test` 不包含瀏覽器測試，也沒有正式的 Playwright 設定或圖片比對測試。

本機效能量測與重跑方式見 [效能開發說明](performance-development.md)；本地備份／還原及健康檢查見 [復原說明](local-recovery.md), 自動測試與建置見 [CI 說明](ci.md)

## 更新紀錄與定版

更新紀錄由 `src/content/release-notes.json` 靜態編譯進網站，線上不讀 GitHub。開發期間把變更累積在唯一置頂的 `version: "Unreleased"`、`date: null` 條目，頁面及頁尾顯示「未發布」；package／lockfile 保持最近正式版本。

正式定版與發布分開執行；只有明確要求定版時才更新版本及日期。

## 專案結構

```text
src/              Vue 首頁、成員清單、活動安排、戰場排表、共用樣式與前端資料 adapter
server/           Express 入口與 MySQL repository（server/mysql）
tools/            MySQL、資料維護與文件工具
tests/            資料與 adapter 測試
```

產品與工程契約見 [工程綁定入口](project-engineering-bindings.md), 視覺規範見 [Style.md](../Style.md), 切換限制見 [Architecture.md](../Architecture.md)
