import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gasRuntime, cloudResult, cloudSession } from './helpers/gas-runtime.js';

test('GAS webhook diagnostics record safe causes and final retry status after commit without changing receipts', async () => {
  const env = await gasRuntime();
  env.setup();
  const admin = cloudSession(cloudResult(env.raw('login', [{ username: 'admin', password: 'initial-password-123' }])));
  const call = (op, args = []) => cloudResult(env.raw(op, args, admin));
  const logs = [];
  env.sandbox.Logger = { log: (line) => logs.push(line) };
  call('addMember', [{ uid: 'private_uid', name: '私人名稱', primaryProfessionId: 1 }]);
  assert.match(logs.pop(), /DISCORD_WEBHOOK_MEMBER.*WEBHOOK_NOT_CONFIGURED/);
  const event = call('createEvent', [{ title: '私人活動', type: 'guild_war', dates: ['2026-10-19'], requestId: 'event' }]).events[0];
  const url = 'https://discord.com/api/webhooks/12345/secret_test_token';
  const input = (id, status = 'leave') => ({ name: '私人名稱', status, note: '私人備註', professionId: 1,
    requestId: id, revision: call('getEventParticipation', [event.id]).revision });
  let attempts = 0;
  let statuses = [];
  env.sandbox.UrlFetchApp.fetch = () => {
    // The saved response is already visible, and delivery has released the script lock.
    assert.equal(env.lock.tryLock(), true);
    env.lock.releaseLock();
    attempts++;
    const status = statuses.shift();
    if (status === 'throw') throw new Error(url + ' 私人名稱 私人備註');
    return { getResponseCode: () => status, getContentText: () => '{"retry_after":0}' };
  };
  env.propertyService.setProperty('DISCORD_WEBHOOK_LEAVE', 'https://invalid.example/private');
  call('submitParticipation', [event.id, input('invalid')]);
  assert.equal(attempts, 0);
  assert.match(logs.pop(), /DISCORD_WEBHOOK_LEAVE.*WEBHOOK_INVALID/);

  env.propertyService.setProperty('DISCORD_WEBHOOK_LEAVE', url);
  statuses = [503];
  const request = input('http-failure', 'registered');
  const receipt = call('submitParticipation', [event.id, request]);
  assert.match(logs.at(-1), /DISCORD_WEBHOOK_LEAVE.*HTTP_ERROR.*HTTP 503/);
  assert.deepEqual(call('submitParticipation', [event.id, request]), receipt);
  assert.equal(attempts, 1, 'requestId retry must not deliver again');

  statuses = [429, 204];
  const before = logs.length;
  call('submitParticipation', [event.id, input('retry-success')]);
  assert.equal(attempts, 3);
  assert.equal(logs.length, before, 'successful retry is not logged as failure');

  statuses = [429, 429];
  call('submitParticipation', [event.id, input('retry-failure', 'registered')]);
  assert.equal(attempts, 5);
  assert.match(logs.at(-1), /HTTP_ERROR.*HTTP 429/);

  statuses = ['throw'];
  call('submitParticipation', [event.id, input('exception')]);
  assert.match(logs.at(-1), /DISCORD_WEBHOOK_LEAVE.*REQUEST_EXCEPTION/);
  assert.equal(call('getEventAttendance', [event.id]).leave[0].name, '私人名稱');
  for (const secret of ['secret_test_token', 'webhooks/', 'invalid.example', '私人名稱', '私人備註', '私人活動', 'private_uid'])
    assert.ok(logs.every((line) => !line.includes(secret)), `logs must omit ${secret}`);

  env.sandbox.Logger = { log() { throw new Error('logger unavailable'); } };
  statuses = [500];
  assert.equal(env.raw('submitParticipation', [event.id, input('logger-failure', 'registered')], admin).ok, true);
  assert.equal(call('getEventParticipation', [event.id]).responses[0].status, 'registered');
});
