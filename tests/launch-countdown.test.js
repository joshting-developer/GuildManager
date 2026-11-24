import test from 'node:test';
import assert from 'node:assert/strict';
import { countdownParts, LAUNCH_AT, LAUNCH_TIME, PREVIEW_SEQUENCE, previewSequence } from '../src/domain/launch-countdown.js';

test('launch is Friday midnight in Taiwan; countdown rounds up and never becomes negative', () => {
  assert.equal(LAUNCH_AT, '2026-11-27T00:00:00+08:00');
  assert.equal(new Date(LAUNCH_TIME).toISOString(), '2026-11-26T16:00:00.000Z');
  assert.equal(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Taipei', weekday: 'long' }).format(LAUNCH_TIME), 'Friday');
  assert.deepEqual(countdownParts(LAUNCH_TIME - (2 * 86400 + 3 * 3600 + 4 * 60 + 5) * 1000).map(p => p.text), ['02', '03', '04', '05']);
  assert.deepEqual(countdownParts(LAUNCH_TIME - 1).map(p => p.text), ['00', '00', '00', '01']);
  for (const now of [LAUNCH_TIME, LAUNCH_TIME + 86400000]) assert.ok(countdownParts(now).every(p => p.value === 0));
});

test('hidden sequence accepts consecutive keys and overlapping prefixes, resets mistakes, and ignores browser shortcuts and composing text', () => {
  const type = (text, buffer = '') => [...text].reduce((value, key) => previewSequence(value, { key }), buffer);
  assert.equal(type(PREVIEW_SEQUENCE), PREVIEW_SEQUENCE);
  assert.equal(type('JYLHISME'), PREVIEW_SEQUENCE);
  assert.equal(type('j' + PREVIEW_SEQUENCE), PREVIEW_SEQUENCE);
  assert.notEqual(type('jylhx isme'), PREVIEW_SEQUENCE);
  for (const event of [{ key: 'Escape' }, { key: 'Backspace' }, { key: 'x' }, { key: 'h', isComposing: true }, { key: 'h', repeat: true }, { key: 'h', ctrlKey: true }, { key: 'h', metaKey: true }, { key: 'h', altKey: true }])
    assert.equal(previewSequence('jyl', event), '');
});
