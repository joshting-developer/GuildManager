import { fillBattlePlayerStats } from '../../server/database/migrations/0006-battle-player-stats.js';
import { migrationStatus } from '../../server/database/migrate.js';
import { mysqlMigrations } from '../../server/database/migrations.js';
import { IMPORT_TABLES } from './transform.js';

const SEED_DUTIES = ['duty-bodyguard', 'duty-mountain-oath', 'duty-aux-tide'];
// Auth is imported separately later; every other business table must still be empty.
const MUST_BE_EMPTY = [...Object.keys(IMPORT_TABLES).filter((table) => table !== 'duties'), 'events', 'battle_metadata_requests', 'battle_sync_requests', 'event_batches', 'event_batch_items', 'event_participation_requests', 'event_video_requests', 'event_video_profession_requests', 'event_video_profession_overrides', 'event_videos', 'member_maintenance_requests', 'file_metadata', 'file_staging', 'attendance_records', 'attendance_requests'];
const BATCH_ROWS = 200;

export class LegacyImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LegacyImportError';
  }
}

export async function applyLegacyImport(database, { rows, settings }) {
  const status = await migrationStatus(database, mysqlMigrations);
  if (status.some((migration) => migration.state !== 'applied')) throw new LegacyImportError('目標資料庫尚未完成所有版本更新, 請先執行 db:migrate');
  return database.transaction(async (connection) => {
    const query = (sql, parameters) => connection.query(sql, parameters);
    if ((await query('SELECT id FROM repository_write_lock WHERE id=1 FOR UPDATE')).length !== 1)
      throw new LegacyImportError('目標資料庫缺少寫入鎖, 請確認版本更新');
    for (const table of MUST_BE_EMPTY) {
      const [row] = await query(`SELECT COUNT(*) AS count FROM \`${table}\``);
      if (Number(row.count)) throw new LegacyImportError(`目標資料庫的 ${table} 已有資料, 匯入只接受剛建立的空資料庫`);
    }
    const duties = await query('SELECT id FROM duties');
    if (duties.some((duty) => !SEED_DUTIES.includes(duty.id))) throw new LegacyImportError('目標資料庫的職責已被修改, 匯入只接受剛建立的空資料庫');

    // Seeded catalogs are replaced by the legacy values so ids and names match old snapshots.
    const current = new Map((await query('SELECT job_id, colorcode, name FROM professions')).map((row) => [Number(row.job_id), row]));
    const legacy = new Map(settings.professions.map((row) => [row.job_id, row]));
    for (const id of current.keys()) if (!legacy.has(id)) throw new LegacyImportError(`舊資料缺少職業 ${id}, 請先確認職業表`);
    for (const row of settings.professions) {
      const existing = current.get(row.job_id);
      if (!existing) await query('INSERT INTO professions (job_id, colorcode, name) VALUES (?, ?, ?)', [row.job_id, row.colorcode, row.name]);
      else if (existing.colorcode !== row.colorcode || existing.name !== row.name)
        await query('UPDATE professions SET colorcode=?, name=? WHERE job_id=?', [row.colorcode, row.name, row.job_id]);
    }
    await query('DELETE FROM duties');
    if (settings.platform)
      await query('UPDATE platform_settings SET name=?, revision=? WHERE id=1', [settings.platform.name, settings.platform.revision]);

    const counts = {};
    for (const [table, columns] of Object.entries(IMPORT_TABLES)) {
      const values = rows[table];
      for (let start = 0; start < values.length; start += BATCH_ROWS) {
        const batch = values.slice(start, start + BATCH_ROWS);
        const placeholders = batch.map(() => `(${columns.map(() => '?').join(',')})`).join(',');
        await query(
          `INSERT INTO \`${table}\` (${columns.map((column) => `\`${column}\``).join(',')}) VALUES ${placeholders}`,
          batch.flatMap((row) => columns.map((column) => row[column])),
        );
      }
      counts[table] = values.length;
    }
    await query(fillBattlePlayerStats);
    return counts;
  });
}
