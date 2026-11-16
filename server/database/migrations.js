import { initialSchema } from './migrations/0001-initial-schema.js';
import { repositoryLock } from './migrations/0002-repository-lock.js';

export const mysqlMigrations = [initialSchema, repositoryLock];
