// Column lists avoid repeating the same field names in every complete-history row.
export function packPersonalBattles(data) {
  const entryColumns = ['recordId', 'playerIndex', 'type', 'playedAt', 'roundNumber', 'redTeam', 'blueTeam', 'winner', 'isInternal'];
  const playerColumns = [...new Set(data.entries.flatMap(entry => Object.keys(entry.player)))];
  return { ...data, entryColumns, playerColumns,
    entries: data.entries.map(entry => [
      ...entryColumns.map(key => entry[key]), ...playerColumns.map(key => entry.player[key] ?? null),
    ]),
  };
}

export function unpackPersonalBattles(data) {
  if (!data.entryColumns) return data;
  const { entryColumns, playerColumns, ...rest } = data;
  return { ...rest, entries: data.entries.map(row => ({
    ...Object.fromEntries(entryColumns.map((key, index) => [key, row[index]])),
    player: Object.fromEntries(playerColumns.map((key, index) => [key, row[entryColumns.length + index]])),
  })) };
}
