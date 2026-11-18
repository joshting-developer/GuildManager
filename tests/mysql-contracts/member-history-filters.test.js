import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTestRepository as createRepository } from '../helpers/mysql-repository.js';

const header = '玩家名字,職業,擊敗,助攻,資源,對玩家傷害,對建築傷害,治療值,承受傷害,重傷,化羽/清泉,焚骨';
const csv = (name = '新成員', job = '碎夢') => `${header}\n${name},${job},10,20,3,100,200,0,300,2,0,0\n${name},${job},5,8,2,50,100,0,200,0,0,0\n${header}\n對手,鐵衣,1,2,3,40,50,0,100,1,0,0`;
const person = (uid, name = '新成員') => ({ uid, name, primaryProfessionId: 3, secondaryProfessionId: 1 });
const record = (name = '新成員', job = '碎夢', datetime = '2026-10-24') => ({
  filename: 'history.csv', csvText: csv(name, job), type: 'scrimmage', datetime,
  redTeam: '紅方', blueTeam: '藍方', winner: 'red',
});
const upload = async (repo, row) => (await repo.saveBattleRecords({ records: [row], requestId: crypto.randomUUID() })).records[0];
async function importRoster(repo, text) {
  const { fingerprint } = (await repo.previewMemberImport({ text }));
  return (await repo.importMembers({ text, fingerprint }));
}

test('new member and CSV import link every exact unassigned historical row, with final-batch duplicate checks', async () => {
  const repo = (await createRepository());
  try {
    const first = (await upload(repo, record()));
    (await repo.addMember(person('001')));
    assert.equal((await repo.getMemberBattleRecords('001')).total, 2);
    assert.equal((await repo.getBattleRecord(first.id)).players[0].memberUid, '001');
    assert.equal((await repo.getBattleRecord(first.id)).players[1].memberUid, '001');
    assert.ok(!(await repo.getBattleRecord(first.id)).players[2].memberUid);
    (await repo.updateMember('001', { name: '已改名', primaryProfessionId: 3, secondaryProfessionId: 1, revision: 1 }));
    (await repo.addMember(person('002')));
    assert.equal((await repo.getMemberBattleRecords('002')).total, 0);
    assert.equal((await repo.getBattleRecord(first.id)).players[0].memberUid, '001');
    (await upload(repo, record('匯入角色')));
    (await upload(repo, record('同批重名')));
    const result = (await importRoster(repo, '003 匯入角色 素問 -\n004 同批重名 碎夢 -\n005 同批重名 龍吟 -'));
    assert.equal(result.summary.added, 3);
    assert.equal((await repo.getMemberBattleRecords('003')).total, 2);
    assert.equal((await repo.getMemberBattleRecords('004')).total, 0);
    assert.equal((await repo.getMemberBattleRecords('005')).total, 0);
    assert.equal((await importRoster(repo, '003 匯入角色 素問 -')).summary.skipped, 1);
    assert.equal((await repo.getMemberBattleRecords('003')).total, 2);
    (await upload(repo, record('小寫')));
    (await repo.addMember(person('006', '小寫不同')));
    assert.equal((await repo.getMemberBattleRecords('006')).total, 0);
    (await repo.addMember(person('007', '既有同名')));
    (await repo.addMember({ ...person('008', '既有同名'), isInGuild: false, isInClub: false }));
    (await upload(repo, record('既有同名')));
    (await repo.addMember(person('009', '既有同名')));
    assert.equal((await repo.getMemberBattleRecords('009')).total, 0);
  } finally { (await repo.close()); }
});

async function checkFilters(add, save, get) {
  const late = (await save(record('新成員', '碎夢', '2026-10-24T23:59')));
  (await save(record('新成員', '素問', '2026-10-25T00:00')));
  add(person('001'));
  for (let day = 1; day <= 21; day++) (await save(record('新成員', '龍吟', `2026-11-${String(day).padStart(2, '0')}`)));
  const selected = (await get('001', { startDate: '2026-10-24', endDate: '2026-10-24', profession: '碎夢' }));
  assert.equal(selected.total, 2); assert.equal(selected.summary.battleCount, 1);
  assert.equal(selected.entries[0].recordId, late.id);
  assert.equal(selected.summary.metrics.find(m => m.key === 'kill').total, 15);
  assert.equal((await get('001', { endDate: '2026-10-24' })).total, 2);
  assert.equal((await get('001', { startDate: '2026-10-25', endDate: '2026-10-25' })).total, 2);
  const first = (await get('001', { startDate: '2026-11-01', profession: '龍吟' }));
  const second = (await get('001', { startDate: '2026-11-01', profession: '龍吟', page: 2 }));
  assert.equal(first.total, 42); assert.equal(first.entries.length, 20); assert.equal(second.entries.length, 20);
  assert.deepEqual(first.summary, second.summary);
  assert.equal(first.summary.metrics.find(m => m.key === 'kill').total, 315);
  assert.equal(first.summary.battleCount, 21);
  const empty = (await get('001', { profession: '鐵衣' }));
  assert.equal(empty.total, 0); assert.equal(empty.summary.battleCount, 0);
  assert.deepEqual(new Set(empty.professions), new Set(['碎夢', '素問', '龍吟']));
  for (const filters of [{ startDate: '2026-02-30' }, { endDate: 'wrong' }, { startDate: '2026-10-25', endDate: '2026-10-24' }, { profession: [] }])
    (await assert.rejects(async () => (await get('001', filters)), e => e.code === 'BATTLE_FILTER_INVALID'));
}

test('MySQL date/profession filters include Taipei boundary days and summaries precede pagination', async () => {
  const repo = (await createRepository());
  try { await checkFilters(async p => (await repo.addMember(p)), async r => (await upload(repo, r)), async (uid, filters) => (await repo.getMemberBattleRecords(uid, filters))); }
  finally { (await repo.close()); }
});
