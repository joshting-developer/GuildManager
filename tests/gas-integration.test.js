import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLineup, editableLineup } from '../src/domain/lineups.js';
import { createAuthClient } from '../src/api/auth.js';
import { createEventClient } from '../src/api/events.js';
import { setGasSession } from '../src/api/gas.js';
import { createSheetStore } from '../gas/src/storage.js';
import { gasRuntime, cloudResult, cloudSession, fixtureCsv } from './helpers/gas-runtime.js';

async function fixture() {
  const env = await gasRuntime();
  env.setup();
  const session = cloudResult(
    env.raw('login', [{ username: 'admin', password: 'initial-password-123' }]),
  );
  const context = cloudSession(session);
  return {
    ...env,
    session,
    context,
    call: (op, args = [], ctx = context) => cloudResult(env.raw(op, args, ctx)),
  };
}
const member = (uid, name) => ({
  uid,
  name,
  primaryProfessionId: 3,
  secondaryProfessionId: 1,
  isInGuild: true,
  isInClub: true,
});
const createEvent = (env, type, requestId = type) => {
  const result = env.call('createEvent', [
    { type, title: type === 'scrimmage' ? '約戰' : '', dates: ['2026-10-04'], requestId },
  ]);
  return result.event || result.events[0];
};
const battle = (event, roundNumber = 1, csvText = fixtureCsv()) => ({
  eventId: event.id,
  roundNumber,
  type: event.type,
  datetime: event.dates[0],
  redTeam: '紅隊',
  blueTeam: '藍隊',
  winner: null,
  ourSide: null,
  isInternal: false,
  filename: `round-${roundNumber}.csv`,
  csvText,
});

test('compiled GAS runs without Node or browser encoders; setup is non-destructive and idempotent', async () => {
  const env = await gasRuntime();
  const old = env.spreadsheet.insertSheet('原始工作表');
  old.getRange(1, 1, 1, 1).setValues([['保留資料']]);
  assert.equal(env.setup().initialized, true);
  assert.equal(env.propertyService.getProperty('BOOTSTRAP_ADMIN_PASSWORD'), null);
  assert.equal(env.setup().initialized, true);
  assert.deepEqual(old.data, [['保留資料']]);
  assert.equal(env.raw('getProfessions').data.professions.length, 9);
  assert.equal(env.raw('getAuthSession').data.user, null);
  assert.equal(env.rpc('setup').error.code, 'OPERATION_INVALID');
  assert.equal(env.rpc('toString').error.code, 'OPERATION_INVALID');
  assert.equal(env.rpc('getEvents', [], { user: { role: 'admin' } }).data.events.length, 0);
  assert.equal(env.rpc('getEvents', [], null).error.code, 'INVALID_REQUEST');
  env.lock.tryLock();
  assert.equal(env.raw('getEvents').error.code, 'BUSY');
  env.lock.releaseLock();
  assert.equal(env.raw('getEvents').ok, true);
});

