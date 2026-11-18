import { createHash } from 'node:crypto';

export class MigrationError extends Error {
  constructor(code) {
    super('資料庫版本更新未完成, 請由維護者檢查遷移紀錄後再執行');
    this.name = 'MigrationError';
    this.code = code;
  }
}

function manifest(migrations) {
  if (!Array.isArray(migrations)) throw new MigrationError('MIGRATION_MANIFEST');
  let previous = '';
  return migrations.map((migration) => {
    if (!/^\d{4}_[a-z][a-z0-9_]{0,90}$/.test(migration.id) || migration.id <= previous
      || !Array.isArray(migration.statements) || migration.statements.length === 0
      || migration.statements.some((statement) => typeof statement !== 'string' || !statement.trim())) {
      throw new MigrationError('MIGRATION_MANIFEST');
    }
    previous = migration.id;
    return { ...migration, checksum: createHash('sha256').update(JSON.stringify(migration.statements)).digest('hex') };
  });
}

function versions(migrations, rows) {
  const byId = new Map(migrations.map((migration) => [migration.id, migration]));
  for (const row of rows) {
    if (!byId.has(row.id)) throw new MigrationError('MIGRATION_UNKNOWN_VERSION');
    if (byId.get(row.id).checksum !== row.checksum) throw new MigrationError('MIGRATION_CHECKSUM');
  }
  const recorded = new Map(rows.map((row) => [row.id, row]));
  let pending = false;
  return migrations.map((migration) => {
    const row = recorded.get(migration.id);
    if (!row) pending = true;
    else if (pending) throw new MigrationError('MIGRATION_HISTORY_GAP');
    return { id: migration.id, state: row?.state || 'pending', completedSteps: row?.completed_steps || 0 };
  });
}

export async function migrationStatus(database, migrations) {
  const expected = manifest(migrations);
  const [table] = await database.query("SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'schema_migrations'");
  const rows = Number(table.count)
    ? await database.query('SELECT id, checksum, state, completed_steps FROM schema_migrations ORDER BY id')
    : [];
  return versions(expected, rows);
}

export function migrationLockName(databaseName) {
  return 'guildmanager:migrate:' + createHash('sha256').update(databaseName).digest('hex').slice(0, 40);
}

export async function migrateMysql(database, migrations, { lockTimeout = 10 } = {}) {
  const expected = manifest(migrations);
  if (!Number.isInteger(lockTimeout) || lockTimeout < 0 || lockTimeout > 60) throw new MigrationError('MIGRATION_MANIFEST');
  return database.withConnection(async (connection) => {
    const [current] = await connection.query('SELECT DATABASE() AS databaseName');
    if (!current.databaseName) throw new MigrationError('MIGRATION_DATABASE_REQUIRED');
    const lock = migrationLockName(current.databaseName);
    let locked = false;
    let failure;
    try {
      const [acquired] = await connection.query('SELECT GET_LOCK(?, ?) AS acquired', [lock, lockTimeout]);
      if (Number(acquired.acquired) !== 1) throw new MigrationError('MIGRATION_BUSY');
      locked = true;
      await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
        checksum CHAR(64) CHARACTER SET ascii NOT NULL,
        state VARCHAR(16) CHARACTER SET ascii NOT NULL CHECK (state IN ('started', 'applied')),
        completed_steps INT UNSIGNED NOT NULL DEFAULT 0,
        started_at VARCHAR(24) CHARACTER SET ascii NOT NULL,
        applied_at VARCHAR(24) CHARACTER SET ascii
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);
      const rows = await connection.query('SELECT id, checksum, state, completed_steps FROM schema_migrations ORDER BY id');
      const status = versions(expected, rows);
      if (status.some((migration) => !['pending', 'applied'].includes(migration.state))) {
        throw new MigrationError('MIGRATION_INCOMPLETE');
      }
      const applied = new Set(rows.map((row) => row.id));
      const result = { applied: [], skipped: [...applied] };
      for (const migration of expected) {
        if (applied.has(migration.id)) continue;
        // DDL implicitly commits. A durable started row prevents unsafe automatic recovery.
        await connection.query('INSERT INTO schema_migrations (id, checksum, state, started_at) VALUES (?, ?, ?, ?)',
          [migration.id, migration.checksum, 'started', new Date().toISOString()]);
        for (const [index, statement] of migration.statements.entries()) {
          await connection.query(statement);
          await connection.query('UPDATE schema_migrations SET completed_steps = ? WHERE id = ?', [index + 1, migration.id]);
        }
        await connection.query('UPDATE schema_migrations SET state = ?, applied_at = ? WHERE id = ?', ['applied', new Date().toISOString(), migration.id]);
        result.applied.push(migration.id);
      }
      return result;
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      if (locked) {
        try {
          const [released] = await connection.query('SELECT RELEASE_LOCK(?) AS released', [lock]);
          if (Number(released.released) !== 1) throw new MigrationError('MIGRATION_LOCK_RELEASE');
        } catch {
          connection.discard();
          if (!failure) throw new MigrationError('MIGRATION_LOCK_RELEASE');
        }
      }
    }
  });
}
