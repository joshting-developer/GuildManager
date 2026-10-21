import { eligibleMember, LINEUP_TYPES, participantKey } from './lineups.js';

export function lineupPeople(members, participation) {
  const responses = new Map(participation.responses.map((row) => [row.uid, row]));
  return [
    ...members.map((member) => {
      const response = responses.get(member.uid);
      return {
        ...member,
        isOnLeave: response?.status === 'leave',
        isRegistered: response?.status === 'registered',
        registrationNote: response?.note || '',
      };
    }),
    ...[
      ...participation.registrations.map((row) => ({ ...row, isOnLeave: false })),
      ...(participation.registrationLeaves || []).map((row) => ({ ...row, isOnLeave: true })),
    ].map((row) => ({
      uid: null,
      registrationId: row.id,
      name: row.name,
      primaryProfessionId: row.professionId,
      primaryProfession: row.profession,
      secondaryProfessionId: null,
      isInGuild: false,
      isInClub: false,
      isOnLeave: row.isOnLeave,
      registrationNote: row.note || '',
    })),
  ];
}

export function lineupSourceMembers(people, { type, tab, assigned = new Set() }) {
  if (!LINEUP_TYPES.includes(type)) return [];
  return people
    .filter((person) => {
      const inTab =
        tab === 'guild'
          ? person.isInGuild
          : tab === 'club'
            ? person.isInClub && !person.isInGuild
            : tab === 'external'
              ? Boolean(person.uid) && !person.isInGuild && !person.isInClub
              : Boolean(person.registrationId);
      // Leave remains visible even when an older draft still assigns this person.
      return (
        inTab &&
        (person.isOnLeave ||
          (eligibleMember(person, type) && !assigned.has(participantKey(person))))
      );
    })
    // 編外成員 who registered for this battle come first; leave always sinks to the bottom.
    .sort(
      (a, b) =>
        Number(a.isOnLeave) - Number(b.isOnLeave) ||
        (tab === 'external' ? Number(Boolean(b.isRegistered)) - Number(Boolean(a.isRegistered)) : 0),
    );
}
