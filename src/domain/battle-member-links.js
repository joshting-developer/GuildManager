// Only new, uniquely named roster entries may claim previously unlinked player rows.
export function uniqueNewMemberNames(allMembers, newMembers) {
  const names = new Map();
  for (const member of allMembers) {
    if (!names.has(member.name)) names.set(member.name, []);
    names.get(member.name).push(member.uid);
  }
  return new Map(
    newMembers
      .filter((member) => names.get(member.name)?.length === 1)
      .map((member) => [member.name, member.uid]),
  );
}
