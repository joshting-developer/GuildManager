import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepository } from '../server/repository.js';
import { createApp } from '../server/app.js';
import { csrfToken } from '../server/auth-repository.js';
import { createLotteryClient } from '../src/api/lottery.js';
import { setGasSession } from '../src/api/gas.js';
import {
  drawLotteryPrize,
  emptyLotteryBoard,
  lotteryRunners,
  updateLotteryBoard,
  validateLotteryInput,
} from '../src/domain/lottery.js';
import { gasRuntime, cloudResult, cloudSession } from './helpers/gas-runtime.js';

const code = (value) => (error) => error.code === value;
let ids = 0;
const options = {
  uuid: () => `prize-${++ids}`,
  now: () => '2026-10-07T00:00:00.000Z',
  random: () => 0,
};

test('lottery input trims lines, de-duplicates players, keeps repeated prizes and rejects bad rows', () => {
  assert.deepEqual(
    validateLotteryInput({ players: [' 甲 ', '乙', '甲'], prizes: ['金條', '金條'], revision: 0 }),
    { players: ['甲', '乙'], prizes: ['金條', '金條'], revision: 0 },
  );
  assert.throws(
    () => validateLotteryInput({ players: ['甲', ' '], prizes: [], revision: 0 }),
    (error) => error.fields.players.includes('第 2 筆'),
  );
  assert.throws(
    () => validateLotteryInput({ players: [], prizes: ['a\u0007'], revision: 0 }),
    code('LOTTERY_INVALID'),
  );
  assert.throws(
    () => validateLotteryInput({ players: Array(501).fill('x'), prizes: [], revision: 0 }),
    code('LOTTERY_INVALID'),
  );
  assert.throws(() => validateLotteryInput({ players: [], prizes: [] }), code('LOTTERY_INVALID'));
});

test('editing the list keeps winners of prizes whose names remain, pairing duplicates in order', () => {
  let board = updateLotteryBoard(
    emptyLotteryBoard(),
    { players: ['甲', '乙', '丙'], prizes: ['金條', '金條', '坐騎'], revision: 0 },
    options,
  );
  const first = board.prizes[0].id;
  board = drawLotteryPrize(board, first, options).board;
  assert.equal(board.prizes[0].winner, '甲');
  assert.deepEqual(lotteryRunners(board), ['乙', '丙']);
  const edited = updateLotteryBoard(
    board,
    {
      players: ['甲', '乙', '丙', '丁'],
      prizes: ['坐騎', '金條', '外觀'],
      revision: board.revision,
    },
    options,
  );
  assert.deepEqual(
    edited.prizes.map((prize) => [prize.name, prize.winner]),
    [
      ['坐騎', null],
      ['金條', '甲'],
      ['外觀', null],
    ],
  );
  assert.equal(edited.prizes[1].id, first);
  assert.throws(
    () =>
      updateLotteryBoard(edited, { players: [], prizes: [], revision: board.revision }, options),
    code('LOTTERY_CONFLICT'),
  );
});

