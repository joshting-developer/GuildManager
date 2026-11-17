import { initialSchema } from './migrations/0001-initial-schema.js';
import { repositoryLock } from './migrations/0002-repository-lock.js';

import { fileMetadata } from './migrations/0003-file-metadata.js';

import { fileStaging } from './migrations/0004-file-staging.js';

export const mysqlMigrations = [initialSchema, repositoryLock, fileMetadata, fileStaging];
