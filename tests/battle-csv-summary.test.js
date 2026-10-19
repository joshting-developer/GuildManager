import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BATTLE_COLUMNS, parseBattleCsv } from '../src/domain/battle-records.js';
import { createRepository } from '../server/repository.js';
import { gasRuntime, cloudResult, cloudSession } from './helpers/gas-runtime.js';

const header = BATTLE_COLUMNS.map(([title]) => `"${title}"`).join(',');
// Match the reported export's shape without keeping real player names in Git.
function exportedCsv(redSummary = 60, blueSummary = 59) {
  const team = (side) => Array.from({ length: 60 }, (_, index) =>
    `"${side}玩家${index + 1}","碎夢",1,2,3,"1,234",0,0,600,1,2,0`,
  ).join('\r\n');
  return `\ufeff"紅隊","${redSummary}"\r\n${header}\r\n${team('紅')}\r\n\r\n"藍隊","${blueSummary}"\r\n${header}\r\n${team('藍')}\r\n`;
}

function upload(event, csvText) {
  return {
    requestId: 'summary-mismatch-upload',
    records: [{
      eventId: event.id,
      roundNumber: 1,
      type: event.type,
      datetime: event.dates[0],
      filename: '20261014_215755_紅隊_藍隊.csv',
      csvText,
      redTeam: '紅隊',
      blueTeam: '藍隊',
      winner: null,
      ourSide: null,
    }],
  };
}

const eventInput = {
  requestId: 'summary-mismatch-event',
  title: '摘要人數測試',
  type: 'scrimmage',
  dates: ['2026-10-14'],
};

test('CSV summary counts above or below actual rows only warn and preserve every player', () => {
  const expected = parseBattleCsv(exportedCsv(60, 60));
  assert.equal(expected.warnings, undefined);
  for (const [redSummary, blueSummary] of [[60, 59], [61, 60], [59, 61], [0, 0]]) {
    const parsed = parseBattleCsv(exportedCsv(redSummary, blueSummary));
    assert.deepEqual([parsed.redCount, parsed.blueCount], [60, 60]);
    assert.deepEqual(parsed.players, expected.players);
    assert.equal(parsed.players[0].playerDamage, 1234);
    assert.equal(parsed.warnings.length, Number(redSummary !== 60) + Number(blueSummary !== 60));
    for (const [index, count] of [redSummary, blueSummary].entries()) {
      if (count === 60) continue;
      const side = index === 0 ? '紅方' : '藍方';
      const warning = parsed.warnings.find((message) => message.startsWith(side));
      assert.ok(warning.includes(`摘要為 ${count} 人`));
      assert.ok(warning.includes('實際玩家戰績為 60 筆'));
      assert.ok(warning.includes('可繼續上傳'));
    }
  }
  // A count warning never bypasses validation of the actual player data.
  assert.throws(() => parseBattleCsv(exportedCsv().replace('1,2,3,"1,234"', '1,2,3,-1')), /非負整數/);
  assert.throws(() => parseBattleCsv(exportedCsv().replace('"碎夢",1,2,3', '"碎夢",1,2')), /欄位數/);
});

function savedRecord(record) {
  assert.deepEqual([record.redCount, record.blueCount], [60, 60]);
  assert.deepEqual(record.players, parseBattleCsv(exportedCsv()).players);
}

test('SQLite imports mismatched summaries with actual counts, unchanged CSV and idempotent retries', () => {
  const repository = createRepository({ filename: ':memory:' });
  try {
    const event = repository.createEvent(eventInput);
    const csvText = exportedCsv();
    const input = upload(event, csvText);
    const result = repository.saveBattleRecords(input);
    const record = repository.getBattleRecord(result.records[0].id);
    savedRecord(record);
    assert.equal(repository.getBattleAttachment(record.id, 'csv').bytes.toString('utf8'), csvText);
    assert.deepEqual(repository.saveBattleRecords(input), result);
    assert.equal(repository.listBattleRecords({ page: 1, eventId: event.id }).total, 1);
  } finally {
    repository.close();
  }
});

test('compiled GAS RPC imports mismatched summaries with actual counts, unchanged CSV and safe retries', async () => {
  const environment = await gasRuntime();
  environment.setup();
  const login = cloudResult(environment.raw('login', [{
    username: 'admin', password: 'initial-password-123',
  }]));
  const context = cloudSession(login);
  const call = (operation, args = []) => cloudResult(environment.raw(operation, args, context));
  const event = call('createEvent', [eventInput]).event;
  const csvText = exportedCsv();
  const input = upload(event, csvText);
  const result = call('saveBattleRecords', [input]);
  const record = call('getBattleRecord', [result.records[0].id]).record;
  savedRecord(record);
  const attachment = call('getBattleAttachment', [record.id, 'csv']);
  assert.equal(Buffer.from(attachment.base64, 'base64').toString('utf8'), csvText);
  assert.deepEqual(call('saveBattleRecords', [input]), result);
  assert.equal(call('getBattleRecords', [1, event.id]).total, 1);
});
