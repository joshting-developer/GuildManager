# 首頁製作計畫

## 原始需求

「先幫我製作一個首頁吧」

## 範圍與假設

- 在現有 Google Apps Script 專案方向上建立首頁, 沿用 `Style.md`
- 首頁包含幫會概況、近期活動、公告與管理入口
- 幫會名稱、欄位與權限尚未確定, 首頁以清楚標示的示範資料呈現
- 活動與管理入口是首頁版面預覽, 不代表後續功能已定案或完成
- 此步驟不讀寫正式試算表, 不建立假登入與儲存成功行為
- 使用者後續確認改用 Vue＋Vuetify 首頁, 搭配 Docker、小型 API 與 SQLite 本機環境
- 採 Vue 3、Vuetify、Vite, 本機 API 使用 Node.js／Express／SQLite
- 前端資料呼叫透過 adapter, 本機使用 HTTP API, GAS 使用 `google.script.run`
- GAS 編譯將前端 JS／CSS 內嵌為單一 HTML, 後端 `.gs` 另行保留

## 步驟

1. 記錄製作範圍與驗證方式, 建立本機 commit
2. 確認並記錄本機／GAS 架構, 建立本機 commit
3. 建立 Docker、API、SQLite 與 Vuetify 首頁, 驗證後建立本機 commit

## 驗證方式

- 檢查 JavaScript 語法、Apps Script 設定與文件格式
- 使用瀏覽器檢查桌面與手機版面, 無橫向溢出及 console 錯誤
- 檢查活動篩選、示範／空白切換、導覽與對話框鍵盤操作
- 確認示範資料標示清楚, 未串接功能不假裝寫入
- 驗證 SQLite 資料經 API 顯示於首頁, 初始化不覆寫既有資料
- 驗證 GAS 編譯產物無外部 JS／CSS 檔案依賴
- 檢查 Compose 設定與容器啟動, 無法啟動時如實記錄原因
- Apps Script 授權與測試部署需在 Google 環境驗證, 本機不宣稱通過

## 待確認

- 正式幫會名稱與標誌
- 第一版實際功能、試算表欄位與登入方案
- Apps Script 專案 ID 與部署設定

## 活動安排後續需求

- 以上為首頁初版的歷史紀錄, 後續已移除示範資料與公告。
- 本次原始需求：「活動安排可以開始製作了；selector 是活動／約戰, 約戰只能選一天, 活動可選很多天」。
- 本次計畫與驗證記錄見 [event-scheduling-plan.md](event-scheduling-plan.md)。

## 成員幫派／俱樂部狀態後續需求

- 本次需求與相容規則見 [member-membership-plan.md](member-membership-plan.md)。
- 兩個獨立 boolean、清單顯示與編輯、俱樂部／幫派／不篩選選單。

## 成員／編外人員分頁後續需求

- 新需求與資料相容處理見 [member-tabs-plan.md](member-tabs-plan.md)。
- 成員頁至少一個所屬狀態為是, 編外頁兩者為否, 原移除操作改為移至編外。

## 行事曆日期建立安排

使用者希望點擊首頁日期格即可建立安排並預選日期。沿用現有表單與 API, 保留安排詳情入口, 計畫與驗證見 [calendar-create-plan.md](calendar-create-plan.md)。

## 活動修改與刪除

使用者要求活動安排可修改及刪除。沿用建立表單、日期規則, 新增版本檢查及刪除確認, 見 [event-management-plan.md](event-management-plan.md)。

## 幫戰與龍虎戰類型

新增幫戰與龍虎戰兩種可多日的安排, 同步資料驗證、類型篩選及月曆, 計畫見 [event-types-plan.md](event-types-plan.md)。

## 戰場排表

新增每場獨立排表、60 人位置、所屬資格篩選、可復用範本與不可變的確認歷史, 見 [battlefield-lineup-plan.md](battlefield-lineup-plan.md)。

## 排表職責清單

使用者要求保鑣、山盟、輔潮等職責有獨立資料表與可拖曳清單, 見 [lineup-duties-plan.md](lineup-duties-plan.md)。

## 排表密度

依使用者要求縮小排表位置與操作留白, 增加專注排表以利同畫面查看 60 人, 見 [lineup-density-plan.md](lineup-density-plan.md)。

## 同位置分場

拖入第二位成員後保留第一場／第二場配置, 見 [lineup-rounds-plan.md](lineup-rounds-plan.md)。

## 幫戰／龍虎戰名稱選填

因對手事前不確定, 放寬兩類安排的名稱必填並補上顯示回退, 見 [optional-battle-title-plan.md](optional-battle-title-plan.md)。

## 一百位示範成員

依使用者要求在本機新增 80 位幫派兼俱樂部與 20 位僅俱樂部的假資料, 保留原有成員, 見 [demo-members-plan.md](demo-members-plan.md)。

## 行事曆首頁與場次參與

管理總覽移至 magament、新首頁行事曆報名／請假、排表三類來源與無 UID 額外報名, 見 [event-participation-plan.md](event-participation-plan.md)。

## 登入與管理頁保護

首頁登入入口、本機帳號密碼與管理頁／API 權限檢查, 見 [auth-plan.md](auth-plan.md)。
