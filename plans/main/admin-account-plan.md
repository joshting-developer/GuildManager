# Admin 帳號與公開報名驗證

## 需求與假設

新增僅 admin 可用的帳號管理頁：修改自己的密碼、建立／修改 manager 與 member 帳號及密碼。保留本機登入與既有資料。manager 使用既有管理功能但無帳號管理權限；使用者已改為 member 帳號密碼, 由 admin 發行；member 不可使用管理介面, 不綁定遊戲 UID。

公開行事曆的幫戰／龍虎戰先要求帳號密碼驗證, 驗證後名稱輸入改為直接輸入／幫會成員／龍虎戰成員三頁, 後兩者依 isInGuild／isInClub, 兼屬成員可在兩頁出現。保留職業、報名／請假及備註、職業統計與成功提示, 約戰仍公開直接填寫。UID 不顯示。請假沿用既有取消效果及找不到資料的提示。

## 步驟

1. 帳號角色與 revision 升級, admin-only API、改密碼與 manager／member 管理頁、導覽與文件。舊無角色帳號升級時優先名稱 admin, 否則最早建立帳號成為 admin, 其他為 manager；不重設密碼。首個 CLI 帳號為 admin, 後續預設 manager。密碼變更撤銷相關其他 session, 競爭更新須重新載入。驗證後獨立 commit。
2. member 與其他登入帳號沿用 scrypt 密碼及 HttpOnly session, admin 建立／更新 member 帳號, 修改帳號撤銷旧登入；公開行事曆對幫戰／龍虎戰要求登入 member／manager／admin, 不使用共用通行碼。幫戰／龍虎戰讀取與修改、舊報名 API 均檢查登入, 管理端可憑登入與 CSRF 操作。公開選人端點只回傳必要名字／職業／分類, 不回傳歷史或備註；選名冊人員以內部 UID 解除同名歧義, 不修改名冊。驗證完成後維持登入, 切換場次可沿用有效 session。驗證後獨立 commit。

## 驗證

隔離 SQLite／API 驗證 migration、權限、CSRF、密碼非明文、session 撤銷、版本衝突與重啟持久化；驗證未登入／錯誤密碼／過期／撤銷 session 皆不能繞過, 約戰不受影響, manager 代報仍可操作。全套 npm test、一般與 GAS 編譯、差異檢查；隔離瀏覽器檢查 admin／manager 路由、三種名稱來源、報名／請假與同名、成功／失敗保留輸入、手機與鍵盤。測試不使用日常資料庫或正式試算表。GAS 僅新增明確尚未串接的介面, 不宣稱部署完成。

## 帳號管理階段驗證

133 項全套測試通過, 含 admin／manager／member 權限、CSRF、舊帳號升級、密碼雜湊、版本競爭及 session 撤銷。隔離 Chrome 完成 admin 密碼修改、manager／member 建立與修改、錯誤保留、角色路由與入口、Enter 提交及 320–1440px 無整頁溢出。一般／GAS 編譯通過, 沿用既有大於 500KB 提示；未讀寫日常資料庫或正式試算表。公開幫戰／龍虎戰的登入要求及三種選人方式於下一步完成。
