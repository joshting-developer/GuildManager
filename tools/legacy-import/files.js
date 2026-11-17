import { createHash, randomUUID } from 'node:crypto';
import { migrationStatus } from '../../server/database/migrate.js';
import { mysqlMigrations } from '../../server/database/migrations.js';
import { createFileMetadataRepository } from '../../server/mysql/file-metadata.js';
import { createFileStagingRepository } from '../../server/mysql/file-staging-repository.js';
import { createStore } from '../../server/mysql/store.js';
import { parseBattleCsv } from '../../src/domain/battle-records.js';
import { validatePlatformIcon } from '../../src/domain/platform-settings.js';

const ICON_PATTERN = /^platform-icon-[^/]+\.(jpe?g|png|webp)$/i;
const ICON_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
// Players are compared on the CSV columns only; memberUid／creditedName are attribution added later.
const PLAYER_KEYS = (player) => Object.keys(player).filter((key) => key !== 'memberUid' && key !== 'creditedName');

export class LegacyFilesError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LegacyFilesError';
  }
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Zip entries keyed by file name; Drive exports put every file in one top-level folder. */
export function legacyFileEntries(zipEntries) {
  const files = new Map();
  const anomalies = [];
  for (const [path, read] of zipEntries) {
    if (path.endsWith('/')) continue;
    const name = path.split('/').pop();
    if (files.has(name)) anomalies.push({ kind: 'duplicate-name', name, reason: 'zip 內有同名檔案, 無法判斷要用哪一份' });
    else files.set(name, read());
  }
  return { files, anomalies };
}

/**
 * Match battle CSVs by their stored filename and verify each one parses into the same players
 * already imported by GM-29, so a wrong or edited file cannot be attached silently.
 */
export function planLegacyFiles(files, { records, platform }) {
  const anomalies = [];
  const used = new Set();
  const csv = [];
  for (const record of records) {
    const bytes = files.get(record.filename);
    if (!bytes) {
      anomalies.push({ kind: 'missing-csv', recordId: record.id, name: record.filename, reason: '原始檔資料夾找不到這筆戰績的 CSV' });
      continue;
    }
    const mismatch = compareCsv(bytes, JSON.parse(record.players_json));
    if (mismatch) {
      anomalies.push({ kind: 'csv-mismatch', recordId: record.id, name: record.filename, reason: mismatch });
      continue;
    }
    used.add(record.filename);
    csv.push({ recordId: record.id, name: record.filename, mimeType: 'text/csv', bytes });
  }

  let icon = null;
  if (platform?.icon) {
    const candidates = [...files.keys()].filter((name) => ICON_PATTERN.test(name));
    if (candidates.length !== 1) {
      anomalies.push({ kind: 'icon', name: candidates.join(', '), reason: `平台圖示候選檔應該剛好 1 個, 實際 ${candidates.length} 個` });
    } else {
      const [name] = candidates;
      const bytes = files.get(name);
      const mimeType = ICON_TYPES[name.split('.').pop().toLowerCase()];
      try {
        if (mimeType !== platform.icon.mimeType) throw new Error(`副檔名是 ${mimeType}, 舊設定是 ${platform.icon.mimeType}`);
        validatePlatformIcon({ mimeType, base64: bytes.toString('base64') });
        used.add(name);
        icon = { name: 'platform-icon', mimeType, bytes };
      } catch (error) {
        anomalies.push({ kind: 'icon', name, reason: error.message });
      }
    }
  }

  // Drive keeps re-uploads as "name(1).csv"; identical bytes are reported as duplicates, not lost data.
  const usedHashes = new Map([...used].map((name) => [sha256(files.get(name)), name]));
  const unused = [...files.keys()].filter((name) => !used.has(name)).map((name) => {
    const same = usedHashes.get(sha256(files.get(name)));
    return same ? { name, result: 'duplicate', of: same } : { name, result: 'unreferenced' };
  });
  return { csv, icon, unused, anomalies };
}

