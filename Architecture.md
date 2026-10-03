# 本機開發與 GAS 部署架構

## 開發方向

使用者已確認先做 Vue＋Vuetify 首頁, 搭配 Docker、小型 API 與 SQLite 本機測試, 後期切換 GAS 與 Google 試算表

| 層級 | 本機開發 | GAS 部署 |
| --- | --- | --- |
| 頁面 | Vue 3＋Vuetify＋Vite, 支援熱更新 | 相同前端來源, 編譯為單一 HTML |
| 前端資料介面 | `src/api/` 呼叫 HTTP 成員／職業 API | 同名資料函式包裝 `google.script.run` |
| 執行入口 | Node.js／Express | GAS `.gs` 函式與 `doGet()` |
| 資料存取 | SQLite repository | Google 試算表 repository |
| 環境 | Docker Compose | Apps Script Web App |

首頁元件不直接操作 SQLite、Google 試算表或 `google.script.run`, 只透過前端資料介面取得相同格式的資料

## 單檔編譯

- Vuetify 支援 Vite 開發, 參考 [官方安裝說明](https://vuetifyjs.com/en/getting-started/installation/)
- 使用 [vite-plugin-singlefile](https://github.com/richardtallent/vite-plugin-singlefile) 將 JS 與 CSS 內嵌到輸出 HTML
- 預設 Vite build 會分出資源檔, GAS build 需另行配置單檔輸出
- 不依賴 `public/` 的相對路徑資源, 該目錄不會被插件自動內嵌
- 圖示採 SVG path, 字體採系統字體, 避免額外字體檔或 CDN 依賴
- 日常編輯 `.vue`、JS 與 CSS 原始碼, 不手改編譯產物
- GAS 前端可以只有一個 HTML, 但資料讀寫仍需要 `.gs` 後端與 manifest
- 前端編譯產物使用 `createHtmlOutputFromFile()` 提供, 不需要對 bundle 執行 Apps Script 模板解析

## 切換時要處理的差異

- GAS 不是 Node.js, 不直接搬入 Express、SQLite driver、`fs`、`process` 或未打包的模組；參考 [GAS V8 限制](https://developers.google.com/apps-script/guides/v8-runtime#v8_runtime_limitations)
- GAS 請求走 [非同步 `google.script.run`](https://developers.google.com/apps-script/guides/html/communication), adapter 包成 Promise, 錯誤需交給畫面處理
- 日期統一傳 ISO 8601 字串, 不跨介面傳 `Date`、資料庫連線或工作表物件
- 可共用不依賴執行環境的資料驗證與運算, 平台入口及資料存取仍要各自實作
- SQLite 的交易、唯一鍵與外鍵不會自動變成試算表功能, GAS 需補固定 ID、驗證、鎖定與部分失敗處理
- 多頁面導覽優先評估 hash 或 memory 路由, 不依賴伺服器 rewrite；使用 `#/members` 切換成員清單, 尚無 Router 套件
- GAS 使用 iframe sandbox, 外部資源、導覽與瀏覽器功能需依 [HTML Service 限制](https://developers.google.com/apps-script/guides/html/restrictions) 實測
- 本機測試不能代替 Google 授權、部署身分與試算表權限驗證, 不等到全部功能完成才做第一次 GAS 整合
- SQLite 測試資料不會自動匯入正式試算表, 後續依確認的欄位另做資料遷移

## Docker 與資料保存

- 前端 dev server 與 API 分為兩個服務, SQLite 在 API 服務內操作, 不需另開資料庫容器
- 前端以開發代理轉送 `/api`, 避免元件綁定本機 API 網址
- SQLite 檔案放入獨立 volume, 容器重建時保留資料；參考 [Docker volumes](https://docs.docker.com/engine/storage/volumes/)
- 初始化只在沒有首頁設定資料時建立空白設定, 不播種示範資料或覆寫既有資料
- 本機服務只發布到 loopback, 尚無正式登入前不對外提供管理 API
- SQLite 成員、職業與名稱歷史已依確認需求實作, 活動資料尚未定案

## 驗證狀態

官方文件確認此架構具備可行性, 實際單檔編譯、本機 API、Docker 與首頁驗證結果記錄於 `plans/main/step.md` 與 `plans/main/members-step.md`

GAS 資料函式與正式試算表 repository 尚待後續實作, 不宣稱本機 Node 後端可以原樣部署至 GAS
