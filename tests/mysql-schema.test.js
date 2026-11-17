import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMysqlDatabase } from '../server/database/mysql.js';
import { migrateMysql } from '../server/database/migrate.js';
import { mysqlMigrations } from '../server/database/migrations.js';
import { createMysqlRepository } from '../server/mysql/repository.js';

const configurationFile = process.env.GUILD_MYSQL_SCHEMA_TEST_CONFIG;

test('real MySQL initial schema preserves existing tables, constraints, snapshots and ordering without seeding people', { skip: !configurationFile }, async () => {
  const configuration = JSON.parse(readFileSync(configurationFile, 'utf8'));
  assert.equal(configuration.purpose, 'guildmanager-schema-test');
  const env = configuration.environment;
  assert.equal(env.NODE_ENV, 'test');
  assert.match(env.DB_DATABASE, /^sp_guildmanager_[a-z][a-z0-9]{0,15}_schematest$/);
  assert.ok(['127.0.0.1', 'localhost', 'mysql', 'side-project-mysql'].includes(env.DB_HOST));
  assert.equal(env.DB_SSL_MODE, 'disabled');
  const database = createMysqlDatabase(env);
  const contract = JSON.parse(readFileSync(new URL('./fixtures/mysql-schema-contract.json', import.meta.url), 'utf8'));
  const tableNames = contract.tables;
  const createdTables = mysqlMigrations.flatMap((migration) => migration.statements)
    .map((sql) => sql.match(/^CREATE TABLE `?([a-z_]+)`? /)?.[1]).filter(Boolean);
  let ownsSchema = false;
  try {
    const [before] = await database.query('SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE()');
    assert.equal(Number(before.count), 0, 'Schema tests require an empty dedicated schema; do not reset existing data');
    ownsSchema = true;
    const first = await migrateMysql(database, mysqlMigrations);
    assert.deepEqual(first.applied, mysqlMigrations.map((migration) => migration.id));
    assert.deepEqual((await migrateMysql(database, mysqlMigrations)).applied, []);
    const tables = await database.query('SELECT TABLE_NAME AS name, ENGINE AS engine, TABLE_COLLATION AS collation FROM information_schema.tables WHERE table_schema=DATABASE() ORDER BY TABLE_NAME');
    assert.deepEqual(tables.filter((row) => !['schema_migrations', 'repository_write_lock'].includes(row.name)).map((row) => row.name), tableNames);
    assert.equal(tableNames.length, 34);
    assert.ok(tables.every((row) => row.engine === 'InnoDB' && row.collation === 'utf8mb4_bin'));
    const columns = await database.query('SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName FROM information_schema.columns WHERE table_schema=DATABASE()');
    for (const table of tableNames) {
      const existing = contract.columns[table];
      const actual = new Set(columns.filter((column) => column.tableName === table).map((column) => column.columnName));
      for (const name of existing) assert.ok(actual.has(name), `${table}.${name} must be preserved`);
    }
    const expectedKeys = contract.foreignKeys;
    const foreignKeys = await database.query('SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, REFERENCED_TABLE_NAME AS targetTable, REFERENCED_COLUMN_NAME AS targetColumn FROM information_schema.key_column_usage WHERE table_schema=DATABASE() AND referenced_table_name IS NOT NULL');
    assert.deepEqual(foreignKeys.map((key) => [key.tableName, key.columnName, key.targetTable, key.targetColumn].join('.')).sort(), expectedKeys);
    for (const table of ['members', 'scheduled_events', 'battle_records', 'auth_accounts']) {
      assert.equal(Number((await database.query(`SELECT COUNT(*) AS count FROM ${table}`))[0].count), 0);
    }
    assert.equal(Number((await database.query('SELECT COUNT(*) AS count FROM professions'))[0].count), 9);
    assert.equal(Number((await database.query('SELECT COUNT(*) AS count FROM duties'))[0].count), 3);
    const now = '2026-11-16T00:00:00.000Z';
    const uid = '00012345678901234567890中文';
    await database.query('INSERT INTO members (uid, name, primary_profession_id, primary_profession, joined_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [uid, '測試成員🌊', 1, '素問', now, now]);
    const [member] = await database.query('SELECT uid, name, secondary_profession_id AS secondaryId FROM members WHERE uid=?', [uid]);
    assert.deepEqual(member, { uid, name: '測試成員🌊', secondaryId: null });
    const repository = createMysqlRepository(database);
    assert.equal((await repository.listProfessions()).professions.length, 9);
    await database.query('INSERT INTO member_name_history (id, member_uid, name, changed_at) VALUES (?, ?, ?, ?)', ['history-one', uid, '舊名稱一', now]);
    await database.query('INSERT INTO member_name_history (id, member_uid, name, changed_at) VALUES (?, ?, ?, ?)', ['history-two', uid, '舊名稱二', now]);
    const detail = await repository.getMember(uid);
    assert.equal(detail.uid, uid);
    assert.equal(detail.revision, 1);
    assert.equal(detail.isInGuild, true);
    assert.equal(detail.isInClub, false);
    assert.deepEqual(detail.previousNames.map((entry) => entry.name), ['舊名稱二', '舊名稱一']);
    assert.deepEqual((await repository.listMembers()).members, [detail]);
    await assert.rejects(repository.getMember('missing'), { code: 'MEMBER_NOT_FOUND' });
    await assert.rejects(database.transaction((transaction) => transaction.query('UPDATE members SET name=? WHERE uid=?', ['不可寫入', uid]), { readOnly: true }), { code: 'DATABASE_QUERY' });
    assert.equal((await repository.getMember(uid)).name, '測試成員🌊');
    await assert.rejects(database.query('UPDATE members SET is_in_guild=2 WHERE uid=?', [uid]), { code: 'DATABASE_QUERY' });
    await assert.rejects(database.query('UPDATE members SET primary_profession_id=999 WHERE uid=?', [uid]), { code: 'DATABASE_REFERENCE' });
    await database.query('INSERT INTO auth_accounts (id, username, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?)', ['account-test', 'CaseAdmin', 'synthetic', '0'.repeat(128), now]);
    await assert.rejects(database.query('INSERT INTO auth_accounts (id, username, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?)', ['account-other', 'caseadmin', 'synthetic', '0'.repeat(128), now]), { code: 'DATABASE_DUPLICATE' });
    await assert.rejects(database.query("UPDATE auth_accounts SET role='owner' WHERE id='account-test'"), { code: 'DATABASE_QUERY' });
    await database.query('INSERT INTO auth_sessions VALUES (?, ?, ?)', ['a'.repeat(64), 'account-test', 9007199254740991]);
    await database.query("DELETE FROM auth_accounts WHERE id='account-test'");
    assert.equal(Number((await database.query('SELECT COUNT(*) AS count FROM auth_sessions'))[0].count), 0);
    for (const id of ['event-one', 'event-two']) {
      await database.query('INSERT INTO scheduled_events (id, title, type, request_id, created_at) VALUES (?, ?, ?, ?, ?)', [id, '', 'guild_war', id, now]);
      await database.query('INSERT INTO event_dates VALUES (?, ?)', [id, '2026-11-16']);
    }
    const guest = async (id, name, active = 1, event = 'event-one') => database.query('INSERT INTO event_registrations (id, event_id, name, profession_id, note, active, revision, request_id, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, 1, ?, ?, ?)', [id, event, name, '', active, id, now, now]);
    await guest('guest-1', 'Alpha');
    await assert.rejects(guest('guest-2', 'aLPHa'), { code: 'DATABASE_DUPLICATE' });
    await guest('guest-3', 'ALPHA', 0);
    await guest('guest-4', 'alpha', 0);
    await guest('guest-5', 'Alpha', 1, 'event-two');
    await guest('guest-6', 'É');
    await guest('guest-7', 'é');
    await guest('guest-8', 'Cafe');
    await guest('guest-9', 'Café');
    const rawJson = ' { "z": null, "a": [1, 2] } ';
    await database.query('INSERT INTO lineup_templates (id, name, request_id, payload_json, teams_json, created_at) VALUES (?, ?, ?, ?, ?, ?)', ['template-1', '測試範本', 'template-request', rawJson, '[]', now]);
    assert.equal((await database.query("SELECT payload_json AS payload FROM lineup_templates WHERE id='template-1'"))[0].payload, rawJson);
    await assert.rejects(database.query("UPDATE lineup_templates SET teams_json='invalid-json' WHERE id='template-1'"), { code: 'DATABASE_QUERY' });
    await database.query('INSERT INTO battle_uploads (id, request_id, input_hash, created_at) VALUES (?, ?, ?, ?)', ['upload-1', 'upload-request', '0'.repeat(64), now]);
    const record = async (id, round) => database.query('INSERT INTO battle_records (id, upload_id, event_id, battle_type, played_at, red_team, blue_team, filename, csv_text, players_json, content_hash, created_at, round_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, 'upload-1', 'event-one', 'guild_war', now, '紅方', '藍方', 'example.csv', '玩家名字,職業\n測試,素問', rawJson, id, now, round]);
    await record('record-1', null);
    await record('record-2', null);
    await record('record-3', 1);
    await assert.rejects(record('record-4', 1), { code: 'DATABASE_DUPLICATE' });
    const records = await database.query('SELECT id, winner, our_side AS ourSide, players_json AS players FROM battle_records ORDER BY created_order');
    assert.deepEqual(records.map((row) => row.id), ['record-1', 'record-2', 'record-3']);
    assert.ok(records.every((row) => row.winner === null && row.ourSide === null && row.players === rawJson));
    const legacyVideo = (id, url) => database.query('INSERT INTO event_videos (id, event_id, round_number, name, url, group_name, created_at) VALUES (?, ?, 1, ?, ?, ?, ?)', [id, 'event-one', '測試影片', url, '進攻一', now]);
    const url = 'https://example.test/' + 'a'.repeat(1980);
    await legacyVideo('video-1', url);
    await legacyVideo('video-2', url.slice(0, -1) + 'b');
    await assert.rejects(legacyVideo('video-3', url), { code: 'DATABASE_DUPLICATE' });
    await assert.rejects(database.query('INSERT INTO event_video_submissions (id,event_id,name,first_url,second_url,note,created_at,group_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', ['video-empty', 'event-one', '測試影片', '', '', '', now, '進攻一']), { code: 'DATABASE_QUERY' });
  } finally {
    if (ownsSchema) {
      for (const name of [...createdTables].reverse().filter(name => name !== 'file_metadata').concat('file_metadata')) await database.query(`DROP TABLE IF EXISTS \`${name}\``);
      await database.query('DROP TABLE IF EXISTS schema_migrations');
    }
    await database.close();
  }
});
