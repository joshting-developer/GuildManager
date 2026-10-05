# GAS 最新程式同步與部署準備

## 範圍

- 使用者要求先同步 GAS，再準備部署。
- 同步來源：`8bee302`，包含成員歷史關聯與分析篩選、出勤閱覽、對戰資訊編輯、member 成員管理、載入提示、手機抽屜及品牌快取等已提交功能。
- 沿用指定的指令碼與已授權的 clasp；編譯四檔，先備份遠端、覆蓋並讀回比對。
- 同步後唯讀確認現有部署資訊，整理更新現有／首次建立 Web App 的步驟。
- 本步不執行 setupGas、不修改帳號／Script Properties／正式資料，也不直接發布新 Web App 版本。

## 驗證

- 最新來源已通過 212 項測試、一般／GAS 編譯與隔離模擬瀏覽器驗證。
- 本次 gas:push 重新編譯並確認四檔與遠端一致。
- 部署說明以 Google 官方文件及實際部署資訊為準，不把上傳當成部署或端到端驗證。

## 結果

- 2026/10/05 11:52（Asia/Taipei）執行 `npm run gas:push`：重新編譯成功，上傳四檔後讀回比對完全一致，Google 接受程式語法。
- 遠端前後備份：`data/gas-backups/2026-10-05T03-52-25-114Z/before` 與 `after`，私有忽略路徑，不提交。
- 同步來源為 `8bee302`；GAS 前端約 990 KB，無外部 JS／CSS；套件包含 Code.gs、Backend.gs、Index.html、appsscript.json。
- 唯讀查詢部署 API：存在 HEAD 及第 3 版 Web App；已發布版本說明 `v1.0.2`，部署 ID `AKfycbwk1B2IdFlpLbeFF2Ti4hgkYTdLsWlcZVGyiSlb2OXDS1TNpoFTUUtlCAf52QTNTP0i`。兩者設定皆為 `USER_DEPLOYING`／`ANYONE_ANONYMOUS`。
- 已發布網址：https://script.google.com/macros/s/AKfycbwk1B2IdFlpLbeFF2Ti4hgkYTdLsWlcZVGyiSlb2OXDS1TNpoFTUUtlCAf52QTNTP0i/exec
- 下一步可從「部署 → 管理部署作業 → v1.0.2 → 編輯 → 新版本 → 部署」更新既有部署，保留原網址。建議新版本說明 `v1.0.3 · 成員管理、出勤閱覽、手機導覽與品牌快取`；此說明是建議，尚未建立版本。
- 未修改既有部署、帳號、Script Properties、試算表或 Drive 資料，也未代使用者執行初始化。正式登入／授權／讀寫與 iframe 行為仍待新版本發布後實測。
- 部署依據：[Google 版本部署](https://developers.google.com/apps-script/concepts/deployments)、[Google Web Apps](https://developers.google.com/apps-script/guides/web)。
