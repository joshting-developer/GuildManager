export const discordSettings = {
  id: '0010_discord_settings',
  statements: [
    `CREATE TABLE discord_settings (
      channel VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      url VARCHAR(256) CHARACTER SET ascii COLLATE ascii_bin NULL,
      revision INT UNSIGNED NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    "INSERT INTO discord_settings (channel) VALUES ('leave'), ('member')",
  ],
};
