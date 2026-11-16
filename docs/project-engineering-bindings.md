# GuildManager 工程與產品契約入口

本專案是逆水寒幫會管理平台, 介面與操作訊息使用繁體中文, 日曆日期與顯示時區採 Asia/Taipei

- 前端 Vue 3／Vuetify／Vite, 本機後端 Node.js／Express／SQLite, GAS 使用 V8／HTML Service／Google 試算表與私人 Drive。共用 MySQL／Redis 或 TaskTracker 的 Laravel 架構不代表本專案已遷移
- 元件經 src/api adapter 呼叫 HTTP 或 google.script.run, SQL 留 repository。沿用 session／角色／CSRF、revision／requestId、不可變快照及 GAS commits／flush／script lock, 不因採用共用 Skill 更換登入、授權或資料模型
- admin／manager／member 與匿名各有明確範圍, 不能套用其他產品的 Workspace／permission 模型取代既有後端驗權；完整權限見下表
- 已取消幫會公告, 不自行加回。Discord 以已確認 Webhook 為範圍, 頻道輪詢與排程不因存在審查方案就視為已實作或獲准安裝
- 正式初始化、資料搬移、Script Properties 與對外部署各須當次授權；build、GAS 程式同步、Web App 發布分開驗證與回報

| 修改範圍 | 開工前讀取 |
| --- | --- |
| 架構、安全、角色、SQLite／Sheets 與驗證 | [工程契約](engineering-contracts.md)、[Architecture](../Architecture.md) |
| 成員名冊、匯入、UID、過去名稱及永久刪除 | [成員契約](member-contracts.md)、[維護操作](成員資料維護.md) |
| 活動、出勤、報名／請假、排表、範本、影片 | [活動與排表契約](event-lineup-contracts.md) |
| 戰績上傳／刪除／編輯、歸屬、個人與分團分析 | [戰績契約](battle-contracts.md) |
| 帳號密碼、品牌、導覽、等待、抽獎、Discord | [平台與整合契約](platform-contracts.md) |
| 資料讀寫、RPC、快取、效能與併發 | [GAS 效能契約](gas-performance-contracts.md)、[讀寫依賴](../GASConcurrency.md) |
| 版本定版與 GAS 同步 | [發布流程](gas-release.md) |
| 介面與互動 | [Style](../Style.md)、相關領域契約 |

契約修改時更新對應文件, 不把規則或卡片歷史累加回個人開發入口。公開產品文件不依賴個人的 Skill 絕對路徑；歷史交付與環境實際狀態由維護者的私人索引查閱
