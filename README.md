# 逆水寒 · 幫會管理平台

Vue 3／Vuetify 首頁, 本機透過 Node.js／Express API 讀取 SQLite, 後期接入 GAS／Google 試算表

首頁未完成的統計、活動與公告顯示「待開發」, 不呈現示範數字；成員管理正在實作, 登入與正式試算表尚未串接

## 使用 Docker 開發

需要 Docker Engine 與 Docker Compose v2

```sh
docker compose up --build -d
```

開啟 [首頁](http://localhost:5173), 前端支援熱更新, API 使用 Node watch

- API 健康檢查：`http://localhost:3001/api/health`
- 首頁資料：`http://localhost:3001/api/home`
- SQLite 保存在 `guild_data` volume 的 `/data/guildmanager.sqlite`
- 本機資料庫不再加入示範資料, 重啟不覆寫既有設定
- `src/` 與 `server/` 修改會反映至服務, 依賴或 Dockerfile 變更後重新執行 `docker compose up --build -d`
- 若 Docker Desktop 的檔案事件通知不穩定, 再依需要開啟 polling

查看狀態與停止服務：

```sh
docker compose ps
docker compose logs --tail 50
docker compose down
```

`down` 保留資料 volume, 加上 `-v` 會刪除資料, 不作為一般停止方式

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

首頁仍在 `http://localhost:5173`, SQLite 位於 `data/guildmanager.sqlite`

API 可透過 `DATABASE_PATH`、`API_PORT`、`API_HOST` 設定

## 驗證與編譯

```sh
npm test
npm run build
npm run build:gas
```

- `npm test`：SQLite 保存、空資料、API 契約與 adapter 錯誤處理
- `npm run build`：一般本機前端 build, 輸出到 `dist/`
- `npm run build:gas`：GAS 模式, 輸出單一前端 `build/gas/Index.html`, 以及 `Code.gs` 和 `appsscript.json`
- GAS 打包指令會檢查是否仍有外部 JS／CSS 檔案或多餘輸出
- 編譯產物不納入 Git, 原始碼與 lockfile 納入 Git

## GAS 匯入方式

1. 執行 `npm run build:gas`
2. 在 Apps Script 專案建立 HTML 檔案 `Index`, 貼上 `build/gas/Index.html` 內容
3. 將 `build/gas/Code.gs` 與 manifest 匯入專案
4. 依目標登入與權限方案完成 `getHomeData()` 及試算表 repository
5. 使用 Apps Script 測試部署驗證後, 再決定正式部署身分與存取對象

目前 GAS 後端只提供頁面入口, `getHomeData()` 會明確回報尚未串接, 不會讀寫正式試算表或回傳假的成功資料

## 資料介面

`src/api/home.js` 的 `getHomeData()` 是前端唯一的首頁資料入口

- 本機模式：HTTP `GET /api/home`
- GAS 模式：`google.script.run.getHomeData()`, 包裝成 Promise
- 編譯設定：`.env.gas` 的 `VITE_DATA_SOURCE=gas`, 不放任何憑證
- 兩端回傳相同格式, `meta.mode` 使用 `demo`、`empty` 或後續正式資料的 `live`

```json
{
  "guild": { "name": "你的幫會" },
  "summary": {
    "members": null,
    "upcomingEvents": null,
    "attendanceRate": null,
    "pendingRegistrations": null
  },
  "events": [],
  "announcements": [],
  "meta": { "mode": "empty", "updatedAt": "ISO 8601 日期字串" }
}
```

日期傳 ISO 8601 字串, 畫面以台北時區顯示；沒有出勤統計時使用 `null`, 不用 `0` 代替未知值

既有 `home_settings`、`events`、`announcements` 表保留, 舊示範資料不再讀取至首頁, 不刪除整個資料庫

本機服務目前提供首頁待開發資料的 API, 只發布到 loopback, 沒有正式登入與資料寫入 API

## 專案結構

```text
src/              Vue 首頁、共用樣式與前端資料 adapter
server/           Express 入口與 SQLite repository
gas/              GAS 頁面入口與 manifest
tools/            GAS 打包工具
tests/            資料與 adapter 測試
plans/main/       需求、計畫與驗證紀錄
```

開發規則見 [AGENTS.md](AGENTS.md), 視覺規範見 [Style.md](Style.md), 切換限制見 [Architecture.md](Architecture.md)
