import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createLineupClient } from '../src/api/lineups.js';
import { emptyLineup } from '../src/domain/lineups.js';
import { taipeiToday } from '../src/domain/battle-events.js';
import { authenticatedFetch } from './helpers/authenticated-fetch.js';
import { gasRuntime, cloudResult, cloudSession } from './helpers/gas-runtime.js';

const shift = (days) => {
  const [y, m, d] = taipeiToday().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

test('local lineup index can bundle the nearest upcoming battle with its versions and sign-ups', async () => {
  const repo = createRepository({ filename: ':memory:' });
  repo.addMember({ uid: '001', name: '甲', primaryProfessionId: 1, isInGuild: true });
  const past = repo.createEvent({ type: 'guild_war', title: '過去', dates: [shift(-3)], requestId: 'past' });
  const soon = repo.createEvent({ type: 'scrimmage', title: '下一場', dates: [shift(2)], requestId: 'soon' });
  repo.createEvent({ type: 'dragon_tiger', title: '更晚', dates: [shift(9)], requestId: 'later' });
  repo.saveMemberResponse(soon.id, { uid: '001', status: 'leave', revision: 0 });
  const teams = emptyLineup();
  teams[0].slots[0].uid = '001';
  repo.saveMemberResponse(past.id, { uid: '001', status: 'registered', revision: 0 });
  repo.confirmLineup({ eventId: past.id, eventRevision: past.revision, expectedVersion: 0, requestId: 'past-lineup', teams });
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const fetch = await authenticatedFetch(server, repo);
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = createLineupClient({ fetchImpl: (path, init) => fetch(base + path, init) });
  try {
    const plain = await client.getIndex();
    assert.equal('selected' in plain, false, 'the plain index is unchanged');
    const bundled = await client.getIndex({ include: 'default' });
    assert.deepEqual(bundled.events, plain.events);
    assert.equal(bundled.selected.eventId, soon.id, 'nearest upcoming battle');
    assert.deepEqual(bundled.selected.versions, []);
    assert.equal(bundled.selected.participation.responses[0].status, 'leave');
  } finally {
    server.close();
    repo.close();
  }
});

test('GAS lineup index bundles the default battle only when asked, and old callers still work', async () => {
  const env = await gasRuntime();
  env.setup();
  const context = cloudSession(cloudResult(env.raw('login', [{ username: 'admin', password: 'initial-password-123' }])));
  const call = (op, args = []) => cloudResult(env.raw(op, args, context));
  call('addMember', [{ uid: '0001', name: '甲', primaryProfessionId: 3, isInGuild: true, isInClub: false }]);
  const soon = call('createEvent', [{ type: 'guild_war', title: '', dates: [shift(1)], requestId: 'soon' }]).events[0];
  call('saveMemberResponse', [soon.id, { uid: '0001', status: 'registered', revision: 0 }]);
  const teams = emptyLineup();
  teams[0].slots[0].uid = '0001';
  call('confirmLineup', [{ teams, eventId: soon.id, eventRevision: 1, expectedVersion: 0, requestId: 'soon-lineup' }]);
  const plain = cloudResult(env.sandbox.getLineupIndex(context));
  assert.equal('selected' in plain, false, 'getLineupIndex(context) keeps working');
  const bundled = cloudResult(env.sandbox.getLineupIndex({ include: 'default' }, context));
  assert.equal(bundled.selected.eventId, soon.id);
  assert.equal(bundled.selected.versions[0].version, 1);
  assert.equal(bundled.selected.participation.responses[0].uid, '0001');
});
