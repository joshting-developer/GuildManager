# 新增幫戰與龍虎戰安排

## 需求與假設

- 活動安排加入幫戰、龍虎戰, 和活動一樣可選 1–366 個不連續日期。
- 約戰仍限制一天, 多日類型之間切換保留日期, 轉約戰時清除多選並提示。
- 建立、修改、類型篩選、刪除確認與首頁月曆均顯示正確類型。
- 類型值使用 guild_war／dragon_tiger, 不新增幫戰結果、報名或其他欄位。
- 舊 SQLite 的兩類型 CHECK 約束需相容遷移, 保留安排、日期、版本、建立識別與已刪標記。

## 步驟

1. 擴充後端允許類型及 SQLite CHECK 約束, 測試新類型與舊資料遷移後提交。
2. 共用前端類型名稱／選項, 更新單日／多日選取、清單／月曆與文件, 驗證後提交。

## 驗證方式

- 隔離 SQLite 驗證新類型建立、編輯、多天、日期限制與重啟保存。
- 驗證兩類型舊 schema 遷移, 保留 ID、revision、request_id、deleted_at、所有日期及外鍵, 遷移失敗回滾。
- 瀏覽器驗證建立／編輯、類型切換、篩選、刪除確認、首頁詳情與日期格建立, 桌面／手機及鍵盤。
- 既有測試、Docker 測試、一般／GAS 編譯, 不在日常資料庫新增測試安排。

## 進度

- [x] 檢查乾淨 Git 狀態並記錄範圍
- [x] 後端與遷移驗證, 提交此步驟
- [ ] 前端、文件及整合驗證後提交

## 遷移方式

- 修改前使用 SQLite 線上備份保存 Docker 日常資料至 /data/backups/。
- 依 [SQLite 官方 schema 修改流程](https://www.sqlite.org/lang_altertable.html#making_other_kinds_of_table_schema_changes) 在交易中建立新表、複製資料、替換原表並檢查外鍵；失敗時回滾, finally 恢復外鍵設定。
- 只更換 scheduled_events 的 CHECK 約束, 保留 event_dates、既有索引／觸發器, 不寫入測試安排至日常資料庫。

## 資料步驟驗證

- 61 項測試通過, 新增 4 項多日類型與 CHECK 遷移測試, 覆蓋 366 天上限、重試、修改、重啟、索引／觸發器保存及失敗回滾。
- Docker 日常資料遷移後與事前備份逐筆比較安排、日期、成員一致, 外鍵檢查通過。
- 備份：/data/backups/guildmanager-before-event-types-1791024491051.sqlite (位於持久 volume)。
