import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from '../../server/runtime.js';
import { withApp } from '../helpers/mysql-app.js';

const log = () => ({ entries: [], error(value) { this.entries.push(JSON.parse(value)); } });
const base = (runtime) => `http://127.0.0.1:${runtime.server.address().port}/api`;

test('shutdown drains active HTTP work before closing MySQL and repeated shutdown uses the same promise', async () => withApp(async ({ repository, admin }) => {
  const { headers } = await admin();
  const events = [];
  let entered, finish;
  const started = new Promise((resolve) => { entered = resolve; });
  const released = new Promise((resolve) => { finish = resolve; });
  const runtime = await startApi({ port: 0, repository: {
    ...repository,
    listDuties: async () => {
      entered();
      await released;
      const result = await repository.listDuties();
      events.push('completed');
      return result;
    },
    close: async () => { events.push('close'); await repository.close(); },
  } });
  const response = fetch(base(runtime) + '/duties', { headers });
  try {
    await started;
    const shutdown = runtime.shutdown();
    assert.equal(runtime.shutdown(), shutdown);
    assert.deepEqual(events, []);
    finish();
    assert.equal((await response).status, 200);
    assert.equal(await shutdown, 0);
    assert.deepEqual(events, ['completed', 'close']);
  } finally {
    finish();
    await runtime.shutdown();
  }
}));

test('pool close failure and an exceeded shutdown deadline return nonzero with fixed logs', async () => {
  for (const close of [async () => { throw new Error('synthetic-password'); }, () => new Promise(() => {})]) {
    const logger = log();
    const runtime = await startApi({ port: 0, shutdownTimeoutMs: 25, log: logger, repository: { close } });
    assert.equal(await runtime.shutdown(), 1);
    assert.equal(logger.entries.length, 1);
    assert.ok(['shutdown_failed', 'shutdown_timeout'].includes(logger.entries[0].event));
    assert.equal(JSON.stringify(logger.entries).includes('synthetic-password'), false);
  }
});

test('HTTP listen failure closes the owned pool before failing', async () => {
  let closed = 0;
  const owner = await startApi({ port: 0, repository: { close: async () => {} } });
  try {
    await assert.rejects(startApi({ port: owner.server.address().port, repository: { close: async () => { closed++; } } }), { code: 'EADDRINUSE' });
    assert.equal(closed, 1);
    await assert.rejects(startApi({ port: -1, repository: { close: async () => { closed++; } } }), { code: 'ERR_SOCKET_BAD_PORT' });
    assert.equal(closed, 2);
  } finally {
    await owner.shutdown();
  }
});

test('shutdown deadline closes a stalled HTTP connection and still initiates pool cleanup', async () => withApp(async ({ repository, admin }) => {
  const { headers } = await admin();
  const logger = log();
  let entered, release, closed;
  const started = new Promise((resolve) => { entered = resolve; });
  const waiting = new Promise((resolve) => { release = resolve; });
  const poolClosed = new Promise((resolve) => { closed = resolve; });
  const runtime = await startApi({ port: 0, shutdownTimeoutMs: 50, log: logger, repository: {
    ...repository,
    listDuties: async () => { entered(); await waiting; return {}; },
    close: async () => { await repository.close(); closed(); },
  } });
  const response = fetch(base(runtime) + '/duties', { headers }).then(() => 'answered', () => 'disconnected');
  try {
    await started;
    assert.equal(await runtime.shutdown(), 1);
    assert.equal(await response, 'disconnected');
    await poolClosed;
    assert.equal(logger.entries[0].event, 'shutdown_timeout');
  } finally {
    release();
    await runtime.shutdown();
  }
}));

test('shutdown waits for already queued notifications after closing MySQL, within the existing deadline', async () => {
  let release, entered;
  const sending = new Promise((resolve) => { release = resolve; });
  const draining = new Promise((resolve) => { entered = resolve; });
  const events = [];
  const runtime = await startApi({ port: 0, repository: { close: async () => events.push('pool-closed') },
    notifier: { drain: async () => { entered(); await sending; events.push('notices-drained'); } } });
  try {
    const stopping = runtime.shutdown();
    await draining;
    assert.deepEqual(events, ['pool-closed']);
    release();
    assert.equal(await stopping, 0);
    assert.deepEqual(events, ['pool-closed', 'notices-drained']);
  } finally { release(); await runtime.shutdown(); }
});

test('notification drain cannot extend the shutdown deadline indefinitely', async () => {
  const logger = log();
  let closed = false;
  const runtime = await startApi({ port: 0, shutdownTimeoutMs: 25, log: logger,
    repository: { close: async () => { closed = true; } }, notifier: { drain: () => new Promise(() => {}) } });
  assert.equal(await runtime.shutdown(), 1);
  assert.equal(closed, true);
  assert.equal(logger.entries[0].event, 'shutdown_timeout');
});


test('pool cleanup failure still waits for notification drain before returning a failure', async () => {
  const events = [], logger = log();
  const runtime = await startApi({ port: 0, log: logger,
    repository: { close: async () => { events.push('pool-close-failed'); throw new Error('synthetic-secret'); } },
    notifier: { drain: async () => events.push('notices-drained') } });
  assert.equal(await runtime.shutdown(), 1);
  assert.deepEqual(events, ['pool-close-failed', 'notices-drained']);
  assert.equal(logger.entries[0].event, 'shutdown_failed');
});
