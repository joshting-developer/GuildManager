import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createParticipationClient } from '../src/api/participation.js';

const types = ['scrimmage', 'guild_war', 'dragon_tiger'];
const video = (event, extra = {}) => ({ name: '公開影片', professionId: 3,
  firstUrl: 'https://example.com/video', secondUrl: '', groupName: '進攻一', note: '',
  eventRevision: event.revision, requestId: crypto.randomUUID(), ...extra });
function seedLocal() {
  const repo = createRepository({ filename: ':memory:' });
  for (const [uid, isInGuild, isInClub] of [['guild', true, false], ['club', false, true], ['outside', false, false]])
    repo.addMember({ uid, name: uid, primaryProfessionId: 3, isInGuild, isInClub });
  const events = [...types, 'activity'].map(type => repo.createEvent({ title: type, type,
    dates: ['2026-10-01'], requestId: type }));
  repo.saveMemberResponse(events[0].id, { uid: 'guild', status: 'leave', note: '不應出現在影片表單', revision: 0 });
  repo.addGuestRegistration(events[0].id, { name: '外援', professionId: 3, requestId: 'guest' });
  return { repo, events };
}

test('video form preserves the legacy public roster and professions without returning participant responses or versions', () => {
  const { repo, events } = seedLocal();
  try {
    const old = repo.getEventParticipationForm(events[0].id);
    for (const event of events.slice(0, 3)) {
      const form = repo.getEventVideoForm(event.id);
      assert.deepEqual(Object.keys(form).sort(), ['event', 'eventId', 'members', 'professions']);
      assert.deepEqual(form.event, repo.getEvent(event.id).event);
      assert.deepEqual(form.members, old.members);
      assert.deepEqual(form.professions, old.professions);
      assert.deepEqual(form.members.map(row => row.uid).sort(), ['club', 'guild']);
    }
    assert.deepEqual(repo.getEventParticipationForm(events[0].id), old);
    assert.equal(old.responses[0].note, '不應出現在影片表單');
    repo.updateEvent(events[0].id, { ...events[0], title: '已修改', revision: events[0].revision });
    assert.equal(repo.getEventVideoForm(events[0].id).event.revision, 2);
    assert.throws(() => repo.getEventVideoForm(events[3].id));
    repo.deleteEvent(events[1].id, 1);
    assert.throws(() => repo.getEventVideoForm(events[1].id));
    assert.throws(() => repo.getEventVideoForm('missing'));
  } finally { repo.close(); }
});

test('video-form HTTP adapter makes one anonymous read; member access, CSRF and video request retries retain their rules', async () => {
  const { repo, events } = seedLocal(), server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const calls = [], client = createParticipationClient({ fetchImpl: (path, init) => { calls.push(path); return fetch(base + path, init); } });
    for (const event of events.slice(0, 3)) assert.equal((await client.getVideoForm(event.id)).eventId, event.id);
    assert.equal(calls.length, 3);
    assert.ok(calls.every(path => path.endsWith('/video-form')));
    const admin = await repo.createAccount({ username: 'admin', password: 'test-password-2026' });
    await repo.setMemberToken(admin.id, { password: '001234', revision: 0 });
    const login = await fetch(base + '/api/auth/member-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: '001234' }) });
    const member = await login.json();
    const headers = { Cookie: login.headers.get('set-cookie').split(';')[0] };
    const get = await fetch(base + `/api/events/${events[0].id}/video-form`, { headers });
    assert.equal(get.status, 200);
    assert.equal(get.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(base + `/api/events/${events[0].id}/videos`, { headers })).status, 403);
    const input = video(events[0]);
    const submit = (extra = {}) => fetch(base + `/api/events/${events[0].id}/videos`, { method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(input) });
    assert.equal((await submit()).status, 403);
    const first = await submit({ 'X-CSRF-Token': member.csrfToken });
    assert.equal(first.status, 201);
    const saved = await first.json();
    assert.deepEqual(await (await submit({ 'X-CSRF-Token': member.csrfToken })).json(), saved);
    for (const id of [events[3].id, 'missing'])
      assert.ok((await fetch(base + `/api/events/${id}/video-form`)).status >= 400);
  } finally { await new Promise(resolve => server.close(resolve)); repo.close(); }
});
