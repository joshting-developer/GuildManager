# 逆水寒 · 幫會管理平台

Vue 3／Vuetify 管理介面, 本機透過 Node.js／Express API 讀寫 SQLite, 後期接入 GAS／Google 試算表

首頁上方集中管理入口, 下方呈現近期活動行事曆, 未完成的功能顯示「待開發」, 不呈現示範數字或安排；成員清單已支援成員／編外分頁、加入、編輯、移至編外及幫派／俱樂部狀態與過去名稱查詢, 活動安排支援建立、修改、刪除活動／約戰並顯示於首頁月曆, 登入與正式試算表尚未串接

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

近期活動提供可切換月份及返回今天的行事曆, 日期以台北時區為準, 顯示本機保存的活動／約戰, 不顯示假活動；點日期格開啟建立安排視窗並預選當天, 點安排名稱或筆數查看完整清單

幫會公告功能已取消, 訊息主要在 Discord 處理；新資料庫不再建立公告表, 舊資料庫中的 `announcements` 表不刪除也不讀取

本機服務提供成員讀寫 API, 只發布到 loopback, 尚無正式登入；瀏覽器寫入限本機開發來源並要求 JSON

## 成員與職業資料

- `members`：UID (TEXT 主鍵)、名稱、主／副職業 ID、是否在幫派／俱樂部內、加入／更新時間、revision, removed_at 留作舊資料相容
- `professions`：`job_id`、`colorcode`、`name`, 依使用者提供的九筆正式職業初始化, 不放示範成員
- `member_name_history`：紀錄 ID、`member_uid`、過去名稱、改名時間, 以 UID 關聯
- 主職業必填, 副職業可選「無副職業」；UID 加入後不可修改, 保留前導零與長 ID
- 改名會在同一交易保存舊名, 只修改職業不增加改名紀錄
- 原移除改為「移至編外」, 將幫派內與俱樂部內設為否, 資料與過去名稱保留；回歸時編輯勾選任一狀態
- 編輯與移至編外需帶 revision, 舊版本會拒絕, 請重新載入後再操作
- 舊文字職業欄位保留作遷移相容, 讀寫以 ID 關聯為準, 不刪除既有資料
- 職業選單與色點讀取資料表, 未來新增職業資料列即可, 不需修改前端選項

| 方法 | 路徑 | 用途 |
| --- | --- | --- |
| GET | `/api/professions` | 職業 ID、色碼與名稱 |
| GET | `/api/members` | 成員與編外人員、所屬狀態及過去名稱 |
| POST | `/api/members` | 加入成員 |
| POST | `/api/members/import/preview` | 解析並預覽匯入內容, 不寫入 |
| POST | `/api/members/import` | 確認預覽後整批匯入 |
| PATCH | `/api/members/:uid` | 修改名稱、職業及所屬狀態 |
| DELETE | `/api/members/:uid` | 移至編外, JSON body 帶 revision, 回傳更新成員 |

加入資料格式：`{ uid: '001', name: '角色名稱', primaryProfessionId: 3, secondaryProfessionId: null, isInGuild: true, isInClub: false }`；編輯不傳 uid, 加上 revision

相容介面 `DELETE /api/members/:uid` 與 `removeMember(uid, revision)` 現在表示移至編外, 回傳 `{ uid, member }`；新操作不再隱藏紀錄。

`src/api/members.js` 在本機呼叫 HTTP, GAS 模式呼叫同名 `google.script.run` 函式, 不會將失敗寫入自動重試或退回本機資料

## 幫派與俱樂部狀態

