import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventVideoClient } from '../src/api/event-videos.js';

test('video reads require the requested event identity but no event revision', async () => {
  let eventId = 'event';
  const client = createEventVideoClient({ fetchImpl: async () => ({ ok: true, json: async () => ({ eventId, videos: [] }) }) });
  assert.deepEqual((await client.getVideos('event')).videos, []);
  eventId = 'other';
  await assert.rejects(client.getVideos('event'), /影片資料回應格式不正確/);
});
