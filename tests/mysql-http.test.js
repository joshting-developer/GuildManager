// HTTP contract checks against the real Express app on an isolated MySQL schema (one process, serialized).
await import('./mysql-http/access.test.js');
await import('./mysql-http/events.test.js');
await import('./mysql-http/members.test.js');
await import('./mysql-http/participation.test.js');
await import('./mysql-http/lineups.test.js');
await import('./mysql-http/battle-records.test.js');
await import('./mysql-http/platform.test.js');
await import('./mysql-http/startup.test.js');
await import('./mysql-http/auth.test.js');
await import('./mysql-http/account-cli.test.js');
