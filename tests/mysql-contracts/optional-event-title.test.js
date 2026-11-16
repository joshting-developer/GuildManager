import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository as createRepository } from '../helpers/mysql-repository.js';

import { emptyLineup } from '../../src/domain/lineups.js';
const values = (type, extra = {}) => ({
  type,
  dates: ['2026-10-24'],
  requestId: `empty-${type}`,
  ...extra,
});
const nameError = (e) => Boolean(e.fields?.title);

test('unnamed guild/dragon events and batches retain empty titles, independent IDs and safe retries', async () => {
  const repo = (await createRepository());
  try {
    for (const type of ['guild_war', 'dragon_tiger']) {
      const input = values(type);
      const first = (await repo.createEvent(input));
      assert.equal(first.title, '');
      assert.deepEqual((await repo.createEvent({ ...input, title: '  ' })), first);
      const batch = values(type, {
        title: ' ',
        dates: ['2026-10-25', '2026-10-26'],
        requestId: `batch-${type}`,
      });
      const events = (await repo.createEventBatch(batch));
      assert.equal(events.length, 2);
      assert.ok(events.every((e) => e.title === ''));
      assert.notEqual(events[0].id, events[1].id);
      assert.deepEqual((await repo.createEventBatch({ ...batch, title: '' })), events);
      (await assert.rejects(
        async () => (await repo.createEventBatch({ ...batch, title: '改名' })),
        (e) => e.code === 'REQUEST_CONFLICT',
      ));
    }
    assert.equal((await repo.listEvents()).events.length, 6);
  } finally {
    (await repo.close());
  }
});

test('editing can clear battle titles with version checks; blank ordinary events and malformed optional titles are rejected', async () => {
  const repo = (await createRepository());
  try {
    for (const type of ['activity', 'scrimmage'])
      (await assert.rejects(async () => (await repo.createEvent(values(type, { title: ' ' }))), nameError));
    for (const type of ['guild_war', 'dragon_tiger']) {
      for (const title of [null, 42, {}, 'a'.repeat(121), 'bad\nname'])
        (await assert.rejects(async () => (await repo.createEvent(values(type, { title }))), nameError));
      const original = (await repo.createEvent(values(type, { title: '原本名稱' })));
      const input = { type, title: ' ', dates: original.dates, revision: original.revision };
      const empty = (await repo.updateEvent(original.id, input));
      assert.equal(empty.title, '');
      assert.equal(empty.revision, 2);
      assert.deepEqual((await repo.updateEvent(original.id, input)), empty);
      for (const next of ['activity', 'scrimmage'])
        (await assert.rejects(
          async () => (await repo.updateEvent(original.id, { ...input, type: next, revision: 2 })),
          nameError,
        ));
      assert.equal((await repo.listEvents()).events.find((e) => e.id === original.id).title, '');
      const named = (await repo.updateEvent(original.id, {
        ...input,
        type: 'scrimmage',
        title: ' 已知對手 ',
        revision: 2,
      }));
      assert.equal(named.title, '已知對手');
      assert.equal(named.revision, 3);
    }
  } finally {
    (await repo.close());
  }
});

test('unnamed battle schedules support lineup confirmation, revisions and archived immutable history', async () => {
  const repo = (await createRepository());
  try {
    const event = (await repo.createEvent(values('guild_war')));
    const input = {
      eventId: event.id,
      eventRevision: event.revision,
      expectedVersion: 0,
      teams: emptyLineup(),
      requestId: 'unnamed-lineup',
    };
    const saved = (await repo.confirmLineup(input));
    assert.equal(saved.event.title, '');
    (await repo.updateEvent(event.id, {
      type: event.type,
      title: '後來確認對手',
      dates: event.dates,
      revision: 1,
    }));
    assert.equal((await repo.getLineupHistory(event.id)).versions[0].event.title, '');
    assert.deepEqual((await repo.confirmLineup(input)), saved);
    (await repo.deleteEvent(event.id, 2));
    const archived = (await repo.getLineupIndex()).events.find((e) => e.id === event.id);
    assert.equal(archived.archived, true);
    assert.equal(archived.title, '');
  } finally {
    (await repo.close());
  }
});
