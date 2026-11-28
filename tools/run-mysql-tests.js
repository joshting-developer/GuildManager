import { spawnSync } from 'node:child_process';

if (!process.env.GUILD_MYSQL_TEST_CONFIG || !process.env.GUILD_MYSQL_MIGRATION_TEST_CONFIG || !process.env.GUILD_MYSQL_SCHEMA_TEST_CONFIG || !process.env.GUILD_MYSQL_REPOSITORY_TEST_CONFIG) {
  console.error('請明確指定 GUILD_MYSQL_TEST_CONFIG、GUILD_MYSQL_MIGRATION_TEST_CONFIG、GUILD_MYSQL_SCHEMA_TEST_CONFIG 與 GUILD_MYSQL_REPOSITORY_TEST_CONFIG 四個隔離設定檔, 不使用應用程式的資料庫設定');
  process.exitCode = 2;
} else {
  const result = spawnSync(process.execPath, ['--test', 'tests/battle-csv-format.test.js', 'tests/name-source-picker.test.js', 'tests/lineup-image-heading.test.js', 'tests/http-config.test.js', 'tests/local-object-recovery.test.js', 'tests/local-site-check.test.js', 'tests/ci-mysql-setup.test.js', 'tests/r2-storage.test.js', 'tests/r2-integration.test.js', 'tests/mysql-database.test.js', 'tests/mysql-integration.test.js', 'tests/mysql-migrations.test.js', 'tests/mysql-schema.test.js', 'tests/mysql-repositories.test.js'], {
    stdio: 'inherit',
  });
  process.exitCode = result.status ?? 1;
}
