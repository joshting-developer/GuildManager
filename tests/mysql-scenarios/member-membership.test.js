import { authenticatedFetch } from '../helpers/authenticated-fetch.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
const initial = {
  uid: '001',
  name: '測試成員',
  primaryProfessionId: 3,
  secondaryProfessionId: null,
};
function edit(member, values = {}) {
  return {
    name: member.name,
    primaryProfessionId: member.primaryProfessionId,
    secondaryProfessionId: member.secondaryProfessionId,
    revision: member.revision,
    ...values,
  };
}

test('membership API supports false values and returns field errors for non-booleans', async () => {
  const repo = await createTestRepository({ });
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
  const fetch = await authenticatedFetch(server, repo);
  const base = `http://127.0.0.1:${server.address().port}/api/members`;
  const send = (url, method, body) =>
    fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  try {
    let response = await send(base, 'POST', { ...initial, isInGuild: false, isInClub: true });
    assert.equal(response.status, 201);
    const member = (await response.json()).member;
    assert.equal(member.isInGuild, false);
    assert.equal(member.isInClub, true);
    response = await send(`${base}/001`, 'PATCH', edit(member, { isInClub: false }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).member.isInClub, false);
    response = await send(base, 'POST', { ...initial, uid: '002', isInGuild: 'false' });
    assert.equal(response.status, 422);
    assert.ok((await response.json()).error.fields.isInGuild);
    const list = (await (await fetch(base)).json()).members;
    assert.equal(list.length, 1);
    assert.equal(list[0].isInGuild, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    (await repo.close());
  }
});
