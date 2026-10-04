# GAS admin 登入復原

- 使用者已確認管理者登入回報密碼錯誤；本機編譯沙盒可正常登入，無法據此確認正式帳號的初始密碼或推定真正原因。
- 保留名冊、戰績、帳號 ID 及 manager／member；提供編輯器 resetAdminPassword 入口，沿用 Google active／effective email 非空且相同的身分檢查，部署方式仍須以部署者執行。
- 使用者於私有 Script Properties 填 RECOVERY_ADMIN_PASSWORD（12–128 字元）後自行執行；不要求貼密碼，也不由工具讀出／執行正式復原。
- script lock 下重設唯一 admin 雜湊、增加 revision、撤銷 admin sessions、移除該帳號的失敗計數；成功才刪除明文復原屬性，不更改其他帳號或業務資料。
- 測試未授權拒絕、缺少／無效密碼、無 admin、成功登入、舊密碼拒絕、session 撤銷、其他角色及業務資料保留、RPC 不可呼叫。
- 執行完整測試與雙編譯，同步 GAS 並讀回比對，提交本機 Git；真實重設及登入結果由使用者確認。

## 結果

- 復原／初始化相關測試 3/3 通過，完整測試 177/177 通過；兩種編譯通過。
- 2026/10/05 已同步四檔且讀回比對一致，備份 data/gas-backups/2026-10-04T18-10-10-717Z（忽略目錄）。未讀取正式密碼、未執行復原或重新部署 Web App。
- 使用者下一步：新增 RECOVERY_ADMIN_PASSWORD → 重新整理編輯器 → Code.gs 選 resetAdminPassword → 執行後以紀錄中的帳號與新密碼從管理者登入。
