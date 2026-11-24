import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTestRepository as createRepository } from '../helpers/mysql-repository.js';

const input = {
  title: '多日活動',
  type: 'activity',
  dates: ['2026-10-24', '2026-10-26'],
  requestId: 'management-test',
};
async function withRepo(callback) {
  const repo = (await createRepository());
  try {
    (await callback(repo));
  } finally {
    (await repo.close());
  }
}
test('editing replaces dates and type atomically, preserving ID and creation time; unchanged saves and retries do not increment twice', async () =>
  (await withRepo(async (repo) => {
    const original = (await repo.createEvent(input));
    assert.equal(original.revision, 1);
    const changes = {
      title: '  改為約戰  ',
      type: 'scrimmage',
      dates: ['2026-11-01'],
      revision: 1,
    };
    const updated = (await repo.updateEvent(original.id, changes));
    assert.equal(updated.title, '改為約戰');
    assert.equal(updated.type, 'scrimmage');
    assert.deepEqual(updated.dates, ['2026-11-01']);
    assert.equal(updated.id, original.id);
    assert.equal(updated.createdAt, original.createdAt);
    assert.equal(updated.revision, 2);
    assert.deepEqual((await repo.updateEvent(original.id, changes)), updated);
    assert.deepEqual((await repo.updateEvent(original.id, { ...changes, revision: 2 })), updated);
    assert.deepEqual((await repo.listEvents()).events, [updated]);
    const multi = (await repo.updateEvent(original.id, {
      ...changes,
      type: 'activity',
      dates: input.dates,
      revision: 2,
    }));
    assert.deepEqual(multi.dates, input.dates);
    assert.equal(multi.revision, 3);
  })));
test('stale edits/deletes, invalid revisions and invalid dates cannot change the current arrangement', async () =>
  (await withRepo(async (repo) => {
    const original = (await repo.createEvent(input));
    const current = (await repo.updateEvent(original.id, { ...input, title: '新版活動', revision: 1 }));
    for (const revision of [undefined, null, 0, -1, 1.5, '2']) {
      (await assert.rejects(
        async () => (await repo.updateEvent(original.id, { ...input, revision })),
        (error) => Boolean(error.fields.revision),
      ));
      (await assert.rejects(
        async () => (await repo.deleteEvent(original.id, revision)),
        (error) => Boolean(error.fields.revision),
      ));
    }
    (await assert.rejects(
      async () => (await repo.updateEvent(original.id, { ...input, revision: 1 })),
      (error) => error.code === 'REVISION_CONFLICT',
    ));
    (await assert.rejects(
      async () => (await repo.deleteEvent(original.id, 1)),
      (error) => error.code === 'REVISION_CONFLICT',
    ));
    for (const patch of [
      { type: 'scrimmage' },
      { dates: [] },
      { dates: ['2026-02-29'] },
      { dates: ['2026-10-24', '2026-10-24'] },
      { title: '' },
      { type: 'invalid' },
    ])
      (await assert.rejects(
        async () => (await repo.updateEvent(original.id, { ...input, revision: 2, ...patch })),
        (error) => error.code === 'VALIDATION_ERROR',
      ));
    (await assert.rejects(
      async () => (await repo.updateEvent('missing', { ...input, revision: 1 })),
      (error) => error.status === 404,
    ));
    (await assert.rejects(
      async () => (await repo.deleteEvent('missing', 1)),
      (error) => error.status === 404,
    ));
    assert.deepEqual((await repo.listEvents()).events, [current]);
  })));
test('deleted events disappear from all dates and retrying creation or editing cannot revive them; deletion retry is safe', async () =>
  (await withRepo(async (repo) => {
    const event = (await repo.createEvent(input));
    const other = (await repo.createEvent({ ...input, requestId: 'other' }));
    assert.deepEqual((await repo.deleteEvent(event.id, event.revision)), { id: event.id });
    assert.deepEqual((await repo.deleteEvent(event.id, event.revision)), { id: event.id });
    assert.deepEqual((await repo.listEvents()).events, [other]);
    (await assert.rejects(
      async () => (await repo.createEvent(input)),
      (error) => error.code === 'EVENT_DELETED',
    ));
    (await assert.rejects(
      async () => (await repo.updateEvent(event.id, { ...input, revision: 1 })),
      (error) => error.status === 404,
    ));
    assert.deepEqual((await repo.listEvents()).events, [other]);
  })));

test('management list filters, searches and pages in SQL with newest first date first', async () =>
  (await withRepo(async (repo) => {
    const created = [];
    for (let index = 0; index < 23; index++)
      created.push(await repo.createEvent({
        title: index === 5 ? '' : `Raid ${index}`, type: index === 5 ? 'guild_war' : index % 2 ? 'scrimmage' : 'activity',
        dates: [`2026-10-${String(index + 1).padStart(2, '0')}`], requestId: `list-${index}`,
      }));
    const multi = await repo.createEvent({ title: 'Same day', type: 'activity', dates: ['2026-10-23', '2026-10-30'], requestId: 'list-multi' });
    const first = await repo.listManagedEvents({});
    assert.equal(first.total, 24);
    assert.equal(first.filteredTotal, 24);
    assert.equal(first.events.length, 20);
    // Same first date: the later created arrangement comes first; dates stay complete.
    assert.deepEqual(first.events.slice(0, 2).map((event) => event.id), [multi.id, created[22].id]);
    assert.deepEqual(first.events[0].dates, ['2026-10-23', '2026-10-30']);
    const last = await repo.listManagedEvents({ page: 9 });
    assert.equal(last.page, 2);
    assert.deepEqual(last.events.map((event) => event.title), ['Raid 3', 'Raid 2', 'Raid 1', 'Raid 0']);
    assert.equal((await repo.listManagedEvents({ type: 'scrimmage' })).filteredTotal, 10);
    assert.deepEqual((await repo.listManagedEvents({ search: ' raid 1' })).events.map((event) => event.title),
      ['Raid 19', 'Raid 18', 'Raid 17', 'Raid 16', 'Raid 15', 'Raid 14', 'Raid 13', 'Raid 12', 'Raid 11', 'Raid 10', 'Raid 1']);
    // An untitled arrangement is found by the type label it displays.
    assert.deepEqual((await repo.listManagedEvents({ search: '幫戰' })).events.map((event) => event.id), [created[5].id]);
    assert.equal((await repo.listManagedEvents({ focusId: created[1].id })).page, 2);
    await assert.rejects(repo.listManagedEvents({ type: 'unknown' }), /安排類型不正確/);
    await assert.rejects(repo.listManagedEvents({ page: 0 }), /頁碼不正確/);
  })));
