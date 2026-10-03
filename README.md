# 逆水寒 · 幫會管理平台

Vue 3／Vuetify 管理介面, 本機透過 Node.js／Express API 讀寫 SQLite, 後期接入 GAS／Google 試算表

首頁直接顯示活動行事曆與場次報名／請假, 右上提供本機帳號密碼登入。登入後可使用管理總覽、成員清單、活動安排與戰場排表；管理頁與管理 API 都檢查登入。Google 登入與正式試算表尚未串接

## 使用 Docker 開發

需要 Docker Engine 與 Docker Compose v2

```sh
docker compose up --build -d
```

開啟 [首頁](http://localhost:5173)、[成員清單](http://localhost:5173/#/members) 、[活動安排](http://localhost:5173/#/events) 或 [戰場排表](http://localhost:5173/#/lineups), 前端支援熱更新, API 使用 Node watch

原首頁總覽改為 [管理總覽](http://localhost:5173/#/magament), `magament` 沿用使用者指定拼字, 也接受 `#/management`。未登入時直接開管理網址會回到首頁並開啟登入視窗；網址使用 hash 以支援後期單一 GAS HTML。

- API 健康檢查：`http://localhost:3001/api/health`
- 成員資料：`http://localhost:3001/api/members`
- 活動安排：`http://localhost:3001/api/events`
- 戰場排表：`http://localhost:3001/api/lineups`
- 職責清單：`http://localhost:3001/api/duties`
- 職業清單：`http://localhost:3001/api/professions`
- SQLite 保存在 `guild_data` volume 的 `/data/guildmanager.sqlite`
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

首頁右上「登入」使用本機帳號密碼, 登入後顯示帳號、登出及管理導覽。登入維持 8 小時, 重新整理仍保留；登出立即撤銷伺服器 session。管理操作未儲存時沿用離開確認。

此工作環境已建立 `admin` 帳號, 隨機密碼保存在 `data/local-admin.json`；這是本機私有檔案, 已由 `.gitignore` 排除, 不包含在提交中。其他開發環境第一次啟動 Docker 後可建立自己的帳號：

```sh
node --input-type=module -e 'import {mkdirSync,writeFileSync} from "node:fs"; import {randomBytes} from "node:crypto"; mkdirSync("data",{recursive:true}); writeFileSync("data/local-admin.json",JSON.stringify({username:"admin",password:randomBytes(24).toString("base64url")},null,2)+"\n",{mode:0o600,flag:"wx"});'
docker compose exec -T api node server/create-account.js < data/local-admin.json
```

工具從 stdin 讀取帳號 JSON, 帳號為 3–32 個英數字／底線／點／減號, 密碼 12–128 字元。既有帳號拒絕覆寫；使用不同私有檔案及帳號可新增其他登入者。直接使用 Node API 的環境改用 `npm run account:create < data/local-admin.json`, 需使用與 API 相同的 `DATABASE_PATH`。

- `auth_accounts` 保存 scrypt 密碼雜湊與獨立 salt, 不保存明文密碼
- `auth_sessions` 保存 session token 的 SHA-256 雜湊及到期時間；瀏覽器使用 HttpOnly／SameSite=Lax cookie, 不使用 localStorage 保存登入憑證
- 管理資料讀取須有 session, 管理修改另須 `X-CSRF-Token`；前端 adapter 自動附加, API 的 Origin／JSON 檢查仍保留
- 登入失敗訊息不區分帳號不存在或密碼錯誤, 同一來源 5 分鐘最多 10 次嘗試
- 所有已由本機工具建立的帳號都能管理, 本次沒有公開註冊或幫主／幹部等角色分級
- 公開行事曆、報名／請假沿用原操作方式, `/api/calendar/members` 僅提供 UID／名稱選單；登入帳號尚未與遊戲 UID 綁定
- Google 登入之後透過 auth adapter 接入, GAS 的登入函式目前明確回報未設定, 不以本機密碼或前端旗標假裝雲端登入成功

| 方法 | 路徑 | 用途 |
| --- | --- | --- |
| GET | `/api/auth/session` | 查詢登入狀態；匿名回傳 user=null |
| POST | `/api/auth/login` | 帳號密碼登入, 設定 session cookie |
| POST | `/api/auth/logout` | 驗證 session／CSRF 後登出 |
| GET | `/api/calendar/members` | 公開報名用 UID／名稱選單 |

本機 cookie 使用 HTTP loopback；後續正式 HTTP 後端須使用 HTTPS 並設 `NODE_ENV=production` 以啟用 Secure cookie。GAS 使用不同身分／通訊機制, 不直接搬入 Node session 或 scrypt；部署方式與 Google OAuth client 待後續設定。[Google 身分服務](https://developers.google.com/identity/gsi/web/guides/overview)、[GAS Session 身分限制](https://developers.google.com/apps-script/reference/base/session#getActiveUser())

## 建立示範成員

啟動本機 API 並建立登入帳號後, 在專案目錄手動執行；指令讀取 `data/local-admin.json` 登入, 結束時登出, 可用 `LOGIN_CREDENTIALS_PATH` 指定其他私有設定檔：

```sh
npm run seed:demo
```

透過 `http://127.0.0.1:3001/api` 新增 100 位示範成員：80 位同時在幫派與俱樂部、20 位只在俱樂部, 因此示範俱樂部成員合計 100 位。主、副職業循環分配九種職業, 名稱含「示範資料」, UID 為 `DEMO-GUILD-001`～`080` 與 `DEMO-CLUB-001`～`020`。既有成員另計。

重複執行會跳過已存在的 UID, 保留既有資料及後續編輯；中斷後可重試。此指令只操作上述本機 API, 不寫入 Google 試算表。成員清單搜尋「示範資料」即可單獨查看與篩選這批人員。

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

- `npm test`：SQLite 保存、成員 CRUD、歷史交易回滾、職業擴充、舊欄位遷移、活動日期規則、排表資格／唯一 UID／不可變快照／範本、版本與重複提交、API 與 adapter 錯誤處理
- `npm run build`：一般本機前端 build, 輸出到 `dist/`
- `npm run build:gas`：GAS 模式, 輸出單一前端 `build/gas/Index.html`, 以及 `Code.gs` 和 `appsscript.json`
- GAS 打包指令會檢查是否仍有外部 JS／CSS 檔案或多餘輸出
- 編譯產物不納入 Git, 原始碼與 lockfile 納入 Git

## GAS 匯入方式

1. 執行 `npm run build:gas`
2. 在 Apps Script 專案建立 HTML 檔案 `Index`, 貼上 `build/gas/Index.html` 內容
3. 將 `build/gas/Code.gs` 與 manifest 匯入專案
4. 依目標登入與權限方案完成成員／職業／活動／排表資料函式及試算表 repository
5. 使用 Apps Script 測試部署驗證後, 再決定正式部署身分與存取對象

目前 GAS 後端提供頁面入口, 成員、職業、活動與排表函式會明確回報尚未串接, 不會讀寫正式試算表或回傳假的成功資料

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

管理總覽保留上方一排管理入口, 「成員清單」「活動安排」與「戰場排表」可進入操作, 下方重複入口已移除；新首頁僅顯示行事曆。

兩頁行事曆可切換月份及返回今天, 台北日期顯示本機四種活動安排。管理總覽點日期格建立安排；首頁點有安排的日期格查看當天場次, 約戰／幫戰／龍虎戰可進入報名／請假, 一般活動只查看。

管理總覽點安排名稱或筆數開啟當日安排視窗, 約戰／幫戰／龍虎戰顯示「報名 N 人／請假 N 人」, 合計本場成員及外援回應。每次開啟讀取最新人數, 失敗可重試, 一般活動不顯示人數。

幫會公告功能已取消, 訊息主要在 Discord 處理；新資料庫不再建立公告表, 舊資料庫中的 `announcements` 表不刪除也不讀取

本機服務只發布到 loopback, 成員與管理 API 須登入；瀏覽器寫入限本機開發來源並要求 JSON, 管理修改另檢查 session 的 CSRF token

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

在 [首頁](http://localhost:5173) 點日期格 (例如 10/24), 會直接開啟建立安排視窗並預選該日期；也可開啟 [活動安排](http://localhost:5173/#/events) 點「建立安排」, 選擇「活動／約戰／幫戰／龍虎戰」與日期後儲存；活動／約戰填寫名稱, 幫戰／龍虎戰名稱可留空

- 幫戰／龍虎戰的名稱可留空或之後清空, 對手確定後可再補名稱；月曆／清單／排表會以類型搭配日期辨識, 不自動填入對手。轉為活動／約戰時仍須填名稱。
- 清單點「修改」調整名稱、類型及日期, 預填原資料並顯示原日期月份；未修改直接取消不會詢問放棄。
- 點「刪除」查看名稱與影響日期, 確認後移出清單及所有日期的月曆；取消不寫入, 失敗保留視窗可重試。
- 編輯／刪除會檢查版本, 若其他操作已修改安排, 提示重新載入並保留輸入, 避免覆寫新資料。
- 活動可逐日選擇 1–366 天, 同一筆安排可跨多天。
- 幫戰／龍虎戰建立可多選 1–366 天, 每個日期各自一筆安排及獨立 ID, 例如選 10/24、10/31 會建立兩場, 可分別修改、刪除, 並連結排表與未來的影片／紀錄。
- 幫戰／龍虎戰編輯僅修改該場的一個日期, 不影響同批其他場次；建立時提示將新增的筆數, 清單與月曆使用正確類型名稱, 篩選支援四種類型。
- 目前手動選擇循環賽日期, 未加入每週／每兩週自動排程或影片、戰鬥紀錄功能。
- 約戰只能選擇一天, 點選另一個日期會替換原日期。
- 建立時活動、幫戰、龍虎戰間切換保留多選日期, 切換成約戰會清除多選並提示；編輯時幫戰／龍虎戰與約戰皆為單日。
- 已選日期可再次點擊取消, 或移除下方日期標籤。
- 從首頁建立時, 日期選擇器顯示點擊日期的月份, 包含相鄰月份的日期格；預選日期可修改。
- 保存後即時更新目前頁面, 首頁月曆保留瀏覽月份並在各日期顯示同一筆安排；點安排名稱或手機筆數查看詳情, 格子其他範圍可再建立安排。
- 未修改表單直接取消不會詢問放棄；修改後取消需確認, 儲存失敗保留輸入, 關閉後焦點返回原入口。
- 日期保存 `YYYY-MM-DD`, 畫面顯示 `YYYY/MM/DD`, 不經瀏覽器時區轉換。
- `scheduled_events(id, title, type, request_id, created_at, updated_at, revision, deleted_at)` 與 `event_dates(event_id, date)` 用 ID 關聯, SQLite 以交易保存。
- 同一 requestId、相同內容重試會取得原安排 ID, 改變內容會拒絕並要求重新載入；前端不自動重試失敗寫入。
- `event_batches` 與 `event_batch_items` 保存批次請求及場次 ID, 整批寫入採同一交易, 部分失敗全部回滾, 重試不重複新增；已刪除場次不因重試重建。
- 舊 `events` 表中的示範資料保留但不讀取, 不更動既有成員資料。
- 刪除以 deleted_at 保留已刪安排的提交識別資料, 查詢不顯示, 舊建立請求不會重建；同一版本的修改／刪除回應遺失時可手動重試。
- 支援建立、查詢、修改及刪除, 時間、報名及對手待後續需求。

| 方法 | 路徑 | 用途 |
| --- | --- | --- |
| GET | `/api/events` | 所有安排及日期 |
| POST | `/api/events` | 建立活動／約戰, 或按日期批次建立幫戰／龍虎戰 |
| PATCH | `/api/events/:id` | 修改名稱、類型及日期, 必須提供 revision |
| DELETE | `/api/events/:id` | 刪除安排, 必須提供 revision |

建立資料：`{ title, type: 'activity' | 'scrimmage' | 'guild_war' | 'dragon_tiger', dates: ['YYYY-MM-DD'], requestId }`。

- 活動／約戰回傳 `{ event }`；幫戰／龍虎戰回傳 `{ events: [...] }`, 每個日期一個獨立安排, 單日也採此格式。
- 每筆安排包含 `{ id, title, type, dates, createdAt, updatedAt, revision }`。幫戰／龍虎戰允許 title 空字串或省略, 省略／只有空白正規化為空字串；活動／約戰 title 必填, 所有名稱最多 120 字。
- 修改資料：`{ title, type, dates, revision }`, 回傳 `{ event }`；幫戰／龍虎戰恰好一天。
- 刪除資料：`{ revision }`, 回傳 `{ id }`。

`src/api/events.js` 統一呼叫本機 API 或 GAS `getEvents()`／`createEvent(input)`／`updateEvent(id, input)`／`deleteEvent(id, revision)`；GAS 資料層仍未串接 Google 試算表, 不會回傳假的成功結果

## 報名與請假

玩家 UID 只在管理端成員清單與相關表單顯示。報名、排表來源／位置／歷史、範本跳過提示只顯示名稱, 內部仍以 UID 關聯, 不修改既有資料或快照。

首頁點有安排的日期格, 同日多場會先列出各場次；選戰鬥的「報名／請假」後：

- 使用單一表單填名稱、狀態與備註, 狀態只有「報名／請假」；報名必選職業, 請假不需要職業。
- 請假會確認是否為本場已報名者或幫會／俱樂部成員, 找不到顯示「沒有報名或沒有資料」。編外尚未報名者不能直接請假；同名資料無法辨識時請聯絡管理者。
- 既有名冊成員以名稱連結原 UID, 不建立第二種身分或修改名冊職業；外援以獨立 ID 保存, 不需 UID 或加入正式名冊。
- 外援取消改選「請假」, 可重新報名恢復同一筆資料。每場獨立保存, 請假者不在可排名單中, 已儲存排表快照保留。
- 帳號密碼登入保護管理功能, 公開填寫名稱仍不是本人驗證；帳號／UID 綁定、正式本人操作權限與報名截止未定案, GAS 資料函式明確回報尚未串接。

| 方法 | 路徑 | 用途 |
| --- | --- | --- |
| GET | `/api/events/:id/participation` | 本場成員回應、有效額外報名、外援請假及 revision |
| POST | `/api/events/:id/participation` | 統一名稱、status (registered／leave)、professionId (報名必填)、note、requestId、revision；依名稱連結成員或外援 |
| PATCH | `/api/events/:id/participation` | 舊介面相容：儲存 uid、status、note、revision |
| POST | `/api/events/:id/registrations` | 舊介面相容：建立額外報名 |
| DELETE | `/api/events/:id/registrations/:registrationId` | 舊介面相容：取消額外報名 |

`event_member_responses` 以場次 ID／UID 關聯, `event_registrations` 使用獨立報名 ID／場次 ID／名稱／職業 ID／備註與版本。排表以 UID 或 registrationId 互斥引用, 第一／第二場皆可安排；儲存保存額外報名原備註及姓名／職業快照。日常更新來源會保留目前排表, 請假者標為無效並要求調整。

## 戰場排表

開啟 [戰場排表](http://localhost:5173/#/lineups), 選擇已建立的約戰、幫戰或龍虎戰。

桌面採緊湊排表, 職業與姓名同行。點右上「專注排表」可收起導覽及設定, 1366×768、100% 縮放可同框查看 60 個位置；1920×1080 一般模式亦可查看完整陣容。仍可拖曳成員／職責、另存範本及儲存排表, 返回一般檢視後可切換場次／範本。長名稱與備註可聚焦或開啟位置看全文, 長文字展開或較小螢幕時仍可捲動。手機維持較大的點選範圍。

1. 從成員清單拖曳至位置, 或點選成員再點位置；手機／鍵盤也可直接開啟位置視窗選人。
2. 拖入第二位成員後, 同一列顯示「第一場／第二場」與兩位名稱。點位置可分別修改／移除兩場人員、選各自主／副職業, 並修改共用職責及備註；隊名可直接修改。
3. 按「儲存排表」直接保存目前名單, 不要求填滿 60 人；儲存後可以繼續修改, 再按儲存即可。
4. 想保留某個配置時「另存範本」, 在本場或另一場選擇範本後「套用範本」, 檢查跳過名單並調整後儲存。
5. 切換或重開場次會載入最後保存的排表, 未保存的場次顯示空位。頁面只顯示尚未儲存／有未儲存修改／已儲存, 沒有工作區或歷史版本切換。

- 版型共用進攻團 3 隊、機動團 3 隊、防守團 4 隊, 每隊 6 個位置。每位置最多兩位不同成員分別出戰第一場／第二場, 未指定第二場時沿用第一場成員。
- 成員來源分幫會成員、俱樂部成員 (排除幫會)、額外報名 (本場額外報名者及已報名的編外)。三種戰鬥共用三類來源, 本場請假者排除, 兼屬成員不重複出現。
- 約戰／幫戰／龍虎戰左側三類名單只列尚未安排的人員, 第一／第二場任一已安排便隱藏, 移出後會重新出現；可直接點排表位置編輯已安排的人員, 位置選單仍提供完整合資格成員。
- 來源卡片右下「主／副」切換本次上場職業, 名稱與色點同步更新；沒有副職業或額外報名者只提供「主」。切換不修改名冊或已安排位置, 拖曳／點選安排使用卡片選擇, 從排表移動則保留原上場職業。確認與範本沿用既有職業保存方式。
- 同一份配置 UID 或額外報名 ID 不重複, 不同活動安排可用同一成員；拖入占用位置加入第二場, 重拖同人不新增, 第三位提示先編輯且保留來源。拖曳已安排的人只移動該人；明確編輯選人可交換該場分配, 職責與備註保留在原位置。
- 桌面雙人位置在同一列內分兩行, 手機保留各場至少 44px 點選範圍；總人數、占用位置及各場出戰人數分開計算, 範本／歷史保存兩場人員與各自職業。
- 範本保存 UID 或額外報名 ID 與位置, 套用時重新檢查資格／請假／職業；額外報名只適用原場次, 跨場或取消者留空並列出原因, 不改範本或既有歷史。
- 底層儲存沿用後端快照, 包含 UID、當時名稱、主／副職業及色彩、上場職業、位置、隊名、職責、備註與場次, 不刪除舊資料；介面直接編輯最新名單, 不展示版本流程。
- 刪除安排或將類型改為一般活動後, 場次選單標示「已封存」, 最後保存的排表可唯讀查看與另存範本。
- 未儲存修改保留在目前頁面, 切換場次、套用範本取代、離開頁面或關閉分頁會提醒；沒有自動儲存。
- 檢查內部版本與活動 revision 防止覆寫, 儲存失敗保留輸入, 更新成員清單保留目前排表；重試使用同一 requestId 避免重複儲存。
- `lineup_versions` 保留既有版本／JSON 快照作相容及並行檢查, 以 event_id 關聯場次, 禁止 UPDATE／DELETE；`lineup_templates` 獨立保存可復用配置, 不自動把舊版本轉為範本, 空位用 null、UID 用文字。
- 本機 SQLite 表透過新增初始化, 不搬移或覆寫既有成員／活動資料；GAS 排表資料函式尚未串接。

| 方法 | 路徑 | 用途 |
| --- | --- | --- |
| GET | `/api/lineups` | 現有戰鬥／封存場次與範本 |
| GET | `/api/lineups/events/:id` | 本場所有確認快照 (新版本在前) |
| POST | `/api/lineups/confirm` | 建立不可變版本, `{ eventId, eventRevision, expectedVersion, teams, requestId }` |
| POST | `/api/lineups/templates` | 建立範本, `{ name, teams, requestId }` |
| GET | `/api/lineups/templates/:id/apply/:eventId` | 按現有資格取得配置與 skipped, 不寫入排表 |

`teams` 依固定版型傳十隊 `{ id, name, slots }`, 每隊六位置 `{ uid: string | null, profession: 'primary' | 'secondary', secondRound: { uid: string, profession: 'primary' | 'secondary' } | null, dutyIds: string[], note }`；uid／profession 為第一場, secondRound 為第二場且舊資料缺值視為 null。前端不提供可信的姓名或職業快照。

`src/api/lineups.js` 統一呼叫 HTTP 或 GAS `getLineupIndex()`／`getLineupHistory(eventId)`／`confirmLineup(input)`／`createLineupTemplate(input)`／`applyLineupTemplate(templateId, eventId)`。

## 職責分配清單

戰場排表旁的「成員／職責分配」分頁切換來源。在「職責分配」可拖曳職責到位置的職責欄, 或先點選職責再點位置；空位也能先規劃職責。

- `duties` 保存固定 ID、唯一名稱、啟用狀態、revision、建立／更新時間。首次只建立使用者明列的保鑣、山盟、輔潮, 重啟不重設改名或停用狀態。
- 「新增職責」加入項目, 鉛筆按鈕修改名稱與啟用狀態；勾選「顯示停用職責」後可重新啟用。沒有硬刪除職責。
- 每位置可以多項職責, 同一職責可分配給多人, 同一位置不重複；成員移動／交換時職責與備註保留在原位置。
- 點位置的職責欄開啟編輯視窗, 用「分配職責」多選與標籤移除；「補充備註」仍可自由填寫。
- 確認快照保存職責 ID 與當時名稱, 改名／停用不改歷史；範本保存 ID, 套用時使用現有名稱並跳過停用／不存在的職責, 顯示位置與原因。
- 排表仍含停用職責時提示位置數, 需移除或重新啟用後才能儲存。更新職責清單保留目前排表。
- 舊排表未包含 dutyIds 時視為空陣列, 原自由文字、不可變快照及舊請求重試均保留, 不猜測或自動轉換舊備註。
- 維護需 revision, 重複名稱拒絕；新增 requestId 與相同修改重試不重複寫入, 失敗保留輸入。

| 方法 | 路徑 | 用途 |
| --- | --- | --- |
| GET | `/api/duties` | 啟用與停用職責 |
| POST | `/api/duties` | 新增, `{ name, requestId }` |
| PATCH | `/api/duties/:id` | 修改名稱與狀態, `{ name, active, revision }` |

`src/api/duties.js` 包裝 HTTP 與 GAS `getDuties()`／`addDuty(input)`／`updateDuty(id, input)`；GAS 資料函式仍明確回報未串接。範本套用回應另含 `skippedDuties`, 每筆帶名稱、隊伍與位置及原因。

## 專案結構

```text
src/              Vue 首頁、成員清單、活動安排、戰場排表、共用樣式與前端資料 adapter
server/           Express 入口與 SQLite repository
gas/              GAS 頁面入口與 manifest
tools/            GAS 打包工具
tests/            資料與 adapter 測試
plans/main/       需求、計畫與驗證紀錄
```

開發規則見 [AGENTS.md](AGENTS.md), 視覺規範見 [Style.md](Style.md), 切換限制見 [Architecture.md](Architecture.md)
