import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository as createRepository } from '../helpers/mysql-repository.js';

import { emptyLineup } from '../../src/domain/lineups.js';

const member = { uid: '001', name: '城', primaryProfessionId: 3 };
const lineup = (note) => {
  const teams = emptyLineup();
  Object.assign(teams[0].slots[0], { uid: '001', profession: 'primary', note });
  return teams;
};

async function checks({ save, list, remove }) {
  const first = (await save({ name: '常用', teams: lineup('舊'), requestId: 'one' }));
  assert.equal(first.replaced, undefined);
  const again = (await save({ name: '常用', teams: lineup('同名'), requestId: 'two' }));
  assert.equal(again.id, first.id, 'same name updates instead of adding another');
  assert.equal(again.replaced, true);
  assert.equal(again.createdAt, first.createdAt);
  assert.equal(again.teams[0].slots[0].note, '同名');
  const other = (await save({ name: '備用', teams: lineup('備'), requestId: 'three' }));
  assert.notEqual(other.id, first.id);
  const back = (await save({ name: '常用', templateId: first.id, teams: lineup('存回'), requestId: 'four' }));
  assert.equal(back.id, first.id);
  assert.equal(back.teams[0].slots[0].note, '存回');
  assert.deepEqual((await list()).map((item) => item.name).sort(), ['備用', '常用']);
  (await assert.rejects(
    async () => (await save({ name: '常用', templateId: 'missing', teams: lineup('x'), requestId: 'five' })),
    (error) => error.code === 'TEMPLATE_NOT_FOUND',
  ));
  assert.deepEqual(await remove(first.id), { deleted: true, id: first.id });
  assert.deepEqual((await list()).map((item) => item.name), ['備用']);
  assert.deepEqual(await remove(first.id), { deleted: true, id: first.id }, 'repeat is a no-op');
  assert.equal((await save({ name: '常用', teams: lineup('新'), requestId: 'six' })).replaced, undefined);
}

test('MySQL saves back to a chosen template and overwrites a same-name template in place', async () => {
  const repo = (await createRepository());
  try {
    (await repo.addMember(member));
    (await checks({
      save: async (input) => (await repo.createLineupTemplate(input)),
      list: async () => (await repo.getLineupTemplates()).templates,
      remove: async (id) => (await repo.deleteLineupTemplate(id)),
    }));
  } finally {
    (await repo.close());
  }
});
