import { eventTypeLabel } from './event-types.js';

// Shared by 戰場排表／上傳數據／影片閱覽 so every battle picker lists, labels and
// pre-selects sessions the same way. Sessions carry dates only; times live in titles.
export const BATTLE_EVENT_TYPES = ['scrimmage', 'guild_war', 'dragon_tiger'];
const WEEKDAYS = '日一二三四五六';

export function isBattleEvent(event) {
  return BATTLE_EVENT_TYPES.includes(event?.type);
}

// The guild plays on Taipei time, whatever the viewer's device clock zone is.
export function taipeiToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(now);
}

export function isPastBattleEvent(event, today = taipeiToday()) {
  return isBattleEvent(event) && Array.isArray(event.dates) && event.dates.length > 0 &&
    event.dates.every(date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && date < today);
}

function weekday(date) {
  const [year, month, day] = date.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

// e.g. 10/22（四）· 約戰 · 21：00 楓橋；sessions from other years keep the year.
export function battleEventLabel(event, today = taipeiToday()) {
  const date = event.dates[0];
  const [year, month, day] = date.split('-');
  const shown = `${year === today.slice(0, 4) ? '' : `${year}/`}${month}/${day}`;
  return `${shown}（${weekday(date)}）· ${eventTypeLabel(event.type)}${
    event.title ? ` · ${event.title}` : ''
  }`;
}

// prefer 'upcoming': today and later first (soonest on top), then past (latest first).
// prefer 'recent':   today and earlier first (latest on top), then future (soonest first).
export function orderBattleEvents(events, { prefer = 'upcoming', today = taipeiToday() } = {}) {
  const tie = (a, b) => (a.title || '').localeCompare(b.title || '') || a.id.localeCompare(b.id);
  const ascending = (a, b) => a.dates[0].localeCompare(b.dates[0]) || tie(a, b);
  const descending = (a, b) => b.dates[0].localeCompare(a.dates[0]) || tie(a, b);
  const first =
    prefer === 'recent'
      ? (event) => event.dates[0] <= today
      : (event) => event.dates[0] >= today;
  const [near, far] = [events.filter(first), events.filter((event) => !first(event))];
  return prefer === 'recent'
    ? [...near.sort(descending), ...far.sort(ascending)]
    : [...near.sort(ascending), ...far.sort(descending)];
}

export function defaultBattleEventId(events, options) {
  return orderBattleEvents(events, options)[0]?.id ?? null;
}