test('GAS wrappers enforce every role, calendar visibility, CSRF, member access and revoked tokens', async () => {
  const env = await fixture();
  env.call('addMember', [member('0001', '城')]);
  const scrim = createEvent(env, 'scrimmage');
  const war = createEvent(env, 'guild_war');
  const dragon = createEvent(env, 'dragon_tiger');
  assert.deepEqual(
    env.call('getEvents', [], {}).events.map((e) => e.id),
    [scrim.id],
  );
  assert.equal(env.call('getEvents').events.length, 3);
  assert.equal(env.raw('getEventParticipation', [war.id]).error.code, 'AUTH_REQUIRED');
  assert.equal(env.raw('getEventParticipation', [dragon.id]).error.code, 'AUTH_REQUIRED');
  assert.equal(env.raw('getEventParticipationMembers', [scrim.id]).error.code, 'AUTH_REQUIRED');
  assert.equal(env.raw('getMembers', [], { role: 'admin' }).error.code, 'AUTH_REQUIRED');
  assert.equal(
    env.raw('addMember', [member('0002', '其他')], { sessionToken: env.session.sessionToken }).error
      .code,
    'CSRF_INVALID',
  );
  env.call('setMemberToken', [{ password: 'Member123', revision: 0 }]);
  const session = env.call('loginMember', [{ password: 'Member123' }], {});
  const ctx = cloudSession(session);
  assert.equal(session.user.username, '');
  assert.equal(env.call('getEvents', [], ctx).events.length, 3);
  assert.equal(env.call('getEventParticipationMembers', [war.id], ctx).members[0].name, '城');
  for (const [op, args] of [
    ['getLineupIndex', []],
    ['getHomeData', []],
    ['getDuties', []],
    ['saveBattleRecords', [{}]],
    ['confirmLineup', [{}]],
    ['getAccountSettings', []],
    ['setMemberToken', [{}]],
  ]) {
    assert.equal(
      env.raw(op, args, ctx).error.code,
      op === 'getAccountSettings' || op === 'setMemberToken'
        ? 'ADMIN_REQUIRED'
        : 'MANAGEMENT_REQUIRED',
      op,
    );
  }
  const input = {
    name: '城',
    memberUid: '0001',
    status: 'registered',
    professionId: 1,
    revision: env.call('getEventParticipation', [war.id], ctx).revision,
    requestId: 'signup',
  };
  assert.equal(
    env.raw('submitParticipation', [war.id, input], { sessionToken: session.sessionToken }).error
      .code,
    'CSRF_INVALID',
  );
  env.call('submitParticipation', [war.id, input], ctx);
  const saved = env.call('saveBattleRecords', [{ records: [battle(scrim)], requestId: 'battle' }])
    .records[0];
  assert.equal(env.call('getBattleRecords', [1, null], ctx).records.length, 1);
  assert.equal(env.call('getBattleRecord', [saved.id], ctx).record.players[0].memberUid, '0001');
  assert.equal(env.call('getMemberBattleRecords', ['0001', 1], ctx).summary.battleCount, 1);
  assert.equal(
    Buffer.from(
      env.call('getBattleAttachment', [saved.id, 'csv'], ctx).base64,
      'base64',
    ).toString(),
    fixtureCsv(),
  );
  assert.equal(env.raw('getBattleRecord', [saved.id]).error.code, 'AUTH_REQUIRED');
  assert.equal(env.raw('getBattleAttachment', [saved.id, 'csv']).error.code, 'AUTH_REQUIRED');
  env.call('setMemberToken', [{ password: 'Changed123', revision: 1 }]);
  assert.equal(env.call('getAuthSession', [], ctx).user, null);
  assert.equal(env.call('getEvents', [], ctx).events.length, 1);
  assert.equal(env.raw('getEventParticipation', [war.id], ctx).error.code, 'AUTH_REQUIRED');
  const manager = env.call('createManager', [
    { username: 'manager', password: 'manager-password-123' },
  ]).manager;
  const managerSession = env.call(
    'login',
    [{ username: 'manager', password: 'manager-password-123' }],
    {},
  );
  const managerContext = cloudSession(managerSession);
  assert.equal(env.call('getMembers', [], managerContext).members.length, 1);
  assert.equal(env.raw('getAccountSettings', [], managerContext).error.code, 'ADMIN_REQUIRED');
  env.call('updateManager', [{ id: manager.id, username: 'updated', password: '', revision: 1 }]);
  assert.equal(env.call('getAuthSession', [], managerContext).user, null);
  const changed = env.call('changeAdminPassword', [
    { currentPassword: 'initial-password-123', password: 'changed-password-123', revision: 1 },
  ]);
  assert.equal(changed.admin.revision, 2);
  assert.equal(env.call('getAuthSession').user.role, 'admin');
});

