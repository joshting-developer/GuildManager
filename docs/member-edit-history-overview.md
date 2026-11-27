# 成員編輯歷程與最後更新時間（v2.2.4）功能介紹

> 狀態：開發完成、尚未 commit／部署。MySQL 整合測試與瀏覽器驗證尚未實跑，詳見「已知限制」。

## 1. 一句話總結

manager／admin 在成員清單操作欄點「編輯歷程」會從右側打開抽屜，依時間列出這位成員被哪個帳號改過、具體改了哪些欄位。上線前的歷程無法回溯。

## 2. 原本的問題與答案

| 問題 | 原本 | 這次 |
| --- | --- | --- |
| 有沒有最後更新時間？ | 有，`members.updated_at`，API 回傳 `updatedAt` | 不變 |
| 有沒有最後更新人？ | 沒有 | 從 `member_edit_logs` 的操作者快照查詢, 不另存成員最後更新人欄位 |
| 過去的編輯能追嗎？ | 無紀錄 | 不回填；舊資料只顯示既有 `updatedAt`, 無歷程時說明無法追溯 |

## 3. 使用者看到什麼

只有 manager／admin 看得到，member 看不到編輯歷程按鈕，直接呼叫 API 會回 403。

- **成員表格操作欄**：提供「編輯歷程」按鈕, 不另設最後更新欄。
- **右側抽屜**（`v-navigation-drawer`）：
  - 標題為「〇〇的編輯歷程」，下方顯示 UID 與既有 `updatedAt` 的最後更新時間（台北時間）, 無時間顯示「—」；有歷程可附上最新操作者。
  - 時間軸由新到舊，每筆包含時間、操作中文名稱、操作帳號，以及欄位變更清單「欄位：舊值 → 新值」。
  - 布林值顯示為「是／否」，職業顯示名稱，過去名稱以「、」串接。
  - 支援載入中、錯誤＋重試、空狀態（「尚無編輯紀錄。此功能上線前的編輯紀錄無法追溯。」），有下一頁時顯示「載入更多」。
  - 可用鍵盤關閉，關閉後焦點回到原按鈕；切換成員時會忽略過期的回應。

## 4. 運作方式

### 資料結構（migration `0011_member_edit_audit`、`0012_drop_member_updated_by`）

| 對象 | 內容 |
| --- | --- |
| `members` | 沿用 `updated_at`；不保存最後更新人欄位 |
| 新表 `member_edit_logs` | `id`、`member_uid`、`action`、`actor_account_id`、`actor_name`、`source`、`changes_json`、`created_at`；索引 `(member_uid, created_at, id)` |

### 會記錄的操作

| `action` | 抽屜顯示 | 觸發來源 |
| --- | --- | --- |
| `create` | 新增成員 | `POST /api/members` |
| `update` | 編輯成員 | `PATCH /api/members/:uid` |
| `remove` | 移至編外 | `DELETE /api/members/:uid` |
| `restore` | 重新加入 | 重新加入已移除成員 |
| `maintenance` | 資料維護 | `PATCH /api/members/:uid/maintenance`（含 UID 修正） |
| `import` | 匯入成員 | `POST /api/members/import` |
| `history_edit` | 編輯過去名稱 | `PATCH /api/members/:uid/history` |
| `permanent_delete` | 永久刪除 | `POST /api/members/:uid/permanent-delete` |

### 寫入規則

- **同一個 transaction**：稽核紀錄跟成員異動一起寫入；revision 衝突或交易失敗時不會留下紀錄。重送同一個 `requestId` 不會重複寫入。
- **只記實際變動**：比對 `uid`、`name`、`primaryProfession`、`secondaryProfession`、`isInGuild`、`isInClub`、`joinedAt`，沒有差異就不新增事件。
- **`changes` 格式**：`[{field, before, after}]`。職業記顯示名稱；過去名稱使用 `previousNames`，before／after 是名稱字串陣列，例如 `{ field: 'previousNames', before: [], after: ['早期名稱'] }`。
- **操作者**：`actorName` 取 session 帳號的 username 快照；共用 member 帳號沒有 username 時改用角色名稱；非 session 工具寫入時為 null。
- **UID 修正**：既有歷程會移到新 UID，並多記一筆 UID 差異。
- **永久刪除**：保留稽核並寫入 `permanent_delete` 事件，事後管理者仍可依 UID 查詢。名冊、過去名稱與有效關聯照原契約刪除。
- **不記錄的情況**：戰績同步只改 `battle_player_links`，不算成員編輯；migration 與舊資料搬移不回填。

## 5. API

`GET /api/members/:uid/edit-history`

| 項目 | 說明 |
| --- | --- |
| 權限 | manager／admin；member 回 403、未登入回 401 |
| 排序 | `changedAt`、`id` 由新到舊 |
| 分頁 | 每頁 200 筆；有更早資料時回 `nextCursor`，以 `?cursor=<nextCursor>` 取下一頁，沒有則為 `null` |
| 錯誤 | cursor 格式不合法回 400 `INVALID_CURSOR` |

```json
{
  "items": [
    {
      "id": "…",
      "uid": "…",
      "action": "update",
      "actorAccountId": "…",
      "actorName": "…",
      "changedAt": "2026-11-27T08:00:00.000Z",
      "source": "members",
      "changes": [{ "field": "primaryProfession", "before": "神相", "after": "鐵衣" }]
    }
  ],
  "nextCursor": null
}
```

