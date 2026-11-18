import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withApp } from '../helpers/mysql-app.js';
import { repositoryDatabase } from '../helpers/mysql-repository.js';
import { DatabaseError } from '../../server/database/mysql.js';

const secret = 'synthetic-password SQL SELECT /private/config Cookie=secret';
const recordingLog = () => ({ entries: [], error(value) { this.entries.push(JSON.parse(value)); } });

test('liveness never needs MySQL; health only probes the database without session or business reads', async () => {
  let probes = 0;
  await withApp({ repository: (repo) => ({
    ...repo,
    probe: async () => { probes++; return repo.probe(); },
    getSession: async () => { throw new Error(secret); },
    listDuties: async () => { throw new Error(secret); },
  }) }, async ({ request }) => {
    const live = await request('/live');
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { status: 'ok' });
    assert.equal(probes, 0);
    for (const path of ['/health', '/HEALTH']) {
      const health = await request(path, 'GET', undefined, { Cookie: 'guild_session=invalid' });
      assert.equal(health.status, 200);
      assert.equal(health.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await health.json(), { status: 'ok' });
    }
    assert.equal(probes, 2);
  });
});

test('health remains readable while a business write lock is held', async () => withApp(async ({ repository, request }) => {
  const db = repositoryDatabase(repository);
  let locked, release;
  const entered = new Promise((resolve) => { locked = resolve; });
  const finish = new Promise((resolve) => { release = resolve; });
  const transaction = db.transaction(async (connection) => {
    await connection.query('SELECT id FROM repository_write_lock WHERE id=1 FOR UPDATE');
    locked();
    await finish;
  });
  try {
    await entered;
    assert.equal((await request('/health')).status, 200);
  } finally {
    release();
    await transaction;
  }
}));

test('database failures and timeouts return fixed health status while API liveness stays available', async () => {
  for (const probe of [async () => { throw new DatabaseError('DATABASE_UNAVAILABLE', secret); }, () => new Promise(() => {})]) {
    const log = recordingLog();
    await withApp({ log, healthTimeoutMs: 25, repository: (repo) => ({ ...repo, probe }) }, async ({ request }) => {
      const response = await request('/health');
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { status: 'error', code: 'DATABASE_UNAVAILABLE' });
      assert.equal((await request('/live')).status, 200);
      assert.deepEqual(log.entries, [{ event: 'health_failed', component: 'database', code: 'DATABASE_UNAVAILABLE' }]);
    });
  }
});

test('API and database errors use distinct fixed classifications without leaking input, SQL or driver messages', async () => {
  for (const error of [new Error(secret), new DatabaseError('DATABASE_QUERY', secret), new DatabaseError(secret, secret)]) {
    const log = recordingLog();
    await withApp({ log, repository: (repo) => ({ ...repo, listDuties: async () => { throw error; } }) }, async ({ admin }) => {
      const { request } = await admin();
      const response = await request('/duties');
      const database = error instanceof DatabaseError;
      assert.equal(response.status, database ? 503 : 500);
      const body = await response.json();
      assert.equal(body.error.code, database ? 'DATABASE_ERROR' : 'OPERATION_FAILED');
      assert.equal(JSON.stringify({ body, log: log.entries }).includes(secret), false);
      assert.deepEqual(log.entries, [{ event: 'api_failed', component: database ? 'database' : 'api', code: error.code === 'DATABASE_QUERY' ? 'DATABASE_QUERY' : database ? 'DATABASE_ERROR' : 'API_ERROR' }]);
    });
  }
});

test('concurrent-write duplicates and deadlocks are definite 409 rollbacks, not unknown database failures', async () => {
  for (const code of ['DATABASE_DUPLICATE', 'DATABASE_CONFLICT']) {
    const log = recordingLog();
    const error = new DatabaseError(code, '資料正在被其他操作更新, 請確認最新資料後重試', 409);
    await withApp({ log, repository: (repo) => ({ ...repo, listDuties: async () => { throw error; } }) }, async ({ admin }) => {
      const { request } = await admin();
      const response = await request('/duties');
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: { code, message: error.message } });
      assert.deepEqual(log.entries, []);
    });
  }
});

test('notification scheduling errors are sanitized and do not change committed writes', async () => {
  const log = recordingLog();
  await withApp({ log, notifier: { send() { throw new Error(secret); } } }, async ({ admin, repository }) => {
    const { request } = await admin();
    const response = await request('/members', 'POST', { uid: '001', name: '測試成員', primaryProfessionId: 1 });
    assert.equal(response.status, 201);
    assert.equal((await repository.listMembers()).members.length, 1);
    assert.deepEqual(log.entries, [{ event: 'notification_schedule_failed', component: 'api', code: 'API_ERROR' }]);
  });
});

test('stopping rejects new work before authentication, validation or database access', async () => withApp({
  isStopping: () => true,
  repository: (repo) => ({ ...repo, getSession: async () => { throw new Error(secret); }, probe: async () => { throw new Error(secret); } }),
}, async ({ request }) => {
  for (const path of ['/health', '/live', '/members']) {
    const response = await request(path);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'SERVICE_STOPPING');
  }
}));

test('a closed real MySQL pool makes health fail while liveness still responds', async () => {
  const log = recordingLog();
  await withApp({ log }, async ({ repository, request }) => {
    assert.equal((await request('/health')).status, 200);
    await repository.close();
    const health = await request('/health');
    assert.equal(health.status, 503);
    assert.deepEqual(await health.json(), { status: 'error', code: 'DATABASE_UNAVAILABLE' });
    assert.equal((await request('/live')).status, 200);
    assert.deepEqual(log.entries, [{ event: 'health_failed', component: 'database', code: 'DATABASE_CLOSED' }]);
  });
});
