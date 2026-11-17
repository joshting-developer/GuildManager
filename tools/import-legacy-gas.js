import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createMysqlDatabase } from '../server/database/mysql.js';
import { applyLegacyImport } from './legacy-import/apply.js';
import { resolveGasStore } from './legacy-import/gas-store.js';
import { transformLegacyStore } from './legacy-import/transform.js';
import { readWorkbook } from './legacy-import/workbook.js';

// 預設只產生預覽報告；加 --apply 並以 --database 確認目標庫名稱才寫入 DB_* 指定的空資料庫。
const usage = '用法：node tools/import-legacy-gas.js --source GuildManagerDataBase.xlsx --report 報告目錄 [--apply --database 目標資料庫名稱]';

let database;
try {
  const { values } = parseArgs({
    options: { source: { type: 'string' }, report: { type: 'string' }, apply: { type: 'boolean', default: false }, database: { type: 'string' } },
    strict: true,
  });
  if (!values.source || !values.report) throw new Error(usage);
  if (values.apply && values.database !== process.env.DB_DATABASE)
    throw new Error('--database 必須與 DB_DATABASE 相同, 避免寫錯資料庫');

  const store = resolveGasStore(readWorkbook(await readFile(values.source)));
  const { rows, settings, report } = transformLegacyStore(store);
  const counts = Object.fromEntries(Object.entries(rows).map(([table, list]) => [table, list.length]));
  const summary = {
    source: { commits: store.stats.commits, firstCommitAt: store.stats.firstCommitAt, lastCommitAt: store.stats.lastCommitAt },
    legacy: store.stats.tables,
    target: counts,
    cleaning: report.summary(),
    pending: {
      accounts: '帳號／Session 不在 Sheets, 另行匯出後補做',
      battleCsv: `${counts.battle_records} 筆戰績 CSV 待 GM-30 上傳 R2 後補 csv_file_id`,
      platformIcon: settings.platform?.icon ? '平台圖示待 GM-30 上傳 R2 後補 icon_file_id' : null,
    },
  };
  // The detailed report names members, so it belongs in an ignored private directory.
  await mkdir(values.report, { recursive: true });
  await writeFile(join(values.report, 'legacy-import-report.json'), `${JSON.stringify({ ...summary, rules: report.hits, anomalies: report.anomalies }, null, 1)}\n`);

  if (report.anomalies.length) {
    console.log(JSON.stringify({ status: 'blocked', reason: '有清洗規則未處理的異常, 請看報告 anomalies 並補規則', ...summary }, null, 1));
    process.exitCode = 3;
  } else if (!values.apply) {
    console.log(JSON.stringify({ status: 'preview', ...summary }, null, 1));
  } else {
    database = createMysqlDatabase(process.env);
    const inserted = await applyLegacyImport(database, { rows, settings });
    console.log(JSON.stringify({ status: 'imported', database: process.env.DB_DATABASE, inserted, ...summary }, null, 1));
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'error', name: error.name, message: error.message }));
  process.exitCode = 1;
} finally {
  if (database) {
    try { await database.close(); } catch { process.exitCode = 1; }
  }
}
