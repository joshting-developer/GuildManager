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
    assert.deepEqual((await repo.getVideoBrowser()), { events: [], hasMore: false, nextCursor: null, selected: null });
    (await repo.createEvent({ type: 'activity', title: '活動', dates: ['2099-01-01'], requestId: 'activity' }));
    assert.deepEqual((await repo.getVideoBrowser('removed')), { events: [], hasMore: false, nextCursor: null, selected: null });
    const future = (await repo.createEvent({ type: 'scrimmage', title: '未來', dates: ['2099-01-01'], requestId: 'future' }));
    assert.equal((await repo.getVideoBrowser()).selected.eventId, future.id);
    assert.deepEqual((await repo.getVideoBrowser()).selected.videos, []);
  } finally { (await repo.close()); }
});

test('video choices filter unrelated events in SQL and keep paged history and pinned selection', async () => {
  const { repositoryDatabase } = await import('../helpers/mysql-repository.js');
  const repo = await createRepository();
  try {
    const db = repositoryDatabase(repo);
    const rows = Array.from({ length: 705 }, (_, i) => {
      const id = `choice-${String(i).padStart(3, '0')}`;
      return [id, id, i < 205 ? 'scrimmage' : 'activity', id, '2026-01-01', '2026-01-01'];
    });
    await db.query(`INSERT INTO scheduled_events(id,title,type,request_id,created_at,updated_at) VALUES ${rows.map(() => '(?,?,?,?,?,?)').join(',')}`, rows.flat());
    await db.query(`INSERT INTO event_dates(event_id,date) VALUES ${rows.map(() => "(?,'2020-01-01')").join(',')}`, rows.map(row => row[0]));
    const first = await repo.getVideoChoices();
    const second = await repo.getVideoChoices({ cursor: first.nextCursor });
    assert.equal(first.events.length, 200);
    assert.equal(first.hasMore, true);
    assert.equal(second.events.length, 5);
    assert.equal(second.hasMore, false);
    assert.equal(new Set([...first.events, ...second.events].map(event => event.id)).size, 205);
    assert.ok([...first.events, ...second.events].every(event => event.type === 'scrimmage'));
    const browser = await repo.getVideoBrowser('choice-204');
    assert.equal(browser.events.length, 201);
    assert.equal(browser.nextCursor, first.nextCursor);
    assert.equal(browser.selected.eventId, 'choice-204');
    assert.deepEqual(browser.selected.videos, []);
    const fallback = await repo.getVideoBrowser('choice-700');
    assert.equal(fallback.selected.eventId, 'choice-000', 'non-battle preferred event cannot enter choices');
    await assert.rejects(repo.getVideoChoices({ cursor: 'not-a-cursor' }));
  } finally { await repo.close(); }
});

test('choice cursors continue across date ties and both date phases without gaps or repeats', async () => {
  const { repositoryDatabase } = await import('../helpers/mysql-repository.js');
  const { taipeiToday } = await import('../../src/domain/battle-events.js');
  const repo = await createRepository();
  try {
    const db = repositoryDatabase(repo), today = taipeiToday();
    const shift = (days) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
    // 230 battles on today, 230 on one past day and 230 upcoming; titles repeat so IDs break ties.
    const rows = [];
    for (const [offset, prefix] of [[0, 't'], [-3, 'p'], [5, 'f']])
      for (let i = 0; i < 230; i++) rows.push([`${prefix}${String(i).padStart(3, '0')}`, `T${i % 7}`, shift(offset)]);
    await db.query(`INSERT INTO scheduled_events(id,title,type,request_id,created_at,updated_at) VALUES ${rows.map(() => "(?,?,'scrimmage',?,'2026-01-01','2026-01-01')").join(',')}`,
      rows.flatMap(([id, title]) => [id, title, id]));
    await db.query(`INSERT INTO event_dates(event_id,date) VALUES ${rows.map(() => '(?,?)').join(',')}`, rows.flatMap(([id, , date]) => [id, date]));
    const order = (list, upcomingFirst) => list.toSorted((a, b) => {
      const phase = (row) => (upcomingFirst ? row[2] >= today : row[2] <= today) ? 0 : 1;
      const asc = (row) => (phase(row) === 0) === upcomingFirst;
      return phase(a) - phase(b) || (asc(a) ? a[2].localeCompare(b[2]) : b[2].localeCompare(a[2])) ||
        a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]);
    }).map((row) => row[0]);
    for (const [name, upcomingFirst] of [['getVideoChoices', false], ['getLineupChoices', true]]) {
      const ids = [];
      let cursor = null, pages = 0;
      do {
        const page = await repo[name](cursor ? { cursor } : {});
        ids.push(...page.events.map((event) => event.id));
        cursor = page.nextCursor;
        pages++;
      } while (cursor);
      assert.equal(pages, 4, name);
      assert.deepEqual(ids, order(rows, upcomingFirst), name);
    }
  } finally {
    (await repo.close());
  }
});
