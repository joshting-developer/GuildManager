import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { createLineupClient } from '../../src/api/lineups.js';
import { authenticatedFetch } from '../helpers/authenticated-fetch.js';
import { emptyLineup } from '../../src/domain/lineups.js';

const member = { uid: '001', name: '城', primaryProfessionId: 3 };
const lineup = (note) => {
  const teams = emptyLineup();
  Object.assign(teams[0].slots[0], { uid: '001', profession: 'primary', note });
  return teams;
};

test('the lineup client deletes a template over HTTP; signed-out visitors cannot', async () => {
  const repo = await createTestRepository({ });
  (await repo.addMember(member));
  const saved = (await repo.createLineupTemplate({ name: '常用', teams: lineup('舊'), requestId: 'one' }));
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
    assert.deepEqual((await repo.getLineupTemplates()).templates, []);
  } finally {
    server.close();
    (await repo.close());
  }
});
