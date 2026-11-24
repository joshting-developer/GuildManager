import test from 'node:test';
import assert from 'node:assert/strict';
import { LEGACY_STOP_AT, NEW_SITE_OPEN_AT, migrationPhase, migrationCountdown } from '../src/migration.js';

test('切站依台灣時間在兩個邊界切換', () => {
  assert.equal(new Date(LEGACY_STOP_AT).toISOString(), '2026-11-26T15:40:00.000Z');
  assert.equal(new Date(NEW_SITE_OPEN_AT).toISOString(), '2026-11-26T16:00:00.000Z');
  assert.equal(migrationPhase(LEGACY_STOP_AT - 1), 'legacy');
  assert.equal(migrationPhase(LEGACY_STOP_AT), 'moving');
  assert.equal(migrationPhase(NEW_SITE_OPEN_AT - 1), 'moving');
  assert.equal(migrationPhase(NEW_SITE_OPEN_AT), 'open');
});

test('倒數包含天數, 到期不顯示負值', () => {
  assert.equal(migrationCountdown(NEW_SITE_OPEN_AT - 90061000), '1 天 01:01:01');
  assert.equal(migrationCountdown(LEGACY_STOP_AT), '00:20:00');
  assert.equal(migrationCountdown(NEW_SITE_OPEN_AT + 1000), '00:00:00');
});

test('停用後不再送出 GAS 呼叫', async () => {
  const { callGas } = await import('../src/api/gas.js');
  const originalNow = Date.now;
  Date.now = () => LEGACY_STOP_AT;
  try {
    await assert.rejects(callGas('getHomeData', [], {}), /舊站已停止使用/);
  } finally {
    Date.now = originalNow;
  }
});
