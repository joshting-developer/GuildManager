import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository, repositoryDatabase } from '../helpers/mysql-repository.js';
import { fixtureCsv } from '../helpers/battle-csv.js';

test('UID remap batches unrelated overrides and import backfill splits bounded name batches', async () => {
  const repo = await createTestRepository(), db = repositoryDatabase(repo);
  try {
    await repo.addMember({ uid: 'old', name: '原名', primaryProfessionId: 3 });
    const event = await repo.createEvent({ title: '歷史', type: 'scrimmage', dates: ['2026-01-01'], requestId: 'event' });
    const snapshot = JSON.stringify({ teams: [{ slots: [{ uid: 'prior' }] }] });
    for (let i = 0; i < 25; i++) await db.query(`INSERT INTO lineup_versions
      (id,event_id,version,request_id,payload_json,snapshot_json,created_at) VALUES (?,?,?,?,'{}',?,'2026-01-01')`,
    [`v${i}`, event.id, i + 1, `v${i}`, i === 0 ? snapshot : '{"uid":"unrelated"}']);
    await db.query("INSERT INTO member_reference_overrides VALUES ('lineup','v0',?)", [JSON.stringify([['prior','old']])]);
    const raw = db.query.bind(db), tx = db.transaction.bind(db), queries = [];
    db.transaction = (work, options) => tx(connection => work({ ...connection, query(sql, args) {
      queries.push({ sql, args }); return connection.query(sql, args);
    } }), options);
    await repo.maintainMember('old', { newUid: 'new', name: '原名', primaryProfessionId: 3, secondaryProfessionId: null, revision: 1, requestId: 'edit' });
    const scans = queries.filter(q => q.sql.includes('LEFT JOIN member_reference_overrides'));
    assert.equal(scans.length, 3);
    assert.deepEqual(scans.map(q => q.args[0]), ['lineup', 'template', 'battle']);
    const singles = queries.filter(q => q.sql.includes('SELECT overrides_json FROM member_reference_overrides'));
    assert.equal(singles.length, 1, 'only the affected locked record rechecks its override');
    assert.equal((await repo.getLineupHistory(event.id)).versions.at(-1).teams[0].slots[0].uid, 'new');
    assert.equal((await raw('SELECT snapshot_json FROM lineup_versions WHERE id=?', ['v0']))[0].snapshot_json, snapshot);
    const members = [];
    for (let i = 0; i < 205; i++) {
      const uid = `m${i}`, name = `Bench${i}`;
      await raw(`INSERT INTO members(uid,name,primary_profession_id,primary_profession,secondary_profession,is_in_guild,is_in_club,joined_at,updated_at,revision)
        VALUES (?, ?, 3, '碎夢', '', 1, 0, '2026-01-01','2026-01-01',1)`, [uid, name]);
      members.push({ uid, name });
    }
    // An embedded immutable owner and duplicate names must remain unclaimed.
    await raw(`INSERT INTO members(uid,name,primary_profession_id,primary_profession,secondary_profession,is_in_guild,is_in_club,joined_at,updated_at,revision)
      VALUES ('duplicate','Bench1',3,'碎夢','',1,0,'2026-01-01','2026-01-01',1)`);
    const result = await repo.saveBattleRecords({ requestId: 'battle', records: [{ type: 'scrimmage', datetime: '2026-01-01',
      filename: 'sample.csv', csvText: fixtureCsv('Bench0','Bench1'), redTeam: 'Red', blueTeam: 'Blue' }] });
    const id = result.records[0].id;
    await raw('DELETE FROM battle_player_links WHERE record_id=?', [id]);
    queries.length = 0;
    await repo.backfillMemberBattleRecords(members);
    const inserts = queries.filter(q => q.sql.includes('INSERT INTO battle_player_links'));
    assert.equal(inserts.length, 2);
    assert.deepEqual(inserts.map(q => JSON.parse(q.args[0]).length), [200, 4]);
    const links = await raw('SELECT player_index,member_uid FROM battle_player_links WHERE record_id=?', [id]);
    assert.deepEqual(links, [{ player_index: 0, member_uid: 'm0' }]);
    await raw("UPDATE battle_records SET players_json=JSON_SET(players_json, '$[0].memberUid','new') WHERE id=?", [id]);
    await raw('DELETE FROM battle_player_links WHERE record_id=?', [id]);
    await repo.backfillMemberBattleRecords(members);
    assert.equal((await raw('SELECT * FROM battle_player_links WHERE record_id=?', [id])).length, 0);
  } finally { await repo.close(); }
});
