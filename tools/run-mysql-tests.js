import { spawnSync } from 'node:child_process';

if (!process.env.GUILD_MYSQL_TEST_CONFIG) {
  console.error('請先指定隔離測試設定檔 GUILD_MYSQL_TEST_CONFIG, 不使用應用程式的資料庫設定');
  process.exitCode = 2;
} else {
  const result = spawnSync(process.execPath, ['--test', 'tests/mysql-database.test.js', 'tests/mysql-integration.test.js'], {
    stdio: 'inherit',
  });
  process.exitCode = result.status ?? 1;
}
