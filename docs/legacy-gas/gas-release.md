> 歷史參考：此文件描述移除前 GAS，所有命令與狀態均非現行操作流程。來源見 [索引](README.md)。

# GAS 版本定版與程式同步

本文保留既有產品契約, 供相關修改時按需查閱；實作協議另見 [Architecture](../../Architecture.md), 介面依 [Style](../../Style.md)。原文的版本、驗證及「尚未部署」敘述是當時紀錄, 不代表目前遠端狀態；現行同步方式見 [GAS 發布流程](gas-release.md)

## 發布版本與 GAS 同步

以下為 2026/10/27 使用者最新規則，取代歷史交接中「開發完成就預先升 patch」的做法；GAS 程式同步與 Web App 發布仍分別記錄。

- 更新紀錄由 `ReleaseNotesPage.vue` 靜態匯入 `src/content/release-notes.json`，隨 Vite／GAS 單檔編譯一起交付，不會執行期從 GitHub／GitHub Releases 讀取。修改本機 JSON 不會自動改變已發布網站。
- 尚未準備同步 GAS 的功能與修正，一律累積到唯一置頂的 `{ "version": "Unreleased", "date": null, ... }`；畫面顯示「未發布／累積中」，不猜未來版號或預填發布日期。已有 Unreleased 時更新同一筆，不建立多筆草稿；保留所有正式歷史紀錄。
- 平常開發不執行 npm version patch；`package.json` 與 lockfile 保持最近已定版版本。有 Unreleased 時本機／測試編譯的頁尾顯示「未發布」，更新紀錄頁說明最近定版版本，避免把開發內容標成已交付版本。正式版號的唯一來源仍是 package.version，Vite 透過 __APP_VERSION__ 帶入，不手改 App.vue 或編譯產物的數字。
- 使用者明確要求同步 GAS／交付新版本時，先盤點並整併全部 Unreleased 內容，依最近已確認同步的正式版本與實際交付紀錄決定下一版，預設沿用 1.0.x 遞增 patch；major／minor 依明確指示。於**編譯與上傳前**執行 `npm version patch --no-git-tag-version --ignore-scripts` 同步 package／lockfile，把該 Unreleased 條目改成正式版與當天台北日期 YYYY-MM-DD，保留內容，提交功能／版本檔後再同步；定版後不另外保留空白 Unreleased 條目。
- 「只有 GAS 同步的新批次才升一次版本」仍適用；未發布內容持續累積，不因每次功能 commit 或文件整理升版。同步失敗、同批重試或已定版未成功上傳時保留原定版與待同步狀態，先檢查實際遠端／交付紀錄，不能再次升 patch；成功同步後的新改動重新建立 Unreleased。
- 每次功能／修正都更新 Unreleased（或同步前正在定版的同一筆），分類沿用「新功能／效能／修正／其他」，以繁體中文描述使用者可見變化，不把 commit 或部署成功當作功能說明。不要預先把未同步內容塞進已交付正式版，也不要因升版改動 lockfile 的套件依賴版本。
- 開發提交／測試編譯可包含 Unreleased；同步前必須核對沒有 Unreleased、package／lockfile／正式 release note／編譯頁尾版本相符且正式條目唯一。定版與上傳之間有改動就補同一版，不重複升版。尚未成功同步時不得記成已交付；Web App 部署狀態不得由 package 或更新紀錄推測。
- 先檢查與提交本次功能、修正及版本檔；文件／規範可獨立提交。本機步驟 commit 沿用既有授權；只有使用者本輪明確要求才 push Git 或同步 GAS，憑證、遠端備份及私有資料不提交。
- `npm run gas:push` 會編譯、備份遠端、同步四檔並讀回比對，本身**不會自動把 Unreleased 定版或升版**；執行者須先完成上述定版步驟。成功後將來源 commit、正式版號與備份記在私人交付紀錄, 更新本機 Memory 索引；通用同步操作留在本文件
- GAS 程式同步與 Web App 發布不同；除非另外明確授權發布，不更新對外部署、不執行 setupGas，也不改正式試算表或 Script Properties。回報分清「已同步程式／已發布／尚未交付」。
