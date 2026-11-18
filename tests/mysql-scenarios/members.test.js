import { authenticatedFetch } from '../helpers/authenticated-fetch.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository, reopenTestRepository, repositoryDatabase } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';

const initial = {
  uid: '00012345678901234567890',
  name: '測試成員',
  primaryProfessionId: 1,
  secondaryProfessionId: null,
};

test('member data and past names persist across repository restarts', async () => {
  let repository = await createTestRepository({ });
  try {
    const member = (await repository.addMember(initial));
    (await repository.updateMember(member.uid, {
      name: '持續保存',
      primaryProfessionId: 1,
      revision: member.revision,
    }));
    repository = reopenTestRepository(repository);
    assert.equal((await repository.listMembers()).members[0].name, '持續保存');
    assert.equal((await repository.listMembers()).members[0].previousNames[0].name, initial.name);
  } finally {
    (await repository.close());
  }
});

test('API supports add/edit/remove and returns actionable validation/conflict responses', async () => {
  const repository = await createTestRepository({ });
  const server = createApp(repository).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
  const fetch = await authenticatedFetch(server, repository);
  const base = `http://127.0.0.1:${server.address().port}/api/members`;
  const send = (method, body, uid = '') =>
    fetch(`${base}${uid ? `/${uid}` : ''}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  try {
    let response = await send('POST', initial);
    assert.equal(response.status, 201);
    const { member } = await response.json();
    assert.equal((await send('POST', initial)).status, 409);
    response = await send(
      'PATCH',
      { name: 'API 改名', primaryProfessionId: 2, revision: member.revision },
      member.uid,
    );
    assert.equal(response.status, 200);
    const changed = (await response.json()).member;
    assert.equal(changed.previousNames[0].name, initial.name);
    assert.equal((await send('DELETE', { revision: member.revision }, member.uid)).status, 409);
    assert.equal((await send('DELETE', { revision: changed.revision }, member.uid)).status, 200);
    const external = (await (await fetch(base)).json()).members;
    assert.equal(external.length, 1);
    assert.equal(external[0].isInGuild, false);
    assert.equal(external[0].isInClub, false);
    assert.deepEqual(external[0].previousNames, changed.previousNames);
    response = await send('POST', { ...initial, name: '' });
    assert.equal(response.status, 422);
    assert.ok((await response.json()).error.fields.name);
    assert.equal(
      (
        await fetch(base, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' },
          body: JSON.stringify(initial),
        })
      ).status,
      403,
    );
    assert.equal((await fetch(base, { method: 'POST', body: 'not JSON' })).status, 415);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    (await repository.close());
  }
});

test('profession catalog uses supplied IDs/colors and accepts future jobs from the table', async () => {
  const repo = await createTestRepository();
  try {
    const jobs = (await repo.listProfessions()).professions;
    assert.equal(jobs.length, 9);
    assert.deepEqual(jobs[0], { job_id: 1, colorcode: '#ffb6c1', name: '素問' });
    assert.equal(jobs[8].name, '神相');
    await assert.rejects(repo.addMember({ ...initial, primaryProfessionId: 99 }), (error) => Boolean(error.fields.primaryProfessionId));
    await assert.rejects(repo.addMember({ ...initial, secondaryProfessionId: 99 }), (error) => Boolean(error.fields.secondaryProfessionId));
    await repositoryDatabase(repo).query('INSERT INTO professions (job_id, colorcode, name) VALUES (?, ?, ?)', [10, '#123456', '未來測試職業']);
    assert.equal((await repo.listProfessions()).professions.length, 10);
    assert.equal((await repo.addMember({ ...initial, primaryProfessionId: 10 })).primaryProfession, '未來測試職業');
  } finally {
    await repo.close();
  }
});
