export const dropMemberUpdatedBy = {
  id: '0012_drop_member_updated_by',
  statements: [
    'ALTER TABLE members DROP COLUMN updated_by_account_id, DROP COLUMN updated_by_name',
  ],
};
