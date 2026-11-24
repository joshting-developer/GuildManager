export const LAUNCH_AT = '2026-11-27T00:00:00+08:00';
export const LAUNCH_TIME = Date.parse(LAUNCH_AT);
export const PREVIEW_STORAGE_KEY = `guild-launch-preview:${LAUNCH_AT}`;
export const PREVIEW_SEQUENCE = 'jylhisme';

export function countdownParts(now) {
  const seconds = Math.max(0, Math.ceil((LAUNCH_TIME - now) / 1000));
  return [
    { label: '天', value: Math.floor(seconds / 86400) },
    { label: '時', value: Math.floor(seconds / 3600) % 24 },
    { label: '分', value: Math.floor(seconds / 60) % 60 },
    { label: '秒', value: seconds % 60 },
  ].map(part => ({ ...part, text: String(part.value).padStart(2, '0') }));
}

export function previewSequence(buffer, event) {
  if (event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return '';
  if (event.key.length !== 1) return '';
  const next = buffer + event.key.toLowerCase();
  for (let length = Math.min(next.length, PREVIEW_SEQUENCE.length); length > 0; length--) {
    const suffix = next.slice(-length);
    if (PREVIEW_SEQUENCE.startsWith(suffix)) return suffix;
  }
  return '';
}
