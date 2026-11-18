import { participationTarget } from '../../src/domain/participation-target.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { createParticipationClient } from '../../src/api/participation.js';

const code = (value) => (error) => error.code === value;
async function setup() {
  const repo = await createTestRepository({ });
  for (const [uid, name, isInGuild, isInClub] of [
    ['guild', '幫內成員', true, true],
    ['club', '俱樂部成員', false, true],
    ['outside', '編外成員', false, false],
  ])
    (await repo.addMember({ uid, name, primaryProfessionId: 1, isInGuild, isInClub }));
  const events = await Promise.all(['scrimmage', 'guild_war', 'dragon_tiger'].map(async (type) =>
    (await repo.createEvent({
      title: type,
      type,
      dates: ['2026-10-24'],
      requestId: type,
    })),
  ));
  let request = 0;
  const submit = async (name, status, extra = {}, event = events[0]) =>
    (await repo.submitParticipation(event.id, {
      name,
      status,
      note: '',
      professionId: 3,
      requestId: `form-${++request}`,
      revision: (await repo.getEventParticipation(event.id)).revision,
      ...extra,
    }));
  return { repo, events, submit };
}

test('unified HTTP adapter is public, checks revisions and never opens management endpoints', async () => {
  const { repo, events } = await setup();
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = createParticipationClient({
    fetchImpl: (path, options) => fetch(base + path, options),
  });
  try {
    const initial = await client.getForm(events[0].id);
    const input = {
      name: '新外援',
      status: 'registered',
      professionId: 1,
      note: '',
      requestId: 'public',
      expectedParticipant: { person: null },
    };
    input.expectedParticipant.person = participationTarget(input, initial);
    assert.equal((await client.submitParticipation(events[0].id, input)).status, 'registered');
    const current = await client.getForm(events[0].id);
    await client.submitParticipation(events[0].id, {
      ...input,
      status: 'leave',
      requestId: 'public-leave',
      expectedParticipant: { person: participationTarget(input, current) },
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
        expectedParticipant: { person: participationTarget({ name: '未知' }, await client.getForm(events[0].id)) },
      }),
      code('PARTICIPATION_NOT_FOUND'),
    );
    assert.equal((await fetch(base + '/api/members')).status, 401);
    assert.equal((await fetch(base + '/api/lineups')).status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    (await repo.close());
  }
});
