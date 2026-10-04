import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { BATTLE_COLUMNS } from '../src/domain/battle-records.js';

const password = 'test-password-2026';
const header = BATTLE_COLUMNS.map(([label]) => label).join(',');
const csv = `${header}\n城,碎夢,2,4,3,100,10,0,200,2,1,\n${header}\n敵人,鐵衣,1,2,3,30,0,0,100,1,0,0`;
test('signed-in member can read battles, attachments and personal analysis; only managers can write or read other management data', async () => {
  let clock = Date.now();
  const repo = createRepository({ filename: ':memory:', authNow: () => clock });
  const admin = await repo.createAccount({ username: 'admin', password });
  await repo.createManager(admin.id, { username: 'manager', password });
  await repo.setMemberToken(admin.id, { password: 'Member123', revision: 0 });
  repo.addMember({ uid: '001', name: '城', primaryProfessionId: 3, secondaryProfessionId: null });
  const upload = {
    requestId: 'battle',
    records: [
      {
        filename: 'battle.csv',
        csvText: csv,
        type: 'scrimmage',
        datetime: '2026-10-24',
        redTeam: '我方',
        blueTeam: '對手',
        winner: null,
      },
    ],
  };
  const {
    records: [record],
  } = repo.saveBattleRecords(upload);
  const server = createApp(repo, { authNow: () => clock }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = 'GET', body, headers = {}) =>
    fetch(`${base}/api${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const reads = [
    '/battle-records',
    `/battle-records/${record.id}`,
    `/battle-records/${record.id}/attachments/csv`,
    '/members/001/battle-records',
  ];
  async function login(role) {
    const response = await request(
      role === 'member' ? '/auth/member-login' : '/auth/login',
      'POST',
      role === 'member' ? { password: 'Member123' } : { username: role, password },
    );
    assert.equal(response.status, 200);
    const session = await response.json();
    return {
      Cookie: response.headers.get('set-cookie').split(';')[0],
      'X-CSRF-Token': session.csrfToken,
    };
  }
  try {
    for (const path of reads) assert.equal((await request(path)).status, 401, path);
    for (const role of ['member', 'manager', 'admin']) {
      const headers = await login(role);
      for (const path of reads)
        assert.equal(
          (await request(path, 'GET', undefined, headers)).status,
          200,
          `${role} ${path}`,
        );
      assert.equal(
        (await (await request('/members/001/battle-records', 'GET', undefined, headers)).json())
          .summary.battleCount,
        1,
      );
      assert.equal(
        await (
          await request(`/battle-records/${record.id}/attachments/csv`, 'GET', undefined, headers)
        ).text(),
        csv,
      );
      if (role !== 'member') continue;
      const personal = await (
        await request('/members/001/battle-records', 'GET', undefined, headers)
      ).json();
      assert.deepEqual(personal.member, { name: '城', profession: '碎夢' });
      for (const path of [
        '/members',
        '/home',
        '/lineups',
        '/duties',
        '/admin/accounts',
        '/members/001',
        '/members/001/battle-records/extra',
        '/battle-records/anything/edit',
      ])
        assert.equal((await request(path, 'GET', undefined, headers)).status, 403, path);
      for (const [path, method, body] of [
        ['/battle-records', 'POST', { ...upload, requestId: 'blocked' }],
        ['/members', 'POST', { uid: '002', name: '新', primaryProfessionId: 3 }],
        ['/members/001', 'PATCH', { name: '改名', primaryProfessionId: 3, revision: 1 }],
        [
          '/events',
          'POST',
          { title: '活動', type: 'activity', dates: ['2026-10-24'], requestId: 'blocked' },
        ],
        ['/lineups/confirm', 'POST', {}],
        ['/admin/member-token', 'PATCH', { password: 'Other123', revision: 1 }],
      ])
        assert.equal((await request(path, method, body, headers)).status, 403, `${method} ${path}`);
      assert.equal(repo.listBattleRecords().total, 1);
      assert.equal(repo.listMembers().members[0].name, '城');
      await repo.setMemberToken(admin.id, { password: 'NewPass123', revision: 1 });
      for (const path of reads)
        assert.equal(
          (await request(path, 'GET', undefined, headers)).status,
          401,
          `revoked ${path}`,
        );
      await repo.setMemberToken(admin.id, { password: 'Member123', revision: 2 });
    }
    const expired = await login('member');
    clock += 8 * 60 * 60 * 1000;
    for (const path of reads)
      assert.equal((await request(path, 'GET', undefined, expired)).status, 401, `expired ${path}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    repo.close();
  }
});
