import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  drawLotteryPrize,
  emptyLotteryBoard,
  lotteryRunners,
  updateLotteryBoard,
  validateLotteryInput,
} from '../../src/domain/lottery.js';

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

test('race plan always lets the saved winner finish first and keeps mishaps before each finish', async () => {
  const { planRace, horseClock, RACE_MS, raceIcon } = await import('../../src/domain/lottery-race.js');
  const names = Array.from({ length: 40 }, (_value, index) => `玩家${index}`);
  for (let round = 0; round < 50; round++) {
    const winner = names[round % names.length];
    const { finishAt, plans, rank } = planRace(names, winner);
    assert.equal(rank[winner], 1);
    assert.equal(finishAt[winner], RACE_MS);
    names.forEach((name, index) => {
      if (name !== winner) assert.ok(finishAt[name] > RACE_MS);
      const plan = plans[index];
      for (const event of plan.events) assert.ok(event.start + event.duration <= finishAt[name]);
      assert.equal(plan.profile(horseClock(finishAt[name], plan.events)), 1);
      assert.ok(plan.profile(horseClock(finishAt[name] * 0.5, plan.events)) < 1);
    });
  }
  assert.equal(raceIcon('甲', 'zoo'), raceIcon('甲', 'zoo'));
  assert.equal(raceIcon('甲', 'missing'), '🏇');
});

test('race commentary matches each animal: no horse/grass lines for others, cars use only car lines', async () => {
  const { RACE_ICONS } = await import('../../src/domain/lottery-race.js');
  const { commentary, commentaryLines, mishapFx, COMMENTARY_ANIMALS } =
    await import('../../src/domain/lottery-commentary.js');
  const types = ['fall', 'sleep', 'eat', 'back', 'boost', 'lateStart', 'start', 'sprint', 'win'];
  const animals = [...new Set(RACE_ICONS.flatMap((icon) => icon.set))];
  for (const animal of animals) {
    assert.ok(COMMENTARY_ANIMALS.includes(animal), `${animal} needs a commentary profile`);
    for (const type of types) {
      const lines = commentaryLines(type, animal);
      assert.ok(lines.length, `${animal} ${type}`);
      if (!['🏇', '🐎', '🐄'].includes(animal))
        for (const line of lines) assert.doesNotMatch(line, /馬|草/, `${animal}: ${line}`);
      for (let i = 0; i < 20; i++) {
        const text = commentary(type, { name: '青衫', animal });
        assert.doesNotMatch(text, /\{[na]\}/);
      }
    }
    for (const type of ['fall', 'sleep', 'eat', 'back', 'boost']) assert.ok(mishapFx(type, animal));
  }
  const car = ['sleep', 'eat'].flatMap((type) => commentaryLines(type, '🏎️'));
  assert.ok(car.every((line) => !/睡|吃|點心|珍奶/.test(line)));
  assert.equal(mishapFx('eat', '🏎️'), '⛽');
  assert.match(commentary('fall', { name: '白鹿', animal: '🐖', random: () => 0 }), /^白鹿 /);
  assert.equal(
    commentary('fall', { name: '白鹿', animal: '🐕', random: () => 0 }),
    '白鹿 的狗狗腳滑了一下，芭比Q了',
  );
});

test('wheel endings always land on the saved winner and twists first stop on someone else', async () => {
  const { planWheel, sliceAt, WHEEL_ENDINGS } = await import('../../src/domain/lottery-wheel.js');
  const counts = Object.fromEntries(WHEEL_ENDINGS.map((ending) => [ending.key, 0]));
  for (const count of [1, 2, 3, 7, 24, 60]) {
    for (let round = 0; round < 1000; round++) {
      const winner = round % count;
      const plan = planWheel(count, winner);
      // A single participant can't have a different first stop; keep it out of the ratios.
      if (count > 1) counts[plan.ending]++;
      assert.ok(plan.stopRotation >= 3 * 360, 'spins several full turns');
      if (plan.ending === 'grow') assert.ok(Math.abs(plan.target) < plan.growHalf, 'grows past the pointer');
      else assert.equal(sliceAt(count, plan.rotation, plan.pointerAngle), plan.winnerSlot, plan.ending);
      if (plan.ending !== 'swap') assert.equal(plan.winnerSlot, winner);
      assert.equal(plan.decoy, sliceAt(count, plan.stopRotation, 0));
      assert.notEqual(plan.ending, 'normal');
      if (plan.ending === 'fake') assert.equal(plan.decoy, winner);
      else assert.notEqual(plan.decoy, winner, `${plan.ending} with ${count}`);
      if (plan.ending === 'extend') assert.equal(plan.pointerAngle, 180);
      if (plan.ending === 'slip') assert.equal(plan.pointerAngle, 0);
      if (count === 1) assert.equal(plan.ending, 'fake');
    }
  }
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  assert.equal(counts.normal, 0);
  for (const key of ['fake', 'extend', 'bend', 'slip', 'break', 'swap', 'grow'])
    assert.ok(Math.abs(counts[key] / total - 1 / 7) < 0.02, JSON.stringify(counts));
  // The same ending never plays twice running, except with one person left.
  let last = null;
  for (let round = 0; round < 500; round++) {
    const { ending } = planWheel(24, 5, Math.random, { avoid: last });
    assert.notEqual(ending, last);
    last = ending;
  }
  assert.equal(planWheel(1, 0, Math.random, { avoid: 'fake' }).ending, 'fake');
  // Forced previews still land on the winner for every ending.
  for (const { key } of WHEEL_ENDINGS) {
    const plan = planWheel(24, 5, Math.random, { ending: key });
    assert.equal(plan.ending, key);
    if (key === 'grow') assert.ok(Math.abs(plan.target) < plan.growHalf);
    else assert.equal(sliceAt(24, plan.rotation, plan.pointerAngle), plan.winnerSlot);
  }
});
