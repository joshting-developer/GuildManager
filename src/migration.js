export const NEW_SITE_URL = 'https://guild-master.jylh.win/';
export const LEGACY_STOP_AT = Date.parse('2026-11-26T23:40:00+08:00');
export const NEW_SITE_OPEN_AT = Date.parse('2026-11-27T00:00:00+08:00');

export function migrationPhase(now = Date.now()) {
  if (now >= NEW_SITE_OPEN_AT) return 'open';
  return now >= LEGACY_STOP_AT ? 'moving' : 'legacy';
}

export function migrationCountdown(now = Date.now()) {
  const seconds = Math.max(0, Math.ceil((NEW_SITE_OPEN_AT - now) / 1000));
  const days = Math.floor(seconds / 86400);
  const time = [Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60]
    .map((value) => String(value).padStart(2, '0')).join(':');
  return days ? `${days} 天 ${time}` : time;
}