test('GAS lineups persist double rounds and duty/name snapshots; templates filter leave and guest eligibility', async () => {
  const env = await fixture();
  env.call('addMember', [member('0001', '城')]);
  env.call('addMember', [member('0002', '第二位')]);
  const event = createEvent(env, 'guild_war');
  const guest = env.call('addGuestRegistration', [
    event.id,
    { name: '外援', professionId: 2, requestId: 'guest' },
  ]).registration;
  const duty = env.call('getDuties').duties[0];
  const teams = emptyLineup();
  teams[0].slots[0] = {
    ...teams[0].slots[0],
    uid: '0001',
    profession: 'secondary',
    dutyIds: [duty.id],
    note: '守塔',
    secondRound: { uid: '0002', profession: 'primary' },
  };
  teams[0].slots[1] = { ...teams[0].slots[1], registrationId: guest.id };
  const input = {
    teams,
    eventId: event.id,
    eventRevision: 1,
    expectedVersion: 0,
    requestId: 'lineup',
  };
  const first = env.call('confirmLineup', [input]).version;
  assert.deepEqual(env.call('confirmLineup', [input]).version, first);
  assert.equal(first.teams[0].slots[0].member.name, '城');
  assert.equal(first.teams[0].slots[0].secondRound.member.name, '第二位');
  const template = env.call('createLineupTemplate', [
    { name: '原名單', teams: editableLineup(first.teams), requestId: 'template' },
  ]).template;
  assert.equal(
    env.raw('confirmLineup', [{ ...input, requestId: 'conflict' }], env.context).error.code,
    'LINEUP_CONFLICT',
  );
  env.call('updateMember', [
    '0001',
    { name: '新名', primaryProfessionId: 3, secondaryProfessionId: 1, revision: 1 },
  ]);
  env.call('updateDuty', [duty.id, { name: '新職責', active: false, revision: 1 }]);
  env.call('saveMemberResponse', [event.id, { uid: '0002', status: 'leave', revision: 0 }]);
  env.call('cancelGuestRegistration', [event.id, guest.id, 1]);
  const history = env.call('getLineupHistory', [event.id]);
  assert.deepEqual(history.versions[0], first);
  const applied = env.call('applyLineupTemplate', [template.id, event.id]);
  assert.equal(applied.teams[0].slots[0].uid, '0001');
  assert.equal(applied.teams[0].slots[0].secondRound, null);
  assert.equal(applied.teams[0].slots[1].registrationId, undefined);
  assert.equal(applied.skipped.length, 2);
  assert.equal(applied.skippedDuties.length, 1);
  env.call('deleteEvent', [event.id, 1]);
  assert.equal(env.call('getLineupIndex').events[0].archived, true);
  assert.equal(
    env.raw('confirmLineup', [{ ...input, expectedVersion: 1, requestId: 'deleted' }], env.context)
      .error.code,
    'EVENT_NOT_FOUND',
  );
  assert.deepEqual(env.call('getLineupHistory', [event.id]).versions[0], first);
});

test('GAS battles split summaries and snapshots, preserve optional/internal results and atomic retry after failed commit', async () => {
  const env = await fixture();
  env.call('addMember', [member('0001', '城')]);
  const event = createEvent(env, 'scrimmage');
  const records = [
    battle(event),
    { ...battle(event, 2, fixtureCsv('城', '城')), isInternal: true },
  ];
  const input = { records, requestId: 'upload' };
  env.failOn('GM_commits');
  assert.equal(env.raw('saveBattleRecords', [input], env.context).ok, false);
  env.failOn(null);
  assert.equal(env.call('getBattleRecords', [1, null]).total, 0);
  const saved = env.call('saveBattleRecords', [input]);
  assert.deepEqual(env.call('saveBattleRecords', [input]), saved);
  const list = env.call('getBattleRecords', [1, event.id]);
  assert.equal(list.total, 2);
  assert.ok(
    list.records.every(
      (record) => !Object.hasOwn(record, 'players') && !Object.hasOwn(record, 'csvFileId'),
    ),
  );
  assert.equal(env.call('getBattleRecord', [saved.records[0].id]).record.players[0].heal, null);
  assert.equal(env.call('getBattleRecord', [saved.records[1].id]).record.isInternal, true);
  const summary = env.call('getMemberBattleRecords', ['0001', 1]);
  assert.equal(summary.summary.battleCount, 2);
  assert.equal(summary.total, 3);
  assert.equal(summary.summary.unknown, 2);
  assert.ok(summary.entries.every((entry) => !Object.hasOwn(entry.player, 'memberUid')));
  env.call('updateMember', [
    '0001',
    { name: '新名', primaryProfessionId: 3, secondaryProfessionId: 1, revision: 1 },
  ]);
  assert.equal(env.call('getMemberBattleRecords', ['0001', 1]).member.name, '新名');
  assert.equal(env.call('getMemberBattleRecords', ['0001', 1]).entries[0].player.player, '城');
  assert.equal(
    env.raw('saveBattleRecords', [{ records: [battle(event)], requestId: 'occupied' }], env.context)
      .error.code,
    'BATTLE_ROUND_EXISTS',
  );
  const invalid = createEvent(env, 'guild_war', 'war');
  const before = env.files.size;
  assert.equal(
    env.raw(
      'saveBattleRecords',
      [
        {
          records: [battle(invalid), { ...battle(invalid, 2), winner: 'unknown' }],
          requestId: 'invalid',
        },
      ],
      env.context,
    ).ok,
    false,
  );
  assert.equal(env.files.size, before);
  env.call('deleteEvent', [event.id, 1]);
  assert.equal(env.call('getBattleRecord', [saved.records[0].id]).record.event.title, '約戰');
  assert.equal(env.call('getMemberBattleRecords', ['0001', 1]).total, 3);
  const storage = createSheetStore(env);
  storage.transaction((store) => store.remove('battle_players', saved.records[0].id));
  assert.equal(env.call('getBattleRecords', [1, null]).total, 2);
  assert.equal(env.raw('getBattleRecord', [saved.records[0].id], env.context).error.code, 'STORAGE_CORRUPT');
  assert.equal(env.raw('getMemberBattleRecords', ['0001', 1], env.context).error.code, 'STORAGE_CORRUPT');
});

