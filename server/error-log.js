import { HttpConfigurationError } from './http-config.js';
import { FileStorageError } from './storage/r2.js';
import { DatabaseError } from './database/mysql.js';
import { MigrationError } from './database/migrate.js';

const databaseCodes = new Set([
  'DATABASE_CONFIGURATION', 'DATABASE_AUTHENTICATION', 'DATABASE_NOT_FOUND',
  'DATABASE_DUPLICATE', 'DATABASE_REFERENCE', 'DATABASE_CONFLICT', 'DATABASE_BUSY',
  'DATABASE_UNAVAILABLE', 'DATABASE_TLS', 'DATABASE_QUERY', 'DATABASE_CLOSED',
  'DATABASE_CONNECTION_RELEASED', 'DATABASE_TRANSACTION_CLOSED',
]);
const migrationCodes = new Set([
  'MIGRATION_MANIFEST', 'MIGRATION_UNKNOWN_VERSION', 'MIGRATION_CHECKSUM',
  'MIGRATION_HISTORY_GAP', 'MIGRATION_DATABASE_REQUIRED', 'MIGRATION_BUSY',
  'MIGRATION_INCOMPLETE', 'MIGRATION_LOCK_RELEASE', 'MIGRATION_PENDING',
]);

// Only fixed classifications leave the process; driver messages and user input never do.
export function reportError(log, event, error) {
  const component = error instanceof DatabaseError ? 'database' : error instanceof MigrationError ? 'migration' : error instanceof FileStorageError ? 'storage' : error instanceof HttpConfigurationError ? 'http' : 'api';
  const allowed = component === 'database' ? databaseCodes : component === 'migration' ? migrationCodes : component === 'storage' ? new Set(['STORAGE_UNAVAILABLE', 'FILE_NOT_FOUND', 'INVALID_FILE']) : component === 'http' ? new Set(['HTTP_CONFIGURATION']) : new Set();
  const code = allowed.has(error?.code) ? error.code : `${component.toUpperCase()}_ERROR`;
  try {
    log.error(JSON.stringify({ event, component, code }));
  } catch {}
}
