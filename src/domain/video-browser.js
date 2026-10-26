import { isBattleEvent, orderBattleEvents } from './battle-events.js';
import { EventVideoError } from './event-videos.js';

export function videoBrowserSelection(source, preferredId = null) {
  if (preferredId !== null && (typeof preferredId !== 'string' || !preferredId.trim() ||
    preferredId.length > 128 || /[\u0000-\u001f\u007f]/.test(preferredId)))
    throw new EventVideoError('場次資料格式不正確，請重新選擇', 422, 'VIDEO_INVALID');
  const events = orderBattleEvents(source.filter(isBattleEvent), { prefer: 'recent' });
  const eventId = events.some(event => event.id === preferredId) ? preferredId : events[0]?.id || null;
  return { events, eventId };
}
