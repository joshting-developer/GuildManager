import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
const input = {
  title: '循環幫戰',
  type: 'guild_war',
  dates: ['2026-10-31', '2026-10-24'],
  requestId: 'batch-1',
};
test('batch dates create separate IDs and revisions; editing or deleting one event never changes siblings', () => {
  const repo = createRepository({ filename: ':memory:' });
  try {
    const events = repo.createEventBatch(input);
    assert.equal(new Set(events.map((event) => event.id)).size, 2);
    assert.deepEqual(
      events.map((event) => event.dates),
      [['2026-10-24'], ['2026-10-31']],
    );
    assert.deepEqual(
      events.map((event) => event.revision),
      [1, 1],
    );
    const changed = repo.updateEvent(events[0].id, {
      title: '第一場改期',
      type: 'dragon_tiger',
      dates: ['2026-10-25'],
      revision: 1,
    });
    assert.deepEqual(repo.listEvents().events, [changed, events[1]]);
    assert.throws(
      () => repo.updateEvent(changed.id, { ...input, revision: 2 }),
      (error) => Boolean(error.fields.dates),
    );
    repo.deleteEvent(changed.id, 2);
    assert.deepEqual(repo.listEvents().events, [events[1]]);
    assert.throws(
      () => repo.createEventBatch(input),
      (error) => error.code === 'EVENT_DELETED',
    );
    assert.deepEqual(repo.listEvents().events, [events[1]]);
  } finally {
    repo.close();
  }
});
test('batch retries return the original IDs, changed payloads conflict and request IDs cannot be reused across regular/batch creation', () => {
  const repo = createRepository({ filename: ':memory:' });
  try {
    const events = repo.createEventBatch(input);
    assert.deepEqual(
      repo.createEventBatch({ ...input, dates: [...input.dates].reverse() }),
      events,
    );
    for (const change of [
      { title: '別的安排' },
      { type: 'dragon_tiger' },
      { dates: ['2026-11-07'] },
    ])
      assert.throws(
        () => repo.createEventBatch({ ...input, ...change }),
        (error) => error.code === 'REQUEST_CONFLICT',
      );
    assert.throws(
      () => repo.createEvent({ ...input, type: 'activity' }),
      (error) => error.code === 'REQUEST_CONFLICT',
    );
    repo.createEvent({ ...input, type: 'activity', requestId: 'regular' });
    assert.throws(
      () => repo.createEventBatch({ ...input, requestId: 'regular' }),
      (error) => error.code === 'REQUEST_CONFLICT',
    );
    assert.equal(repo.listEvents().events.length, 3);
  } finally {
    repo.close();
  }
});
test('batch rollback removes partially inserted arrangements and request ledger; restart preserves the successful batch for retry', () => {
  const directory = mkdtempSync(join(tmpdir(), 'guild-event-batch-'));
  const filename = join(directory, 'test.sqlite');
  let repo = createRepository({ filename });
  const db = new Database(filename);
  try {
    db.exec(
      "CREATE TRIGGER fail_batch BEFORE INSERT ON event_dates WHEN NEW.date = '2026-10-31' BEGIN SELECT RAISE(ABORT, 'batch rollback'); END;",
    );
    assert.throws(() => repo.createEventBatch(input), /batch rollback/);
    for (const table of ['scheduled_events', 'event_dates', 'event_batches', 'event_batch_items'])
      assert.equal(db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count, 0);
    db.exec('DROP TRIGGER fail_batch');
    const saved = repo.createEventBatch(input);
    repo.close();
    repo = createRepository({ filename });
    assert.deepEqual(repo.createEventBatch(input), saved);
    assert.deepEqual(repo.listEvents().events, saved);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally {
    repo.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test('HTTP battle creation returns separate single-day arrangements, regular activities retain one multi-day arrangement', async () => {
  const repo = createRepository({ filename: ':memory:' });
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
  const url = `http://127.0.0.1:${server.address().port}/api/events`;
  const post = (body) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  try {
    for (const type of ['guild_war', 'dragon_tiger']) {
      const response = await post({ ...input, type, requestId: type });
      assert.equal(response.status, 201);
      const body = await response.json();
      assert.equal(body.events.length, 2);
      assert.equal(body.event, undefined);
      for (const event of body.events) {
        assert.equal(event.dates.length, 1);
        assert.equal(event.type, type);
      }
      assert.deepEqual(
        (await (await post({ ...input, type, requestId: type })).json()).events,
        body.events,
      );
    }
    const activity = (
      await (await post({ ...input, type: 'activity', requestId: 'regular' })).json()
    ).event;
    assert.equal(activity.dates.length, 2);
    assert.equal(repo.listEvents().events.length, 5);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    repo.close();
  }
});
