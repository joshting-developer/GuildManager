import { EventError } from '../../src/domain/event-validation.js';

// Battle pickers page by an opaque position instead of an offset, so any amount of history can be
// continued and each batch reads only the next rows of one date phase.
const PAGE_SIZE = 200;

export function choiceCursor(value) {
  if (value === undefined || value === '') return null;
  try {
    if (typeof value !== 'string' || value.length > 1024) throw new Error();
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (![0, 1].includes(cursor.phase) || !/^\d{4}-\d{2}-\d{2}$/.test(cursor.date) ||
        typeof cursor.title !== 'string' || cursor.title.length > 255 ||
        typeof cursor.id !== 'string' || !cursor.id || cursor.id.length > 128)
      throw new Error();
    return cursor;
  } catch {
    throw new EventError('場次分頁位置不正確，請重新載入');
  }
}

const encode = (row, phase) =>
  Buffer.from(JSON.stringify({ phase, date: row.date, title: row.title ?? '', id: row.id })).toString('base64url');
// Matches MySQL ORDER BY title, id on utf8mb4_bin / ascii_bin columns.
const binary = (a, b) => Buffer.compare(Buffer.from(a ?? ''), Buffer.from(b ?? ''));

// sources: ({ dates, keyset, direction, take }) => rows with id, title, date, already ordered by
// date (direction), title, id. dates(column) is the phase's date range from the cursor's date on;
// keyset(prefix) adds the exact position. phases: two { operator, direction } around `today`.
export async function choicePage(sources, phases, today, cursor) {
  const picked = [];
  for (let phase = cursor?.phase ?? 0; phase < phases.length && picked.length <= PAGE_SIZE; phase++) {
    const { operator, direction } = phases[phase];
    const after = direction === 'ASC' ? '>' : '<';
    const resume = cursor && cursor.phase === phase;
    const dates = (column) => ({
      sql: `${column} ${operator} ?${resume ? ` AND ${column} ${after}= ?` : ''}`,
      args: resume ? [today, cursor.date] : [today],
    });
    const keyset = (date, title, id) => resume
      ? { sql: ` AND (${date} ${after} ? OR (${date} = ? AND (COALESCE(${title}, '') > ? OR (COALESCE(${title}, '') = ? AND ${id} > ?))))`,
        args: [cursor.date, cursor.date, cursor.title, cursor.title, cursor.id] }
      : { sql: '', args: [] };
    const take = PAGE_SIZE + 1 - picked.length;
    const rows = (await Promise.all(sources.map((source) => source({ dates, keyset, direction, take })))).flat();
    rows.sort((a, b) => (direction === 'ASC' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)) ||
      binary(a.title, b.title) || binary(a.id, b.id));
    picked.push(...rows.slice(0, take).map((row) => ({ row, phase })));
  }
  const page = picked.slice(0, PAGE_SIZE);
  const hasMore = picked.length > PAGE_SIZE;
  return {
    rows: page.map(({ row }) => row),
    hasMore,
    nextCursor: hasMore ? encode(page.at(-1).row, page.at(-1).phase) : null,
  };
}

// Live battles: walk the date index to the date of the last row this batch can need, then read and
// order only the rows up to that date, so a batch costs about one page however long the history is.
export function liveBattleSource(db, columns) {
  const battle = "e.deleted_at IS NULL AND e.type IN ('scrimmage','guild_war','dragon_tiger')";
  return async ({ dates, keyset, direction, take }) => {
    const range = dates('d.date'), position = keyset('d.date', 'e.title', 'e.id');
    // Counted from the exact position, so at least `take` rows fall on or before this date.
    const edge = (await db.prepare(`SELECT d.date FROM event_dates d STRAIGHT_JOIN scheduled_events e ON e.id=d.event_id
      WHERE ${battle} AND ${range.sql}${position.sql} ORDER BY d.date ${direction} LIMIT 1 OFFSET ?`)
      .all(...range.args, ...position.args, take - 1))[0]?.date;
    const bound = edge ? ` AND d.date ${direction === 'ASC' ? '<=' : '>='} ?` : '';
    return db.prepare(`SELECT ${columns}, d.date FROM event_dates d STRAIGHT_JOIN scheduled_events e ON e.id=d.event_id
      WHERE ${battle} AND ${range.sql}${bound}${position.sql}
      ORDER BY d.date ${direction}, e.title, e.id LIMIT ?`).all(...range.args, ...(edge ? [edge] : []), ...position.args, take);
  };
}
