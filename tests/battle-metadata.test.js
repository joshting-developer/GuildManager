import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createBattleRecordClient } from '../src/api/battle-records.js';
import { setGasSession } from '../src/api/gas.js';
import { authenticatedFetch } from './helpers/authenticated-fetch.js';
import { gasRuntime, cloudResult, cloudSession, fixtureCsv } from './helpers/gas-runtime.js';

const member = { uid: '001', name: '城', primaryProfessionId: 3 };
const upload = (type = 'scrimmage', eventId = null, roundNumber) => ({
  requestId: `upload-${type}-${roundNumber || 'old'}`,
  records: [
    {
      type,
      eventId,
      ...(roundNumber ? { roundNumber } : {}),
      filename: 'battle.csv',
      csvText: fixtureCsv(),
      datetime: '2026-10-05T00:00:00',
      redTeam: '原紅方',
      blueTeam: '原藍方',
      winner: null,
      ourSide: null,
    },
  ],
});
const patch = (extra = {}) => ({
  redTeam: '新紅方',
  blueTeam: '新藍方',
  winner: 'red',
  ourSide: 'red',
  isInternal: false,
  revision: 0,
  requestId: 'edit-one',
  ...extra,
});
const code = (expected) => (error) => error.code === expected;
function checks(
  { get, update, list, attachment, personal, save },
  first,
  second,
  ordinary,
  savedInput,
) {
  const original = get(first.id);
  const csv = attachment(first.id);
  const changed = update(first.id, patch()).record;
  assert.equal(changed.winner, 'red');
  assert.equal(changed.revision, 1);
  assert.equal(list().find((row) => row.id === first.id).redTeam, '新紅方');
  assert.equal(personal().summary.wins, 1);
  assert.equal(get(second.id).revision, 0);
  const internal = update(
    first.id,
    patch({ revision: 1, requestId: 'internal', isInternal: true }),
  ).record;
  assert.equal(internal.isInternal, true);
  assert.equal(internal.winner, null);
  assert.equal(internal.ourSide, null);
  assert.equal(personal().summary.wins, 0);
  assert.equal(personal().summary.unknown, 3);
  assert.deepEqual(
    update(first.id, patch({ revision: 1, requestId: 'internal', isInternal: true })).record,
    internal,
  );
  assert.throws(
    () => update(first.id, patch({ revision: 1, requestId: 'stale' })),
    code('REVISION_CONFLICT'),
  );
  assert.throws(
    () => update(first.id, patch({ revision: 1, requestId: 'internal', redTeam: '不同操作' })),
    code('REQUEST_CONFLICT'),
  );
  const regular = update(
    first.id,
    patch({ revision: 2, requestId: 'regular', winner: 'blue' }),
  ).record;
  assert.equal(regular.isInternal, false);
  assert.equal(personal().summary.losses, 1);
  assert.deepEqual(get(first.id).players, original.players);
  for (const key of [
    'event',
    'eventId',
    'type',
    'playedAt',
    'roundNumber',
    'filename',
    'createdAt',
    'redCount',
    'blueCount',
  ])
    assert.deepEqual(get(first.id)[key], original[key]);
  assert.deepEqual(attachment(first.id), csv);
  assert.equal(save(savedInput).records[0].id, first.id);
  assert.equal(get(first.id).revision, 3);
  for (const values of [
    { redTeam: '' },
    { blueTeam: 'a\nname' },
    { winner: 'draw' },
    { ourSide: 'other' },
    { isInternal: 'true' },
    { revision: -1 },
    { revision: 0.5 },
    { requestId: '' },
    { players: [] },
    { type: 'guild_war' },
    { roundNumber: 2 },
    { csvText: 'change' },
  ])
    assert.throws(
      () => update(first.id, patch({ revision: 3, requestId: 'invalid', ...values })),
      code('BATTLE_INVALID'),
    );
  assert.throws(() => update(ordinary.id, patch({ isInternal: true })), code('BATTLE_INVALID'));
  assert.throws(() => update('missing', patch()), code('BATTLE_NOT_FOUND'));
  return regular;
}

test('SQLite result editing preserves CSV, players, member links and round identity; latest personal analysis reflects corrections', () => {
  const repo = createRepository({ filename: ':memory:' });
  try {
    repo.addMember(member);
    const event = repo.createEvent({
      type: 'scrimmage',
      title: '約戰',
      dates: ['2026-10-05'],
      requestId: 'event',
    });
    const savedInput = upload('scrimmage', event.id, 1);
    const first = repo.saveBattleRecords(savedInput).records[0];
    const second = repo.saveBattleRecords(upload('scrimmage', event.id, 2)).records[0];
    const ordinary = repo.saveBattleRecords(upload('guild_war')).records[0];
    repo.deleteEvent(event.id, event.revision);
    checks(
      {
        get: (id) => repo.getBattleRecord(id),
        update: (id, input) => repo.updateBattleRecord(id, input),
        list: () => repo.listBattleRecords().records,
        attachment: (id) => repo.getBattleAttachment(id, 'csv'),
        personal: () =>
          repo.getMemberBattleRecords('001', { startDate: '2026-10-05', endDate: '2026-10-05' }),
        save: (input) => repo.saveBattleRecords(input),
      },
      first,
      second,
      ordinary,
      savedInput,
    );
  } finally {
    repo.close();
  }
});

