# 平台架構、安全與驗證契約

本文保留既有產品契約, 供相關修改時按需查閱；實作協議另見 [Architecture](../Architecture.md), 介面依 [Style](../Style.md)。原文的版本、驗證及「尚未部署」敘述是當時紀錄, 不代表目前遠端狀態

## 技術方向

- 前端：Vue 3／Vuetify／Vite, 日常編輯 `.vue`、JS 與 CSS 原始碼
- 本機後端：Node.js／Express, 使用 MySQL 非同步 Repository, 分層與寫法見 [Node.js 分層規範](nodejs-architecture.md)
- 本機環境：Docker Compose 的 frontend／api 服務, 資料保存在本機 MySQL 的專用資料庫
- 日期顯示與專案時區統一採 `Asia/Taipei`

`NSHM_history` 的 Laravel、Vue、Inertia 與資料庫架構只作背景參考, 本專案沿用其視覺語言, 不直接搬入這些框架

前端採用 Vue／Vuetify, 後端採用 Node API／MySQL；開發與編譯方式見[本機開發](development.md), 平台切換規則見 [Architecture.md](../Architecture.md)

## 建議檔案分工

目前分工如下, 後續依需求增加檔案, 不需先建立空檔

| 檔案 | 用途 |
| --- | --- |
| `src/App.vue`、`src/pages/` | 共用導覽、首頁與成員管理畫面 |
| `src/main.js`、`src/styles.css` | Vuetify 主題與共用樣式 |
| `src/api/` | Node 資料呼叫 adapter |
| `server/app.js`、`server/index.js` | Express API 與啟動入口 |
| `server/mysql/`、`server/database/` | MySQL Repository、連線與明確 migration |
| `compose.yaml`、`Dockerfile` | 本機開發環境 |


## 程式撰寫規則

- JavaScript 預設使用 2 格縮排、單引號、分號, 優先使用 `const`, 需要重新賦值才用 `let`
- 函式與變數使用 `camelCase`, 常數使用 `UPPER_SNAKE_CASE`, 資料表欄位使用 `snake_case`
- 前端處理顯示與操作狀態, 後端處理資料驗證、權限與資料存取
- SQL 留在 MySQL Repository, 前端與 HTTP handler 不直接查詢資料庫
- 鎖定套件版本並維護 lockfile, 不手改編譯產物
- DOM ID、class 與 `data-*` 使用一致且具功能語意的命名
- 後端傳回可序列化的資料, 日期轉成 ISO 8601 字串, 不直接傳回 `Date` 或 driver 物件
- 錯誤訊息讓使用者知道原因與下一步, 記錄中不包含憑證或不必要的個資
- 載入玩家名稱、備註等使用者輸入時, 優先用 `textContent`, 不直接插入未處理的 HTML
- 註解用來說明原因與限制, 不逐行翻譯程式碼

## 資料與一致性

- MySQL 使用固定唯一 ID 與外鍵, 遊戲 UID 保留字串與前導零
- 後端驗證格式、允許值、revision、requestId 與引用資格, 同一交易保存業務資料與重試結果
- 所有 async 查詢必須 await, MySQL 交易與鎖由單一 owner 管理, 不在持鎖時等待物件儲存或 Discord
- 原始檔案存私有物件儲存, metadata 與關聯存 MySQL, 跨服務失敗依 staging ledger 復原
- 測試與日常開發分庫, 不用正式資料進行驗證性寫入；資料搬移與破壞性維護須另行授權
- CSV 匯出處理公式字首, 不把使用者文字當作公式或 HTML

## 身分與權限

- 本機角色分 admin／manager／member, admin／manager 可使用既有管理功能, member 可使用行事曆報名、完整成員清單、戰績閱覽／個人分析及精簡影片閱覽，其他管理功能不開放, `#/admin` 及 `/api/admin/*` 僅 admin；不建立公開註冊。首個 CLI 帳號預設 admin, 後續 manager；舊無角色資料優先名稱 admin, 否則最早帳號為 admin, 其餘 manager, 不重設密碼。角色與帳號升級須保留原密碼、Session 與外鍵一致性。
- admin 可驗證目前密碼後修改自己的密碼, 保留目前 session 並撤銷其他登入；可建立／修改 manager 帳號／密碼（留空保留）與共用 member 通行密碼, manager／member 修改撤銷全部 session。帳號名稱不分大小寫唯一, revision 拒絕過期修改, 不提供角色提升／刪除。網頁改密碼不更新私有 local-admin.json。
- 公開頁為行事曆、既有報名／請假及精簡影片閱覽（只提供角色、職業與團別, 不含連結／備註）；完整成員清單及相關 API 開放 member／manager／admin；管理總覽 (magament／management)、活動安排、排表及相關管理 API 須 admin／manager 登入, 不只隱藏導覽
- 本機密碼使用 scrypt 雜湊, session 用 HttpOnly cookie 且伺服器只保存 token 雜湊, 管理及登入後報名修改檢查 CSRF；私有帳號檔 data/local-admin.json 不得提交。
- 每個可由前端呼叫的資料函式都要在後端檢查權限, 隱藏按鈕不等於存取控制
- 不信任前端傳入的使用者身分、角色或操作人欄位
- 憑證、Token 與私密設定保留於後端設定, 不放在 HTML、公開文件或版控

## 介面要求

- 1100px 以下使用 56px 固定於上方的頂欄及右側 modal 導覽抽屜；登入後頂欄只保留品牌與選單，登出放抽屜底部。抽屜沿用角色入口、當前頁標示、遮罩／Escape 關閉、背景捲動鎖定與焦點管理；開關不重建頁面或清除草稿，換頁保留既有未儲存防護，桌面導覽不變。
- 依 `Style.md` 共用色彩、間距、卡片與表格規則
- 資料區塊提供載入、空資料、錯誤及成功狀態
- 操作完成後才顯示成功, 失敗時保留可修正的輸入
- 示範資料需標示「示範資料」, 未串接功能需標示「尚未串接」
- 以幫會管理者與成員看得懂的文字命名, 技術欄位留在必要的匯入或管理情境

## 驗證與交付

- 文件調整：確認連結、名稱、設定與兩份文件的敘述一致
- 前端調整：確認桌面與手機版面、鍵盤操作及必要畫面狀態
- 資料調整：使用隔離 MySQL確認新增、修改、查詢及失敗處理, 視變更檢查重複提交與並行寫入
- 本機資料調整：執行 `npm test`, 驗證 API 契約、MySQL 保存與 adapter 的成功／失敗處理
- 權限調整：以目標部署方式驗證允許與拒絕存取的情境
- 尚未有對應環境時, 如實寫出未驗證項目, 不宣稱已完成端到端測試
- 只有文件需求時交付文件, 應用程式與正式部署依後續使用者需求執行

## 參考來源

- 視覺基準：NSHM_history 的 style-guide.md（原本機參考）
- 版面參考：NSHM_history 的 AppHeaderLayout.vue（原本機參考）
- 表格與篩選參考：NSHM_history 的 Games.vue（原本機參考）

相鄰專案僅供原本機參考, 必要規則以本專案 [Style](../Style.md) 為準, 一般 clone 與部署不依賴相鄰專案
