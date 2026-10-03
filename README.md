# 逆水寒 · 幫會管理平台

Vue 3／Vuetify 管理介面, 本機透過 Node.js／Express API 讀寫 SQLite, 後期接入 GAS／Google 試算表

首頁上方集中管理入口, 下方呈現近期活動行事曆, 未完成的功能顯示「待開發」, 不呈現示範數字或約戰；成員清單已支援加入、編輯、移除與過去名稱查詢, 登入與正式試算表尚未串接

## 使用 Docker 開發

需要 Docker Engine 與 Docker Compose v2

```sh
docker compose up --build -d
```

開啟 [首頁](http://localhost:5173) 或 [成員清單](http://localhost:5173/#/members), 前端支援熱更新, API 使用 Node watch

- API 健康檢查：`http://localhost:3001/api/health`
- 成員資料：`http://localhost:3001/api/members`
- 職業清單：`http://localhost:3001/api/professions`
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

- `npm test`：SQLite 保存、成員 CRUD、歷史交易回滾、職業擴充、舊欄位遷移、API 與 adapter 錯誤處理
- `npm run build`：一般本機前端 build, 輸出到 `dist/`
- `npm run build:gas`：GAS 模式, 輸出單一前端 `build/gas/Index.html`, 以及 `Code.gs` 和 `appsscript.json`
- GAS 打包指令會檢查是否仍有外部 JS／CSS 檔案或多餘輸出
- 編譯產物不納入 Git, 原始碼與 lockfile 納入 Git

## GAS 匯入方式

1. 執行 `npm run build:gas`
2. 在 Apps Script 專案建立 HTML 檔案 `Index`, 貼上 `build/gas/Index.html` 內容
3. 將 `build/gas/Code.gs` 與 manifest 匯入專案
4. 依目標登入與權限方案完成成員／職業資料函式及試算表 repository
5. 使用 Apps Script 測試部署驗證後, 再決定正式部署身分與存取對象

目前 GAS 後端提供頁面入口, 成員與職業函式會明確回報尚未串接, 不會讀寫正式試算表或回傳假的成功資料

## 資料介面

首頁目前直接顯示待開發, 尚未使用保留的 `src/api/home.js` 首頁資料介面

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
  "meta": { "mode": "empty", "updatedAt": "ISO 8601 日期字串" }
}
```

日期傳 ISO 8601 字串, 畫面以台北時區顯示；沒有出勤統計時使用 `null`, 不用 `0` 代替未知值

首頁保留上方一排管理入口, 「成員清單」可進入操作, 下方重複入口已移除

近期活動提供可切換月份及返回今天的行事曆, 日期以台北時區為準, 約戰資料尚未串接, 不顯示假活動

幫會公告功能已取消, 訊息主要在 Discord 處理；新資料庫不再建立公告表, 舊資料庫中的 `announcements` 表不刪除也不讀取

本機服務提供成員讀寫 API, 只發布到 loopback, 尚無正式登入；瀏覽器寫入限本機開發來源並要求 JSON

## 成員與職業資料

- `members`：UID (TEXT 主鍵)、名稱、主／副職業 ID、加入／更新／移除時間、revision
- `professions`：`job_id`、`colorcode`、`name`, 依使用者提供的九筆正式職業初始化, 不放示範成員
- `member_name_history`：紀錄 ID、`member_uid`、過去名稱、改名時間, 以 UID 關聯
- 主職業必填, 副職業可選「無副職業」；UID 加入後不可修改, 保留前導零與長 ID
- 改名會在同一交易保存舊名, 只修改職業不增加改名紀錄
- 移除採退會標記, 隱藏成員但保留歷史；同 UID 重新加入會恢復並延續紀錄
- 編輯與移除需帶 revision, 舊版本會拒絕, 請重新載入後再操作
- 舊文字職業欄位保留作遷移相容, 讀寫以 ID 關聯為準, 不刪除既有資料
- 職業選單與色點讀取資料表, 未來新增職業資料列即可, 不需修改前端選項

| 方法 | 路徑 | 用途 |
| --- | --- | --- |
| GET | `/api/professions` | 職業 ID、色碼與名稱 |
| GET | `/api/members` | 在會成員及過去名稱 |
| POST | `/api/members` | 加入成員 |
| PATCH | `/api/members/:uid` | 修改名稱及職業 |
| DELETE | `/api/members/:uid` | 移除成員, JSON body 帶 revision |

加入資料格式：`{ uid: '001', name: '角色名稱', primaryProfessionId: 3, secondaryProfessionId: null }`；編輯不傳 uid, 加上 revision

`src/api/members.js` 在本機呼叫 HTTP, GAS 模式呼叫同名 `google.script.run` 函式, 不會將失敗寫入自動重試或退回本機資料

## 專案結構

```text
src/              Vue 首頁、成員清單、共用樣式與前端資料 adapter
server/           Express 入口與 SQLite repository
gas/              GAS 頁面入口與 manifest
tools/            GAS 打包工具
tests/            資料與 adapter 測試
plans/main/       需求、計畫與驗證紀錄
```

開發規則見 [AGENTS.md](AGENTS.md), 視覺規範見 [Style.md](Style.md), 切換限制見 [Architecture.md](Architecture.md)
