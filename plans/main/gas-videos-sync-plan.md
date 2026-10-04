# 影片功能 GAS 同步

- 將已確認的單一影片表單、五欄閱覽、篩選及 CSV 匯出開放於 GAS。
- 新增 GAS RPC：getEventVideos／submitEventVideo；只保存連結／團別／備註，不上傳影片檔案。
- 沿用原場次可見性與 CSRF；member 可提交但不能讀清單，admin／manager 可讀。
- 試算表追加 GM_videos，使用既有 script lock、Base64 JSON 與提交 marker，影片與 requestId 回應同次提交。首次有效使用補建此表，不覆寫其他表；不遷移本機資料。
- 修正網址驗證，不依賴 Apps Script 不提供的 Web URL API；來源：https://developers.google.com/apps-script/guides/v8-runtime
- 隔離 GAS 測試驗證角色、重試、過期場次、部分寫入、無 URL 全域與舊已初始化表。
- 編譯／完整測試／實際編譯 HTML 與模擬 RPC 瀏覽器驗證後 commit，再使用既有 gas:push 備份遠端、上傳四檔與讀回比對。
- 本次同步指令碼程式；不直接執行正式試算表初始化、不改憑證或現有部署版本。

## 同步前驗證

- npm test：189／189 通過，含 GAS 權限、CSRF、防重試、場次版本、部分寫入失敗及舊表補建。
- npm run build 與 npm run build:gas 通過；GAS 四檔／單 HTML 無外部 JS／CSS，後端沿用 ES2019。一般 build 保留既有大於 500 kB 的 bundle 提醒。
- 使用實際編譯 Index.html、Chrome 與隔離模擬 Google RPC 驗證匿名約戰、member 幫戰提交、admin／manager 五欄閱覽、篩選 CSV 實際下載及重載保存；無 HTTP fallback／外部資源／瀏覽器錯誤。
- 桌面 1440px 與手機 390px 驗證無整頁橫向溢出；網址僅文字，member 無閱覽入口。
- 真實雲端授權、試算表讀寫與 iframe 下載尚未實測；同步程式不宣稱正式 Web App 已更新。