- 新增／編輯表單提供「是否在幫派內」「是否在俱樂部內」兩個勾選欄位, 可以都勾選或都不勾選。儲存後顯示於對應分類。
- 清單顯示「幫派內」「俱樂部內」的「是／否」, 不只用顏色區分。
- 成員 tab 顯示 isInGuild 或 isInClub 至少一個為 true；編外人員 tab 顯示兩者皆 false, 兩分頁完整且互斥。
- 成員頁篩選「俱樂部」檢查 isInClub、「幫派」檢查 isInGuild、「不篩選」顯示目前分類全部人員；編外頁只保留搜尋／職業條件, 避免互斥條件。
- 名稱／UID／過去名稱、主職業與所屬篩選採交集, 修改條件或切換分類回到第一頁, 切換分類重設幫派／俱樂部條件；清除篩選重設條件並保留目前 tab。
- 只有取消幫派內勾選, 若俱樂部仍為是就留在成員頁；兩者皆否則顯示於編外人員。
- 「移至編外」先確認對象, 成功後成員頁移出、編外頁可查詢, 不刪除人員；編外頁保留編輯及過去名稱查詢。
- 編外人員編輯勾選任一狀態即可返回成員, 同 UID 重新新增仍拒絕重複。
- 成員頁新增預設 isInGuild=true、isInClub=false, 編外頁新增預設兩者 false；前端可直接調整, API 只接受 boolean, 不接受字串或數字。
- 舊資料初次加入狀態欄位時依原在會狀態初始化, 俱樂部原未記錄設為 false；原先 removed_at 隱藏紀錄轉為兩者 false 的編外人員, 保留 UID、名稱／職業與歷史, 增加 revision。
- API 回傳真正 boolean, SQLite 使用 is_in_guild／is_in_club 的 0／1, 重啟不重設。
- 修改狀態會增加 revision, 不產生名稱歷史；舊客戶端編輯省略這兩欄會保留原值。

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
- 清單內已存在的 UID 跳過, 不修改既有名稱、職業或所屬狀態
- 四欄格式維持不變, 新 UID 預設幫派內是／俱樂部內否, 匯入後可編輯；從編外頁匯入新 UID 仍歸入成員頁, 結果會提醒分類。
- 編外人員 UID 也視為已存在, 預覽標示跳過, 不覆寫或自動將狀態變成是。編外回歸請使用編輯。
- 任何格式、職業或匯入內重複 UID 錯誤需先修正, 不部分匯入
- 預覽不寫入, 確認時重新驗證並檢查預覽版本, 整批寫入使用交易
- 輸入或相關成員資料改變後需重新預覽；提交中停用重複操作, 失敗保留輸入
- 完成後彈窗顯示實際新增／重新加入／跳過數量；全部跳過時顯示「沒有新增成員」
- GAS 匯入資料層尚未實作, 不會假裝成功或寫入正式試算表

## 活動安排

在 [首頁](http://localhost:5173) 點日期格 (例如 10/24), 會直接開啟建立安排視窗並預選該日期；也可開啟 [活動安排](http://localhost:5173/#/events) 點「建立安排」, 填寫名稱及選擇「活動／約戰」與日期後儲存

- 清單點「修改」調整名稱、類型及日期, 預填原資料並顯示原日期月份；未修改直接取消不會詢問放棄。
- 點「刪除」查看名稱與影響日期, 確認後移出清單及所有日期的月曆；取消不寫入, 失敗保留視窗可重試。
- 編輯／刪除會檢查版本, 若其他操作已修改安排, 提示重新載入並保留輸入, 避免覆寫新資料。
- 活動可逐日選擇 1–366 天, 允許不連續或跨月份的日期。
- 約戰只能選擇一天, 點選另一個日期會替換原日期。
- 從多日活動切換成約戰時, 會清除日期並提示重新選一天。
- 已選日期可再次點擊取消, 或移除下方日期標籤。
- 從首頁建立時, 日期選擇器顯示點擊日期的月份, 包含相鄰月份的日期格；預選日期可修改。
- 保存後即時更新目前頁面, 首頁月曆保留瀏覽月份並在各日期顯示同一筆安排；點安排名稱或手機筆數查看詳情, 格子其他範圍可再建立安排。
- 未修改表單直接取消不會詢問放棄；修改後取消需確認, 儲存失敗保留輸入, 關閉後焦點返回原入口。
- 日期保存 `YYYY-MM-DD`, 畫面顯示 `YYYY/MM/DD`, 不經瀏覽器時區轉換。
- `scheduled_events(id, title, type, request_id, created_at, updated_at, revision, deleted_at)` 與 `event_dates(event_id, date)` 用 ID 關聯, SQLite 以交易保存。
- 同一 requestId、相同內容重試會取得原結果, 改變內容會拒絕並要求重新載入；前端不自動重試失敗寫入。
- 舊 `events` 表中的示範資料保留但不讀取, 不更動既有成員資料。
- 刪除以 deleted_at 保留已刪安排的提交識別資料, 查詢不顯示, 舊建立請求不會重建；同一版本的修改／刪除回應遺失時可手動重試。
- 支援建立、查詢、修改及刪除, 時間、報名及對手待後續需求。

| 方法 | 路徑 | 用途 |
| --- | --- | --- |
| GET | `/api/events` | 所有安排及日期 |
| POST | `/api/events` | 建立活動或單日約戰 |
| PATCH | `/api/events/:id` | 修改名稱、類型及日期, 必須提供 revision |
| DELETE | `/api/events/:id` | 刪除安排, 必須提供 revision |

建立資料：`{ title, type: 'activity' | 'scrimmage', dates: ['YYYY-MM-DD'], requestId }`；修改資料：`{ title, type, dates, revision }`, 刪除資料：`{ revision }`；建立／修改回傳 `{ event: { id, title, type, dates, createdAt, updatedAt, revision } }`, 刪除回傳 `{ id }`

`src/api/events.js` 統一呼叫本機 API 或 GAS `getEvents()`／`createEvent(input)`／`updateEvent(id, input)`／`deleteEvent(id, revision)`；GAS 資料層仍未串接 Google 試算表, 不會回傳假的成功結果

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
