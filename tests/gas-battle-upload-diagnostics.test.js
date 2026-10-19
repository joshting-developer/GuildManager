import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattleUploadDiagnostics } from '../gas/src/battle-upload-diagnostics.js';
import { gasRuntime, cloudResult, cloudSession, fixtureCsv } from './helpers/gas-runtime.js';

const secret = 'player-secret https://discord.com/api/webhooks/private-token sheet-private-id';

test('upload diagnostics retain the innermost failure and fixed categories without raw exception data', () => {
  for (const [message, expected] of [
    ['Service Spreadsheets timed out', 'TIMEOUT'],
    ['Authorization is required', 'AUTHORIZATION'],
    ['Access denied: permission missing', 'PERMISSION'],
    ['Service invoked too many times', 'QUOTA'],
    ['File does not exist', 'NOT_FOUND'],
    ['unrecognized failure', 'UNEXPECTED'],
  ]) {
    let tick = 0;
    const logs = [];
    const d = createBattleUploadDiagnostics({ clock: () => tick++, uuid: () => 'a'.repeat(32), log: (line) => logs.push(line) });
    const error = new Error(`${message} ${secret}`);
    assert.throws(() => d.run('LOCK', () => d.run('SHEETS_WRITE', () => { throw error; }, 'battle_players')), (value) => value === error);
    const response = d.report(error);
    const entry = JSON.parse(logs[0]);
    assert.equal(entry.stage, 'SHEETS_WRITE');
    assert.equal(entry.table, 'battle_players');
    assert.equal(entry.category, expected);
    assert.ok(entry.elapsedMs > 0);
    assert.equal(entry.timings.find((step) => step.stage === 'SHEETS_WRITE').count, 1);
    assert.ok(response.includes(entry.diagnosticId));
    for (const value of [secret, message, error.stack]) {
      assert.ok(!logs.join('').includes(value));
      assert.ok(!response.includes(value));
    }
  }
});

test('diagnostics cannot replace the upload failure when logging or reference creation fails', () => {
  const d = createBattleUploadDiagnostics({ uuid: () => { throw Error(secret); }, log: () => { throw Error(secret); } });
  const error = new Error(secret);
  assert.throws(() => d.run('DRIVE_CSV', () => { throw error; }), (value) => value === error);
  assert.match(d.report(error), /保存原始 CSV.*診斷碼：upload-/);
  assert.ok(!d.report(error).includes(secret));
});

test('diagnostics discard unknown stage/table labels and preserve the actual final exception', () => {
  const logs = [];
  const d = createBattleUploadDiagnostics({ log: (line) => logs.push(JSON.parse(line)) });
  const first = new Error('Access denied');
  const final = new Error('Service timed out');
  assert.throws(() => d.run('LOCK', () => {
    try {
      d.run('DRIVE_CSV', () => { throw first; });
    } finally {
      d.run(secret, () => { throw final; }, secret);
    }
  }), (error) => error === final);
  d.report(final);
  assert.equal(logs[0].stage, 'UNKNOWN');
  assert.equal(logs[0].table, null);
  assert.equal(logs[0].category, 'TIMEOUT');
  assert.ok(!JSON.stringify(logs).includes(secret));
});

async function fixture() {
  const env = await gasRuntime();
  env.setup();
  const login = cloudResult(env.raw('login', [{ username: 'admin', password: 'initial-password-123' }]));
  const context = cloudSession(login);
  const call = (name, args = []) => cloudResult(env.raw(name, args, context));
  const event = call('createEvent', [{ requestId: 'event', title: '診斷測試', type: 'scrimmage', dates: ['2026-10-07'] }]).event;
  const logs = [];
  env.sandbox.Logger = { log: (line) => logs.push(JSON.parse(line)) };
  const input = {
    requestId: 'upload', image: null,
    records: [1, 2].map((roundNumber) => ({
      eventId: event.id, type: event.type, datetime: event.dates[0], roundNumber,
      filename: `diagnostic-${roundNumber}.csv`, csvText: fixtureCsv(), redTeam: '紅', blueTeam: '藍',
    })),
  };
  const upload = () => env.raw('saveBattleRecords', [input], context);
  function failed(result, stage, table = null) {
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'GAS_ERROR');
    const entry = logs.at(-1);
    assert.equal(entry.event, 'BATTLE_UPLOAD_FAILURE');
    assert.equal(entry.stage, stage);
    assert.equal(entry.table, table);
    assert.ok(result.error.message.includes(entry.diagnosticId));
    assert.ok(!JSON.stringify([entry, result]).includes(secret));
    return entry;
  }
  return { env, context, call, logs, input, upload, failed };
}

