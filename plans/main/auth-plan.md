# 本機登入與管理頁保護

## 需求與假設

- 首頁右上提供登入, 只有登入者可進入管理總覽、成員、活動安排及戰場排表
- 先使用本機帳號密碼, SQLite 保存帳號及 session；不新增註冊、角色管理或 Google 部署
- 公開行事曆與既有報名／請假維持可用, 報名成員選單改讀最小公開資料, 不公開成員歷史與管理資料
- 帳號登入與遊戲 UID 的本人驗證分開, 本次不建立 UID 綁定
- 沿用 #/magament, 同時接受 #/management 的管理總覽網址
- Google 登入後續需確認 OAuth client 與 GAS 部署方式；Session.getActiveUser() 並非在所有部署模式都能取得 Email
- 既有 15 張資料表保持原資料, 新增獨立帳號／session 表；密碼 scrypt 雜湊, session HttpOnly cookie, 管理修改檢查 CSRF
- 本機初始帳號使用隨機密碼, 保存於已忽略的 data/local-admin.json, 不提交憑證

## 步驟與驗證

- [x] 後端帳號、登入／登出／session、API 權限、帳號建立工具與回歸測試, 99 項通過
- [x] 首頁登入視窗、導覽／網址保護、API session adapter、文件與瀏覽器測試, 隨介面步驟提交
- [x] Docker 建立本機帳號, 原有 15 張表逐筆一致、101 位成員保留, 正常／GAS 編譯與 Docker 104 項測試通過

驗證包含錯誤密碼、限速、過期、登出撤銷、重啟保存、匿名拒絕、CSRF 拒絕、公開報名可用、直接管理網址、桌面／手機／鍵盤及 API 不洩漏密碼／session 雜湊。測試使用隔離 SQLite, 日常資料先備份至 /data/backups/auth-before-1791037857341.sqlite

## 完成驗證

- 後端提交：9c1f3ff, 99 項通過；加入前端 adapter 測試後本機／Docker 各 104 項通過
- Chrome 隔離測試：匿名管理 API 401、錯誤／正確密碼、重新整理保留 session、無 CSRF 修改 403、登出後 401、management 別名與重新登入原頁
- 鍵盤 Enter 登入、Escape 關閉／焦點返回；320／390／768／1024／1150／1200／1440px 無頁面橫向溢出, 手機管理選單可用, 無 Vue 警告或 pageerror
- 公開行事曆能以最小選單送出請假；登入後透過實際成員新增表單提交, 自動附加 CSRF 成功；這些資料只寫入 /private/tmp/guild-auth-ui-20261003.sqlite
- 日常 Docker：私有設定建立 admin, 首頁登入讀取既有 101 位成員並登出；播種指令已登入且新增 0／跳過 100, 所有原資料再次比對一致
- 私有設定 data/local-admin.json 為 0600 且被 Git 忽略, 密碼沒有寫入輸出或提交
- npm run build／build:gas 通過, GAS Index.html 約 836 KB, 無外部 JS／CSS, Code.gs 語法及未設定 auth 函式打包通過
- 尚未驗證 Google OAuth、GAS 部署、本人 UID 綁定及正式試算表；本次只完成本機帳號密碼與管理功能保護