function compareCsv(bytes, expected) {
  let parsed;
  try {
    parsed = parseBattleCsv(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    return `CSV 無法解析：${error.message}`;
  }
  if (parsed.players.length !== expected.length) return `CSV 有 ${parsed.players.length} 位玩家, 已匯入的戰績有 ${expected.length} 位`;
  for (const [index, player] of expected.entries()) {
    const actual = parsed.players[index];
    const key = PLAYER_KEYS(player).find((name) => player[name] !== actual[name]);
    if (key) return `第 ${index + 1} 位玩家的 ${key} 與已匯入的戰績不同`;
  }
  return null;
}

/**
 * Upload every planned file that is still missing and link it in its own short transaction.
 * Object IO stays outside MySQL; the staging ledger keeps unknown PUT results recoverable (GM-17).
 */
export async function applyLegacyFiles(database, storage, plan) {
  const status = await migrationStatus(database, mysqlMigrations);
  if (status.some((migration) => migration.state !== 'applied')) throw new LegacyFilesError('目標資料庫尚未完成所有版本更新, 請先執行 db:migrate');
  const store = createStore(database);
  const journal = createFileStagingRepository(store);
  const metadata = createFileMetadataRepository(store);

  const missing = new Set((await store.prepare('SELECT id FROM battle_records WHERE csv_file_id IS NULL').all()).map((row) => row.id));
  const known = new Set((await store.prepare('SELECT id FROM battle_records').all()).map((row) => row.id));
  const unknown = plan.csv.filter((file) => !known.has(file.recordId));
  if (unknown.length) throw new LegacyFilesError(`目標資料庫沒有 ${unknown.length} 筆戰績, 請先用同一份匯出檔完成 GM-29 匯入`);

  const result = { csvUploaded: 0, csvSkipped: 0, iconUploaded: 0, iconSkipped: 0 };
  for (const file of plan.csv) {
    if (!missing.has(file.recordId)) {
      result.csvSkipped += 1;
      continue;
    }
    const stored = await upload(storage, journal, 'battle-csv', file);
    await store.write(async () => {
      const row = await store.prepare('SELECT csv_file_id FROM battle_records WHERE id=? FOR UPDATE').get(file.recordId);
      if (row.csv_file_id) throw new LegacyFilesError('戰績已在匯入期間被連結到其他檔案, 請重新執行');
      await metadata.insert(stored);
      await store.prepare('UPDATE battle_records SET csv_file_id=? WHERE id=?').run(stored.id, file.recordId);
    });
    result.csvUploaded += 1;
  }

  if (plan.icon) {
    const row = await store.prepare('SELECT icon_file_id, icon_base64 FROM platform_settings WHERE id=1').get();
    if (row.icon_file_id || row.icon_base64) result.iconSkipped = 1;
    else {
      const stored = await upload(storage, journal, 'platform-icon', plan.icon);
      // Restores the legacy icon as-is; the imported platform revision is kept.
      await store.write(async () => {
        const current = await store.prepare('SELECT icon_file_id FROM platform_settings WHERE id=1 FOR UPDATE').get();
        if (current.icon_file_id) throw new LegacyFilesError('平台圖示已在匯入期間被設定, 請重新執行');
        await metadata.insert(stored);
        await store.prepare('UPDATE platform_settings SET icon_file_id=? WHERE id=1').run(stored.id);
      });
      result.iconUploaded = 1;
    }
  }
  return result;
}

async function upload(storage, journal, kind, { name, mimeType, bytes }) {
  const id = randomUUID();
  const file = { id, bucket: storage.bucket, key: `files/${kind}/${id}`, name, mimeType, size: bytes.length, sha256: sha256(bytes) };
  await journal.stage(file);
  await storage.put(file.key, bytes, mimeType);
  await journal.ready(file.id);
  return file;
}
