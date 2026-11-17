import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createBattleRecordClient } from '../src/api/battle-records.js';
import { fixtureCsv } from './helpers/battle-csv.js';

import { authenticatedFetch } from './helpers/authenticated-fetch.js';
import { parseBattleCsv } from '../src/domain/battle-records.js';
import { battlePlayerValue, sortBattlePlayers } from '../src/domain/battle-statistics.js';
import { memberAffiliation, battleRosterIndex, battlePlayerMember, validateBattleAttributions, applyBattleAttributions } from '../src/domain/battle-attributions.js';

const A = { uid: 'A', name: '實際操作A', primaryProfessionId: 3, isInGuild: true, isInClub: false };
const B = { uid: 'B', name: '角色B', primaryProfessionId: 3, isInGuild: false, isInClub: true };
const csv = fixtureCsv(B.name, '外部對手');
const players = parseBattleCsv(csv).players;
const attribution = (extra = {}) => ({ playerIndex: 0, sourcePlayer: B.name, sourceSide: 'red',
  memberUid: A.uid, memberName: A.name, memberRevision: 1, ...extra });
const input = (extra = {}) => ({ requestId: crypto.randomUUID(), records: [{ filename: 'battle.csv', csvText: csv,
  type: 'scrimmage', datetime: '2026-10-27', redTeam: '本幫', blueTeam: '對手', ourSide: 'red', winner: 'red',
  attributions: [attribution()], ...extra }] });
const localFixture = () => { const repo = createRepository({ filename: ':memory:' }); repo.addMember(A); repo.addMember(B); return repo; };

const stripped = ({ memberUid, creditedName, ...value }) => value;

function exercise(api) {
  const payload = input(), saved = api.save(payload).records[0];
  assert.equal(saved.players[0].player, B.name);
  assert.equal(saved.players[0].creditedName, A.name);
  assert.equal(saved.players[0].memberUid, A.uid);
  assert.deepEqual(saved.players.map(stripped), players);
  assert.equal(api.personal(A.uid).total, 1);
  assert.equal(api.personal(B.uid).total, 0);
  assert.equal(api.personal(A.uid).entries[0].player.creditedName, A.name);
  assert.equal(api.attachment(saved.id), csv);
  assert.deepEqual(api.save(payload), { records: [saved] });
  assert.deepEqual(api.get(saved.id), saved);
  assert.throws(() => api.save({ ...payload, records: [{ ...payload.records[0], attributions: [attribution({ memberUid: B.uid, memberName: B.name })] }] }), { code: 'REQUEST_CONFLICT' });
  assert.throws(() => api.save({ ...payload, requestId: 'duplicate-attribution', records: [{ ...payload.records[0], attributions: [] }] }), { code: 'BATTLE_DUPLICATE' });
  assert.equal(api.list().total, 1);
  assert.equal(api.members().find(member => member.uid === B.uid).name, B.name);
  const defaultPayload = input({ datetime: '2026-10-28', attributions: undefined });
  const defaultRow = api.save(defaultPayload).records[0].players[0];
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

test('SQLite explicit operator assignment wins over the account owner, preserves raw CSV and metrics, and participates only in retry identity', () => {
  const repo = localFixture();
  try {
    exercise({ save: x => repo.saveBattleRecords(x), get: id => repo.getBattleRecord(id), list: () => repo.listBattleRecords(),
      personal: uid => repo.getMemberBattleRecords(uid, { readAll: true }), attachment: id => repo.getBattleAttachment(id, 'csv').bytes.toString(),
      members: () => repo.getBattleUploadRoster().members });
    const stale = input({ datetime: '2026-10-29' });
    const member = repo.listMembers().members.find(m => m.uid === A.uid);
    repo.updateMember(A.uid, { name: 'A的新名字', primaryProfessionId: 3, secondaryProfessionId: null,
      isInGuild: true, isInClub: false, revision: member.revision });
    assert.throws(() => repo.saveBattleRecords(stale), { code: 'ATTRIBUTION_MEMBER_CHANGED' });
    assert.equal(repo.listBattleRecords().total, 2);
    for (const attributions of [[attribution({ memberUid: 'missing' })], [attribution({ sourceSide: 'blue' })]])
      assert.throws(() => repo.saveBattleRecords(input({ datetime: '2026-10-30', attributions })));
  } finally { repo.close(); }
});

test('HTTP roster is one uncached management request, submission attribution retains CSRF and malformed responses fail', async () => {
  const repo = localFixture(), server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`, authed = await authenticatedFetch(server, repo), calls = [];
    const client = createBattleRecordClient({ fetchImpl: async (url, init) => {
      calls.push(url);
      const response = await authed(base + url, init);
      if (url === '/api/battle-upload/roster') assert.equal(response.headers.get('cache-control'), 'no-store');
      return response;
    } });
    const roster = await client.getUploadRoster();
    assert.deepEqual(calls, ['/api/battle-upload/roster']); assert.equal(roster.members.length, 2);
    const admin = await repo.authenticate({ username: 'test_admin', password: 'test-password-2026' });
    await repo.setMemberToken(admin.user.id, { password: '001234', revision: 0 });
    const member = await repo.authenticateMember({ password: '001234' });
    assert.equal((await fetch(base + calls[0])).status, 401);
    assert.equal((await fetch(base + calls[0], { headers: { Cookie: `guild_session=${member.token}` } })).status, 403);
    const path = base + '/api/battle-records';
    for (const [token, status] of [[null, 401], [member.token, 403], [admin.token, 403]])
      assert.equal((await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Cookie: `guild_session=${token}` } : {}) }, body: JSON.stringify(input()) })).status, status);
    assert.equal((await client.saveRecords(input())).records[0].players[0].memberUid, A.uid);
    for (const malformed of [{}, { members: [{}] }, { members: [{ ...roster.members[0], revision: null }] }]) {
      const bad = createBattleRecordClient({ fetchImpl: async () => ({ ok: true, json: async () => malformed }) });
      await assert.rejects(bad.getUploadRoster());
    }
  } finally { await new Promise(r => server.close(r)); repo.close(); }
});
