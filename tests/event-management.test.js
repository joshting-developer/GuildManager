import { authenticatedFetch } from './helpers/authenticated-fetch.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createEventClient } from '../src/api/events.js';
const input = {
  title: '多日活動',
  type: 'activity',
  dates: ['2026-10-24', '2026-10-26'],
  requestId: 'management-test',
};
function withRepo(callback) {
  const repo = createRepository({ filename: ':memory:' });
  try {
    callback(repo);
  } finally {
    repo.close();
  }
}
test('editing replaces dates and type atomically, preserving ID and creation time; unchanged saves and retries do not increment twice', () =>
  withRepo((repo) => {
    const original = repo.createEvent(input);
    assert.equal(original.revision, 1);
    const changes = {
      title: '  改為約戰  ',
      type: 'scrimmage',
      dates: ['2026-11-01'],
      revision: 1,
    };
    const updated = repo.updateEvent(original.id, changes);
    assert.equal(updated.title, '改為約戰');
    assert.equal(updated.type, 'scrimmage');
    assert.deepEqual(updated.dates, ['2026-11-01']);
    assert.equal(updated.id, original.id);
    assert.equal(updated.createdAt, original.createdAt);
    assert.equal(updated.revision, 2);
    assert.deepEqual(repo.updateEvent(original.id, changes), updated);
    assert.deepEqual(repo.updateEvent(original.id, { ...changes, revision: 2 }), updated);
    assert.deepEqual(repo.listEvents().events, [updated]);
    const multi = repo.updateEvent(original.id, {
      ...changes,
      type: 'activity',
      dates: input.dates,
      revision: 2,
    });
    assert.deepEqual(multi.dates, input.dates);
    assert.equal(multi.revision, 3);
  }));
test('stale edits/deletes, invalid revisions and invalid dates cannot change the current arrangement', () =>
  withRepo((repo) => {
    const original = repo.createEvent(input);
    const current = repo.updateEvent(original.id, { ...input, title: '新版活動', revision: 1 });
    for (const revision of [undefined, null, 0, -1, 1.5, '2']) {
      assert.throws(
        () => repo.updateEvent(original.id, { ...input, revision }),
        (error) => Boolean(error.fields.revision),
      );
      assert.throws(
        () => repo.deleteEvent(original.id, revision),
        (error) => Boolean(error.fields.revision),
      );
    }
    assert.throws(
      () => repo.updateEvent(original.id, { ...input, revision: 1 }),
      (error) => error.code === 'REVISION_CONFLICT',
    );
    assert.throws(
      () => repo.deleteEvent(original.id, 1),
      (error) => error.code === 'REVISION_CONFLICT',
    );
    for (const patch of [
      { type: 'scrimmage' },
      { dates: [] },
      { dates: ['2026-02-29'] },
      { dates: ['2026-10-24', '2026-10-24'] },
      { title: '' },
      { type: 'invalid' },
    ])
      assert.throws(
        () => repo.updateEvent(original.id, { ...input, revision: 2, ...patch }),
        (error) => error.code === 'VALIDATION_ERROR',
      );
    assert.throws(
      () => repo.updateEvent('missing', { ...input, revision: 1 }),
      (error) => error.status === 404,
    );
    assert.throws(
      () => repo.deleteEvent('missing', 1),
      (error) => error.status === 404,
    );
    assert.deepEqual(repo.listEvents().events, [current]);
  }));
test('deleted events disappear from all dates and retrying creation or editing cannot revive them; deletion retry is safe', () =>
  withRepo((repo) => {
    const event = repo.createEvent(input);
    const other = repo.createEvent({ ...input, requestId: 'other' });
    assert.deepEqual(repo.deleteEvent(event.id, event.revision), { id: event.id });
    assert.deepEqual(repo.deleteEvent(event.id, event.revision), { id: event.id });
    assert.deepEqual(repo.listEvents().events, [other]);
    assert.throws(
      () => repo.createEvent(input),
      (error) => error.code === 'EVENT_DELETED',
    );
    assert.throws(
      () => repo.updateEvent(event.id, { ...input, revision: 1 }),
      (error) => error.status === 404,
    );
    assert.deepEqual(repo.listEvents().events, [other]);
  }));
