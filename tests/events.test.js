import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
const input = {
  title: '幫會活動',
  type: 'activity',
  dates: ['2026-10-08', '2026-10-03'],
  requestId: 'test-1',
};
function withRepo(callback) {
  const repo = createRepository({ filename: ':memory:' });
  try {
    callback(repo);
  } finally {
    repo.close();
  }
}
test('activities save discrete dates, scrimmages save one day, with no seeded events', () =>
  withRepo((repo) => {
    assert.deepEqual(repo.listEvents(), { events: [] });
    const event = repo.createEvent(input);
    assert.deepEqual(event.dates, ['2026-10-03', '2026-10-08']);
    const single = repo.createEvent({
      ...input,
      type: 'scrimmage',
      dates: ['2026-10-05'],
      requestId: 'test-2',
    });
    assert.deepEqual(single.dates, ['2026-10-05']);
    assert.deepEqual(repo.listEvents().events, [event, single]);
  }));
test('server rejects multi-day scrimmages and missing, duplicate, malformed or impossible dates', () =>
  withRepo((repo) => {
    const invalid = [
      { type: 'scrimmage' },
      { dates: [] },
      { dates: null },
      { dates: Array(367).fill('2026-10-03') },
      { dates: ['2026-10-03', '2026-10-03'] },
      { dates: ['2026-02-29'] },
      { dates: ['2026-04-31'] },
      { dates: ['2026-13-01'] },
      { dates: ['2026-1-3'] },
      { dates: ['2026-10-03T00:00:00Z'] },
      { dates: [123] },
    ];
    for (const values of invalid)
      assert.throws(
        () => repo.createEvent({ ...input, ...values }),
        (error) => Boolean(error.fields.dates),
      );
    assert.deepEqual(repo.listEvents().events, []);
    assert.deepEqual(repo.createEvent({ ...input, dates: ['2028-02-29'] }).dates, ['2028-02-29']);
  }));
test('type, title and request ID are validated independently of the browser', () =>
  withRepo((repo) => {
    for (const values of [
      null,
      {},
      { ...input, title: '' },
      { ...input, title: 'x'.repeat(121) },
      { ...input, type: 'battle' },
      { ...input, requestId: '' },
    ])
      assert.throws(
        () => repo.createEvent(values),
        (error) => error.code === 'VALIDATION_ERROR',
      );
    assert.equal(repo.createEvent({ ...input, title: '  幫會活動  ' }).title, '幫會活動');
  }));
test('retrying a successful request returns the same event, changing that request is rejected', () =>
  withRepo((repo) => {
    const event = repo.createEvent(input);
    assert.deepEqual(repo.createEvent({ ...input, dates: [...input.dates].reverse() }), event);
    assert.throws(
      () => repo.createEvent({ ...input, title: '其他活動' }),
      (error) => error.code === 'REQUEST_CONFLICT',
    );
    assert.equal(repo.listEvents().events.length, 1);
  }));
test('event dates survive restarts, old demo events remain untouched and hidden, failed writes roll back', () => {
  const directory = mkdtempSync(join(tmpdir(), 'guild-events-'));
  const filename = join(directory, 'test.sqlite');
  let repo = createRepository({ filename });
  try {
    const saved = repo.createEvent(input);
    repo.close();
    repo = createRepository({ filename });
    assert.deepEqual(repo.listEvents().events, [saved]);
    const db = new Database(filename);
    db.exec(
      "INSERT INTO events VALUES ('demo', '舊示範', 'activity', '2026-10-03', 1, 1, 'demo'); CREATE TRIGGER fail_date BEFORE INSERT ON event_dates WHEN NEW.date = '2026-10-08' BEGIN SELECT RAISE(ABORT, 'test rollback'); END;",
    );
    assert.throws(() => repo.createEvent({ ...input, requestId: 'failed' }), /test rollback/);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM scheduled_events').get().total, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM event_dates').get().total, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM events').get().total, 1);
    assert.deepEqual(repo.listEvents().events, [saved]);
    db.close();
  } finally {
    repo.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test('events API returns persisted arrangements and actionable validation errors', async () => {
  const repo = createRepository({ filename: ':memory:' });
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
  const base = `http://127.0.0.1:${server.address().port}/api/events`;
  const post = (body) =>
    fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  try {
    let response = await post({ ...input, type: 'scrimmage' });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.fields.dates, '約戰只能選擇一天');
    response = await post(input);
    assert.equal(response.status, 201);
    const event = (await response.json()).event;
    const list = await fetch(base);
    assert.equal(list.headers.get('cache-control'), 'no-store');
    assert.deepEqual((await list.json()).events, [event]);
    assert.equal((await post({ ...input, title: 'changed' })).status, 409);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    repo.close();
  }
});
