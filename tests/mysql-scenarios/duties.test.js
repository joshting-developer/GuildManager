import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository, reopenTestRepository } from '../helpers/mysql-repository.js';
import { emptyLineup, placeMember } from '../../src/domain/lineups.js';
const code = (code) => (error) => error.code === code;
async function event(repo) {
  return (await repo.createEvent({
    title: '職責測試',
    type: 'scrimmage',
    dates: ['2026-10-24'],
    requestId: 'event',
  }));
}
function confirmInput(event, teams, options = {}) {
  return {
    eventId: event.id,
    eventRevision: 1,
    expectedVersion: 0,
    teams,
    requestId: 'confirm',
    ...options,
  };
}

test('initial duty names and inactive states never reset on restart, new assignments persist and movements retain seat duties', async () => {
  let repo = await createTestRepository({ });
  try {
    const original = (await repo.listDuties()).duties[0];
    const changed = (await repo.updateDuty(original.id, { name: '專用保鑣', active: false, revision: 1 }));
    const added = (await repo.addDuty({ name: '指揮', requestId: 'command' }));
    const teams = emptyLineup();
    teams[0].slots[0].uid = '001';
    teams[0].slots[0].dutyIds = [added.id];
    teams[0].slots[1].uid = '002';
    placeMember(teams, '001', 'attack-1', 1);
    assert.equal(teams[0].slots[1].uid, '001');
    assert.deepEqual(teams[0].slots[0].dutyIds, [added.id]);
    assert.deepEqual(teams[0].slots[1].dutyIds, []);
    const battle = await event(repo),
      blank = emptyLineup();
    blank[0].slots[0].dutyIds = [added.id];
    const saved = (await repo.confirmLineup(confirmInput(battle, blank)));
    repo = reopenTestRepository(repo);
    assert.equal((await repo.listDuties()).duties.length, 4);
    assert.deepEqual(
      (await repo.listDuties()).duties.find((d) => d.id === original.id),
      changed,
    );
    assert.deepEqual((await repo.getLineupHistory(battle.id)).versions, [saved]);
  } finally {
    (await repo.close());
  }
});
