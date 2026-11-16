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
