import { asyncMap } from "../../server/mysql/collections.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepository as createRepository } from '../helpers/mysql-repository.js';

import { isBattleEvent, orderBattleEvents, taipeiToday } from '../../src/domain/battle-events.js';
import { videoTableCsv } from '../../src/domain/video-table-csv.js';

const video = (event, extra = {}) => ({ name: '=長名稱', professionId: 3,
  firstUrl: 'https://example.com/first', secondUrl: 'https://example.com/second',
  groupName: '進攻二', note: '備註\n第二行', eventRevision: event.revision,
  requestId: crypto.randomUUID(), ...extra });
async function localFixture() {
  const repo = (await createRepository());
  const events = (await asyncMap([['過去', 'scrimmage', '2020-01-01'], ['今天', 'guild_war', taipeiToday()],
    ['未來', 'dragon_tiger', '2099-01-01'], ['活動', 'activity', taipeiToday()]], async ([title, type, date]) =>
    (await repo.createEvent({ title, type, dates: [date], requestId: type }))));
  (await repo.submitEventVideo(events[1].id, video(events[1])));
  (await repo.submitEventVideo(events[1].id, video(events[1], { name: '另一次提交' })));
  (await repo.submitEventVideo(events[0].id, video(events[0])));
  return { repo, events };
}

test('MySQL browser returns the same sorted choices and selected videos as legacy reads, including CSV, without stale reloads', async () => {
  const { repo, events } = (await localFixture());
  try {
    const oldEvents = orderBattleEvents((await repo.listEvents()).events.filter(isBattleEvent), { prefer: 'recent' });
    const result = (await repo.getVideoBrowser());
    assert.deepEqual(result.events, oldEvents);
    assert.equal(result.selected.eventId, events[1].id);
    assert.deepEqual(result.selected, (await repo.listEventVideos(events[1].id)));
    assert.equal(videoTableCsv(result.selected.videos), videoTableCsv((await repo.listEventVideos(events[1].id)).videos));
    assert.equal((await repo.getVideoBrowser(events[0].id)).selected.eventId, events[0].id);
    (await repo.updateEvent(events[0].id, { ...events[0], title: '新名稱', revision: 1 }));
    assert.equal((await repo.getVideoBrowser(events[0].id)).events.find(e => e.id === events[0].id).title, '新名稱');
    (await repo.deleteEvent(events[0].id, 2));
    assert.equal((await repo.getVideoBrowser(events[0].id)).selected.eventId, events[1].id);
    (await assert.rejects(async () => (await repo.getVideoBrowser({})), { code: 'VIDEO_INVALID' }));
    (await assert.rejects(async () => (await repo.getVideoBrowser('x'.repeat(129))), { code: 'VIDEO_INVALID' }));
  } finally { (await repo.close()); }
});

test('empty or future-only browser uses the previous picker rule without reading an unavailable event', async () => {
  const repo = (await createRepository());
  try {
    assert.deepEqual((await repo.getVideoBrowser()), { events: [], selected: null });
    (await repo.createEvent({ type: 'activity', title: '活動', dates: ['2099-01-01'], requestId: 'activity' }));
    assert.deepEqual((await repo.getVideoBrowser('removed')), { events: [], selected: null });
    const future = (await repo.createEvent({ type: 'scrimmage', title: '未來', dates: ['2099-01-01'], requestId: 'future' }));
    assert.equal((await repo.getVideoBrowser()).selected.eventId, future.id);
    assert.deepEqual((await repo.getVideoBrowser()).selected.videos, []);
  } finally { (await repo.close()); }
});