test('compiled RPC diagnoses second Drive attachment failure, preserves atomic results and retries both rounds safely', async () => {
  const f = await fixture();
  const create = f.env.folder.createFile;
  let count = 0;
  f.env.folder.createFile = (blob) => {
    if (++count === 2) throw new Error(`Access denied ${secret}`);
    return create(blob);
  };
  assert.equal(f.failed(f.upload(), 'DRIVE_CSV').category, 'PERMISSION');
  assert.equal(f.call('getBattleRecords', [1, f.input.records[0].eventId]).total, 0);
  assert.equal(f.env.files.size, 1); // A private unattached file can remain after a failed batch.
  f.env.folder.createFile = create;
  const result = cloudResult(f.upload());
  assert.equal(result.records.length, 2);
  assert.deepEqual(cloudResult(f.upload()), result);
  assert.equal(f.env.files.size, 3);
  assert.equal(f.logs.length, 1);
  for (const record of result.records) {
    assert.equal(record.players.length, 2);
    const file = f.call('getBattleAttachment', [record.id, 'csv']);
    assert.equal(Buffer.from(file.base64, 'base64').toString('utf8'), fixtureCsv());
  }
});

test('compiled RPC identifies Sheets read/write/commit failures and maintains retry visibility', async () => {
  const f = await fixture();
  const current = f.env.sheets.get('GM_battles');
  const getLastRow = current.getLastRow;
  current.getLastRow = () => { throw new Error(`Service Spreadsheets timed out ${secret}`); };
  assert.equal(f.failed(f.upload(), 'SHEETS_READ', 'battles').category, 'TIMEOUT');
  assert.equal(f.env.files.size, 0);
  current.getLastRow = getLastRow;
  for (const [table, stage] of [['battle_players', 'SHEETS_WRITE'], ['commits', 'SHEETS_COMMIT']]) {
    f.env.failOn(`GM_${table}`);
    f.failed(f.upload(), stage, table);
    f.env.failOn(null);
    assert.equal(f.call('getBattleRecords', [1, f.input.records[0].eventId]).total, 0);
  }
  const saved = cloudResult(f.upload());
  assert.equal(saved.records.length, 2);
  const before = f.env.files.size;
  assert.deepEqual(cloudResult(f.upload()), saved);
  assert.equal(f.env.files.size, before);
});

test('failure after commit reports uncertainty and same request recovers saved results without duplicate attachments', async () => {
  const f = await fixture();
  const flush = f.env.sandbox.SpreadsheetApp.flush;
  let calls = 0;
  f.env.sandbox.SpreadsheetApp.flush = () => {
    if (++calls === 2) throw new Error(`Service Spreadsheets timed out ${secret}`);
  };
  f.failed(f.upload(), 'SHEETS_FLUSH');
  f.env.sandbox.SpreadsheetApp.flush = flush;
  assert.equal(f.call('getBattleRecords', [1, f.input.records[0].eventId]).total, 2);
  const recovered = cloudResult(f.upload());
  assert.equal(recovered.records.length, 2);
  assert.equal(f.env.files.size, 2);
  assert.equal(f.logs.length, 1);
});

test('validation and authorization retain their original errors and produce no upload diagnostics or files', async () => {
  const f = await fixture();
  const anonymous = f.env.raw('saveBattleRecords', [f.input]);
  assert.equal(anonymous.error.code, 'AUTH_REQUIRED');
  const invalid = f.env.raw('saveBattleRecords', [{ ...f.input, records: [] }], f.context);
  assert.equal(invalid.error.code, 'BATTLE_INVALID');
  const invalidCsrf = f.env.raw('saveBattleRecords', [f.input], { ...f.context, csrfToken: 'bad' });
  assert.equal(invalidCsrf.error.code, 'CSRF_INVALID');
  assert.equal(f.logs.length, 0);
  assert.equal(f.env.files.size, 0);
});
