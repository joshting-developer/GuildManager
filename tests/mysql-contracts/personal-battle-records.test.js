import { test } from 'node:test';
import assert from 'node:assert/strict';

import { join } from 'node:path';

import { createTestRepository as createRepository } from '../helpers/mysql-repository.js';

import { BATTLE_COLUMNS } from '../../src/domain/battle-records.js';
import { summarizePersonalBattles } from '../../src/domain/personal-battle-statistics.js';

const header = BATTLE_COLUMNS.map(([label]) => label).join(',');
const csv = `${header}\n空城,碎夢,2,4,3,100,10,0,200,2,1,\n同名,素問,1,1,1,20,0,40,10,0,0,0\n${header}\n敵人,鐵衣,1,2,3,30,0,0,100,1,0,0`;
async function add(repo, uid, name) {
  return (await repo.addMember({ uid, name, primaryProfessionId: 3, secondaryProfessionId: null }));
}
async function upload(repo, extra = {}, requestId = crypto.randomUUID()) {
  const input = {
    requestId,
    records: [
      {
        filename: 'battle.csv',
        csvText: csv,
        type: 'scrimmage',
        datetime: '2026-10-24',
        redTeam: '我方',
        blueTeam: '對手',
        winner: 'red',
        ...extra,
      },
    ],
  };
  return { input, result: (await repo.saveBattleRecords(input)) };
}

test('new members link older records; pages share full summary and failures roll back links', async () => {
  const repo = (await createRepository());
  try {
    (await upload(repo));
    (await add(repo, '001', '空城'));
    assert.equal((await repo.getMemberBattleRecords('001')).total, 1);
    for (let i = 0; i < 21; i++)
      (await upload(repo, { datetime: `2026-10-${String(i + 1).padStart(2, '0')}` }));
    const first = (await repo.getMemberBattleRecords('001'));
    const second = (await repo.getMemberBattleRecords('001', { page: 2 }));
    assert.equal(first.entries.length, 20);
    assert.equal(second.entries.length, 2);
    assert.equal(first.total, 22);
    assert.deepEqual(first.summary, second.summary);
    assert.equal(first.summary.metrics.find((m) => m.key === 'kill').total, 44);
    assert.equal(first.entries[0].playedAt, '2026-10-24');
    (await assert.rejects(async () =>
      (await repo.saveBattleRecords({
        requestId: 'invalid-pair',
        records: [
          {
            filename: 'new.csv',
            csvText: csv,
            type: 'scrimmage',
            datetime: '2026-11-01',
            redTeam: '我方',
            blueTeam: '對手',
          },
          {
            filename: 'bad.csv',
            csvText: csv,
            type: 'guild_war',
            datetime: '2026-11-01',
            eventId: 'missing',
            redTeam: '我方',
            blueTeam: '對手',
          },
        ],
      })),
    ));
    assert.equal((await repo.getMemberBattleRecords('001')).total, 22);
    (await assert.rejects(async () => (await repo.getMemberBattleRecords('001', { page: 0 }))));
    (await assert.rejects(
      async () => (await repo.getMemberBattleRecords('missing')),
      (e) => e.code === 'MEMBER_NOT_FOUND',
    ));
  } finally {
    (await repo.close());
  }
});

test('personal analysis preserves missing values and unknown results; same battle on both sides counts once', () => {
  const entries = [
    {
      recordId: 'one',
      winner: 'red',
      player: { side: 'red', playerDamage: 100, seriousInjury: 2 },
    },
    {
      recordId: 'one',
      winner: 'red',
      player: { side: 'blue', playerDamage: 200, seriousInjury: 0 },
    },
    {
      recordId: 'two',
      winner: 'blue',
      isInternal: true,
      player: { side: 'blue', playerDamage: null, seriousInjury: 1 },
    },
    {
      recordId: 'three',
      winner: null,
      player: { side: 'red', playerDamage: 300, seriousInjury: null },
    },
  ];
  const summary = summarizePersonalBattles(entries);
  assert.equal(summary.battleCount, 3);
  assert.equal(summary.rowCount, 4);
  assert.deepEqual([summary.wins, summary.losses, summary.unknown], [0, 0, 3]);
  const damage = summary.metrics.find((m) => m.key === 'playerDamage');
  assert.deepEqual(damage, {
    label: '對玩家傷害',
    key: 'playerDamage',
    total: 600,
    average: 200,
    missing: 1,
    perLife: 100,
    perLifeMissing: 2,
  });
  assert.equal(summary.metrics.find((m) => m.key === 'heal').total, null);
  assert.equal(summarizePersonalBattles([]).battleCount, 0);
});
