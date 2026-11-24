export const lineupOb = {
  id: '0009_lineup_ob',
  statements: [
    `CREATE TABLE event_lineup_ob (
      id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      event_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
      enabled VARCHAR(3) NOT NULL,
      attack_mode VARCHAR(6) NOT NULL,
      defense_mode VARCHAR(6) NOT NULL,
      attack VARCHAR(64) NOT NULL,
      mobile VARCHAR(64) NOT NULL,
      defense12 VARCHAR(64) NOT NULL,
      defense34 VARCHAR(64) NOT NULL,
      FOREIGN KEY (event_id) REFERENCES scheduled_events(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  ],
};
