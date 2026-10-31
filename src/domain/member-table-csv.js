import { tableCsv } from './table-csv.js';

export function memberTableCsv(members) {
  return tableCsv(
    ['UID', '名稱', '主職業', '副職業', '幫派內', '俱樂部內', '過去名稱'],
    members.map((member) => [
      member.uid,
      member.name,
      member.primaryProfession,
      member.secondaryProfession,
      member.isInGuild ? '是' : '否',
      member.isInClub ? '是' : '否',
      member.previousNames.map((entry) => entry.name).join('\n'),
    ]),
  );
}
