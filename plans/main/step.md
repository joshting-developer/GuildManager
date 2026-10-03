# 首頁進度

- [x] 確認需求、風格規範與 Git 狀態
- [x] 記錄計畫與驗證方式
- [x] 確認 Vue／Vuetify 單檔編譯與本機／GAS 架構
- [x] 建立 Vue／Vuetify 首頁與 GAS 頁面入口
- [x] 建立本機預覽方式與操作說明
- [x] 建立 Docker、小型 API 與 SQLite 本機環境
- [x] 完成桌面、手機與互動檢查
- [x] 更新專案狀態並提交首頁

## 驗證結果

- Vue 3.5.43／Vuetify 4.2.3／Vite 7.3.6 實際編譯成功
- 本機 Node 與 Docker Linux 的 6 項 SQLite／API／adapter 測試全部通過
- SQLite 重啟保存既有資料, 未播種資料庫保持空資料與未知出勤值
- Docker 映像建立成功, frontend 與 api 啟動成功, api 健康檢查通過
- 瀏覽器驗證活動篩選、詳情、空白預覽、手機選單、鍵盤焦點返回與 API 失敗／重試
- 1440px 桌面與 1024／768／390／320px 版面無橫向溢出, 無 page error
- 桌面與手機截圖保存在 `artifacts/`, 不加入 Git
- 一般 build 與 GAS 單檔 build 成功, JS／CSS 內嵌於同一 HTML
- 實際單檔 HTML 約 520 KB, 以模擬 GAS bridge 渲染成功, 沒有 HTTP 或外部資源請求；缺少 bridge 時顯示錯誤, 不回退至假資料

## 限制

- 本機已驗證介面與 SQLite API, 尚未部署至 Google Apps Script
- 正式試算表尚未串接, 首頁資料均為本機 SQLite 中的示範內容
- GAS `getHomeData()` 尚未接入正式資料, 目前明確回報未串接
- 本機後端沒有正式登入或寫入 API, 不將此環境用於正式資料

## 活動安排後續進度

- 以上為首頁初版的歷史紀錄, 後續已移除示範資料與公告。
- 本次原始需求：「活動安排可以開始製作了；selector 是活動／約戰, 約戰只能選一天, 活動可選很多天」。
- 本次計畫與驗證記錄見 [event-scheduling-plan.md](event-scheduling-plan.md)。

- [x] 活動資料 API 與後端日期規則 (e6091ac)
- [x] 活動建立表單、首頁月曆與手機操作
- [x] 本機／Docker 40 個測試、瀏覽器流程與一般／GAS build

## 成員幫派／俱樂部狀態

- [x] 檢查乾淨工作目錄並記錄需求、假設及驗證方式
- [x] 資料欄位、相容遷移與 API 測試 (47 個測試通過)
- [ ] 清單、編輯與篩選介面、瀏覽器驗證及提交
