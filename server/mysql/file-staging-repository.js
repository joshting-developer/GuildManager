import { FileStorageError } from '../storage/r2.js';

const RETENTION_MS = 24 * 60 * 60 * 1000;

/** Coordinates staging and cleanup; concurrent cleaners skip rows another cleaner has claimed. */
export function createFileStagingRepository(db) {
  return {
    async stage(file) {
      await db.prepare('INSERT INTO file_staging (id,bucket,object_key,state,expires_at) VALUES (?,?,?,?,?)')
        .run(file.id, file.bucket, file.key, 'uploading', Date.now() + RETENTION_MS);
    },
    async ready(id) {
      await db.transaction(async () => {
        const result = await db.prepare("UPDATE file_staging SET state='ready' WHERE id=? AND state='uploading'").run(id);
        if (result.changes !== 1) throw new FileStorageError();
      });
    },
    async deleted(id) {
      await db.prepare("UPDATE file_staging SET expires_at=? WHERE id=? AND state='deleting'")
        .run(Date.now() + RETENTION_MS, id);
    },
    async claimExpired(bucket, limit) {
      return db.transaction(async () => {
        const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
        const orphans = await db.prepare(`SELECT f.id,f.object_key FROM file_metadata f
          WHERE f.bucket=? AND f.created_at<=?
          AND NOT EXISTS (SELECT 1 FROM battle_records b WHERE b.csv_file_id=f.id)
          AND NOT EXISTS (SELECT 1 FROM battle_uploads u WHERE u.image_file_id=f.id)
          AND NOT EXISTS (SELECT 1 FROM platform_settings p WHERE p.icon_file_id=f.id)
          ORDER BY f.created_at,f.id LIMIT ? FOR UPDATE SKIP LOCKED`).all(bucket, cutoff, limit);
        for (const file of orphans) {
          await db.prepare("INSERT INTO file_staging (id,bucket,object_key,state,expires_at) VALUES (?,?,?,'deleting',0)")
            .run(file.id, bucket, file.object_key);
          await db.prepare('DELETE FROM file_metadata WHERE id=?').run(file.id);
        }
        const rows = await db.prepare(`SELECT id,object_key FROM file_staging
          WHERE bucket=? AND expires_at<=? ORDER BY expires_at,id LIMIT ? FOR UPDATE SKIP LOCKED`).all(bucket, Date.now(), limit);
        for (const row of rows) await db.prepare("UPDATE file_staging SET state='deleting' WHERE id=?").run(row.id);
        return rows;
      });
    },
  };
}
