# GuildManager 工程與產品契約入口

本專案是逆水寒幫會管理平台, 介面與操作訊息使用繁體中文, 日曆日期與顯示時區採 Asia/Taipei

2.0.0 遷移以 Node／MySQL／R2 為目標, 保留既有介面與功能；已開始 [MySQL 開發與隔離驗證](mysql-development.md), 後端寫法依 [Node.js 分層規範](nodejs-architecture.md), HTTP 服務已接上 MySQL 非同步 Repository, 新檔案已接 R2 metadata, 新版前端統一透過同源 `/api` 呼叫 Node, 部署尚未切換。正式舊資料在最後階段才匯入, 不把開發中的元件當作已切站

- 前端 Vue 3／Vuetify／Vite, 後端 Node.js／Express／MySQL；共用服務與追蹤工具不改變本專案技術棧
- 沿用 session／角色／CSRF、revision／requestId、不可變快照, 不因採用共用 Skill 更換登入、授權或資料模型
- admin／manager／member 與匿名各有明確範圍, 不能套用其他產品的 Workspace／permission 模型取代既有後端驗權；完整權限見下表
- 已取消幫會公告, 不自行加回。Discord 以已確認 Webhook 為範圍, 頻道輪詢與排程不因存在審查方案就視為已實作或獲准安裝
- 正式初始化、資料搬移與對外部署各須當次授權；build、資料匯入、對外發布分開驗證與回報

| 修改範圍 | 開工前讀取 |
| --- | --- |
| 架構、安全、角色、MySQL／物件儲存 與驗證 | [工程契約](engineering-contracts.md)、[Architecture](../Architecture.md) |
| 2.0.0 的 Node.js 後端分層、async／交易／錯誤／驗證／測試寫法 | [Node.js 分層規範](nodejs-architecture.md)、[MySQL 開發說明](mysql-development.md) |
| 成員名冊、匯入、UID、過去名稱及永久刪除 | [成員契約](member-contracts.md)、[維護操作](成員資料維護.md) |
| 活動、出勤、報名／請假、排表、範本、影片 | [活動與排表契約](event-lineup-contracts.md) |
| 戰績上傳／刪除／編輯、歸屬、個人與分團分析 | [戰績契約](battle-contracts.md) |
| 帳號密碼、品牌、導覽、等待、抽獎、Discord | [平台與整合契約](platform-contracts.md) |
| 介面與互動 | [Style](../Style.md)、相關領域契約 |

契約修改時更新對應文件, 不把規則或卡片歷史累加回個人開發入口。公開產品文件不依賴個人的 Skill 絕對路徑；歷史交付與環境實際狀態由維護者的私人索引查閱

Node 私有檔案、MySQL metadata 與既有 API 接線見 [R2 私有檔案服務](r2-storage.md), 正式舊檔案不自動移轉。
