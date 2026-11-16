import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository as createRepository } from '../helpers/mysql-repository.js';

import { emptyLineup } from '../../src/domain/lineups.js';
import { taipeiToday } from '../../src/domain/battle-events.js';

async function localFixture() {
  const repo = (await createRepository());
  (await repo.addMember({ uid: '001', name: '排表成員', primaryProfessionId: 1, secondaryProfessionId: 2, isInGuild: true }));
  const event = (await repo.createEvent({ title: '最近場次', type: 'scrimmage', dates: [taipeiToday()], requestId: 'event' }));
  const teams = emptyLineup();
  teams[0].slots[0].uid = '001';
  teams[0].slots[0].secondRound = { uid: null, profession: 'primary' };
  for (let i = 0; i < 12; i++) {
    teams[0].slots[0].alias = `小名${i}`;
    (await repo.confirmLineup({ eventId: event.id, eventRevision: 1, expectedVersion: i, requestId: `save-${i}`, teams }));
  }
  (await repo.createLineupTemplate({ name: '完整範本', requestId: 'template', teams }));
  return { repo, event, teams };
}

test('editor reads only the current version and defers template contents while legacy index/history stay equal', async () => {
  const { repo, event } = (await localFixture());
  try {
    const old = (await repo.getLineupIndex()), history = (await repo.getLineupHistory(event.id));
    const editor = (await repo.getLineupEditor());
    assert.deepEqual(editor.events, old.events);
    assert.equal(editor.templates, undefined);
    assert.equal(editor.selected.eventId, event.id);
    assert.deepEqual(editor.selected.versions, [history.versions[0]]);
    assert.equal(editor.selected.versions[0].teams[0].slots[0].alias, '小名11');
    assert.deepEqual(editor.members, (await repo.listMembers()).members);
    assert.deepEqual(editor.professions, (await repo.listProfessions()).professions);
    assert.deepEqual(editor.duties, (await repo.listDuties()).duties);
    assert.deepEqual(editor.selected.participation, (await repo.getEventParticipation(event.id)));
    assert.deepEqual((await repo.getLineupTemplates()).templates, old.templates.map(({ id, name, createdAt }) => ({ id, name, createdAt })));
    assert.deepEqual((await repo.getLineupHistory(event.id)), history);
    const current = (await repo.getLineupEvent(event.id));
    assert.equal(current.members, undefined);
    assert.deepEqual((await repo.getLineupEvent(event.id, true)).members, editor.members);
    assert.equal((await repo.getLineupSources(event.id)).versions, undefined);
    assert.deepEqual((await repo.getLineupSources(event.id)).members, editor.members);
    assert.ok(JSON.stringify(editor).length < JSON.stringify({ ...old, selected: { versions: history.versions }, members: editor.members, professions: editor.professions, duties: editor.duties }).length / 2);
  } finally { (await repo.close()); }
});

test('editor handles no events, preserves requested nondefault event, and reads archived snapshots without participation', async () => {
  const repo = (await createRepository());
  try {
    assert.equal((await repo.getLineupEditor()).selected, null);
    assert.equal((await repo.getLineupTemplates()).templates.length, 0);
    const a = (await repo.createEvent({ type: 'scrimmage', title: '甲', dates: [taipeiToday()], requestId: 'a' }));
    const b = (await repo.createEvent({ type: 'scrimmage', title: '乙', dates: ['2020-01-01'], requestId: 'b' }));
    assert.equal((await repo.getLineupEditor(b.id)).selected.eventId, b.id);
    assert.equal((await repo.getLineupEditor('no-longer-present')).selected.eventId, a.id);
    (await repo.confirmLineup({ eventId: b.id, eventRevision: 1, expectedVersion: 0, requestId: 'save', teams: emptyLineup() }));
    (await repo.deleteEvent(b.id, 1));
    const archived = (await repo.getLineupEditor(b.id)).selected;
    assert.equal(archived.event.archived, true);
    assert.equal(archived.participation, null);
    assert.equal(archived.versions.length, 1);
    (await assert.rejects(async () => (await repo.getLineupEvent('missing')), { code: 'EVENT_UNAVAILABLE' }));
    (await assert.rejects(async () => (await repo.getLineupEditor({})), { code: 'LINEUP_INVALID' }));
    (await assert.rejects(async () => (await repo.getLineupEvent(a.id, 'true')), { code: 'LINEUP_INVALID' }));
  } finally { (await repo.close()); }
});
