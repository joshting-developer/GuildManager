import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { createLineupClient } from '../src/api/lineups.js';
import { authenticatedFetch } from './helpers/authenticated-fetch.js';
import { emptyLineup } from '../src/domain/lineups.js';
import { gasRuntime, cloudResult, cloudSession } from './helpers/gas-runtime.js';

const member = { uid: '001', name: '城', primaryProfessionId: 3 };
const lineup = (note) => {
  const teams = emptyLineup();
  Object.assign(teams[0].slots[0], { uid: '001', profession: 'primary', note });
  return teams;
};

function checks({ save, list, remove }) {
  const first = save({ name: '常用', teams: lineup('舊'), requestId: 'one' });
  assert.equal(first.replaced, undefined);
  const again = save({ name: '常用', teams: lineup('同名'), requestId: 'two' });
  assert.equal(again.id, first.id, 'same name updates instead of adding another');
  assert.equal(again.replaced, true);
  assert.equal(again.createdAt, first.createdAt);
  assert.equal(again.teams[0].slots[0].note, '同名');
  const other = save({ name: '備用', teams: lineup('備'), requestId: 'three' });
  assert.notEqual(other.id, first.id);
  const back = save({ name: '常用', templateId: first.id, teams: lineup('存回'), requestId: 'four' });
  assert.equal(back.id, first.id);
  assert.equal(back.teams[0].slots[0].note, '存回');
  assert.deepEqual(list().map((item) => item.name).sort(), ['備用', '常用']);
  assert.throws(
    () => save({ name: '常用', templateId: 'missing', teams: lineup('x'), requestId: 'five' }),
    (error) => error.code === 'TEMPLATE_NOT_FOUND',
  );
  assert.deepEqual(remove(first.id), { deleted: true, id: first.id });
  assert.deepEqual(list().map((item) => item.name), ['備用']);
  assert.deepEqual(remove(first.id), { deleted: true, id: first.id }, 'repeat is a no-op');
  assert.equal(save({ name: '常用', teams: lineup('新'), requestId: 'six' }).replaced, undefined);
}

test('SQLite saves back to a chosen template and overwrites a same-name template in place', () => {
  const repo = createRepository({ filename: ':memory:' });
  try {
    repo.addMember(member);
    checks({
      save: (input) => repo.createLineupTemplate(input),
      list: () => repo.getLineupTemplates().templates,
      remove: (id) => repo.deleteLineupTemplate(id),
    });
  } finally {
    repo.close();
  }
});

test('the lineup client deletes a template over HTTP; signed-out visitors cannot', async () => {
  const repo = createRepository({ filename: ':memory:' });
  repo.addMember(member);
  const saved = repo.createLineupTemplate({ name: '常用', teams: lineup('舊'), requestId: 'one' });
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const fetch = await authenticatedFetch(server, repo);
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = createLineupClient({ fetchImpl: (path, init) => fetch(base + path, init) });
  try {
    const anonymous = await globalThis.fetch(`${base}/api/lineups/templates/${saved.id}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(anonymous.status, 401);
    assert.deepEqual(await client.deleteTemplate(saved.id), { deleted: true, id: saved.id });
    assert.deepEqual(repo.getLineupTemplates().templates, []);
  } finally {
    server.close();
    repo.close();
  }
});

test('GAS saves back to a chosen template and overwrites a same-name template in place', async () => {
  const env = await gasRuntime();
  env.setup();
  const admin = cloudSession(cloudResult(env.raw('login', [{ username: 'admin', password: 'initial-password-123' }])));
  const call = (op, args = []) => {
    const result = env.raw(op, args, admin);
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    return result.data;
  };
  call('addMember', [member]);
  checks({
    save: (input) => call('createLineupTemplate', [input]).template,
    list: () => call('getLineupTemplates').templates,
    remove: (id) => call('deleteLineupTemplate', [id]),
  });
  call('setMemberToken', [{ password: 'Member123', revision: 0 }]);
  const member_ = cloudSession(cloudResult(env.raw('loginMember', [{ password: 'Member123' }])));
  assert.equal(env.raw('deleteLineupTemplate', ['x']).error.code, 'AUTH_REQUIRED');
  assert.equal(env.raw('deleteLineupTemplate', ['x'], member_).error.code, 'MANAGEMENT_REQUIRED');
});
