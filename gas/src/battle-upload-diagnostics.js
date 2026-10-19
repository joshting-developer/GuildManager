const STAGES = {
  LOCK: '等待儲存鎖',
  SETTINGS: '讀取雲端設定',
  AUTH_READ: '讀取登入資料',
  AUTH_CHECK: '檢查登入權限',
  AUTH_SAVE: '保存登入狀態',
  SHEETS_OPEN: '開啟戰績試算表',
  SHEETS_READ: '讀取試算表資料',
  SHEETS_WRITE: '寫入試算表資料',
  SHEETS_FLUSH: '確認試算表寫入',
  SHEETS_COMMIT: '提交儲存標記',
  DRIVE_CSV: '保存原始 CSV',
  DRIVE_IMAGE: '保存附件',
  PROCESS: '處理戰績資料',
  UNKNOWN: '雲端處理',
};
const CATEGORIES = {
  TIMEOUT: '服務逾時', AUTHORIZATION: '服務授權', PERMISSION: '存取權限',
  QUOTA: '服務配額', NOT_FOUND: '資源不存在', UNEXPECTED: '未預期錯誤',
};

function category(error) {
  // Inspect the message only to choose a fixed category. Never copy it to logs or the response.
  const message = typeof error?.message === 'string' ? error.message : '';
  if (/timed?\s*out|timeout|逾時|超時|超时/i.test(message)) return 'TIMEOUT';
  if (/authorization|not authorized|授權|授权/i.test(message)) return 'AUTHORIZATION';
  if (/permission|access denied|權限|权限|存取遭拒/i.test(message)) return 'PERMISSION';
  if (/quota|too many|limit exceeded|配額|配额|次數過多/i.test(message)) return 'QUOTA';
  if (/not found|does not exist|找不到|不存在/i.test(message)) return 'NOT_FOUND';
  return 'UNEXPECTED';
}

export function createBattleUploadDiagnostics({
  clock = Date.now,
  uuid = () => Utilities.getUuid(),
  log = (message) => Logger.log(message),
} = {}) {
  const started = clock();
  const failures = new Map();
  const timings = new Map();
  function run(stage, work, table = null) {
    stage = Object.prototype.hasOwnProperty.call(STAGES, stage) ? stage : 'UNKNOWN';
    // Table names are internal constants. Do not accept a configured prefix or record key here.
    table = /^(commits|settings|professions|members|name_history|events|duties|responses|registrations|videos|requests|lineup_versions|templates|battles|battle_players|battle_links|lottery)$/.test(table || '') ? table : null;
    const before = clock();
    try {
      return work();
    } catch (error) {
      if (!failures.has(error)) failures.set(error, { stage, table });
      throw error;
    } finally {
      const key = `${stage}:${table || ''}`;
      const timing = timings.get(key) || { stage, table, count: 0, elapsedMs: 0 };
      timing.count++;
      timing.elapsedMs += Math.max(0, clock() - before);
      timings.set(key, timing);
    }
  }
  function report(error) {
    const { stage, table } = failures.get(error) || { stage: 'UNKNOWN', table: null };
    const reason = category(error);
    let diagnosticId = `upload-${started.toString(36)}`;
    try {
      const value = uuid();
      if (typeof value === 'string' && /^[a-f0-9-]{16,64}$/i.test(value))
        diagnosticId = `upload-${value}`;
    } catch {}
    try {
      log(JSON.stringify({
        event: 'BATTLE_UPLOAD_FAILURE', diagnosticId, stage, table,
        category: reason, elapsedMs: Math.max(0, clock() - started),
        // Nested stages overlap: timings describe each stage, not additive wall-clock totals.
        timings: [...timings.values()],
      }));
    } catch {}
    return `戰績上傳結果未確認（步驟：${STAGES[stage]}；類型：${CATEGORIES[reason]}；診斷碼：${diagnosticId}），請保留檔案，可重試或將此訊息提供給管理者`;
  }
  return { run, report };
}
