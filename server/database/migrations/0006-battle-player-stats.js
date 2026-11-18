export const fillBattlePlayerStats = `INSERT IGNORE INTO battle_player_stats (record_id, player_index, player_json)
  SELECT r.id, p.position - 1, p.player FROM battle_records r
  JOIN JSON_TABLE(r.players_json, '$[*]' COLUMNS (position FOR ORDINALITY, player JSON PATH '$')) p`;

export const battlePlayerStats = {
  id: '0006_battle_player_stats',
  statements: [
    `CREATE TABLE battle_player_stats (
      record_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      player_index INT NOT NULL,
      player_json JSON NOT NULL,
      profession VARCHAR(120) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(player_json, '$.profession'))) STORED,
      PRIMARY KEY (record_id, player_index),
      CONSTRAINT battle_player_stats_record_fk FOREIGN KEY (record_id) REFERENCES battle_records(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    fillBattlePlayerStats,
  ],
};
