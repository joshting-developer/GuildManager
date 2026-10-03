import { test } from 'node:test';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createParticipationClient } from '../src/api/participation.js';
import { emptyLineup } from '../src/domain/lineups.js';

const code = (value) => (error) => error.code === value;
function setup() {
  const repo = createRepository({ filename: ':memory:' });
  for (const [uid, name, isInGuild, isInClub] of [
    ['guild', '幫內成員', true, true],
    ['club', '俱樂部成員', false, true],
    ['outside', '編外成員', false, false],
  ])
    repo.addMember({ uid, name, primaryProfessionId: 1, isInGuild, isInClub });
  const events = ['scrimmage', 'guild_war', 'dragon_tiger'].map((type) =>
    repo.createEvent({
      title: type,
      type,
      dates: ['2026-10-24'],
      requestId: type,
    }),
  );
  let request = 0;
  const submit = (name, status, extra = {}, event = events[0]) =>
    repo.submitParticipation(event.id, {
      name,
      status,
      note: '',
      professionId: 3,
      requestId: `form-${++request}`,
      revision: repo.getEventParticipation(event.id).revision,
      ...extra,
    });
  return { repo, events, submit };
}

test('name form links members, rejects unknown leave and unregistered outsiders, and scopes responses to each battle', () => {
  const { repo, events, submit } = setup();
  try {
    for (const event of events) {
      for (const name of ['沒有這個人', '編外成員']) {
        assert.throws(() => submit(name, 'leave', {}, event), code('PARTICIPATION_NOT_FOUND'));
      }
      assert.equal(repo.getEventParticipation(event.id).responses.length, 0);
      submit(' 幫內成員 ', 'leave', { professionId: null, note: '晚到' }, event);
      submit('俱樂部成員', 'leave', { professionId: null }, event);
      submit('編外成員', 'registered', {}, event);
      submit('編外成員', 'leave', {}, event);
      const rows = repo.getEventParticipation(event.id);
      assert.equal(rows.registrations.length, 0);
      assert.equal(rows.responses.length, 3);
      assert.ok(rows.responses.every((row) => row.status === 'leave'));
      assert.equal(rows.responses.find((row) => row.uid === 'guild').note, '晚到');
      submit('幫內成員', 'registered', {}, event);
      assert.equal(
        repo.getEventParticipation(event.id).responses.find((row) => row.uid === 'guild').status,
        'registered',
      );
      assert.equal(
        repo.listMembers().members.find((row) => row.uid === 'guild').primaryProfessionId,
        1,
      );
    }
    assert.equal(repo.listMembers().members.length, 3);
    assert.throws(() => submit('新外援', 'none'), code('PARTICIPATION_INVALID'));
    assert.throws(
      () => submit('新外援', 'registered', { professionId: 99 }),
      code('PARTICIPATION_INVALID'),
    );
    assert.throws(
      () => submit('新外援', 'leave', {}, { id: 'missing' }),
      code('EVENT_UNAVAILABLE'),
    );
  } finally {
    repo.close();
  }
});

test('guest leave retains identity, removes lineup eligibility and preserves snapshots; re-registration restores one entry', () => {
  const { repo, events, submit } = setup();
  const event = events[0];
  try {
    submit('外援', 'registered', { note: '山盟' });
    const guest = repo.getEventParticipation(event.id).registrations[0];
    assert.equal(guest.uid, undefined);
    const teams = emptyLineup();
    teams[0].slots[0].registrationId = guest.id;
    const snapshot = repo.confirmLineup({
      eventId: event.id,
      eventRevision: 1,
      expectedVersion: 0,
      requestId: 'snapshot',
      teams,
    });
    const template = repo.createLineupTemplate({ name: '範本', requestId: 'template', teams });
    submit('外援', 'leave', { note: '不能來', professionId: null });
    const leave = repo.getEventParticipation(event.id);
    assert.equal(leave.registrations.length, 0);
    assert.equal(leave.registrationLeaves[0].id, guest.id);
    assert.equal(leave.registrationLeaves[0].note, '不能來');
    assert.equal(
      repo.applyLineupTemplate(template.id, event.id).teams[0].slots[0].registrationId,
      undefined,
    );
    assert.throws(
      () =>
        repo.confirmLineup({
          eventId: event.id,
          eventRevision: 1,
          expectedVersion: 1,
          requestId: 'invalid',
          teams,
        }),
      code('INELIGIBLE_MEMBER'),
    );
    assert.deepEqual(repo.getLineupHistory(event.id).versions[0], snapshot);
    assert.throws(() => submit('外援', 'leave', {}, events[1]), code('PARTICIPATION_NOT_FOUND'));
    submit('外援', 'registered', { professionId: 4, note: '改打潮光' });
    const restored = repo.getEventParticipation(event.id);
    assert.equal(restored.registrations.length, 1);
    assert.equal(restored.registrations[0].id, guest.id);
    assert.equal(restored.registrations[0].profession, '潮光');
    assert.equal(restored.registrationLeaves.length, 0);
    assert.equal(
      repo.applyLineupTemplate(template.id, event.id).teams[0].slots[0].registrationId,
      guest.id,
    );
    assert.deepEqual(repo.getLineupHistory(event.id).versions[0], snapshot);
  } finally {
    repo.close();
  }
});

