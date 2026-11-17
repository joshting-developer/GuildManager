# 測試與建置 CI

`.github/workflows/verify.yml` 在 pull request、`main`／`patch-2.0.0` push 或手動執行時跑測試與建置。權限只有 `contents: read`, checkout 不保留 Git credential；不讀正式 Secrets、不發布映像、不建立 Tag、不部署網站

工作依序安裝 lockfile 套件、建立四個隔離 MySQL 測試庫、複製公開測試 CA、執行 Node／Python 安全測試、前端 build 與 production／development Docker build。GitHub hosted runner 使用自己的 MySQL 8.4 service, 不連維護者本機的共用服務或正式資料庫；service root 密碼為公開合成 fixture, 只供該次工作初始化使用

`tools/setup-ci-mysql.js` 只在明確的 GitHub CI 環境與指定臨時埠執行, 拒絕本機共用埠 13306。初始化先確認四庫與四帳號不存在, 不重設既有庫；各帳號只有自身測試庫的 migration／CRUD 權限。連線設定保存在 `.local/ci/`、權限 0600, 不上傳 artifact。測試不持有 root；只有初始化步驟持有合成 service root 密碼

CI 沒有真 R2 憑證, 因此專用 R2 整合案例會明確略過；MySQL、業務、HTTP、TLS 拒絕及工具安全測試仍須通過。真 R2、本機瀏覽器與實際 HTTPS 代理驗收另行執行, 不因 CI 綠燈就宣稱全部通過

Actions 固定到已核對的 commit, 用法依官方 [checkout](https://github.com/actions/checkout) 與 [setup-node](https://github.com/actions/setup-node)。此流程未配置發布／部署 job；正式版本 Tag、受控 Environment Secrets、部署核准與回滾需另行設定並實際驗收
