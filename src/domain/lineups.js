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
      })),
    })),
  );
}
export function eligibleMember(member, type) {
  return (
    type === 'scrimmage' ||
    (type === 'guild_war' && member.isInGuild) ||
    (type === 'dragon_tiger' && member.isInClub)
  );
}
export function editableLineup(teams) {
  return teams.map((team) => ({
    id: team.id,
    name: team.name,
    slots: team.slots.map((slot) => ({
      uid: slot.uid,
      profession: slot.profession,
      note: slot.note,
      dutyIds: [...(slot.dutyIds || [])],
    })),
  }));
}
// Moving to an occupied seat swaps assigned people, retaining notes on their seats.
export function placeMember(teams, uid, teamId, index) {
  const target = teams.find((team) => team.id === teamId)?.slots[index];
  if (!target || !uid) return;
  const source = teams.flatMap((team) => team.slots).find((slot) => slot.uid === uid);
  if (source === target) return;
  const displaced = { uid: target.uid, profession: target.profession };
  target.uid = uid;
  target.profession = source?.profession || 'primary';
  if (source) Object.assign(source, displaced);
}
