import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createEventClient } from '../src/api/events.js';
import { emptyLineup } from '../src/domain/lineups.js';
const values = (type, extra = {}) => ({
  type,
  dates: ['2026-10-24'],
  requestId: `empty-${type}`,
  ...extra,
});
const nameError = (e) => Boolean(e.fields?.title);

test('unnamed guild/dragon events and batches retain empty titles, independent IDs and safe retries', () => {
  const repo = createRepository({ filename: ':memory:' });
  try {
    for (const type of ['guild_war', 'dragon_tiger']) {
      const input = values(type);
      const first = repo.createEvent(input);
      assert.equal(first.title, '');
      assert.deepEqual(repo.createEvent({ ...input, title: '  ' }), first);
      const batch = values(type, {
        title: ' ',
        dates: ['2026-10-25', '2026-10-26'],
        requestId: `batch-${type}`,
      });
      const events = repo.createEventBatch(batch);
      assert.equal(events.length, 2);
      assert.ok(events.every((e) => e.title === ''));
      assert.notEqual(events[0].id, events[1].id);
      assert.deepEqual(repo.createEventBatch({ ...batch, title: '' }), events);
      assert.throws(
        () => repo.createEventBatch({ ...batch, title: '改名' }),
        (e) => e.code === 'REQUEST_CONFLICT',
      );
    }
    assert.equal(repo.listEvents().events.length, 6);
  } finally {
    repo.close();
  }
});

test('editing can clear battle titles with version checks; blank ordinary events and malformed optional titles are rejected', () => {
  const repo = createRepository({ filename: ':memory:' });
  try {
    for (const type of ['activity', 'scrimmage'])
      assert.throws(() => repo.createEvent(values(type, { title: ' ' })), nameError);
    for (const type of ['guild_war', 'dragon_tiger']) {
      for (const title of [null, 42, {}, 'a'.repeat(121), 'bad\nname'])
        assert.throws(() => repo.createEvent(values(type, { title })), nameError);
      const original = repo.createEvent(values(type, { title: '原本名稱' }));
      const input = { type, title: ' ', dates: original.dates, revision: original.revision };
      const empty = repo.updateEvent(original.id, input);
      assert.equal(empty.title, '');
      assert.equal(empty.revision, 2);
      assert.deepEqual(repo.updateEvent(original.id, input), empty);
      for (const next of ['activity', 'scrimmage'])
        assert.throws(
          () => repo.updateEvent(original.id, { ...input, type: next, revision: 2 }),
          nameError,
        );
      assert.equal(repo.listEvents().events.find((e) => e.id === original.id).title, '');
      const named = repo.updateEvent(original.id, {
        ...input,
        type: 'scrimmage',
        title: ' 已知對手 ',
        revision: 2,
      });
      assert.equal(named.title, '已知對手');
      assert.equal(named.revision, 3);
    }
  } finally {
    repo.close();
  }
});

test('unnamed battle schedules support lineup confirmation, revisions and archived immutable history', () => {
  const repo = createRepository({ filename: ':memory:' });
  try {
    const event = repo.createEvent(values('guild_war'));
    const input = {
      eventId: event.id,
      eventRevision: event.revision,
      expectedVersion: 0,
      teams: emptyLineup(),
      requestId: 'unnamed-lineup',
    };
    const saved = repo.confirmLineup(input);
    assert.equal(saved.event.title, '');
    repo.updateEvent(event.id, {
      type: event.type,
      title: '後來確認對手',
      dates: event.dates,
      revision: 1,
    });
    assert.equal(repo.getLineupHistory(event.id).versions[0].event.title, '');
    assert.deepEqual(repo.confirmLineup(input), saved);
    repo.deleteEvent(event.id, 2);
    const archived = repo.getLineupIndex().events.find((e) => e.id === event.id);
    assert.equal(archived.archived, true);
    assert.equal(archived.title, '');
  } finally {
    repo.close();
  }
});

test('HTTP event adapter creates blank battle batches, clears names and rejects blank scrimmages', async () => {
  const repo = createRepository({ filename: ':memory:' });
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const client = createEventClient({
    fetchImpl: (path, init) => fetch(`http://127.0.0.1:${server.address().port}${path}`, init),
  });
  try {
    const created = await client.createEvent(values('dragon_tiger', { title: '' }));
    assert.equal(created.events[0].title, '');
    const event = created.events[0];
    const named = await client.updateEvent(event.id, {
      type: event.type,
      title: '暫定',
      dates: event.dates,
      revision: 1,
    });
    const cleared = await client.updateEvent(event.id, {
      type: event.type,
      title: '',
      dates: event.dates,
      revision: named.event.revision,
    });
    assert.equal(cleared.event.title, '');
    await assert.rejects(() => client.createEvent(values('scrimmage', { title: '' })), nameError);
    assert.equal((await client.getEvents()).events.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    repo.close();
  }
});
