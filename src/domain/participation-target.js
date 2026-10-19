// Scope optimistic concurrency to an identifiable person. Unknown/ambiguous
// manual names keep the legacy whole-form check and backend identity validation.
export function participationTarget(input, snapshot) {
  const name = input.name.trim().toLowerCase();
  const roster = new Map(snapshot.members.map((member) => [member.uid, member]));
  for (const row of snapshot.responses)
    if (!roster.has(row.uid)) roster.set(row.uid, { uid: row.uid, name: row.name, isInGuild: false, isInClub: false });
  const members = [...roster.values()].filter((member) =>
    member.name.toLowerCase() === name && (input.memberUid
      ? member.uid === input.memberUid && (member.isInGuild || member.isInClub)
      : input.status === 'registered' || member.isInGuild || member.isInClub ||
        snapshot.responses.some((row) => row.uid === member.uid && ['registered', 'leave'].includes(row.status))));
  const guests = input.memberUid ? [] : [
    ...snapshot.registrations, ...snapshot.registrationLeaves,
  ].filter((guest) => guest.name.toLowerCase() === name);
  if (members.length === 1 && !guests.length) {
    const member = members[0];
    return {
      kind: 'member', id: member.uid, name: member.name,
      isInGuild: !!member.isInGuild, isInClub: !!member.isInClub,
      revision: snapshot.responses.find((row) => row.uid === member.uid)?.revision || 0,
    };
  }
  if (!members.length && guests.length === 1) {
    const guest = guests[0];
    return { kind: 'registration', id: guest.id, name: guest.name, revision: guest.revision, active: !!guest.active };
  }
  return null;
}

export function validParticipationExpectation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== 2 ||
      !Number.isSafeInteger(value.eventRevision) || value.eventRevision < 1) return false;
  const person = value.person;
  if (!person || typeof person !== 'object' || Array.isArray(person) ||
      !['member', 'registration'].includes(person.kind)) return false;
  const keys = ['kind', 'id', 'name', 'revision',
    ...(person.kind === 'member' ? ['isInGuild', 'isInClub'] : ['active'])];
  return Object.keys(person).length === keys.length &&
    Object.keys(person).every((key) => keys.includes(key)) &&
    typeof person.id === 'string' && !!person.id && person.id.length <= 64 &&
    typeof person.name === 'string' && !!person.name && person.name.length <= 64 &&
    Number.isSafeInteger(person.revision) && person.revision >= (person.kind === 'member' ? 0 : 1) &&
    (person.kind === 'member'
      ? typeof person.isInGuild === 'boolean' && typeof person.isInClub === 'boolean'
      : typeof person.active === 'boolean');
}

export function sameParticipationTarget(left, right) {
  if (!left || !right) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}