test('retries never reverse a newer leave and stale submissions or ambiguous names cannot mutate records', () => {
  const { repo, events, submit } = setup();
  const event = events[0];
  try {
    const input = {
      name: '外援',
      status: 'registered',
      professionId: 3,
      note: '',
      requestId: 'retry',
      revision: repo.getEventParticipation(event.id).revision,
    };
    const receipt = repo.submitParticipation(event.id, input);
    assert.deepEqual(repo.submitParticipation(event.id, input), receipt);
    assert.throws(
      () => repo.submitParticipation(event.id, { ...input, requestId: 'stale', status: 'leave' }),
      code('PARTICIPATION_CHANGED'),
    );
    submit('外援', 'leave');
    assert.deepEqual(repo.submitParticipation(event.id, input), receipt);
    assert.equal(repo.getEventParticipation(event.id).registrations.length, 0);
    assert.throws(
      () => repo.submitParticipation(event.id, { ...input, name: '另一人' }),
      code('REQUEST_CONFLICT'),
    );
    repo.addMember({ uid: 'duplicate', name: '幫內成員', primaryProfessionId: 1 });
    const before = repo.getEventParticipation(event.id);
    assert.throws(() => submit('幫內成員', 'leave'), code('PARTICIPATION_AMBIGUOUS'));
    assert.deepEqual(repo.getEventParticipation(event.id), before);
    repo.addGuestRegistration(event.id, {
      name: '俱樂部成員',
      professionId: 1,
      requestId: 'legacy',
    });
    assert.throws(() => submit('俱樂部成員', 'leave'), code('PARTICIPATION_AMBIGUOUS'));
  } finally {
    repo.close();
  }
});

