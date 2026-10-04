import { emptyLineup, participantKey } from './lineups.js';

export class LineupError extends Error {
  constructor(message, status = 422, code = 'LINEUP_INVALID') {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = {};
  }
}
export function lineupText(value, label, max, required = false) {
  if (
    typeof value !== 'string' ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    value.length > max ||
    (required && !value.trim())
  ) {
    throw new LineupError(`${label}格式不正確，長度最多 ${max} 字`);
  }
  return value.trim();
}
export function validateLineupRequestId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value))
    throw new LineupError('缺少有效的操作識別碼，請重新操作');
  return value;
}
export function validateLineup(teams) {
  const layout = emptyLineup();
  if (!Array.isArray(teams) || teams.length !== layout.length)
    throw new LineupError('排表需要十隊，每隊六個位置');
  const seen = new Set();
  return layout.map((defaultTeam, teamIndex) => {
    const team = teams[teamIndex];
    if (team?.id !== defaultTeam.id || !Array.isArray(team.slots) || team.slots.length !== 6)
      throw new LineupError('排表位置格式不正確');
    return {
      id: team.id,
      name: lineupText(team.name, '隊名', 40, true),
      slots: team.slots.map((slot) => {
        function validateAssignment(person, allowEmpty = false) {
          const registrationId = person?.registrationId ?? null;
          if (
            !person ||
            (person.uid !== null &&
              (typeof person.uid !== 'string' || !person.uid || person.uid.length > 64)) ||
            (registrationId !== null &&
              (typeof registrationId !== 'string' ||
                !/^[a-zA-Z0-9_-]{1,64}$/.test(registrationId))) ||
            (person.uid !== null && registrationId !== null) ||
            (!allowEmpty && !person.uid && !registrationId)
          )
            throw new LineupError('人員資料格式不正確, 請重新選擇');
          if (!['primary', 'secondary'].includes(person.profession))
            throw new LineupError('請選擇主職業或副職業');
          const identity = participantKey(person);
          if (identity) {
            if (seen.has(identity))
              throw new LineupError(
                '同一位人員在這份排表中重複, 請調整安排',
                422,
                'DUPLICATE_LINEUP_UID',
              );
            seen.add(identity);
          }
          return {
            uid: person.uid,
            ...(registrationId ? { registrationId } : {}),
            profession: person.profession,
          };
        }
        const first = validateAssignment(slot, true);
        const secondRound = slot.secondRound == null ? null : validateAssignment(slot.secondRound);
        const dutyIds = slot.dutyIds === undefined ? [] : slot.dutyIds;
        if (
          !Array.isArray(dutyIds) ||
          dutyIds.some((id) => typeof id !== 'string' || !id || id.length > 64) ||
          new Set(dutyIds).size !== dutyIds.length
        )
          throw new LineupError('職責 ID 格式不正確或同一位置重複分配職責');
        return {
          ...first,
          secondRound,
          note: lineupText(slot.note, '任務備註', 160),
          dutyIds: [...dutyIds],
        };
      }),
    };
  });
}
