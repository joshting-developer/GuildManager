import { taipeiToday } from '../../src/domain/battle-events.js';
import { eventListQuery } from '../../src/domain/event-list-query.js';
import { asyncMap } from "./collections.js";
import { randomUUID } from 'node:crypto';
import { EventError, validateEvent } from '../../src/domain/event-validation.js';
export { EventError, validateEvent } from '../../src/domain/event-validation.js';

export function createEventRepository(db) {
  // Keep legacy demo events untouched; only this schema stores user-created arrangements.
  function checkRevision(revision) {
    if (!Number.isSafeInteger(revision) || revision < 1)
      throw new EventError('安排版本不正確，請重新載入清單後再試', { revision: '請重新載入安排' });
  }
  function conflict() {
    throw new EventError(
      '安排已被其他操作修改，請保留輸入並重新載入清單後再試',
      {},
      409,
      'REVISION_CONFLICT',
    );
  }
  function sameValues(event, values) {
    return (
      event.title === values.title &&
      event.type === values.type &&
      JSON.stringify(event.dates) === JSON.stringify(values.dates)
    );
  }
  async function getEvent(id) {
    const event = (await db
      .prepare(
        'SELECT id, title, type, created_at AS createdAt, updated_at AS updatedAt, revision FROM scheduled_events WHERE id = ? AND deleted_at IS NULL',
      )
      .get(id));
    if (!event) return null;
    event.dates = (await db
      .prepare('SELECT date FROM event_dates WHERE event_id = ? ORDER BY date')
      .all(id))
      .map((row) => row.date);
    return event;
  }
  const repository = {
    async getEvent(id) {
      const event = (await getEvent(id));
      if (!event) throw new EventError('找不到有效場次，請重新載入', {}, 404, 'EVENT_NOT_FOUND');
      return { event };
    },
    async listEvents(input) {
      const { startDate, endDate, limit, offset } = eventListQuery(input);
      const range = startDate ? 'AND EXISTS (SELECT 1 FROM event_dates r WHERE r.event_id = e.id AND r.date BETWEEN ? AND ?)' : '';
      const rows = await db.prepare(
        `SELECT chosen.*, d.date FROM (
          SELECT e.id, e.title, e.type, e.created_at AS createdAt, e.updated_at AS updatedAt, e.revision,
            (SELECT MIN(date) FROM event_dates WHERE event_id = e.id) AS firstDate
          FROM scheduled_events e WHERE e.deleted_at IS NULL ${range}
          ORDER BY firstDate, e.created_at, e.id LIMIT ? OFFSET ?
        ) chosen JOIN event_dates d ON d.event_id = chosen.id
        ORDER BY chosen.firstDate, chosen.createdAt, chosen.id, d.date`,
      ).all(...(startDate ? [startDate, endDate] : []), limit + 1, offset);
      const events = new Map();
      for (const { date, firstDate, ...event } of rows) {
        if (!events.has(event.id)) events.set(event.id, { ...event, dates: [] });
        events.get(event.id).dates.push(date);
      }
      const values = [...events.values()];
      return { events: values.slice(0, limit), ...(input ? { hasMore: values.length > limit } : {}) };
    },
    async getVideoChoices(input = {}) {
      const { limit, offset } = eventListQuery({ ...input, limit: 200 });
      const today = taipeiToday();
      const rows = await db.prepare(`SELECT e.id,e.title,e.type,e.created_at AS createdAt,
        e.updated_at AS updatedAt,e.revision,d.date
        FROM scheduled_events e JOIN event_dates d ON d.event_id=e.id
        WHERE e.deleted_at IS NULL AND e.type IN ('scrimmage','guild_war','dragon_tiger')
        ORDER BY CASE WHEN d.date<=? THEN 0 ELSE 1 END,
          CASE WHEN d.date<=? THEN d.date END DESC,CASE WHEN d.date>? THEN d.date END ASC,e.title,e.id
        LIMIT ? OFFSET ?`).all(today, today, today, limit + 1, offset);
      return {
        events: rows.slice(0, limit).map(({ date, ...event }) => ({ ...event, dates: [date] })),
        hasMore: rows.length > limit,
        nextOffset: offset + Math.min(rows.length, limit),
      };
    },
    async createEvent(input) {
      const values = validateEvent(input);
      return (await db.transaction(async () => {
        if (
          (await db
            .prepare('SELECT request_id FROM event_batches WHERE request_id = ?')
            .get(values.requestId))
        )
          throw new EventError(
            '這次提交已用於批次建立，請重新載入清單',
            {},
            409,
            'REQUEST_CONFLICT',
          );
        const prior = (await db
          .prepare('SELECT id FROM scheduled_events WHERE request_id = ?')
          .get(values.requestId));
        if (prior) {
          const event = (await getEvent(prior.id));
          if (!event)
            throw new EventError('此安排已刪除，請重新載入清單', {}, 410, 'EVENT_DELETED');
          if (!sameValues(event, values))
            throw new EventError(
              '上次提交已儲存，請重新載入清單後再建立其他安排',
              {},
              409,
              'REQUEST_CONFLICT',
            );
          return event;
        }
        const id = randomUUID();
        const now = new Date().toISOString();
        (await db.prepare(
          'INSERT INTO scheduled_events (id, title, type, request_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(id, values.title, values.type, values.requestId, now, now));
        const insertDate = db.prepare('INSERT INTO event_dates (event_id, date) VALUES (?, ?)');
        for (const date of values.dates) (await insertDate.run(id, date));
        return (await getEvent(id));
      }));
    },
    async createEventBatch(input) {
      const values = validateEvent(input, { singleBattleDate: false });
      if (!['guild_war', 'dragon_tiger'].includes(values.type))
        throw new EventError('批次建立只適用於幫戰或龍虎戰', { type: '請選擇幫戰或龍虎戰' });
      return (await db.transaction(async () => {
        const prior = (await db
          .prepare('SELECT * FROM event_batches WHERE request_id = ?')
          .get(values.requestId));
        if (prior) {
          if (
            prior.title !== values.title ||
            prior.type !== values.type ||
            prior.dates_json !== JSON.stringify(values.dates)
          )
            throw new EventError(
              '上次批次已儲存，請重新載入清單後再建立其他安排',
              {},
              409,
              'REQUEST_CONFLICT',
            );
          const events = (await asyncMap(await db
            .prepare('SELECT event_id FROM event_batch_items WHERE batch_request_id = ?')
            .all(values.requestId), async (row) => (await getEvent(row.event_id))));
          if (events.some((event) => !event))
            throw new EventError(
              '這批安排中已有項目刪除，請重新載入清單',
              {},
              410,
              'EVENT_DELETED',
            );
          return events.sort((a, b) => a.dates[0].localeCompare(b.dates[0]));
        }
        if (
          (await db.prepare('SELECT id FROM scheduled_events WHERE request_id = ?').get(values.requestId))
        )
          throw new EventError(
            '這次提交已儲存其他安排，請重新載入清單',
            {},
            409,
            'REQUEST_CONFLICT',
          );
        (await db.prepare(
          'INSERT INTO event_batches (request_id, title, type, dates_json) VALUES (?, ?, ?, ?)',
        ).run(values.requestId, values.title, values.type, JSON.stringify(values.dates)));
        const link = db.prepare(
          'INSERT INTO event_batch_items (batch_request_id, event_id) VALUES (?, ?)',
        );
        const events = (await asyncMap(values.dates, async (date) => {
          const event = (await repository.createEvent({
            title: values.title,
            type: values.type,
            dates: [date],
            requestId: randomUUID(),
          }));
          (await link.run(values.requestId, event.id));
          return event;
        }));
        return events;
      }));
    },
    async updateEvent(id, input) {
      const values = validateEvent(input, { requireRequestId: false });
      checkRevision(input.revision);
      return (await db.transaction(async () => {
        (await db.prepare('SELECT id FROM scheduled_events WHERE id = ? FOR UPDATE').get(id));
        const current = (await getEvent(id));
        if (!current)
          throw new EventError(
            '找不到安排，可能已刪除，請重新載入清單',
            {},
            404,
            'EVENT_NOT_FOUND',
          );
        // A lost response can be retried without a second write if exactly this revision was saved.
        if (current.revision === input.revision + 1 && sameValues(current, values)) return current;
        if (current.revision !== input.revision) conflict();
        if (sameValues(current, values)) return current;
        (await db.prepare(
          'UPDATE scheduled_events SET title = ?, type = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
        ).run(values.title, values.type, new Date().toISOString(), id));
        (await db.prepare('DELETE FROM event_dates WHERE event_id = ?').run(id));
        const insertDate = db.prepare('INSERT INTO event_dates (event_id, date) VALUES (?, ?)');
        for (const date of values.dates) (await insertDate.run(id, date));
        return (await getEvent(id));
      }));
    },
    async deleteEvent(id, revision) {
      checkRevision(revision);
      return (await db.transaction(async () => {
        const current = (await db
          .prepare('SELECT revision, deleted_at FROM scheduled_events WHERE id = ? FOR UPDATE')
          .get(id));
        if (!current)
          throw new EventError('找不到安排，請重新載入清單', {}, 404, 'EVENT_NOT_FOUND');
        if (current.deleted_at && current.revision === revision + 1) return { id };
        if (current.revision !== revision) conflict();
        if (current.deleted_at)
          throw new EventError('此安排已刪除，請重新載入清單', {}, 410, 'EVENT_DELETED');
        const now = new Date().toISOString();
        (await db.prepare(
          'UPDATE scheduled_events SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
        ).run(now, now, id));
        return { id };
      }));
    },
  };
  return repository;
}
