import { defaultBattleEventId } from './battle-events.js';
import { lineupText } from './lineup-validation.js';

export function lineupEditorEventId(events, preferredId) {
  if (preferredId != null) lineupText(preferredId, '場次', 128, true);
  return events.some(event => event.id === preferredId)
    ? preferredId : defaultBattleEventId(events, { prefer: 'upcoming' });
}

// The lineup page opens on the nearest upcoming battle. Returning that battle's saved
// versions and sign-ups with the index saves a second ~2 s cloud round trip on page load.
export function withDefaultLineupEvent(index, { history, participation, today } = {}) {
  const eventId = defaultBattleEventId(index.events, { prefer: 'upcoming', ...(today ? { today } : {}) });
  if (!eventId) return { ...index, selected: null };
  const archived = index.events.find((event) => event.id === eventId)?.archived;
  return {
    ...index,
    selected: {
      eventId,
      versions: history(eventId),
      participation: archived ? null : participation(eventId),
    },
  };
}
