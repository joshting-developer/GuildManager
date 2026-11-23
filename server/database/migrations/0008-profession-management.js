export const professionManagement = {
  id: '0008_profession_management',
  statements: [
    `ALTER TABLE professions
      ADD COLUMN revision INT NOT NULL DEFAULT 1,
      ADD COLUMN request_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL UNIQUE,
      ADD COLUMN original_input TEXT NULL`,
  ],
};
