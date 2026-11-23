import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository, repositoryDatabase, reopenTestRepository } from '../helpers/mysql-repository.js';
import { createMysqlRepository } from '../../server/mysql/repository.js';
import { createMemberClient } from '../../src/api/members.js';

const input = (name = '新職業') => ({ name, colorcode: '#12AB34', requestId: crypto.randomUUID() });
test('profession catalogue persists edits, rejects stale/invalid writes and safely replays additions', async () => {
  const repo = await createTestRepository();
  try {
    const db = repositoryDatabase(repo);
    const original = (await repo.listProfessions()).professions;
    const addedInput = input();
    const added = await repo.addProfession(addedInput);
    assert.deepEqual(added, { job_id: 10, name: '新職業', colorcode: '#12ab34', revision: 1 });
    assert.deepEqual(await repo.addProfession(addedInput), added);
    await assert.rejects(repo.addProfession({ ...addedInput, name: '別的職業' }), { code: 'REQUEST_CONFLICT' });
    await assert.rejects(repo.addProfession(input('新職業')), { code: 'DUPLICATE_PROFESSION' });
    await repo.addMember({ uid: 'test', name: '成員', primaryProfessionId: added.job_id });
    const patch = { name: '改名職業', colorcode: '#abcdef', revision: 1 };
    const saved = await repo.updateProfession(added.job_id, patch);
    assert.equal(saved.revision, 2);
    assert.deepEqual(await repo.updateProfession(added.job_id, patch), saved);
    assert.deepEqual(await repo.addProfession(addedInput), saved, 'replay cannot overwrite later edits');
    assert.equal((await repo.getMember('test')).primaryProfession, '改名職業');
    assert.equal((await repo.getMember('test')).primaryProfessionId, added.job_id);
    await assert.rejects(repo.updateProfession(added.job_id, { ...patch, colorcode: '#123456' }), { code: 'PROFESSION_CONFLICT' });
    await assert.rejects(repo.updateProfession(999, patch), { code: 'PROFESSION_NOT_FOUND' });
    for (const bad of [{ name: '' }, { name: 'a'.repeat(65) }, { colorcode: 'red' }, { colorcode: '#123' }, { colorcode: '#12345678' }, { requestId: '' }, { active: false }])
      await assert.rejects(repo.addProfession({ ...input(), ...bad }), { code: 'PROFESSION_INVALID' });
    await assert.rejects(repo.updateProfession(10, { ...patch, revision: 0 }), { code: 'PROFESSION_INVALID' });
    assert.deepEqual((await reopenTestRepository(repo).listProfessions()).professions, [...original, saved]);
    const before = await db.query('SELECT * FROM professions ORDER BY job_id');
    const broken = createMysqlRepository({ ...db, transaction: (work, options) => db.transaction(connection => work({ query(sql, args) {
      if (sql.startsWith('UPDATE professions')) throw new Error('synthetic failure');
      return connection.query(sql, args);
    } }), options) });
    await assert.rejects(broken.updateProfession(10, { ...patch, name: '不該保存', revision: 2 }), /synthetic failure/);
    assert.deepEqual(await db.query('SELECT * FROM professions ORDER BY job_id'), before);
  } finally { await repo.close(); }
});

test('concurrent profession additions and edits retain unique IDs and reject lost updates', async () => {
  const repo = await createTestRepository();
  try {
    const jobs = await Promise.all([repo.addProfession(input('一')), repo.addProfession(input('二'))]);
    assert.equal(new Set(jobs.map(job => job.job_id)).size, 2);
    const create = input('同操作');
    const replay = await Promise.all([repo.addProfession(create), repo.addProfession(create)]);
    assert.deepEqual(replay[0], replay[1]);
    const results = await Promise.allSettled(['#111111', '#222222'].map(colorcode => repo.updateProfession(1, { name: '素問', colorcode, revision: 1 })));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'PROFESSION_CONFLICT');
  } finally { await repo.close(); }
});

test('profession writes invalidate the shared client catalogue and preserve error codes', async () => {
  let reads = 0;
  const fetchImpl = async (_url, options) => ({ ok: true, json: async () => options.method === 'GET' ? { professions: [{ name: `read-${++reads}` }] } : { profession: { job_id: 10 } } });
  const one = createMemberClient({ fetchImpl }), two = createMemberClient({ fetchImpl });
  await one.getProfessions(); await two.getProfessions(); assert.equal(reads, 1);
  await one.addProfession(input()); await two.getProfessions(); assert.equal(reads, 2);
  await one.updateProfession(10, {}); await two.getProfessions(); assert.equal(reads, 3);
  await one.getProfessions({ refresh: true }); assert.equal(reads, 4);
  const client = createMemberClient({ fetchImpl: async () => ({ ok: false, json: async () => ({ error: { code: 'PROFESSION_CONFLICT', message: '請重新載入' } }) }) });
  await assert.rejects(client.updateProfession(1, {}), { code: 'PROFESSION_CONFLICT' });
});
