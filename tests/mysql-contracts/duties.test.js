import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTestRepository as createRepository } from '../helpers/mysql-repository.js';

import { emptyLineup } from "../../src/domain/lineups.js";
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
test('duty catalog preserves fixed IDs, validates names, rejects duplicates and supports versioned rename/deactivation/retry', async () => {
  const repo = (await createRepository());
  try {
    assert.deepEqual(
      (await repo.listDuties()).duties.map((d) => d.name),
      ['保鑣', '山盟', '輔潮'],
    );
    const created = (await repo.addDuty({ name: ' 塔前炮 ', requestId: 'new-duty' }));
    assert.equal(created.name, '塔前炮');
    assert.equal(created.active, true);
    assert.deepEqual((await repo.addDuty({ name: '塔前炮', requestId: 'new-duty' })), created);
    (await assert.rejects(
      async () => (await repo.addDuty({ name: '塔後炮', requestId: 'new-duty' })),
      code('REQUEST_CONFLICT'),
    ));
    (await assert.rejects(
      async () => (await repo.addDuty({ name: '保鑣', requestId: 'duplicate' })),
      code('DUPLICATE_DUTY'),
    ));
    for (const name of ['', 'a'.repeat(41), 7, '\n保鑣'])
      (await assert.rejects(async () => (await repo.addDuty({ name, requestId: 'bad' })), code('DUTY_INVALID')));
    (await assert.rejects(async () => (await repo.addDuty({ name: '炮手', requestId: 'bad key' })), code('DUTY_INVALID')));
    const changed = (await repo.updateDuty(created.id, { name: '塔後炮', active: false, revision: 1 }));
    assert.equal(changed.revision, 2);
    assert.equal(changed.id, created.id);
    assert.deepEqual(
      (await repo.updateDuty(created.id, { name: '塔後炮', active: false, revision: 1 })),
      changed,
    );
    (await assert.rejects(
      async () => (await repo.updateDuty(created.id, { name: '砲手', active: true, revision: 1 })),
      code('DUTY_CONFLICT'),
    ));
    (await assert.rejects(
      async () => (await repo.updateDuty(created.id, { name: '山盟', active: true, revision: 2 })),
      code('DUPLICATE_DUTY'),
    ));
    (await assert.rejects(
      async () => (await repo.updateDuty(created.id, { name: '砲手', active: 1, revision: 2 })),
      code('DUTY_INVALID'),
    ));
    (await assert.rejects(
      async () => (await repo.updateDuty('missing', { name: '砲手', active: true, revision: 1 })),
      code('DUTY_NOT_FOUND'),
    ));
    assert.equal(
      (await repo.updateDuty(created.id, { name: '塔後炮', active: true, revision: 2 })).revision,
      3,
    );
  } finally {
    (await repo.close());
  }
});
test('multiple reusable duties are ID-linked and server snapshots preserve old names after catalog changes', async () => {
  const repo = (await createRepository());
  try {
    const battle = (await event(repo));
    const catalog = (await repo.listDuties()).duties;
    const teams = emptyLineup();
    teams[0].slots[0].dutyIds = [catalog[0].id, catalog[1].id];
    teams[0].slots[0].note = '舊文字備註';
    teams[0].slots[0].duties = [{ id: catalog[0].id, name: '偽造名稱' }];
    teams[0].slots[1].dutyIds = [catalog[0].id];
    const first = (await repo.confirmLineup(confirmInput(battle, teams)));
    assert.deepEqual(
      first.teams[0].slots[0].duties,
      catalog.slice(0, 2).map(({ id, name }) => ({ id, name })),
    );
    const template = (await repo.createLineupTemplate({ name: '職責模板', teams, requestId: 'template' }));
    const renamed = (await repo.updateDuty(catalog[0].id, { name: '新版保鑣', active: true, revision: 1 }));
    assert.deepEqual((await repo.getLineupHistory(battle.id)).versions, [first]);
    assert.deepEqual((await repo.getLineupIndex()).templates, [template]);
    const applied = (await repo.applyLineupTemplate(template.id, battle.id));
    assert.deepEqual(applied.teams[0].slots[0].dutyIds, [renamed.id, catalog[1].id]);
    const second = (await repo.confirmLineup(
      confirmInput(battle, applied.teams, { requestId: 'second', expectedVersion: 1 }),
    ));
    assert.equal(second.teams[0].slots[0].duties[0].name, '新版保鑣');
    (await repo.updateDuty(renamed.id, { name: renamed.name, active: false, revision: 2 }));
    (await assert.rejects(
      async () =>
        (await repo.confirmLineup(
          confirmInput(battle, teams, { requestId: 'inactive', expectedVersion: 2 }),
        )),
      code('DUTY_UNAVAILABLE'),
    ));
    const filtered = (await repo.applyLineupTemplate(template.id, battle.id));
    assert.deepEqual(filtered.teams[0].slots[0].dutyIds, [catalog[1].id]);
    assert.equal(filtered.teams[0].slots[0].note, '舊文字備註');
    assert.equal(filtered.skippedDuties.length, 2);
    assert.deepEqual(
      filtered.skippedDuties.map((d) => d.position),
      [1, 2],
    );
    assert.equal(filtered.skippedDuties[0].name, '保鑣');
    assert.equal((await repo.getLineupHistory(battle.id)).versions.length, 2);
    for (const dutyIds of [['missing'], [catalog[1].id, catalog[1].id], null, [1]]) {
      const invalid = emptyLineup();
      invalid[0].slots[0].dutyIds = dutyIds;
      (await assert.rejects(
        async () =>
          (await repo.confirmLineup(
            confirmInput(battle, invalid, { requestId: 'invalid', expectedVersion: 2 }),
          )),
        (error) => ['DUTY_UNAVAILABLE', 'LINEUP_INVALID'].includes(error.code),
      ));
    }
  } finally {
    (await repo.close());
  }
});
