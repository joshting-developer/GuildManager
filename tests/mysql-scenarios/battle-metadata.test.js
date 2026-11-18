import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { createBattleRecordClient } from '../../src/api/battle-records.js';

import { authenticatedFetch } from '../helpers/authenticated-fetch.js';
import { fixtureCsv } from '../helpers/battle-csv.js';

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

test('HTTP editing requires management role and CSRF; member keeps read access; adapter PATCH supports late results', async () => {
  const repo = await createTestRepository({ });
  const record = (await repo.saveBattleRecords(upload())).records[0];
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const fetchAdmin = await authenticatedFetch(server, repo);
    const admin = await (await repo.authenticate({
      username: 'test_admin',
      password: 'test-password-2026',
    }));
    await (await repo.setMemberToken(admin.user.id, { password: 'Member123', revision: 0 }));
    const member = await (await repo.authenticateMember({ password: 'Member123' }));
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
    (await repo.close());
  }
});
