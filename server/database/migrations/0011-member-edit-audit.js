export const memberEditAudit = {
  id: '0011_member_edit_audit',
  statements: [
    `ALTER TABLE members ADD COLUMN updated_by_account_id VARCHAR(64) NULL,
      ADD COLUMN updated_by_name VARCHAR(255) NULL`,
    `CREATE TABLE member_edit_logs (
      id VARCHAR(36) PRIMARY KEY,
      member_uid VARCHAR(64) NOT NULL,
      action VARCHAR(32) NOT NULL,
      actor_account_id VARCHAR(64) NULL,
      actor_name VARCHAR(255) NULL,
      source VARCHAR(64) NOT NULL,
      changes_json LONGTEXT NOT NULL,
      created_at VARCHAR(32) NOT NULL,
      INDEX member_edit_logs_member_created (member_uid, created_at, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  ],
};
