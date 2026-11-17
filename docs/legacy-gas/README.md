# 舊版 GAS 參考

GAS 程式與建置／同步工具已從現行版本移除。此目錄保留舊工作表、Drive、驗證與發布說明，供 GM-28／GM-29 資料搬移查閱，不是現行操作指令。不要依此執行線上初始化、同步或部署。

## 移除前原始碼

移除前完整原始碼：`b34f88f542b9a29ee5bfcca1b72f546651b69f60`。`v1.0.31` 的 `gas/`、GAS 工具與 RPC adapter 內容相同，但整份工作樹不同。可用 `git show <commit>:<path>` 查閱，不需將舊實作放回現行 build。

- [部署與工作表格式](GASDeployment.md)
- [併發與提交](GASConcurrency.md)
- [效能研究](GASPerformanceSurvey.md)
- [效能契約](gas-performance-contracts.md)
- [歷史發布流程](gas-release.md)

程式移除不代表資料已搬移、線上 GAS 已停用或 Node 網站已切站。私人憑證、備份與遠端資源不在本次移除範圍。