test('old schema migration preserves dates and IDs, persists edits/deletions across restart, and rolls back partially failed edits/deletes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'guild-event-edit-'));
  const filename = join(directory, 'test.sqlite');
  const db = new Database(filename);
  let repo;
  try {
    db.exec(
      "CREATE TABLE scheduled_events (id TEXT PRIMARY KEY, title TEXT NOT NULL, type TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL); CREATE TABLE event_dates (event_id TEXT NOT NULL REFERENCES scheduled_events(id), date TEXT NOT NULL, PRIMARY KEY(event_id, date)); INSERT INTO scheduled_events VALUES ('old', '舊活動', 'activity', 'old-request', '2026-10-01T00:00:00Z'); INSERT INTO event_dates VALUES ('old', '2026-10-24');",
    );
    repo = createRepository({ filename });
    const old = repo.listEvents().events[0];
    assert.equal(old.id, 'old');
    assert.deepEqual(old.dates, ['2026-10-24']);
    assert.equal(old.revision, 1);
    assert.equal(old.updatedAt, old.createdAt);
    db.exec(
      "CREATE TRIGGER fail_event_date BEFORE INSERT ON event_dates WHEN NEW.date = '2026-10-26' BEGIN SELECT RAISE(ABORT, 'date rollback'); END;",
    );
    assert.throws(() => repo.updateEvent('old', { ...input, revision: 1 }), /date rollback/);
    assert.deepEqual(repo.listEvents().events, [old]);
    db.exec('DROP TRIGGER fail_event_date');
    const changed = repo.updateEvent('old', { ...input, revision: 1 });
    db.exec(
      "CREATE TRIGGER fail_event_delete BEFORE UPDATE ON scheduled_events WHEN NEW.deleted_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'delete rollback'); END;",
    );
    assert.throws(() => repo.deleteEvent('old', 2), /delete rollback/);
    assert.deepEqual(repo.listEvents().events, [changed]);
    db.exec('DROP TRIGGER fail_event_delete');
    repo.close();
    repo = createRepository({ filename });
    assert.deepEqual(repo.listEvents().events, [changed]);
    repo.deleteEvent('old', 2);
    repo.close();
    repo = createRepository({ filename });
    assert.deepEqual(repo.listEvents(), { events: [] });
    assert.throws(
      () => repo.createEvent({ ...input, requestId: 'old-request' }),
      (error) => error.code === 'EVENT_DELETED',
    );
  } finally {
    repo?.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test('HTTP PATCH/DELETE accept revisions, report conflicts and prevent cross-origin writes', async () => {
  const repo = createRepository({ filename: ':memory:' });
  const event = repo.createEvent(input);
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
  const fetch = await authenticatedFetch(server, repo);
  const url = `http://127.0.0.1:${server.address().port}/api/events/${event.id}`;
  const request = (method, body, headers = {}) =>
    fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  try {
    let response = await request('PATCH', { ...input, title: 'API 修改', revision: 1 });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).event.revision, 2);
    assert.equal((await request('DELETE', { revision: 1 })).status, 409);
    assert.equal((await request('DELETE', {})).status, 422);
    assert.equal(
      (await request('DELETE', { revision: 2 }, { Origin: 'https://example.com' })).status,
      403,
    );
    response = await request('DELETE', { revision: 2 });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: event.id });
    assert.equal((await request('DELETE', { revision: 2 })).status, 200);
    assert.equal((await request('PATCH', { ...input, revision: 2 })).status, 404);
    assert.deepEqual(repo.listEvents(), { events: [] });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    repo.close();
  }
});
test('event adapter encodes IDs and passes revisions for HTTP edits/deletes with no automatic retry', async () => {
  const requests = [];
  const values = { ...input, revision: 3 };
  const client = createEventClient({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: requests.length === 1,
        json: async () =>
          requests.length === 1
            ? { event: { id: 'a/b', ...values } }
            : { error: { code: 'REVISION_CONFLICT', message: '安排已修改' } },
      };
    },
  });
  assert.equal((await client.updateEvent('a/b', values)).event.id, 'a/b');
  await assert.rejects(client.deleteEvent('a/b', 3), (error) => error.code === 'REVISION_CONFLICT');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, '/api/events/a%2Fb');
  assert.equal(requests[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(requests[0].options.body), values);
  assert.equal(requests[1].options.method, 'DELETE');
  assert.deepEqual(JSON.parse(requests[1].options.body), { revision: 3 });
});
test('GAS edit/delete bridge preserves ID and revision and propagates unconnected errors without HTTP', async () => {
  let success, failure;
  const calls = [];
  const client = createEventClient({
    source: 'gas',
    fetchImpl: () => assert.fail('no HTTP'),
    googleRun: {
      withSuccessHandler(handler) {
        success = handler;
        return this;
      },
      withFailureHandler(handler) {
        failure = handler;
        return this;
      },
      updateEvent(id, values) {
        calls.push([id, values]);
        success({ event: { id, ...values } });
      },
      deleteEvent(id, revision) {
        calls.push([id, revision]);
        failure({ message: '雲端活動刪除尚未串接' });
      },
    },
  });
  const values = { ...input, revision: 4 };
  assert.equal((await client.updateEvent('id', values)).event.id, 'id');
  await assert.rejects(client.deleteEvent('id', 4), /尚未串接/);
  assert.deepEqual(calls, [
    ['id', values],
    ['id', 4],
  ]);
});
