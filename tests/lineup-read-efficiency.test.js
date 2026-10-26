import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createLineupClient } from '../src/api/lineups.js';
import { emptyLineup } from '../src/domain/lineups.js';
import { taipeiToday } from '../src/domain/battle-events.js';
import { authenticatedFetch } from './helpers/authenticated-fetch.js';
import { gasRuntime, cloudResult, cloudSession } from './helpers/gas-runtime.js';
import { createSheetStore } from '../gas/src/storage.js';
import { canonical } from '../gas/src/common.js';

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

async function gasFixture() {
  const env = await gasRuntime(); env.setup();
  const context = cloudSession(cloudResult(env.raw('login', [{ username: 'admin', password: 'initial-password-123' }])));
  cloudResult(env.raw('createManager', [{ username: 'manager', password: 'manager-password' }], context));
  const manager = cloudSession(cloudResult(env.raw('login', [{ username: 'manager', password: 'manager-password' }])));
  cloudResult(env.raw('setMemberToken', [{ password: '001234', revision: 0 }], context));
  const member = cloudSession(cloudResult(env.raw('loginMember', [{ password: '001234' }])));
  const stamp = '2026-10-26T00:00:00Z', teams = emptyLineup();
  teams[0].slots[0] = { ...teams[0].slots[0], uid: 'old-uid', alias: '第一人小名', member: { uid: 'old-uid', name: '原快照' },
    secondRound: { uid: 'second', profession: 'primary', alias: '第二人小名', member: { uid: 'second', name: '第二人' } } };
  const storage = createSheetStore(env);
  storage.transaction(store => {
    store.put('events', 'event', { id: 'event', title: '最近場次', type: 'scrimmage', dates: [taipeiToday()], revision: 1, createdAt: stamp });
    store.put('members', 'new-uid', { uid: 'new-uid', name: '現在名稱', primaryProfessionId: 1, isInGuild: true, isInClub: false, joinedAt: stamp, revision: 1 });
    store.put('responses', canonical(['event', 'new-uid']), { eventId: 'event', uid: 'new-uid', status: 'leave', revision: 1 });
    for (let i = 1; i <= 20; i++) store.put('lineup_versions', `v-${i}`, { id: `v-${i}`, eventId: 'event', event: { id: 'event', title: '最近場次', type: 'scrimmage', dates: [taipeiToday()], revision: 1 }, version: i, createdAt: stamp, teams });
    store.put('requests', 'member-ref:lineup:v-20', { overrides: [['old-uid', 'new-uid']] });
    for (let i = 0; i < 8; i++) store.put('templates', `template-${i}`, { id: `template-${i}`, name: `範本${i}`, teams, createdAt: stamp });
  });
  return { env, context, manager, member, storage };
}

test('GAS editor uses fewer Sheets reads, skips templates entirely and returns the same latest projected snapshot under writer lock', async (t) => {
  const { env, context, manager, member } = await gasFixture();
  let reads = [];
  for (const [name, sheet] of env.sheets) {
    const getRange = sheet.getRange.bind(sheet);
    sheet.getRange = (...args) => { const range = getRange(...args), values = range.getValues; range.getValues = () => { reads.push(name); return values(); }; return range; };
  }
  const call = (op, args = [], ctx = context) => cloudResult(env.raw(op, args, ctx));
  const old = call('getLineupIndex', [{ include: 'default' }]);
  const catalogs = { ...call('getMembers'), ...call('getProfessions'), ...call('getDuties') };
  const oldReads = reads.length; reads = [];
  const before = JSON.stringify({ sheets: [...env.sheets].map(([n, s]) => [n, s.data]), properties: [...env.properties], files: [...env.files], fetches: env.fetches });
  env.lock.tryLock(); env.lock.tryLock = () => assert.fail('editor cannot acquire writer lock');
  const editor = call('getLineupEditor', [null]);
  assert.ok(reads.length < oldReads, `${reads.length} editor reads versus ${oldReads} legacy reads`);
  assert.equal(reads.includes('GM_templates'), false);
  t.diagnostic(JSON.stringify({ legacySheetsReads: oldReads, editorSheetsReads: reads.length, legacyBytes: JSON.stringify({ ...old, ...catalogs }).length, editorBytes: JSON.stringify(editor).length }));
  assert.deepEqual(editor.selected.versions, old.selected.versions.slice(0, 1));
  assert.deepEqual(editor.selected.participation, old.selected.participation);
  assert.deepEqual(editor.events, old.events);
  for (const key of ['members', 'professions', 'duties']) assert.deepEqual(editor[key], catalogs[key]);
  assert.equal(editor.templates, undefined);
  assert.equal(editor.selected.versions[0].teams[0].slots[0].uid, 'new-uid');
  assert.equal(editor.selected.versions[0].teams[0].slots[0].secondRound.alias, '第二人小名');
  assert.ok(JSON.stringify(editor).length < JSON.stringify({ ...old, ...catalogs }).length / 2);
  reads = [];
  assert.deepEqual(call('getLineupSources', ['event']).members, catalogs.members);
  assert.equal(reads.includes('GM_lineup_versions'), false, 'source refresh must not read saved lineups');
  assert.equal(reads.includes('GM_templates'), false);
  assert.deepEqual(call('getLineupEvent', ['event', true]).members, catalogs.members);
  assert.ok(call('getLineupEditor', ['event'], manager).selected);
  const summaries = call('getLineupTemplates').templates;
  assert.equal(summaries.length, 8);
  assert.ok(summaries.every(row => Object.keys(row).sort().join(',') === 'createdAt,id,name'));
  for (const [op, args] of [['getLineupEditor', [null]], ['getLineupEvent', ['event', false]], ['getLineupTemplates', []], ['getLineupSources', ['event']]]) {
    assert.equal(env.raw(op, args).error.code, 'AUTH_REQUIRED');
    assert.equal(env.raw(op, args, member).error.code, 'MANAGEMENT_REQUIRED');
  }
  assert.equal(JSON.stringify({ sheets: [...env.sheets].map(([n, s]) => [n, s.data]), properties: [...env.properties], files: [...env.files], fetches: env.fetches }), before);
});

test('GAS archived and empty editor retain legacy snapshots and never read participation for archived records', async () => {
  const env = await gasRuntime(); env.setup();
  const context = cloudSession(cloudResult(env.raw('login', [{ username: 'admin', password: 'initial-password-123' }])));
  const call = (op, args = []) => cloudResult(env.raw(op, args, context));
  assert.equal(call('getLineupEditor', [null]).selected, null);
  const storage = createSheetStore(env), event = { id: 'archived', title: '舊場次', type: 'scrimmage', dates: ['2020-01-01'], revision: 1 };
  storage.transaction(s => s.put('lineup_versions', 'old', { id: 'old', eventId: event.id, event, teams: emptyLineup(), version: 1, createdAt: '2020-01-01T00:00:00Z' }));
  const old = call('getLineupHistory', [event.id]);
  const current = call('getLineupEvent', [event.id, false]);
  assert.equal(current.event.archived, true);
  assert.equal(current.participation, null);
  assert.deepEqual(current.versions, old.versions);
  assert.equal(call('getLineupEditor', [event.id]).selected.eventId, event.id);
  assert.equal(env.raw('getLineupEvent', [event.id, 'true'], context).error.code, 'LINEUP_INVALID');
});
