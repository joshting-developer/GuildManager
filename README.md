# 逆水寒 · 幫會管理平台

Vue 3／Vuetify 管理介面, 本機透過 Node.js／Express API 讀寫 SQLite, 後期接入 GAS／Google 試算表

首頁上方集中管理入口, 下方呈現近期活動行事曆, 未完成的功能顯示「待開發」, 不呈現示範數字或安排；成員清單已支援加入、編輯、移除與過去名稱查詢, 活動安排支援建立活動／約戰並顯示於首頁月曆, 登入與正式試算表尚未串接

## 使用 Docker 開發

需要 Docker Engine 與 Docker Compose v2

```sh
docker compose up --build -d
```

開啟 [首頁](http://localhost:5173)、[成員清單](http://localhost:5173/#/members) 或 [活動安排](http://localhost:5173/#/events), 前端支援熱更新, API 使用 Node watch

- API 健康檢查：`http://localhost:3001/api/health`
- 成員資料：`http://localhost:3001/api/members`
- 活動安排：`http://localhost:3001/api/events`
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

- `npm test`：SQLite 保存、成員 CRUD、歷史交易回滾、職業擴充、舊欄位遷移、活動日期規則與重複提交、API 與 adapter 錯誤處理
- `npm run build`：一般本機前端 build, 輸出到 `dist/`
- `npm run build:gas`：GAS 模式, 輸出單一前端 `build/gas/Index.html`, 以及 `Code.gs` 和 `appsscript.json`
- GAS 打包指令會檢查是否仍有外部 JS／CSS 檔案或多餘輸出
- 編譯產物不納入 Git, 原始碼與 lockfile 納入 Git

## GAS 匯入方式

1. 執行 `npm run build:gas`
2. 在 Apps Script 專案建立 HTML 檔案 `Index`, 貼上 `build/gas/Index.html` 內容
3. 將 `build/gas/Code.gs` 與 manifest 匯入專案
4. 依目標登入與權限方案完成成員／職業／活動資料函式及試算表 repository
5. 使用 Apps Script 測試部署驗證後, 再決定正式部署身分與存取對象

目前 GAS 後端提供頁面入口, 成員、職業與活動函式會明確回報尚未串接, 不會讀寫正式試算表或回傳假的成功資料

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

首頁保留上方一排管理入口, 「成員清單」與「活動安排」可進入操作, 下方重複入口已移除

近期活動提供可切換月份及返回今天的行事曆, 日期以台北時區為準, 顯示本機保存的活動／約戰, 不顯示假活動；點有安排的日期查看完整清單

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
| POST | `/api/members/import/preview` | 解析並預覽匯入內容, 不寫入 |
| POST | `/api/members/import` | 確認預覽後整批匯入 |
| PATCH | `/api/members/:uid` | 修改名稱及職業 |
| DELETE | `/api/members/:uid` | 移除成員, JSON body 帶 revision |

加入資料格式：`{ uid: '001', name: '角色名稱', primaryProfessionId: 3, secondaryProfessionId: null }`；編輯不傳 uid, 加上 revision

`src/api/members.js` 在本機呼叫 HTTP, GAS 模式呼叫同名 `google.script.run` 函式, 不會將失敗寫入自動重試或退回本機資料

## 匯入成員

在成員清單點「匯入成員」, 貼上文字或讀取 UTF-8 CSV／TSV／TXT, 再按「預覽資料」確認名單, 最後「確認匯入」

欄位順序固定為 `UID Name 主職業 副職業`, 職業填名稱, 不填 job_id

格式範例 (不會自動寫入)：

```text
UID Name 主職業 副職業
001 角色名稱 碎夢 素問
002 另一位角色 神相 -
```

- 表頭可省略, 原始 `UID Name Job1 Job2` 與「名稱」表頭也可接受
- 空白、Tab 或逗號分隔, 必須保留四欄；名稱含空白時用 Tab 或 CSV 引號
- 無副職業填 `-` 或 `無副職業`, CSV／TSV 副職業可以留空欄
- Excel 檔請先另存為 UTF-8 CSV；每批最多 500 位、256 KiB
- UID 全程以文字保存, 保留前導零與長 ID, 請避免 Excel 自動轉數字
- 清單內已存在的 UID 跳過, 不修改既有名稱或職業
- 已移除的 UID 會在預覽標示「重新加入」, 恢復時沿用過去名稱紀錄
- 任何格式、職業或匯入內重複 UID 錯誤需先修正, 不部分匯入
- 預覽不寫入, 確認時重新驗證並檢查預覽版本, 整批寫入使用交易
- 輸入或相關成員資料改變後需重新預覽；提交中停用重複操作, 失敗保留輸入
- 完成後彈窗顯示實際新增／重新加入／跳過數量；全部跳過時顯示「沒有新增成員」
- GAS 匯入資料層尚未實作, 不會假裝成功或寫入正式試算表

## 活動安排

開啟 [活動安排](http://localhost:5173/#/events), 點「建立安排」填寫名稱, 選擇「活動／約戰」與日期, 再儲存

- 活動可逐日選擇 1–366 天, 允許不連續或跨月份的日期。
- 約戰只能選擇一天, 點選另一個日期會替換原日期。
- 從多日活動切換成約戰時, 會清除日期並提示重新選一天。
- 已選日期可再次點擊取消, 或移除下方日期標籤。
- 保存後更新清單, 首頁月曆在各日期顯示同一筆安排, 手機可點筆數查看詳情。
- 日期保存 `YYYY-MM-DD`, 畫面顯示 `YYYY/MM/DD`, 不經瀏覽器時區轉換。
- `scheduled_events(id, title, type, request_id, created_at)` 與 `event_dates(event_id, date)` 用 ID 關聯, SQLite 以交易保存。
- 同一 requestId、相同內容重試會取得原結果, 改變內容會拒絕並要求重新載入；前端不自動重試失敗寫入。
- 舊 `events` 表中的示範資料保留但不讀取, 不更動既有成員資料。
- 第一版只有建立與查詢, 時間、報名、對手及編輯／刪除待後續需求。

| 方法 | 路徑 | 用途 |
| --- | --- | --- |
| GET | `/api/events` | 所有安排及日期 |
| POST | `/api/events` | 建立活動或單日約戰 |

建立資料：`{ title, type: 'activity' | 'scrimmage', dates: ['YYYY-MM-DD'], requestId }`；回傳 `{ event: { id, title, type, dates, createdAt } }`

`src/api/events.js` 統一呼叫本機 API 或 GAS `getEvents()`／`createEvent(input)`；GAS 資料層仍未串接 Google 試算表, 不會回傳假的成功結果

## 專案結構

```text
src/              Vue 首頁、成員清單、活動安排、共用樣式與前端資料 adapter
server/           Express 入口與 SQLite repository
gas/              GAS 頁面入口與 manifest
tools/            GAS 打包工具
tests/            資料與 adapter 測試
plans/main/       需求、計畫與驗證紀錄
```

開發規則見 [AGENTS.md](AGENTS.md), 視覺規範見 [Style.md](Style.md), 切換限制見 [Architecture.md](Architecture.md)
