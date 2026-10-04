import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { visibleCalendarEvents } from '../src/domain/calendar-access.js';

test('calendar filtering hides member-only events without altering dates or record snapshots', () => {
  const events = ['activity', 'scrimmage', 'guild_war', 'dragon_tiger'].map((type) => ({
    id: type,
    type,
    title: type,
    dates: ['2026-10-04'],
  }));
  assert.deepEqual(visibleCalendarEvents(events), events.slice(0, 2));
  assert.deepEqual(visibleCalendarEvents(events, { role: 'invalid' }), events.slice(0, 2));
  for (const role of ['member', 'manager', 'admin'])
    assert.deepEqual(visibleCalendarEvents(events, { role }), events);
  assert.equal(events.length, 4);
});

test('events API returns only public events anonymously and after expiry/revocation, but all events for the three valid roles', async () => {
  let clock = Date.now();
  const repo = createRepository({ filename: ':memory:', authNow: () => clock });
  const password = 'test-password-2026';
  const admin = await repo.createAccount({ username: 'admin', password });
  await repo.createManager(admin.id, { username: 'manager', password });
  await repo.setMemberToken(admin.id, { password: 'Member123', revision: 0 });
  const events = ['activity', 'scrimmage', 'guild_war', 'dragon_tiger'].map((type) =>
    repo.createEvent({ type, title: type, dates: ['2026-10-04'], requestId: type }),
  );
  const deleted = repo.createEvent({
    type: 'activity',
    title: '已刪',
    dates: ['2026-10-04'],
    requestId: 'deleted',
  });
  repo.deleteEvent(deleted.id, deleted.revision);
  const server = createApp(repo, { authNow: () => clock }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function list(headers = {}, query = '') {
    const response = await fetch(`${base}/events${query}`, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return response.json();
  }
  async function login(role, memberPassword = 'Member123') {
    const response = await fetch(`${base}/auth/${role === 'member' ? 'member-login' : 'login'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        role === 'member' ? { password: memberPassword } : { username: role, password },
      ),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    return {
      Cookie: response.headers.get('set-cookie').split(';')[0],
      'X-CSRF-Token': result.csrfToken,
    };
  }
  const publicIds = events
    .slice(0, 2)
    .map((event) => event.id)
    .sort();
  try {
    const publicData = await list();
    assert.deepEqual(publicData.events.map((event) => event.id).sort(), publicIds);
    assert.ok(!JSON.stringify(publicData).includes('guild_war'));
    assert.ok(!JSON.stringify(publicData).includes('dragon_tiger'));
    assert.deepEqual(
      (await list({ Cookie: 'guild_session=invalid', role: 'member' }, '?role=member')).events,
      publicData.events,
    );
    for (const role of ['member', 'manager', 'admin']) {
      const headers = await login(role);
      assert.deepEqual((await list(headers)).events, repo.listEvents().events, role);
    }
    const member = await login('member');
    await repo.setMemberToken(admin.id, { password: 'Changed123', revision: 1 });
    assert.deepEqual((await list(member)).events.map((event) => event.id).sort(), publicIds);
    const current = await login('member', 'Changed123');
    const response = await fetch(`${base}/auth/logout`, {
      method: 'POST',
      headers: { ...current, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await list(current)).events.map((event) => event.id).sort(), publicIds);
    const expiry = await login('member', 'Changed123');
    clock += 8 * 60 * 60 * 1000;
    assert.deepEqual((await list(expiry)).events.map((event) => event.id).sort(), publicIds);
    assert.equal(
      (await fetch(`${base}/events/${events[2].id}/participation`, { headers: expiry })).status,
      401,
    );
    assert.equal(repo.listEvents().events.length, 4);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    repo.close();
  }
});
