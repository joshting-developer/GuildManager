export const EVENT_TYPE_OPTIONS = [
  { title: '活動', value: 'activity' },
  { title: '約戰', value: 'scrimmage' },
  { title: '幫戰', value: 'guild_war' },
  { title: '龍虎戰', value: 'dragon_tiger' },
];
export function eventTypeLabel(type) {
  return EVENT_TYPE_OPTIONS.find((option) => option.value === type)?.title || '未知類型';
}
export function isBattleType(type) {
  return ['guild_war', 'dragon_tiger'].includes(type);
}
