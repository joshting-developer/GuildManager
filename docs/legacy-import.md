# GAS 舊資料匯入 MySQL

把舊版 Apps Script 的 Sheets 匯出檔（`GuildManagerDataBase.xlsx`）轉成 v2 MySQL 資料。舊站仍在使用, 正式轉移時一律重新下載最新匯出檔, 用同一套規則重跑, 不手動修改匯出檔或資料庫

## 使用方式

```sh
# 預覽：不連資料庫, 產生報告
node tools/import-legacy-gas.js --source GuildManagerDataBase.xlsx --report .local/legacy-import

# 寫入：DB_* 指向剛完成 db:migrate 的空資料庫, --database 必須與 DB_DATABASE 相同
node tools/import-legacy-gas.js --source GuildManagerDataBase.xlsx --report .local/legacy-import --apply --database <DB_DATABASE>
```

- 報告 `legacy-import-report.json` 含成員名稱與 UID, 只放忽略目錄, 不提交、不貼卡片
- 有規則未處理的異常時結束碼為 3 且不寫入；補上規則與決定後重跑
- 寫入使用單一交易, 只接受剛建立的空資料庫：除了 migration 種子職業／職責／平台設定以外都必須是空的, 帳號表不檢查。職業與平台名稱以舊資料覆蓋, 種子職責換成舊職責
- 只用 Node 標準函式庫讀 xlsx, 不需要額外套件

## 舊資料格式

每張 `GM_<table>` 只追加不覆寫：同一 `record_id`（JSON 字串）每次修改新增一代, `payload_base64` 是 `{"value": ...}` 或 `{"deleted": true}` 的 UTF-8 JSON, 過長時依 `part_number` 分段。`GM_commits` 是唯一提交依據, 沒有提交紀錄的列是失敗寫入, 一律忽略；同 key 取最後提交的一代, 分段不完整直接停止, 不退回舊代。xlsx 會把分段欄位匯出成 `"0.0"` 這類字串

## 對應

| 舊表 | v2 |
|---|---|
| professions／settings `platform` | professions／platform_settings（名稱與 revision） |
| duties | duties |
| members／name_history | members／member_name_history |
| events | scheduled_events＋event_dates（`deletedAt` 照原值保留） |
| responses／registrations | event_member_responses／event_registrations |
| videos | event_video_submissions |
| lineup_versions／templates | lineup_versions（snapshot 為 event＋teams）／lineup_templates |
| battles＋battle_players／battle_links | battle_uploads（每筆戰績一筆）＋battle_records／battle_player_links |
| requests `member-ref:<kind>:<id>` | member_reference_overrides |
| requests `member-revision:<uid>` | member_uid_revisions |
| lottery `default` | lottery_boards（整份看板 JSON） |

- 舊資料沒有 v2 的 requestId, 以 `legacy-<種類>:<舊 id>` 填入, 不會跟新操作重複；`payload_json` 為 `{}`
- 其他 requests 是舊站的重送結果, 不搬
- 戰績玩家資料照原樣保存, 包含舊站存在玩家列裡的 `memberUid`／`creditedName`, 讀取時一樣以 battle_player_links 覆蓋 `memberUid`, 與舊站行為相同
- 戰績 CSV 與平台圖示不在 Sheets：`csv_text` 留空、`csv_file_id`／`icon_file_id` 留 NULL, 由 R2 匯入（GM-30）補上
- 帳號、Session 與登入限制存在 Script Properties, 不在匯出檔, 也不匯入：舊 admin／manager 帳號一律不沿用, 部署時依[平台契約](platform-contracts.md#v2-初始管理員與歷史操作者)建立 admin, manager 與成員通行密碼上線後由 admin 在帳號管理重新設定
- 舊資料沒有操作者／建立者欄位；將來若出現, 依[平台契約](platform-contracts.md#v2-初始管理員與歷史操作者)對應到目標庫的 admin

## 清洗規則

規則依資料特徵判斷, 不寫死個別紀錄, 新匯出檔出現同樣情況會自動套用。報告逐筆列出命中的紀錄與保留／捨棄結果。原則：用不到才不要, 判斷前要查過陣容、範本、戰績玩家、戰績連結與出席回覆

| 規則 | 條件 | 處理 | 理由 |
|---|---|---|---|
| R1 | 改名紀錄為 `'同門'<數字>` | 保留 | 遊戲 CSV 對未顯示名稱玩家的佔位名, 戰績同步會用曾用名比對, 名稱內含本人 UID |
| R2 | 改名紀錄等於目前名稱 | 保留 | 改名後又改回原名的真實歷史 |
| R3 | UID 為 6 個以上的 0 加最多 3 位數 | 有被使用才保留 | 手動建立的補位成員；使用包含陣容、範本、戰績玩家、戰績連結、出席回覆, 成員對應修正不算使用 |
| R4 | 外部報名名稱為 6 位以上純數字 | 有被使用才保留 | 疑似把 UID 填進名稱, 無法辨認本人原意 |
| R5 | 參照的成員／場次／戰績／排表／範本不存在 | 捨棄 | 例如已刪除成員留下的 UID 版本紀錄 |

會讓匯入停止、需要先決定的異常：未知的場次類型／出席狀態／影片分組／勝方, 職業對不到, 日期格式錯誤, 同場次重複的有效報名名稱或排表版本, 戰績缺玩家或人數不符, 文字超過 v2 欄位長度, 以及無法辨識的 requests／settings 紀錄
