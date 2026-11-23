import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { createLineupClient } from '../../src/api/lineups.js';
import { emptyLineup } from '../../src/domain/lineups.js';
import { taipeiToday } from '../../src/domain/battle-events.js';
import { authenticatedFetch } from '../helpers/authenticated-fetch.js';

async function localFixture() {
  const repo = await createTestRepository({ });
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

test('HTTP new adapter uses one request per read and requires management without widening existing endpoints', async () => {
  const { repo, event } = await localFixture(), server = createApp(repo).listen(0, '127.0.0.1');
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
    const choices = await client.getChoices(0);
    assert.equal(choices.events.length, 1);
    assert.equal(choices.hasMore, false);
    assert.equal(choices.nextOffset, 1);
    assert.equal((await client.getHistory(event.id)).versions.length, 12);
    const admin = (await (await repo.authenticate({ username: 'test_admin', password: 'test-password-2026' }))).user;
    await (await repo.setMemberToken(admin.id, { password: '001234', revision: 0 }));
    const member = await (await repo.authenticateMember({ password: '001234' }));
    for (const path of ['/choices?offset=0', '/editor', '/templates', `/events/${event.id}/current`, `/events/${event.id}/sources`]) {
      assert.equal((await fetch(base + '/api/lineups' + path)).status, 401);
      assert.equal((await fetch(base + '/api/lineups' + path, { headers: { Cookie: `guild_session=${member.token}` } })).status, 403);
    }
    assert.equal((await authed(base + `/api/lineups/events/${event.id}/current?includeCatalogs=bad`)).status, 422);
  } finally { await new Promise(resolve => server.close(resolve)); (await repo.close()); }
});
