export const inNameSource = (member, source) =>
  source === 'guild' ? !!member.isInGuild : source === 'club' && !!member.isInClub;

export const hasProfession = (member, professionId) =>
  professionId != null &&
  (member.primaryProfessionId === professionId || member.secondaryProfessionId === professionId);

// Members in the chosen roster whose primary or secondary profession matches, once per UID.
export function memberChoices(members, source, professionId) {
  const seen = new Set();
  return members.filter((member) => {
    if (seen.has(member.uid) || !inNameSource(member, source) || !hasProfession(member, professionId))
      return false;
    seen.add(member.uid);
    return true;
  });
}
