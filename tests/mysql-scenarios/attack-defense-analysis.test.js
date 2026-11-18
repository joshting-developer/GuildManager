import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository } from '../helpers/mysql-repository.js';
import { createApp } from '../../server/app.js';
import { createBattleRecordClient } from '../../src/api/battle-records.js';
import { authenticatedFetch } from '../helpers/authenticated-fetch.js';

import { emptyLineup } from '../../src/domain/lineups.js';
import { BATTLE_COLUMNS } from '../../src/domain/battle-records.js';
import { analyzeBattleTeamContext } from '../../src/domain/team-battle-analysis.js';

function fixture() {
  const teams = emptyLineup();
  const positions = [0, 3, 6, 7, 8, 9];
  const players = positions.map((position, index) => {
    const uid = `private-${index}`, name = `玩家${index}`;
    Object.assign(teams[position].slots[0], { uid, member: { uid, name }, note: 'private-note', dutyIds: ['private-duty'] });
    return { side: 'red', player: name, profession: '碎夢', memberUid: uid, kill: (index + 1) * 10,
      assist: 20, resource: 10, buildingDamage: (index + 1) * 1000, damageTaken: 4000,
      playerDamage: (index + 1) * 2000, seriousInjury: index, heal: 3000, revive: 1 };
  });
  players.push({ ...players[0], memberUid: null, player: '未排紅方', kill: 50 });
  players.push({ ...players[0], memberUid: null, player: '未排藍方', side: 'blue', kill: 999 });
  const record = { id: 'battle', eventId: 'event', type: 'scrimmage', playedAt: '2026-10-19', roundNumber: 1,
    createdAt: '2026-10-19T12:00:00Z', redTeam: '紅', blueTeam: '藍', winner: 'red', ourSide: 'red', players };
  const lineup = { id: 'lineup', eventId: 'event', version: 1, event: { type: record.type, dates: [record.playedAt] }, createdAt: record.createdAt, teams };
  return { record, lineup };
}

test('HTTP detail opt-in uses one adapter request and protects context fields and options while retaining legacy responses', async () => {
  const { record, lineup } = fixture(), repo = await createTestRepository({ });
  const csv = [BATTLE_COLUMNS.map(([label]) => label).join(','), ...record.players.filter(p => p.side === 'red').map(p => BATTLE_COLUMNS.map(([, k]) => p[k] ?? '').join(',')), BATTLE_COLUMNS.map(([label]) => label).join(','), ...record.players.filter(p => p.side === 'blue').map(p => BATTLE_COLUMNS.map(([, k]) => p[k] ?? '').join(','))].join('\n');
  for (const player of record.players.filter(p => p.memberUid)) (await repo.addMember({ uid: player.memberUid, name: player.player, primaryProfessionId: 3, secondaryProfessionId: null }));
  const event = (await repo.createEvent({ requestId: 'event', title: '分析', type: record.type, dates: [record.playedAt] }));
  const teams = lineup.teams.map(team => ({ ...team, slots: team.slots.map(slot => ({ ...slot, dutyIds: [] })) }));
  (await repo.confirmLineup({ eventId: event.id, eventRevision: event.revision, expectedVersion: 0, requestId: 'lineup', teams }));
  const battle = (await repo.saveBattleRecords({ requestId: 'battle', records: [{ eventId: event.id, type: record.type, datetime: record.playedAt, roundNumber: 1, filename: 'fixture.csv', csvText: csv, redTeam: '紅', blueTeam: '藍' }] })).records[0];
  const server = createApp(repo).listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`, authFetch = await authenticatedFetch(server, repo);
    let reads = 0;
    const client = createBattleRecordClient({ fetchImpl: (url, init) => { reads++; return authFetch(base + url, init); } });
    const result = await client.getRecord(battle.id, { includeTeamContext: true });
    assert.equal(reads, 1);
    assert.ok(!JSON.stringify(result.record.teamContext).includes('private-'));
    assert.equal(analyzeBattleTeamContext(result.record).sides.red.groups[2].rows.length, 1);
    assert.equal((await client.getRecord(battle.id)).record.teamContext, undefined);
    assert.equal((await fetch(`${base}/api/battle-records/${battle.id}?includeTeamContext=true`)).status, 401);
    assert.equal((await authFetch(`${base}/api/battle-records/${battle.id}?includeTeamContext=invalid`)).status, 422);
    await assert.rejects(async () => (await repo.getBattleRecord(battle.id, { includeTeamContext: 'true' })), { code: 'BATTLE_FILTER_INVALID' });
    assert.deepEqual((await repo.getBattleTeamAnalysis(battle.id)).sides.red.groups[0].totals, analyzeBattleTeamContext(result.record).sides.red.groups[0].totals);
  } finally { await new Promise(r => server.close(r)); (await repo.close()); }
});
