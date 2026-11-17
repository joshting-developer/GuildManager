import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createLineupClient } from '../src/api/lineups.js';
import { emptyLineup } from '../src/domain/lineups.js';
import { taipeiToday } from '../src/domain/battle-events.js';
import { authenticatedFetch } from './helpers/authenticated-fetch.js';

function localFixture() {
  const repo = createRepository({ filename: ':memory:' });
  repo.addMember({ uid: '001', name: '排表成員', primaryProfessionId: 1, secondaryProfessionId: 2, isInGuild: true });
  const event = repo.createEvent({ title: '最近場次', type: 'scrimmage', dates: [taipeiToday()], requestId: 'event' });
  const teams = emptyLineup();
  teams[0].slots[0].uid = '001';
  teams[0].slots[0].secondRound = { uid: null, profession: 'primary' };
  for (let i = 0; i < 12; i++) {
    teams[0].slots[0].alias = `小名${i}`;
    repo.confirmLineup({ eventId: event.id, eventRevision: 1, expectedVersion: i, requestId: `save-${i}`, teams });
  }
  repo.createLineupTemplate({ name: '完整範本', requestId: 'template', teams });
  return { repo, event, teams };
}

test('editor reads only the current version and defers template contents while legacy index/history stay equal', () => {
  const { repo, event } = localFixture();
  try {
    const old = repo.getLineupIndex(), history = repo.getLineupHistory(event.id);
    const editor = repo.getLineupEditor();
    assert.deepEqual(editor.events, old.events);
    assert.equal(editor.templates, undefined);
    assert.equal(editor.selected.eventId, event.id);
    assert.deepEqual(editor.selected.versions, [history.versions[0]]);
    assert.equal(editor.selected.versions[0].teams[0].slots[0].alias, '小名11');
    assert.deepEqual(editor.members, repo.listMembers().members);
    assert.deepEqual(editor.professions, repo.listProfessions().professions);
    assert.deepEqual(editor.duties, repo.listDuties().duties);
    assert.deepEqual(editor.selected.participation, repo.getEventParticipation(event.id));
    assert.deepEqual(repo.getLineupTemplates().templates, old.templates.map(({ id, name, createdAt }) => ({ id, name, createdAt })));
    assert.deepEqual(repo.getLineupHistory(event.id), history);
    const current = repo.getLineupEvent(event.id);
    assert.equal(current.members, undefined);
    assert.deepEqual(repo.getLineupEvent(event.id, true).members, editor.members);
    assert.equal(repo.getLineupSources(event.id).versions, undefined);
    assert.deepEqual(repo.getLineupSources(event.id).members, editor.members);
    assert.ok(JSON.stringify(editor).length < JSON.stringify({ ...old, selected: { versions: history.versions }, members: editor.members, professions: editor.professions, duties: editor.duties }).length / 2);
  } finally { repo.close(); }
});

test('editor handles no events, preserves requested nondefault event, and reads archived snapshots without participation', () => {
  const repo = createRepository({ filename: ':memory:' });
  try {
    assert.equal(repo.getLineupEditor().selected, null);
    assert.equal(repo.getLineupTemplates().templates.length, 0);
    const a = repo.createEvent({ type: 'scrimmage', title: '甲', dates: [taipeiToday()], requestId: 'a' });
    const b = repo.createEvent({ type: 'scrimmage', title: '乙', dates: ['2020-01-01'], requestId: 'b' });
    assert.equal(repo.getLineupEditor(b.id).selected.eventId, b.id);
    assert.equal(repo.getLineupEditor('no-longer-present').selected.eventId, a.id);
    repo.confirmLineup({ eventId: b.id, eventRevision: 1, expectedVersion: 0, requestId: 'save', teams: emptyLineup() });
    repo.deleteEvent(b.id, 1);
    const archived = repo.getLineupEditor(b.id).selected;
    assert.equal(archived.event.archived, true);
    assert.equal(archived.participation, null);
    assert.equal(archived.versions.length, 1);
    assert.throws(() => repo.getLineupEvent('missing'), { code: 'EVENT_UNAVAILABLE' });
    assert.throws(() => repo.getLineupEditor({}), { code: 'LINEUP_INVALID' });
    assert.throws(() => repo.getLineupEvent(a.id, 'true'), { code: 'LINEUP_INVALID' });
  } finally { repo.close(); }
});

test('HTTP new adapter uses one request per read and requires management without widening existing endpoints', async () => {
  const { repo, event } = localFixture(), server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`, authed = await authenticatedFetch(server, repo), calls = [];
    const client = createLineupClient({ fetchImpl: (path, init) => { calls.push(path); return authed(base + path, init); } });
    assert.equal((await client.getEditor(event.id)).selected.versions.length, 1);
    assert.equal((await client.getEvent(event.id)).versions.length, 1);
    assert.ok((await client.getEvent(event.id, { includeCatalogs: true })).members.length);
    assert.equal((await client.getTemplates()).templates.length, 1);
    assert.ok((await client.getSources(event.id)).members.length);
    assert.equal(calls.length, 5);
    assert.equal((await client.getHistory(event.id)).versions.length, 12);
    const admin = (await repo.authenticate({ username: 'test_admin', password: 'test-password-2026' })).user;
    await repo.setMemberToken(admin.id, { password: '001234', revision: 0 });
    const member = await repo.authenticateMember({ password: '001234' });
    for (const path of ['/editor', '/templates', `/events/${event.id}/current`, `/events/${event.id}/sources`]) {
      assert.equal((await fetch(base + '/api/lineups' + path)).status, 401);
      assert.equal((await fetch(base + '/api/lineups' + path, { headers: { Cookie: `guild_session=${member.token}` } })).status, 403);
    }
    assert.equal((await authed(base + `/api/lineups/events/${event.id}/current?includeCatalogs=bad`)).status, 422);
  } finally { await new Promise(resolve => server.close(resolve)); repo.close(); }
});
