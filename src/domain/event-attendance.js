// Attendance means explicit responses, rather than every eligible lineup member.
export function eventAttendance(participation) {
  const row =
    (source) =>
    ({ uid, id, revision, name, profession, colorcode, note }) => ({
      source,
      id: source === 'member' ? uid : id,
      revision,
      name,
      profession,
      colorcode,
      note,
    });
  const byName = (a, b) => a.name.localeCompare(b.name, 'zh-TW');
  return {
    eventId: participation.eventId,
    leave: [
      ...participation.responses.filter((item) => item.status === 'leave').map(row('member')),
      ...participation.registrationLeaves.map(row('registration')),
    ].sort(byName),
    registered: [
      ...participation.responses.filter((item) => item.status === 'registered').map(row('member')),
      ...participation.registrations.map(row('registration')),
    ].sort(byName),
  };
}
