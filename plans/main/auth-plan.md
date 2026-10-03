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
- [ ] 首頁登入視窗、導覽／網址保護、API session adapter、文件與瀏覽器測試, 驗證後提交
- [ ] Docker 建立本機帳號, 驗證原資料未改、正常／GAS 編譯與 Docker 測試, 完成交付

驗證包含錯誤密碼、限速、過期、登出撤銷、重啟保存、匿名拒絕、CSRF 拒絕、公開報名可用、直接管理網址、桌面／手機／鍵盤及 API 不洩漏密碼／session 雜湊。測試使用隔離 SQLite, 日常資料先備份至 /data/backups/auth-before-1791037857341.sqlite
