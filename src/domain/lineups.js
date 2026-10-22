export const LINEUP_GROUPS = [
  { id: 'attack', name: '進攻團', teams: ['塔前隊', '塔前拆／保鑣隊', '塔後隊'] },
  { id: 'mobile', name: '機動團', teams: ['塔前隊', '塔前拆／保鑣隊', '塔後隊'] },
  { id: 'defense', name: '防守團', teams: ['1 隊', '2 隊', '3 隊', '4 隊'] },
];
export const LINEUP_TYPES = ['scrimmage', 'guild_war', 'dragon_tiger'];
export function emptyLineup() {
  return LINEUP_GROUPS.flatMap((group) =>
    group.teams.map((name, index) => ({
      id: `${group.id}-${index + 1}`,
      name,
      slots: Array.from({ length: 6 }, () => ({
        uid: null,
        profession: 'primary',
        note: '',
        dutyIds: [],
        secondRound: null,
      })),
    })),
  );
}
// Every roster member — 幫會, 俱樂部 and 編外 alike — can be arranged without registering,
// unless on leave for this battle. 本場外援 (registrationId, no UID) exist only once registered.
export function eligibleMember(member, type) {
  return (
    LINEUP_TYPES.includes(type) &&
    !member.isOnLeave &&
    Boolean(member.uid || member.isInGuild || member.isInClub || member.registrationId)
  );
}
export function participantKey(person) {
  return person?.registrationId
    ? `registration:${person.registrationId}`
    : person?.uid
      ? `member:${person.uid}`
      : null;
}
export function participantReference(key, profession = 'primary') {
  return key?.startsWith('registration:')
    ? { uid: null, registrationId: key.slice(13), profession }
    : { uid: key?.startsWith('member:') ? key.slice(7) : key || null, profession };
}
export function editableLineup(teams) {
  return teams.map((team) => ({
    id: team.id,
    name: team.name,
    slots: team.slots.map((slot) => ({
      uid: slot.uid,
      ...(slot.registrationId ? { registrationId: slot.registrationId } : {}),
      profession: slot.profession,
      ...(slot.alias ? { alias: slot.alias } : {}),
      note: slot.note,
      dutyIds: [...(slot.dutyIds || [])],
      secondRound: slot.secondRound
        ? {
            uid: slot.secondRound.uid,
            ...(slot.secondRound.registrationId
              ? { registrationId: slot.secondRound.registrationId }
              : {}),
            profession: slot.secondRound.profession,
            ...(slot.secondRound.alias ? { alias: slot.secondRound.alias } : {}),
          }
        : null,
    })),
  }));
}
export function slotAssignments(slot) {
  return [slot, ...(slot.secondRound ? [slot.secondRound] : [])];
}
function assignment(slot, round) {
  return round === 2 ? slot.secondRound : slot;
}
// The nickname belongs to the person on this round, so it is replaced along with them.
function setAssignment(slot, round, person) {
  const { alias, ...reference } = person || {};
  const withAlias = alias && participantKey(reference) ? { ...reference, alias } : reference;
  if (round === 2) slot.secondRound = participantKey(reference) ? withAlias : null;
  else {
    delete slot.registrationId;
    delete slot.alias;
    Object.assign(slot, withAlias);
  }
}
// Explicit editing can swap assignments; duties and notes always stay on the position.
export function placeMember(teams, uid, teamId, index, round = 1) {
  const target = teams.find((team) => team.id === teamId)?.slots[index];
  if (!target || !uid || ![1, 2].includes(round)) return;
  const reference = participantReference(uid);
  const key = participantKey(reference);
  let source;
  for (const slot of teams.flatMap((team) => team.slots)) {
    for (const sourceRound of [1, 2]) {
      if (participantKey(assignment(slot, sourceRound)) === key)
        source = { slot, round: sourceRound };
    }
  }
  if (source?.slot === target && source.round === round) return;
  const previous = assignment(target, round);
  const displaced = {
    ...participantReference(participantKey(previous), previous?.profession || 'primary'),
    alias: previous?.alias,
  };
  const incoming = assignment(source?.slot || {}, source?.round);
  setAssignment(target, round, {
    ...reference,
    profession: incoming?.profession || 'primary',
    alias: incoming?.alias,
  });
  if (source) setAssignment(source.slot, source.round, displaced);
}
// Removing clears one round of a position (duties and notes stay) and returns what was there,
// so the page can offer undo; restoring only refills that round while it is still empty and the
// person has not been placed elsewhere in the meantime.
export function removeFromSlot(teams, teamId, index, round = 1) {
  const slot = teams.find((team) => team.id === teamId)?.slots[index];
  const current = slot && assignment(slot, round);
  const key = participantKey(current);
  if (!key) return null;
  const removed = {
    key,
    profession: current.profession || 'primary',
    ...(current.alias ? { alias: current.alias } : {}),
  };
  setAssignment(slot, round, participantReference(null));
  return removed;
}
export function restoreToSlot(teams, teamId, index, round, removed) {
  const slot = teams.find((team) => team.id === teamId)?.slots[index];
  if (!slot || !removed?.key || participantKey(assignment(slot, round))) return false;
  if (teams.some((team) => team.slots.some((other) => slotAssignments(other).some((person) => participantKey(person) === removed.key))))
    return false;
  setAssignment(slot, round, { ...participantReference(removed.key, removed.profession), alias: removed.alias });
  return true;
}
// Dragging adds the next round instead of replacing the person already on this position.
export function addMemberToSlot(teams, uid, teamId, index) {
  const target = teams.find((team) => team.id === teamId)?.slots[index];
  if (!target || !uid) return false;
  const key = participantKey(participantReference(uid));
  if (slotAssignments(target).some((person) => participantKey(person) === key)) return true;
  if (participantKey(target) && target.secondRound) return false;
  placeMember(teams, uid, teamId, index, participantKey(target) ? 2 : 1);
  return true;
}