test('SQLite lottery draws once per prize, survives restart, excludes winners and resets with revision', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'guild-lottery-'));
  const filename = join(directory, 'test.sqlite');
  try {
    let repo = createRepository({ filename });
    assert.deepEqual(repo.getLottery().lottery, emptyLotteryBoard());
    let board = repo.saveLottery({
      players: ['甲', '乙'],
      prizes: ['一獎', '二獎', '三獎'],
      revision: 0,
    }).lottery;
    const [one, two, three] = board.prizes.map((prize) => prize.id);
    const firstDraw = repo.drawLotteryPrize({ prizeId: one });
    assert.equal(firstDraw.draw.already, false);
    assert.deepEqual(firstDraw.draw.runners.sort(), ['乙', '甲']);
    const again = repo.drawLotteryPrize({ prizeId: one });
    assert.equal(again.draw.already, true);
    assert.equal(again.draw.winner, firstDraw.draw.winner);
    assert.equal(again.lottery.revision, firstDraw.lottery.revision);
    repo.close();

    repo = createRepository({ filename });
    const secondDraw = repo.drawLotteryPrize({ prizeId: two });
    assert.deepEqual(secondDraw.draw.runners, [
      ['甲', '乙'].find((name) => name !== firstDraw.draw.winner),
    ]);
    assert.throws(() => repo.drawLotteryPrize({ prizeId: three }), code('LOTTERY_NO_RUNNERS'));
    assert.throws(
      () => repo.drawLotteryPrize({ prizeId: 'missing' }),
      code('LOTTERY_PRIZE_NOT_FOUND'),
    );
    board = repo.getLottery().lottery;
    assert.throws(
      () => repo.resetLottery({ revision: board.revision - 1 }),
      code('LOTTERY_CONFLICT'),
    );
    const reset = repo.resetLottery({ revision: board.revision }).lottery;
    assert.ok(reset.prizes.every((prize) => prize.winner === null && prize.drawnAt === null));
    assert.equal(repo.resetLottery({ revision: reset.revision }).lottery.revision, reset.revision);
    repo.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('lottery HTTP API is limited to admin/manager sessions with CSRF', async () => {
  const repo = createRepository({ filename: ':memory:' });
  const admin = await repo.createAccount({ username: 'admin', password: 'admin-password-123' });
  await repo.setMemberToken(admin.id, { password: 'Member123', revision: 0 });
  const adminSession = await repo.authenticate({
    username: 'admin',
    password: 'admin-password-123',
  });
  const memberSession = await repo.authenticateMember({ password: 'Member123' });
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
    repo.close();
  }
});

test('GAS lottery mirrors the local contract, creates its sheet on first use and blocks members', async () => {
  const env = await gasRuntime();
  env.setup();
  env.sheets.delete('GM_lottery');
  const admin = cloudResult(
    env.raw('login', [{ username: 'admin', password: 'initial-password-123' }]),
  );
  const context = cloudSession(admin);
  cloudResult(env.raw('setMemberToken', [{ password: 'Member123', revision: 0 }], context));
  const member = cloudSession(cloudResult(env.raw('loginMember', [{ password: 'Member123' }])));
  assert.equal(env.raw('getLottery', [], member).error.code, 'MANAGEMENT_REQUIRED');
  assert.equal(env.raw('getLottery', []).error.code, 'AUTH_REQUIRED');
  assert.equal(
    env.raw('saveLottery', [{ players: [], prizes: [], revision: 0 }], {
      ...context,
      csrfToken: 'x',
    }).error.code,
    'CSRF_INVALID',
  );

  let success;
  const googleRun = {
    withSuccessHandler(fn) {
      success = fn;
      return this;
    },
    withFailureHandler() {
      return this;
    },
  };
  for (const [operation, arity] of [
    ['getLottery', 0],
    ['saveLottery', 1],
    ['drawLotteryPrize', 1],
    ['resetLottery', 1],
  ])
    googleRun[operation] = (...args) =>
      success(env.raw(operation, args.slice(0, arity), args[arity]));
  setGasSession(admin);
  try {
    const client = createLotteryClient({
      source: 'gas',
      googleRun,
      fetchImpl: () => assert.fail('HTTP must not be used'),
    });
    assert.equal((await client.getLottery()).lottery.prizes.length, 0);
    assert.ok(env.sheets.has('GM_lottery'));
    const saved = (
      await client.saveLottery({ players: ['甲', '乙'], prizes: ['一獎', '二獎'], revision: 0 })
    ).lottery;
    const first = await client.drawPrize(saved.prizes[0].id);
    const repeat = await client.drawPrize(saved.prizes[0].id);
    assert.equal(repeat.draw.already, true);
    assert.equal(repeat.draw.winner, first.draw.winner);
    const second = await client.drawPrize(saved.prizes[1].id);
    assert.notEqual(second.draw.winner, first.draw.winner);
    await assert.rejects(client.resetLottery(saved.revision), code('LOTTERY_CONFLICT'));
    const reset = await client.resetLottery(second.lottery.revision);
    assert.ok(reset.lottery.prizes.every((prize) => prize.winner === null));
  } finally {
    setGasSession({ user: null });
  }
});
