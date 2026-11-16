import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository as createRepository } from '../helpers/mysql-repository.js';

import { fixtureCsv } from "../helpers/gas-runtime.js";

import { parseBattleCsv } from '../../src/domain/battle-records.js';
import { battlePlayerValue, sortBattlePlayers } from '../../src/domain/battle-statistics.js';
import { memberAffiliation, battleRosterIndex, battlePlayerMember, validateBattleAttributions, applyBattleAttributions } from '../../src/domain/battle-attributions.js';

const A = { uid: 'A', name: '實際操作A', primaryProfessionId: 3, isInGuild: true, isInClub: false };
const B = { uid: 'B', name: '角色B', primaryProfessionId: 3, isInGuild: false, isInClub: true };
const csv = fixtureCsv(B.name, '外部對手');
const players = parseBattleCsv(csv).players;
const attribution = (extra = {}) => ({ playerIndex: 0, sourcePlayer: B.name, sourceSide: 'red',
  memberUid: A.uid, memberName: A.name, memberRevision: 1, ...extra });
const input = (extra = {}) => ({ requestId: crypto.randomUUID(), records: [{ filename: 'battle.csv', csvText: csv,
  type: 'scrimmage', datetime: '2026-10-27', redTeam: '本幫', blueTeam: '對手', ourSide: 'red', winner: 'red',
  attributions: [attribution()], ...extra }] });
const localFixture = async () => { const repo = (await createRepository()); (await repo.addMember(A)); (await repo.addMember(B)); return repo; };

const stripped = ({ memberUid, creditedName, ...value }) => value;

async function exercise(api) {
  const payload = input(), saved = (await api.save(payload)).records[0];
  assert.equal(saved.players[0].player, B.name);
  assert.equal(saved.players[0].creditedName, A.name);
  assert.equal(saved.players[0].memberUid, A.uid);
  assert.deepEqual(saved.players.map(stripped), players);
  assert.equal((await api.personal(A.uid)).total, 1);
  assert.equal((await api.personal(B.uid)).total, 0);
  assert.equal((await api.personal(A.uid)).entries[0].player.creditedName, A.name);
  assert.equal((await api.attachment(saved.id)), csv);
  assert.deepEqual((await api.save(payload)), { records: [saved] });
  assert.deepEqual((await api.get(saved.id)), saved);
  (await assert.rejects(async () => (await api.save({ ...payload, records: [{ ...payload.records[0], attributions: [attribution({ memberUid: B.uid, memberName: B.name })] }] })), { code: 'REQUEST_CONFLICT' }));
  (await assert.rejects(async () => (await api.save({ ...payload, requestId: 'duplicate-attribution', records: [{ ...payload.records[0], attributions: [] }] })), { code: 'BATTLE_DUPLICATE' }));
  assert.equal((await api.list()).total, 1);
  assert.equal((await api.members()).find(member => member.uid === B.uid).name, B.name);
  const defaultPayload = input({ datetime: '2026-10-28', attributions: undefined });
  const defaultRow = (await api.save(defaultPayload)).records[0].players[0];
  assert.equal(defaultRow.memberUid, B.uid); assert.equal(defaultRow.creditedName, undefined);
}

test('shared attribution validation and classification keep current-name matching exact and reject ambiguous or forged rows', () => {
  const members = [{ ...A, revision: 1 }, { ...B, revision: 1 }, { ...A, uid: 'duplicate' },
    { ...B, uid: 'outside', name: '編外', isInClub: false }, { ...A, uid: 'both', name: '兼屬', isInClub: true }];
  const index = battleRosterIndex(members);
  assert.equal(memberAffiliation(index.byUid.get('A')), '幫會');
  assert.equal(memberAffiliation(index.byUid.get('B')), '俱樂部');
  assert.equal(memberAffiliation(index.byUid.get('outside')), '編外');
  assert.equal(memberAffiliation(index.byUid.get('both')), '幫會／俱樂部');
  assert.equal(memberAffiliation(null), '未匹配');
  assert.equal(battlePlayerMember({ player: A.name }, null, index), null);
  assert.equal(battlePlayerMember(players[0], attribution(), index).uid, A.uid);
  const renamed = { ...players[0], player: 'Z-account', creditedName: 'A-operator' };
  const ordinary = { ...players[0], player: 'M-operator' };
  assert.equal(battlePlayerValue(renamed, 'player', 'per_life'), 'A-operator');
  assert.deepEqual(sortBattlePlayers([ordinary, renamed], 'red', 'player', 'asc'), [renamed, ordinary]);
  assert.deepEqual(sortBattlePlayers([ordinary, renamed], 'red', 'player', 'desc'), [ordinary, renamed]);
  assert.equal(battlePlayerValue({ side: 'red' }, 'player'), null);
  assert.equal(renamed.player, 'Z-account');
  assert.deepEqual(validateBattleAttributions(undefined, players), []);
  for (const value of [null, {}, [attribution(), attribution()], [attribution({ playerIndex: -1 })],
    [attribution({ playerIndex: 999 })], [attribution({ sourceSide: 'blue' })], [attribution({ sourcePlayer: '偽造角色' })],
    [attribution({ memberUid: '' })], [attribution({ memberRevision: 0 })], [attribution({ memberRevision: '1' })],
    [attribution({ injected: 'not allowed' })]])
    assert.throws(() => validateBattleAttributions(value, players), { code: 'ATTRIBUTION_INVALID' });
  assert.throws(() => applyBattleAttributions(players, [attribution({ memberUid: 'missing' })], index.byUid), { code: 'ATTRIBUTION_MEMBER_CHANGED' });
  assert.throws(() => applyBattleAttributions(players, [attribution({ memberName: 'stale' })], index.byUid), { code: 'ATTRIBUTION_MEMBER_CHANGED' });
});

test('MySQL explicit operator assignment wins over the account owner, preserves raw CSV and metrics, and participates only in retry identity', async () => {
  const repo = (await localFixture());
  try {
    (await exercise({ save: async x => (await repo.saveBattleRecords(x)), get: async id => (await repo.getBattleRecord(id)), list: async () => (await repo.listBattleRecords()),
      personal: async uid => (await repo.getMemberBattleRecords(uid, { readAll: true })), attachment: async id => (await repo.getBattleAttachment(id, 'csv')).bytes.toString(),
      members: async () => (await repo.getBattleUploadRoster()).members }));
    const stale = input({ datetime: '2026-10-29' });
    const member = (await repo.listMembers()).members.find(m => m.uid === A.uid);
    (await repo.updateMember(A.uid, { name: 'A的新名字', primaryProfessionId: 3, secondaryProfessionId: null,
      isInGuild: true, isInClub: false, revision: member.revision }));
    (await assert.rejects(async () => (await repo.saveBattleRecords(stale)), { code: 'ATTRIBUTION_MEMBER_CHANGED' }));
    assert.equal((await repo.listBattleRecords()).total, 2);
    for (const attributions of [[attribution({ memberUid: 'missing' })], [attribution({ sourceSide: 'blue' })]])
      (await assert.rejects(async () => (await repo.saveBattleRecords(input({ datetime: '2026-10-30', attributions })))));
  } finally { (await repo.close()); }
});
