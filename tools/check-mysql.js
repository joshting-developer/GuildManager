import { createMysqlDatabase } from '../server/database/mysql.js';

let database;
try {
  database = createMysqlDatabase(process.env);
  console.log(JSON.stringify(await database.probe()));
} catch (error) {
  console.error(JSON.stringify({ status: 'error', code: error.code || 'DATABASE_UNAVAILABLE' }));
  process.exitCode = 1;
} finally {
  if (database) {
    try {
      await database.close();
    } catch {
      console.error(JSON.stringify({ status: 'error', code: 'DATABASE_CLOSE' }));
      process.exitCode = 1;
    }
  }
}
