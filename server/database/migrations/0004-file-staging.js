export const fileStaging = {
  id: '0004_file_staging',
  statements: [
    'CREATE INDEX file_metadata_cleanup ON file_metadata (bucket,created_at,id)',
    `CREATE TABLE file_staging (
      id VARCHAR(64) PRIMARY KEY,
      bucket VARCHAR(63) NOT NULL,
      object_key VARCHAR(255) NOT NULL UNIQUE,
      state VARCHAR(16) NOT NULL,
      expires_at BIGINT NOT NULL,
      INDEX file_staging_expiry (bucket,state,expires_at,id),
      CHECK (state IN ('uploading','ready','deleting'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  ],
};
