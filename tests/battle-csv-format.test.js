import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBattleCsv } from '../src/domain/battle-records.js';

const header = '玩家名字,職業,擊敗/清泉,助攻,資源,對玩家傷害,對建築傷害,治療值,承受傷害,重傷,復活/清泉,焚骨';
const csv = `${header}\n測試玩家,碎夢,12/1,172,0,52876805,40841,68299,47395515,4,16,78`;

test('new game CSV separates kill spring from revival spring', () => {
  const player = parseBattleCsv(`\ufeff${csv}`).players[0];
  assert.equal(player.kill, 12);
  assert.equal(player.killSpring, 1);
  assert.equal(player.revive, 16);
  const old = parseBattleCsv(csv.replace('擊敗/清泉', '擊敗').replace('復活/清泉', '化羽/清泉').replace('12/1', '12')).players[0];
  assert.equal(old.kill, 12);
  assert.equal(old.revive, 16);
  assert.equal(old.killSpring, undefined);
});

test('new CSV rejects invalid compound values and duplicate alias headers', () => {
  for (const value of ['12/-1', '12/1/2', '12/', '/1', '12/9007199254740992', '1.5/1'])
    assert.throws(() => parseBattleCsv(csv.replace('12/1', value)), /非負整數/);
  assert.throws(() => parseBattleCsv(csv.replace('焚骨', '擊敗')), /缺少或重複/);
  assert.throws(() => parseBattleCsv(csv.replace('焚骨', '化羽/清泉')), /缺少或重複/);
});


test('kill spring displays immediately after kills and missing history stays unknown', async () => {
  const { BATTLE_DISPLAY_COLUMNS } = await import('../src/domain/battle-records.js');
  const { BATTLE_TABLE_COLUMNS, summarizeBattle } = await import('../src/domain/battle-statistics.js');
  const { statCell } = await import('../src/domain/number-format.js');
  for (const columns of [BATTLE_DISPLAY_COLUMNS, BATTLE_TABLE_COLUMNS]) {
    const killIndex = columns.findIndex(([, key]) => key === 'kill');
    assert.deepEqual(columns[killIndex + 1], ['擊殺清泉', 'killSpring']);
  }
  assert.deepEqual(statCell(undefined, { showZero: true }), { text: '—', empty: true });
  assert.deepEqual(statCell(0, { showZero: true }), { text: '0', empty: false });
  const summary = summarizeBattle([{ side: 'red', profession: '碎夢', kill: 12, killSpring: 3 }, { side: 'red', profession: '碎夢', kill: 2 }]);
  assert.deepEqual(summary.teams.red.metrics.killSpring, { value: 3, missing: 1 });
});
