import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTestRepository as createRepository } from '../helpers/mysql-repository.js';

test('an unseeded SQLite database contains empty data with unknown attendance', async () => {
  const repository = (await createRepository());
  try {
    const data = (await repository.readHome());
    assert.equal(data.meta.mode, 'empty');
    assert.equal(data.summary.attendanceRate, null);
    assert.deepEqual(data.events, []);
  } finally {
    (await repository.close());
  }
});
