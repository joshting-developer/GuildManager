import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository, repositoryDatabase } from '../helpers/mysql-repository.js';

test('legacy history batches record-scoped overrides and preserves all versions', async () => {
  const repo = await createTestRepository();
  const db = repositoryDatabase(repo);
  try {
    const event = await repo.createEvent({ title: '歷史', type: 'scrimmage', dates: ['2026-01-01'], requestId: 'history' });
    const unrelated = await repo.createEvent({ title: '其他場次', type: 'scrimmage', dates: ['2026-01-02'], requestId: 'other-event' });
    const raw = db.query.bind(db);
    const snapshot = JSON.stringify({ teams: [{ slots: [{ uid: 'old', secondRound: { uid: 'old' } }] }] });
    for (let i = 1; i <= 100; i++) {
      await raw('INSERT INTO lineup_versions (id,event_id,version,request_id,payload_json,snapshot_json,created_at) VALUES (?,?,?,?,?,?,?)', [`v${i}`, event.id, i, `v${i}`, '{}', snapshot, '2026-01-01']);
    }
    for (const [kind, id, uid] of [['lineup', 'v100', 'correct'], ['lineup', 'v99', 'other'], ['template', 'v100', 'wrong-kind'], ['lineup', 'unrelated', 'wrong-record']]) {
      await raw('INSERT INTO member_reference_overrides VALUES (?,?,?)', [kind, id, JSON.stringify([['old', uid]])]);
    }
    const transaction = db.transaction.bind(db);
    const reads = [];
    db.transaction = (work, options) => transaction(connection => work({ ...connection, query(sql, args) {
      reads.push({ sql, args });
      return connection.query(sql, args);
    } }), options);
    for (const count of [1, 20, 100]) {
      // Keep identical snapshots while varying the matching event's version count.
      await raw('UPDATE lineup_versions SET event_id=? WHERE version>?', [unrelated.id, count]);
      await raw('UPDATE lineup_versions SET event_id=? WHERE version<=?', [event.id, count]);
      reads.length = 0;
      const history = await repo.getLineupHistory(event.id);
      assert.equal(history.versions.length, count);
      assert.deepEqual(history.versions.map(v => v.version), Array.from({ length: count }, (_, i) => count - i));
      assert.equal(reads.length, 2);
      const overrides = reads.find(r => r.sql.includes('member_reference_overrides'));
      assert.equal(overrides.args[0], 'lineup');
      assert.equal(overrides.args.length, count + 1);
      assert.ok(!overrides.args.includes('unrelated'));
      assert.equal(history.versions.at(-1).teams[0].slots[0].uid, 'old');
      if (count === 100) {
        assert.equal(history.versions[0].teams[0].slots[0].uid, 'correct');
        assert.equal(history.versions[0].teams[0].slots[0].secondRound.uid, 'correct');
        assert.equal(history.versions[1].teams[0].slots[0].uid, 'other');
      }
    }
    reads.length = 0;
    assert.deepEqual(await repo.getLineupHistory('missing'), { versions: [] });
    assert.equal(reads.length, 1);
  } finally { await repo.close(); }
});
