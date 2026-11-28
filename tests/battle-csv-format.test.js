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
