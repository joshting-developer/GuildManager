import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createDutyClient } from '../src/api/duties.js';
import { emptyLineup, editableLineup, placeMember } from '../src/domain/lineups.js';
const code = (code) => (error) => error.code === code;
function event(repo) {
  return repo.createEvent({
    title: '職責測試',
    type: 'scrimmage',
    dates: ['2026-10-24'],
    requestId: 'event',
  });
}
function confirmInput(event, teams, options = {}) {
  return {
    eventId: event.id,
    eventRevision: 1,
    expectedVersion: 0,
    teams,
    requestId: 'confirm',
    ...options,
  };
}
test('duty catalog preserves fixed IDs, validates names, rejects duplicates and supports versioned rename/deactivation/retry', () => {
  const repo = createRepository({ filename: ':memory:' });
  try {
    assert.deepEqual(
      repo.listDuties().duties.map((d) => d.name),
      ['保鑣', '山盟', '輔潮'],
    );
    const created = repo.addDuty({ name: ' 塔前炮 ', requestId: 'new-duty' });
    assert.equal(created.name, '塔前炮');
    assert.equal(created.active, true);
    assert.deepEqual(repo.addDuty({ name: '塔前炮', requestId: 'new-duty' }), created);
    assert.throws(
      () => repo.addDuty({ name: '塔後炮', requestId: 'new-duty' }),
      code('REQUEST_CONFLICT'),
    );
    assert.throws(
      () => repo.addDuty({ name: '保鑣', requestId: 'duplicate' }),
      code('DUPLICATE_DUTY'),
    );
    for (const name of ['', 'a'.repeat(41), 7, '\n保鑣'])
      assert.throws(() => repo.addDuty({ name, requestId: 'bad' }), code('DUTY_INVALID'));
    assert.throws(() => repo.addDuty({ name: '炮手', requestId: 'bad key' }), code('DUTY_INVALID'));
    const changed = repo.updateDuty(created.id, { name: '塔後炮', active: false, revision: 1 });
    assert.equal(changed.revision, 2);
    assert.equal(changed.id, created.id);
    assert.deepEqual(
      repo.updateDuty(created.id, { name: '塔後炮', active: false, revision: 1 }),
      changed,
    );
    assert.throws(
      () => repo.updateDuty(created.id, { name: '砲手', active: true, revision: 1 }),
      code('DUTY_CONFLICT'),
    );
    assert.throws(
      () => repo.updateDuty(created.id, { name: '山盟', active: true, revision: 2 }),
      code('DUPLICATE_DUTY'),
    );
    assert.throws(
      () => repo.updateDuty(created.id, { name: '砲手', active: 1, revision: 2 }),
      code('DUTY_INVALID'),
    );
    assert.throws(
      () => repo.updateDuty('missing', { name: '砲手', active: true, revision: 1 }),
      code('DUTY_NOT_FOUND'),
    );
    assert.equal(
      repo.updateDuty(created.id, { name: '塔後炮', active: true, revision: 2 }).revision,
      3,
    );
  } finally {
    repo.close();
  }
});
test('multiple reusable duties are ID-linked and server snapshots preserve old names after catalog changes', () => {
  const repo = createRepository({ filename: ':memory:' });
  try {
    const battle = event(repo);
    const catalog = repo.listDuties().duties;
    const teams = emptyLineup();
    teams[0].slots[0].dutyIds = [catalog[0].id, catalog[1].id];
    teams[0].slots[0].note = '舊文字備註';
    teams[0].slots[0].duties = [{ id: catalog[0].id, name: '偽造名稱' }];
    teams[0].slots[1].dutyIds = [catalog[0].id];
    const first = repo.confirmLineup(confirmInput(battle, teams));
    assert.deepEqual(
      first.teams[0].slots[0].duties,
      catalog.slice(0, 2).map(({ id, name }) => ({ id, name })),
    );
    const template = repo.createLineupTemplate({ name: '職責模板', teams, requestId: 'template' });
    const renamed = repo.updateDuty(catalog[0].id, { name: '新版保鑣', active: true, revision: 1 });
    assert.deepEqual(repo.getLineupHistory(battle.id).versions, [first]);
    assert.deepEqual(repo.getLineupIndex().templates, [template]);
    const applied = repo.applyLineupTemplate(template.id, battle.id);
    assert.deepEqual(applied.teams[0].slots[0].dutyIds, [renamed.id, catalog[1].id]);
    const second = repo.confirmLineup(
      confirmInput(battle, applied.teams, { requestId: 'second', expectedVersion: 1 }),
    );
    assert.equal(second.teams[0].slots[0].duties[0].name, '新版保鑣');
    repo.updateDuty(renamed.id, { name: renamed.name, active: false, revision: 2 });
    assert.throws(
      () =>
        repo.confirmLineup(
          confirmInput(battle, teams, { requestId: 'inactive', expectedVersion: 2 }),
        ),
      code('DUTY_UNAVAILABLE'),
    );
    const filtered = repo.applyLineupTemplate(template.id, battle.id);
    assert.deepEqual(filtered.teams[0].slots[0].dutyIds, [catalog[1].id]);
    assert.equal(filtered.teams[0].slots[0].note, '舊文字備註');
    assert.equal(filtered.skippedDuties.length, 2);
    assert.deepEqual(
      filtered.skippedDuties.map((d) => d.position),
      [1, 2],
    );
    assert.equal(filtered.skippedDuties[0].name, '保鑣');
    assert.equal(repo.getLineupHistory(battle.id).versions.length, 2);
    for (const dutyIds of [['missing'], [catalog[1].id, catalog[1].id], null, [1]]) {
      const invalid = emptyLineup();
      invalid[0].slots[0].dutyIds = dutyIds;
      assert.throws(
        () =>
          repo.confirmLineup(
            confirmInput(battle, invalid, { requestId: 'invalid', expectedVersion: 2 }),
          ),
        (error) => ['DUTY_UNAVAILABLE', 'LINEUP_INVALID'].includes(error.code),
      );
    }
  } finally {
    repo.close();
  }
});
test('old lineup snapshots, templates and original request retries remain unchanged when dutyIds is absent', () => {
  const folder = mkdtempSync(join(tmpdir(), 'guild-duties-legacy-'));
  const filename = join(folder, 'test.sqlite');
  const repo = createRepository({ filename });
  const raw = new Database(filename);
  try {
    const battle = event(repo);
    const teams = emptyLineup();
    for (const team of teams)
      for (const slot of team.slots) {
        delete slot.dutyIds;
        delete slot.secondRound;
      }
    teams[0].slots[0].note = '原本自由文字';
    const payload = confirmInput(battle, teams);
    const snapshot = {
      event: {
        id: battle.id,
        title: battle.title,
        type: battle.type,
        revision: 1,
        dates: battle.dates,
      },
      teams: teams.map((t) => ({ ...t, slots: t.slots.map((s) => ({ ...s, member: null })) })),
    };
    raw
      .prepare('INSERT INTO lineup_versions VALUES (?,?,?,?,?,?,?)')
      .run(
        'legacy-version',
        battle.id,
        1,
        'confirm',
        JSON.stringify(payloadWithoutRequest(payload)),
        JSON.stringify(snapshot),
        '2026-10-01T00:00:00.000Z',
      );
    const oldTemplate = { name: '舊範本', teams };
    raw
      .prepare('INSERT INTO lineup_templates VALUES (?,?,?,?,?,?)')
      .run(
        'legacy-template',
        '舊範本',
        'legacy-create',
        JSON.stringify(oldTemplate),
        JSON.stringify(snapshot.teams),
        '2026-10-01T00:00:00.000Z',
      );
    const first = repo.getLineupHistory(battle.id).versions[0];
    const before = repo.getLineupIndex().templates[0];
    assert.deepEqual(repo.confirmLineup(payload), first);
    assert.deepEqual(repo.confirmLineup({ ...payload, teams: editableLineup(teams) }), first);
    assert.deepEqual(
      repo.createLineupTemplate({ ...oldTemplate, requestId: 'legacy-create' }),
      before,
    );
    const applied = repo.applyLineupTemplate('legacy-template', battle.id);
    assert.deepEqual(applied.teams[0].slots[0].dutyIds, []);
    assert.equal(applied.teams[0].slots[0].secondRound, null);
    assert.equal(applied.teams[0].slots[0].note, '原本自由文字');
    assert.deepEqual(
      JSON.parse(raw.prepare('SELECT snapshot_json FROM lineup_versions').get().snapshot_json),
      snapshot,
    );
    assert.equal(repo.getLineupHistory(battle.id).versions.length, 1);
  } finally {
    repo.close();
    raw.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
function payloadWithoutRequest({ requestId, ...payload }) {
  return payload;
}
test('initial duty names and inactive states never reset on restart, new assignments persist and movements retain seat duties', () => {
  const folder = mkdtempSync(join(tmpdir(), 'guild-duties-restart-'));
  const filename = join(folder, 'test.sqlite');
  let repo = createRepository({ filename });
  try {
    const original = repo.listDuties().duties[0];
    const changed = repo.updateDuty(original.id, { name: '專用保鑣', active: false, revision: 1 });
    const added = repo.addDuty({ name: '指揮', requestId: 'command' });
    const teams = emptyLineup();
    teams[0].slots[0].uid = '001';
    teams[0].slots[0].dutyIds = [added.id];
    teams[0].slots[1].uid = '002';
    placeMember(teams, '001', 'attack-1', 1);
    assert.equal(teams[0].slots[1].uid, '001');
    assert.deepEqual(teams[0].slots[0].dutyIds, [added.id]);
    assert.deepEqual(teams[0].slots[1].dutyIds, []);
    const battle = event(repo),
      blank = emptyLineup();
    blank[0].slots[0].dutyIds = [added.id];
    const saved = repo.confirmLineup(confirmInput(battle, blank));
    repo.close();
    repo = createRepository({ filename });
    assert.equal(repo.listDuties().duties.length, 4);
    assert.deepEqual(
      repo.listDuties().duties.find((d) => d.id === original.id),
      changed,
    );
    assert.deepEqual(repo.getLineupHistory(battle.id).versions, [saved]);
  } finally {
    repo.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
test('HTTP duty adapter maps CRUD, validation and conflicts; GAS preserves arguments and failures without HTTP fallback', async () => {
  const repo = createRepository({ filename: ':memory:' });
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = createDutyClient({ fetchImpl: (path, init) => fetch(base + path, init) });
  try {
    assert.equal((await client.getDuties()).duties.length, 3);
    const { duty } = await client.addDuty({ name: '隊長', requestId: 'http' });
    assert.equal(
      (await client.updateDuty(duty.id, { name: '團長', active: false, revision: 1 })).duty
        .revision,
      2,
    );
    await assert.rejects(
      () => client.updateDuty(duty.id, { name: '指揮', active: true, revision: 1 }),
      code('DUTY_CONFLICT'),
    );
    await assert.rejects(
      () => client.addDuty({ name: '保鑣', requestId: 'duplicate' }),
      code('DUPLICATE_DUTY'),
    );
    assert.equal((await fetch(base + '/api/duties')).headers.get('cache-control'), 'no-store');
    assert.equal(
      (
        await fetch(base + '/api/duties', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
          body: '{}',
        })
      ).status,
      403,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    repo.close();
  }
  const calls = [];
  const bridge = {
    withSuccessHandler(fn) {
      this.done = fn;
      return this;
    },
    withFailureHandler(fn) {
      this.fail = fn;
      return this;
    },
  };
  for (const method of ['getDuties', 'addDuty', 'updateDuty'])
    bridge[method] = (...args) => {
      calls.push([method, ...args]);
      bridge.done({});
    };
  const gas = createDutyClient({ source: 'gas', googleRun: bridge });
  await gas.getDuties();
  await gas.addDuty({ name: '隊長' });
  await gas.updateDuty('duty', { revision: 1 });
  assert.deepEqual(calls, [
    ['getDuties'],
    ['addDuty', { name: '隊長' }],
    ['updateDuty', 'duty', { revision: 1 }],
  ]);
  bridge.addDuty = () => bridge.fail({ message: '尚未串接' });
  await assert.rejects(() => gas.addDuty({}), /尚未串接/);
  await assert.rejects(
    () =>
      createDutyClient({
        fetchImpl: async () => {
          throw new Error();
        },
      }).getDuties(),
    /無法連線/,
  );
  await assert.rejects(
    () =>
      createDutyClient({
        fetchImpl: async () => ({
          json: async () => {
            throw new Error();
          },
        }),
      }).getDuties(),
    /格式不正確/,
  );
});