test('GAS result editing is atomic, retains Drive files and player snapshots, and supports old revision-less records', async () => {
  const env = await gasRuntime();
  env.setup();
  const session = cloudResult(
    env.raw('login', [{ username: 'admin', password: 'initial-password-123' }]),
  );
  const ctx = cloudSession(session);
  const call = (op, args = []) => cloudResult(env.raw(op, args, ctx));
  call('addMember', [member]);
  const event = call('createEvent', [
    { type: 'scrimmage', title: '約戰', dates: ['2026-10-05'], requestId: 'event' },
  ]).event;
  const savedInput = upload('scrimmage', event.id, 1);
  const first = call('saveBattleRecords', [savedInput]).records[0];
  const second = call('saveBattleRecords', [upload('scrimmage', event.id, 2)]).records[0];
  const ordinary = call('saveBattleRecords', [upload('guild_war')]).records[0];
  assert.equal(first.revision, 0);
  env.failOn('GM_commits');
  assert.equal(env.raw('updateBattleRecord', [first.id, patch()], ctx).ok, false);
  env.failOn(null);
  assert.equal(call('getBattleRecord', [first.id]).record.winner, null);
  assert.equal(call('getBattleRecord', [first.id]).record.revision, 0);
  call('deleteEvent', [event.id, event.revision]);
  const fileCount = env.files.size;
  checks(
    {
      get: (id) => call('getBattleRecord', [id]).record,
      update: (id, input) => call('updateBattleRecord', [id, input]),
      list: () => call('getBattleRecords', [1, null]).records,
      attachment: (id) => call('getBattleAttachment', [id, 'csv']),
      personal: () => call('getMemberBattleRecords', ['001', 1, {}]),
      save: (input) => call('saveBattleRecords', [input]),
    },
    first,
    second,
    ordinary,
    savedInput,
  );
  assert.equal(env.files.size, fileCount);
  call('setMemberToken', [{ password: 'Member123', revision: 0 }]);
  const memberCtx = cloudSession(cloudResult(env.raw('loginMember', [{ password: 'Member123' }])));
  assert.equal(env.raw('updateBattleRecord', [second.id, patch()]).error.code, 'AUTH_REQUIRED');
  assert.equal(
    env.raw('updateBattleRecord', [second.id, patch()], memberCtx).error.code,
    'MANAGEMENT_REQUIRED',
  );
  assert.equal(
    env.raw('updateBattleRecord', [second.id, patch()], { sessionToken: session.sessionToken })
      .error.code,
    'CSRF_INVALID',
  );
  call('createManager', [{ username: 'manager', password: 'manager-password-123' }]);
  const manager = cloudResult(
    env.raw('login', [{ username: 'manager', password: 'manager-password-123' }]),
  );
  setGasSession(manager);
  const run = {
    withSuccessHandler(fn) {
      this.success = fn;
      return this;
    },
    withFailureHandler() {
      return this;
    },
    updateBattleRecord(id, input, context) {
      this.success(env.raw('updateBattleRecord', [id, input], context));
    },
  };
  const client = createBattleRecordClient({
    source: 'gas',
    googleRun: run,
    fetchImpl: () => assert.fail('no HTTP fallback'),
  });
  assert.equal(
    (await client.updateRecord(second.id, patch({ requestId: 'manager-edit' }))).record.winner,
    'red',
  );
  setGasSession({ user: null });
});

test('HTTP editing requires management role and CSRF; member keeps read access; adapter PATCH supports late results', async () => {
  const repo = createRepository({ filename: ':memory:' });
  const record = repo.saveBattleRecords(upload()).records[0];
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const fetchAdmin = await authenticatedFetch(server, repo);
    const admin = await repo.authenticate({
      username: 'test_admin',
      password: 'test-password-2026',
    });
    await repo.setMemberToken(admin.user.id, { password: 'Member123', revision: 0 });
    const member = await repo.authenticateMember({ password: 'Member123' });
    const path = `${base}/api/battle-records/${record.id}`;
    const input = {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch()),
    };
    assert.equal((await fetch(path, input)).status, 401);
    assert.equal(
      (
        await fetch(path, {
          ...input,
          headers: { ...input.headers, Cookie: `guild_session=${member.token}` },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(path, {
          ...input,
          headers: { ...input.headers, Cookie: `guild_session=${admin.token}` },
        })
      ).status,
      403,
    );
    const client = createBattleRecordClient({
      fetchImpl: (url, init) => fetchAdmin(base + url, init),
    });
    assert.equal((await client.updateRecord(record.id, patch())).record.revision, 1);
    await assert.rejects(
      client.updateRecord(record.id, patch({ requestId: 'stale' })),
      code('REVISION_CONFLICT'),
    );
    assert.equal(
      (await fetch(path, { headers: { Cookie: `guild_session=${member.token}` } })).status,
      200,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    repo.close();
  }
});
