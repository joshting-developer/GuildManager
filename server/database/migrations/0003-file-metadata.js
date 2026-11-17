export const fileMetadata = {
  id: '0003_file_metadata',
  statements: [
    `CREATE TABLE file_metadata (
      id VARCHAR(64) PRIMARY KEY,
      bucket VARCHAR(63) NOT NULL,
      object_key VARCHAR(255) NOT NULL UNIQUE,
      name VARCHAR(160) NOT NULL,
      mime_type VARCHAR(64) NOT NULL,
      size_bytes INT UNSIGNED NOT NULL,
      sha256 CHAR(64) NOT NULL,
      created_at VARCHAR(32) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    'ALTER TABLE battle_records ADD COLUMN csv_file_id VARCHAR(64) NULL, ADD CONSTRAINT battle_records_csv_file_fk FOREIGN KEY (csv_file_id) REFERENCES file_metadata(id)',
    'ALTER TABLE battle_uploads ADD COLUMN image_file_id VARCHAR(64) NULL, ADD CONSTRAINT battle_uploads_image_file_fk FOREIGN KEY (image_file_id) REFERENCES file_metadata(id)',
    'ALTER TABLE platform_settings ADD COLUMN icon_file_id VARCHAR(64) NULL, ADD CONSTRAINT platform_settings_icon_file_fk FOREIGN KEY (icon_file_id) REFERENCES file_metadata(id)',
  ],
};
