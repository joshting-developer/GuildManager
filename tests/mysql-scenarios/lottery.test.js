import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository, reopenTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { csrfToken } from '../../server/mysql/auth-repository.js';
import { createLotteryClient } from '../../src/api/lottery.js';

import { emptyLotteryBoard } from '../../src/domain/lottery.js';

const code = (value) => (error) => error.code === value;

test('lottery draws once per prize, survives restart, excludes winners and resets with revision', async () => {
  try {
    let repo = await createTestRepository({ });
    assert.deepEqual((await repo.getLottery()).lottery, emptyLotteryBoard());
    let board = (await repo.saveLottery({
      players: ['甲', '乙'],
      prizes: ['一獎', '二獎', '三獎'],
      revision: 0,
    })).lottery;
    const [one, two, three] = board.prizes.map((prize) => prize.id);
    const firstDraw = (await repo.drawLotteryPrize({ prizeId: one }));
    assert.equal(firstDraw.draw.already, false);
    assert.deepEqual(firstDraw.draw.runners.sort(), ['乙', '甲']);
    const again = (await repo.drawLotteryPrize({ prizeId: one }));
    assert.equal(again.draw.already, true);
    assert.equal(again.draw.winner, firstDraw.draw.winner);
    assert.equal(again.lottery.revision, firstDraw.lottery.revision);
    repo = reopenTestRepository(repo);
    const secondDraw = (await repo.drawLotteryPrize({ prizeId: two }));
    assert.deepEqual(secondDraw.draw.runners, [
      ['甲', '乙'].find((name) => name !== firstDraw.draw.winner),
    ]);
    await assert.rejects(async () => (await repo.drawLotteryPrize({ prizeId: three })), code('LOTTERY_NO_RUNNERS'));
    await assert.rejects(
      async () => (await repo.drawLotteryPrize({ prizeId: 'missing' })),
      code('LOTTERY_PRIZE_NOT_FOUND'),
    );
    board = (await repo.getLottery()).lottery;
    await assert.rejects(
      async () => (await repo.resetLottery({ revision: board.revision - 1 })),
      code('LOTTERY_CONFLICT'),
    );
    const reset = (await repo.resetLottery({ revision: board.revision })).lottery;
    assert.ok(reset.prizes.every((prize) => prize.winner === null && prize.drawnAt === null));
    assert.equal((await repo.resetLottery({ revision: reset.revision })).lottery.revision, reset.revision);
    (await repo.close());
  } finally {
  }
});

test('lottery HTTP API is limited to admin/manager sessions with CSRF', async () => {
  const repo = await createTestRepository({ });
  const admin = await (await repo.createAccount({ username: 'admin', password: 'admin-password-123' }));
  await (await repo.setMemberToken(admin.id, { password: 'Member123', revision: 0 }));
  const adminSession = await (await repo.authenticate({
    username: 'admin',
    password: 'admin-password-123',
  }));
  const memberSession = await (await repo.authenticateMember({ password: 'Member123' }));
  const server = createApp(repo).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const as =
    (session, csrf = true) =>
    (url, init = {}) =>
      fetch(base + url, {
        ...init,
        headers: {
          Cookie: `guild_session=${session.token}`,
          ...(csrf ? { 'X-CSRF-Token': csrfToken(session.token) } : {}),
          ...init.headers,
        },
      });
  try {
    assert.equal((await fetch(`${base}/api/lottery`)).status, 401);
    assert.equal((await as(memberSession)('/api/lottery')).status, 403);
    const body = JSON.stringify({ players: ['甲'], prizes: ['一獎'], revision: 0 });
    const noCsrf = await as(adminSession, false)('/api/lottery', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    assert.equal(noCsrf.status, 403);

    const client = createLotteryClient({ fetchImpl: as(adminSession) });
    const saved = (await client.saveLottery({ players: ['甲'], prizes: ['一獎'], revision: 0 }))
      .lottery;
    const drawn = await client.drawPrize(saved.prizes[0].id);
    assert.equal(drawn.draw.winner, '甲');
    await assert.rejects(client.resetLottery(saved.revision), code('LOTTERY_CONFLICT'));
    const reset = await client.resetLottery(drawn.lottery.revision);
    assert.equal(reset.lottery.prizes[0].winner, null);
    await assert.rejects(
      client.saveLottery({ players: ['甲'], prizes: [''], revision: reset.lottery.revision }),
      (error) => error.code === 'LOTTERY_INVALID' && Boolean(error.fields.prizes),
    );
  } finally {
    server.close();
    (await repo.close());
  }
});
