import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEventClient } from '../src/api/events.js';
test('event client preserves fields and request ID, never automatically retrying a failed write', async () => {
  const requests = [];
  const input = {
    title: '活動',
    type: 'activity',
    dates: ['2026-10-03'],
    requestId: 'same-request',
  };
  const client = createEventClient({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: false,
        json: async () => ({
          error: {
            code: 'VALIDATION_ERROR',
            message: '請修正日期',
            fields: { dates: '約戰只能一天' },
          },
        }),
      };
    },
  });
  await assert.rejects(client.createEvent(input), (error) => error.fields.dates === '約戰只能一天');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/events');
  assert.deepEqual(JSON.parse(requests[0].options.body), input);
});

test('event client reports network and malformed JSON errors, and returns local event data', async () => {
  await assert.rejects(
    createEventClient({
      fetchImpl: async () => {
        throw new Error('offline');
      },
    }).getEvents(),
    /無法連線/,
  );
  await assert.rejects(
    createEventClient({
      fetchImpl: async () => ({
        ok: true,
        json: async () => {
          throw new Error('invalid JSON');
        },
      }),
    }).getEvents(),
    /格式不正確/,
  );
  const data = { events: [{ id: 'id', dates: ['2026-10-03'] }] };
  assert.deepEqual(
    await createEventClient({
      fetchImpl: async () => ({ ok: true, json: async () => data }),
    }).getEvents(),
    data,
  );
});
