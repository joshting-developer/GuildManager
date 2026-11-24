import { LineupError, lineupText } from './lineup-validation.js';

export function emptyLineupOb() {
  return { enabled: 'off', attackMode: 'single', defenseMode: 'single', attack: '', mobile: '', defense12: '', defense34: '' };
}
export function validateLineupOb(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !Object.hasOwn(emptyLineupOb(), key)) ||
      !['on', 'off'].includes(input.enabled) ||
      !['single', 'double'].includes(input.attackMode) || !['single', 'double'].includes(input.defenseMode))
    throw new LineupError('OB 設定格式不正確, 請重新確認');
  return { enabled: input.enabled, attackMode: input.attackMode, defenseMode: input.defenseMode,
    ...Object.fromEntries(['attack', 'mobile', 'defense12', 'defense34'].map(key => [key, lineupText(input[key], 'OB 名稱', 64)])) };
}
export function lineupObRows(ob = emptyLineupOb()) {
  if (ob.enabled !== 'on') return [];
  return [
    [{ label: '進攻', name: ob.attack }, ...(ob.attackMode === 'double' ? [{ label: '機動', name: ob.mobile }] : [])],
    [{ label: ob.defenseMode === 'double' ? '防守12' : '防守', name: ob.defense12 }, ...(ob.defenseMode === 'double' ? [{ label: '防守34', name: ob.defense34 }] : [])],
  ];
}