test('unified HTTP adapter is public, checks revisions and never opens management endpoints', async () => {
  const { repo, events } = setup();
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = createParticipationClient({
    fetchImpl: (path, options) => fetch(base + path, options),
  });
  try {
    const initial = await client.getParticipation(events[0].id);
    const input = {
      name: '新外援',
      status: 'registered',
      professionId: 1,
      note: '',
      requestId: 'public',
      revision: initial.revision,
    };
    assert.equal((await client.submitParticipation(events[0].id, input)).status, 'registered');
    const current = await client.getParticipation(events[0].id);
    await client.submitParticipation(events[0].id, {
      ...input,
      status: 'leave',
      requestId: 'public-leave',
      revision: current.revision,
    });
    await assert.rejects(
      client.submitParticipation(events[0].id, { ...input, requestId: 'stale' }),
      code('PARTICIPATION_CHANGED'),
    );
    await assert.rejects(
      client.submitParticipation(events[0].id, {
        ...input,
        name: '未知',
        status: 'leave',
        requestId: 'unknown',
        revision: (await client.getParticipation(events[0].id)).revision,
      }),
      code('PARTICIPATION_NOT_FOUND'),
    );
    assert.equal((await fetch(base + '/api/members')).status, 401);
    assert.equal((await fetch(base + '/api/lineups')).status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    repo.close();
  }
});

test('unified GAS operation preserves the input and reports unconnected without HTTP fallback', async () => {
  let success, failure;
  const input = { name: '外援', status: 'leave', requestId: 'gas' };
  const client = createParticipationClient({
    source: 'gas',
    fetchImpl: () => assert.fail('不可呼叫 HTTP'),
    googleRun: {
      withSuccessHandler(fn) {
        success = fn;
        return this;
      },
      withFailureHandler(fn) {
        failure = fn;
        return this;
      },
      submitParticipation(eventId, payload) {
        assert.equal(eventId, 'event');
        assert.deepEqual(payload, input);
        failure({ message: '尚未串接' });
      },
    },
  });
  await assert.rejects(client.submitParticipation('event', input), /尚未串接/);
  assert.equal(typeof success, 'function');
});

test('member registrations retain their selected battle profession without changing the roster or saved lineup', () => {
  const { repo, events, submit } = setup();
  const event = events[0];
  try {
    const teams = emptyLineup();
    teams[0].slots[0].uid = 'guild';
    const snapshot = repo.confirmLineup({
      eventId: event.id,
      eventRevision: 1,
      expectedVersion: 0,
      requestId: 'profession-snapshot',
      teams,
    });
    submit('幫內成員', 'registered', { professionId: 3 });
    const row = () =>
      repo.getEventParticipation(event.id).responses.find((response) => response.uid === 'guild');
    assert.equal(row().professionId, 3);
    assert.equal(row().profession, '碎夢');
    assert.equal(
      repo.listMembers().members.find((member) => member.uid === 'guild').primaryProfessionId,
      1,
    );
    submit('幫內成員', 'leave', { professionId: null });
    assert.equal(row().status, 'leave');
    assert.equal(row().professionId, 3);
    submit('幫內成員', 'registered', { professionId: 4 });
    assert.equal(row().professionId, 4);
    assert.equal(row().profession, '潮光');
    assert.equal(repo.getEventParticipation(events[1].id).responses.length, 0);
    assert.deepEqual(repo.getLineupHistory(event.id).versions[0], snapshot);
    const input = {
      uid: 'guild',
      status: 'registered',
      note: '',
      professionId: 2,
      revision: row().revision,
    };
    const saved = repo.saveMemberResponse(event.id, input);
    assert.deepEqual(repo.saveMemberResponse(event.id, input), saved);
    assert.throws(
      () => repo.saveMemberResponse(event.id, { ...input, professionId: 3 }),
      code('PARTICIPATION_CHANGED'),
    );
    assert.throws(
      () => repo.saveMemberResponse(event.id, { ...input, professionId: 99 }),
      code('PARTICIPATION_INVALID'),
    );
    assert.equal(row().professionId, 2);
  } finally {
    repo.close();
  }
});

test('old response schema upgrades without rewriting rows and selected professions persist after restart', () => {
  const folder = mkdtempSync(join(tmpdir(), 'guild-response-professions-'));
  const filename = join(folder, 'test.sqlite');
  let repo = createRepository({ filename });
  try {
    repo.addMember({ uid: 'legacy', name: '舊成員', primaryProfessionId: 1 });
    const event = repo.createEvent({
      title: '舊約戰',
      type: 'scrimmage',
      dates: ['2026-10-24'],
      requestId: 'legacy-event',
    });
    repo.saveMemberResponse(event.id, {
      uid: 'legacy',
      status: 'registered',
      note: '既有備註',
      revision: 0,
    });
    repo.close();
    const oldDb = new Database(filename);
    oldDb.exec('ALTER TABLE event_member_responses DROP COLUMN profession_id');
    const before = oldDb.prepare('SELECT * FROM event_member_responses').all();
    oldDb.close();
    repo = createRepository({ filename });
    const inspect = new Database(filename, { readonly: true });
    assert.deepEqual(
      inspect
        .prepare(
          'SELECT event_id, member_uid, status, note, revision, updated_at FROM event_member_responses',
        )
        .all(),
      before,
    );
    assert.equal(inspect.pragma('foreign_key_check').length, 0);
    inspect.close();
    const legacy = repo.getEventParticipation(event.id).responses[0];
    assert.equal(legacy.professionId, 1);
    assert.equal(legacy.profession, '素問');
    const input = {
      name: '舊成員',
      status: 'registered',
      professionId: 3,
      note: '新備註',
      requestId: 'selected-profession',
      revision: repo.getEventParticipation(event.id).revision,
    };
    const result = repo.submitParticipation(event.id, input);
    repo.close();
    repo = createRepository({ filename });
    assert.deepEqual(repo.submitParticipation(event.id, input), result);
    assert.equal(repo.getEventParticipation(event.id).responses[0].professionId, 3);
    assert.equal(repo.getEventParticipation(event.id).responses[0].note, '新備註');
  } finally {
    repo.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