`GET /api/members` 維持既有 `updatedAt`, 不回傳 `updatedBy`；操作者由歷程 API 查詢。

## 6. 審查後修正的項目

| 問題 | 修正 |
| --- | --- |
| 過去名稱的異動被記成 `leaveHistory`，抽屜誤顯示為「離開紀錄」 | 改為 `previousNames`，前端移除 `leaveHistory` 對照 |
| 過去名稱明細直接展開內部資料（`id`、`changedAt`） | 後端只存名稱字串陣列 |
| 後端固定 `LIMIT 200`，前端「載入更多」永遠不會出現 | 改為 cursor 分頁並回傳 `nextCursor`，無效 cursor 回 400 |
| 前端單元測試沒有納入 `npm test` | 加進 `tools/run-mysql-tests.js` |

## 7. 已知限制與待決事項

- **同 UID 重建**：永久刪除後以同一個 UID 重建成員，抽屜會接著顯示上一位成員的歷程，以「永久刪除」那筆作為分界。若要完全分開，需要另外加入成員生命週期識別，需要你決定要不要做。
- **migration**：0011 曾新增 `members.updated_by_*`；因 migration 有 checksum 驗證, 不改寫已套用的 0011, 改由 0012 移除兩欄。四組隔離 MySQL 測試 348 pass／0 fail／3 skip。
- **畫面未驗證**：桌面、手機、明暗主題的瀏覽器操作都還沒測。
- **發布說明**：changelog 與網站 release notes 已同步為前後端完成的 2.2.4。
- **尚未 commit、開 PR 或部署**。

## 8. 如何驗證

1. **自動測試**：設定 `GUILD_MYSQL_TEST_CONFIG`、`GUILD_MYSQL_MIGRATION_TEST_CONFIG`、`GUILD_MYSQL_SCHEMA_TEST_CONFIG`、`GUILD_MYSQL_REPOSITORY_TEST_CONFIG` 四組隔離設定後，執行 `npm test`。
2. **不需資料庫的檢查**：
   - `node --test tests/member-edit-history.test.js tests/member-edit-audit.test.js`
   - `npm run build`
3. **手動操作**（本地環境，套用 migration 後）：
   1. 以 manager 或 admin 登入，打開成員清單，確認操作欄有「編輯歷程」, 表格沒有最後更新欄。
   2. 編輯一位成員的職業或幫派狀態，確認抽屜的最後更新時間與 `updatedAt` 相符, 歷程顯示你的帳號。
   3. 點「編輯歷程」，確認抽屜出現「編輯成員」，且有「主職業：舊 → 新」這類明細。
   4. 新增一筆過去名稱，確認顯示為「編輯過去名稱／過去名稱：— → 新名稱」。
   5. 用維護功能修改 UID，確認舊歷程跟著移到新 UID。
4. **權限**：以 member 帳號登入，確認操作欄沒有「編輯歷程」按鈕；直接呼叫 `GET /api/members/<uid>/edit-history` 應回 403。

## 9. 異動檔案清單

| 檔案 | 用途 |
| --- | --- |
| `server/database/migrations/0011-member-edit-audit.js` | 成員編輯稽核資料表 |
| `server/database/migrations/0012-drop-member-updated-by.js` | 移除 0011 新增的兩個最後更新人欄位 |
| `server/database/migrations.js` | 註冊 0011、0012 migration |
| `server/mysql/member-edit-audit.js` | 差異比對、寫入稽核與操作者快照 |
| `server/mysql/repository.js` | 新增、編輯、移除、匯入時寫稽核；`getMemberEditHistory` 與 cursor 分頁 |
| `server/mysql/member-maintenance.js` | 維護、UID 修正、過去名稱、永久刪除時寫稽核 |
| `server/mysql/store.js` | 對外開放 `getMemberEditHistory` |
| `server/app.js` | 新路由與權限；各寫入路由傳入操作者 |
| `src/api/members.js` | 新增 `getMemberEditHistory(uid, cursor)` |
| `src/domain/member-edit-history.js` | 操作／欄位中文對照、值與時間格式化 |
| `src/components/MemberEditHistoryDrawer.vue` | 編輯歷程抽屜 |
| `src/pages/MembersPage.vue` | 操作欄編輯歷程按鈕、傳入 updatedAt、掛載抽屜 |
| `docs/member-contracts.md` | 新增「成員編輯稽核（2.2.4）」契約 |
| `docs/changelog-2.2.4.md` | 2.2.4 前後端發布摘要 |
| `package.json`、`package-lock.json` | 版號 2.2.4 |
| `tools/run-mysql-tests.js` | 把兩個新單元測試加入 `npm test` |
| `tests/member-edit-audit.test.js` | 差異比對單元測試 |
| `tests/member-edit-history.test.js` | 前端中文對照與格式化測試 |
| `tests/mysql-contracts/members.test.js`、`tests/mysql-scenarios/member-maintenance.test.js` | 稽核寫入、UID 移轉、重送不重複、永久刪除保留、分頁 |
| `tests/mysql-http/members.test.js`、`tests/mysql-http/auth.test.js` | 路由權限（403／401） |
| `tests/mysql-schema.test.js`、`tests/fixtures/mysql-schema-contract.json` | schema 契約更新 |

`Memory.md` 也補了這次的紀錄，但它在 `.gitignore` 裡，不會進版控。