test('frontend GAS adapter integrates login, restored session, async events and logout wrapper without HTTP', async () => {
  const env = await gasRuntime();
  env.setup();
  setGasSession({ user: null });
  const run = new Proxy(
    {},
    {
      get(_target, operation) {
        if (operation === 'withSuccessHandler') return (success) => runner(success);
      },
    },
  );
  function runner(success, failure) {
    return new Proxy(
      {},
      {
        get(_target, operation) {
          if (operation === 'withFailureHandler') return (fn) => runner(success, fn);
          if (operation === 'withSuccessHandler') return (fn) => runner(fn, failure);
          return (...args) =>
            queueMicrotask(() => {
              try {
                success(env.raw(operation, args));
              } catch (error) {
                failure(error);
              }
            });
        },
      },
    );
  }
  const auth = createAuthClient({
    source: 'gas',
    googleRun: run,
    fetchImpl: () => assert.fail('HTTP fallback'),
  });
  const events = createEventClient({ source: 'gas', googleRun: run });
  try {
    assert.equal((await auth.getSession()).user, null);
    const session = await auth.login({ username: 'admin', password: 'initial-password-123' });
    assert.equal(session.user.role, 'admin');
    assert.equal((await auth.getSession()).user.id, session.user.id);
    const created = await events.createEvent({
      type: 'guild_war',
      title: '',
      dates: ['2026-10-04'],
      requestId: 'adapter',
    });
    assert.equal(created.events.length, 1);
    assert.equal((await events.getEvents()).events.length, 1);
    assert.equal((await auth.logout()).user, null);
    assert.equal((await events.getEvents()).events.length, 0);
    await assert.rejects(
      events.createEvent({ type: 'guild_war', dates: ['2026-10-05'], requestId: 'unauthorized' }),
      { code: 'AUTH_REQUIRED' },
    );
  } finally {
    setGasSession({ user: null });
  }
});

test('GAS HTML entry contains only the public storage namespace and private setup refuses incompatible sheets', async () => {
  const env = await gasRuntime();
  env.sandbox.ScriptApp = { getScriptId: () => 'public-script-id' };
  env.sandbox.HtmlService = {
    createHtmlOutputFromFile: (name) => ({
      getContent: () => {
        assert.equal(name, 'Index');
        return '<html><head></head><body>應用程式</body></html>';
      },
    }),
    createHtmlOutput: (html) => ({
      html,
      title: '',
      meta: {},
      setTitle(value) {
        this.title = value;
        return this;
      },
      addMetaTag(key, value) {
        this.meta[key] = value;
        return this;
      },
    }),
  };
  const html = env.sandbox.doGet();
  assert.ok(html.html.includes('window.__GUILD_GAS_KEY__="public-script-id"'));
  assert.ok(!html.html.includes('initial-password-123'));
  assert.ok(!html.html.includes('a'.repeat(64)));
  assert.equal(html.meta.viewport, 'width=device-width, initial-scale=1.0');
  const incompatible = env.spreadsheet.insertSheet('GM_members');
  incompatible.getRange(1, 1, 1, 1).setValues([['既有資料請保留']]);
  assert.throws(() => env.setup(), { code: 'SCHEMA_INVALID' });
  assert.deepEqual(incompatible.data, [['既有資料請保留']]);
  assert.equal(env.sheets.has('GM_commits'), false);
  assert.equal(env.propertyService.getProperty('GM_AUTH_POINTER'), null);
});

test('expired GAS sessions lose both member-only calendar and protected operations', async () => {
  const env = await fixture();
  const event = createEvent(env, 'guild_war');
  const { createPrivateStore } = await import('../gas/src/storage.js');
  const privateStore = createPrivateStore(env.propertyService, env.utilities.getUuid);
  const state = privateStore.load();
  state.sessions.forEach((session) => {
    session.expiresAt = Date.now() - 1;
  });
  privateStore.save(state);
  assert.equal(env.call('getAuthSession').user, null);
  assert.deepEqual(env.call('getEvents').events, []);
  assert.equal(env.raw('getMembers', [], env.context).error.code, 'AUTH_REQUIRED');
  assert.equal(
    env.raw('getEventParticipation', [event.id], env.context).error.code,
    'AUTH_REQUIRED',
  );
});
