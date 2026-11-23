import { battlePlayerStats } from './migrations/0006-battle-player-stats.js';
import { initialSchema } from './migrations/0001-initial-schema.js';
import { repositoryLock } from './migrations/0002-repository-lock.js';

import { fileMetadata } from './migrations/0003-file-metadata.js';

import { fileStaging } from './migrations/0004-file-staging.js';

import { attendance } from './migrations/0005-attendance.js';

import { eventVideoMoves } from './migrations/0007-event-video-moves.js';

export const mysqlMigrations = [initialSchema, repositoryLock, fileMetadata, fileStaging, attendance, battlePlayerStats, eventVideoMoves];
