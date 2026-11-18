import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createMysqlDatabase } from '../server/database/mysql.js';
import { createR2Storage } from '../server/storage/r2.js';
import { applyLegacyFiles, legacyFileEntries, planLegacyFiles } from './legacy-import/files.js';
import { resolveGasStore } from './legacy-import/gas-store.js';
import { transformLegacyStore } from './legacy-import/transform.js';
import { readWorkbook, readZipEntries } from './legacy-import/workbook.js';

// 預設只產生預覽報告；加 --apply 並以 --database／--bucket 確認目標後, 才上傳到 R2 並連結 DB_* 指定的資料庫。
const usage = '用法：node tools/import-legacy-files.js --source GuildManagerDataBase.xlsx --files 戰績原始檔.zip --report 報告目錄 [--apply --database 目標資料庫 --bucket 目標bucket]';

let database, storage;
try {
  const { values } = parseArgs({
    options: {
      source: { type: 'string' }, files: { type: 'string' }, report: { type: 'string' },
      apply: { type: 'boolean', default: false }, database: { type: 'string' }, bucket: { type: 'string' },
    },
    strict: true,
  });
  if (!values.source || !values.files || !values.report) throw new Error(usage);
  if (values.apply && values.database !== process.env.DB_DATABASE) throw new Error('--database 必須與 DB_DATABASE 相同, 避免寫錯資料庫');
  if (values.apply && values.bucket !== process.env.R2_BUCKET) throw new Error('--bucket 必須與 R2_BUCKET 相同, 避免傳錯 bucket');

  // Same export as the database import, so record ids, filenames and players are the ones already imported.
  const { rows, settings } = transformLegacyStore(resolveGasStore(readWorkbook(await readFile(values.source))));
  const { files, anomalies: entryAnomalies } = legacyFileEntries(readZipEntries(await readFile(values.files)));
  const plan = planLegacyFiles(files, { records: rows.battle_records, platform: settings.platform });
  const anomalies = [...entryAnomalies, ...plan.anomalies];
  const summary = {
    files: files.size,
    csv: plan.csv.length,
    icon: plan.icon ? 1 : 0,
    duplicates: plan.unused.filter((file) => file.result === 'duplicate').length,
    unreferenced: plan.unused.filter((file) => file.result === 'unreferenced').length,
    anomalies: anomalies.length,
  };
  await mkdir(values.report, { recursive: true });
  await writeFile(join(values.report, 'legacy-files-report.json'), `${JSON.stringify({ summary, unused: plan.unused, anomalies }, null, 1)}\n`);

  if (anomalies.length) {
    console.log(JSON.stringify({ status: 'blocked', reason: '有檔案對不到或內容不符, 請看報告 anomalies', ...summary }, null, 1));
    process.exitCode = 3;
  } else if (!values.apply) {
    console.log(JSON.stringify({ status: 'preview', ...summary }, null, 1));
  } else {
    database = createMysqlDatabase(process.env);
    storage = createR2Storage(process.env);
    const uploaded = await applyLegacyFiles(database, storage, plan);
    console.log(JSON.stringify({ status: 'imported', database: process.env.DB_DATABASE, bucket: storage.bucket, uploaded, ...summary }, null, 1));
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'error', name: error.name, message: error.message }));
  process.exitCode = 1;
} finally {
  try { storage?.close(); } catch { process.exitCode = 1; }
  if (database) {
    try { await database.close(); } catch { process.exitCode = 1; }
  }
}
