// Immutable initial schema; append changes as a new version. JSON text preserves original retry fingerprints.
// active_name folds ASCII only; url_hash indexes the complete legacy URL without prefix truncation.
export const initialSchema = {
  id: '0001_initial_schema',
  statements: [
    `CREATE TABLE \`auth_accounts\` (
      \`id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      \`username\` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL UNIQUE,
      \`password_salt\` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`password_hash\` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`created_at\` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`role\` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'manager' CHECK(role IN ('admin', 'manager', 'member')),
      \`revision\` BIGINT NOT NULL DEFAULT 1 CHECK(revision > 0),
      \`created_order\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`auth_sessions\` (
      \`token_hash\` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      \`account_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`expires_at\` BIGINT NOT NULL,
      CONSTRAINT \`auth_sessions_account_id_fk\` FOREIGN KEY (\`account_id\`) REFERENCES \`auth_accounts\` (\`id\`) ON DELETE CASCADE,
      KEY auth_sessions_expiry (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`battle_metadata_requests\` (
      \`request_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      \`input_hash\` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`result_json\` LONGTEXT NOT NULL CHECK(JSON_VALID(\`result_json\`))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`battle_sync_requests\` (
      \`request_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      \`input_hash\` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`result_json\` LONGTEXT NOT NULL CHECK(JSON_VALID(\`result_json\`))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`battle_uploads\` (
      \`id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      \`request_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
      \`input_hash\` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`image_name\` VARCHAR(255),
      \`image_type\` VARCHAR(255),
      \`image_data\` LONGBLOB,
      \`created_at\` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`duties\` (
      \`id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      \`name\` VARCHAR(64) NOT NULL UNIQUE,
      \`active\` TINYINT NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      \`revision\` BIGINT NOT NULL DEFAULT 1 CHECK(revision > 0),
      \`request_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin UNIQUE,
      \`original_name\` VARCHAR(255) NOT NULL,
      \`created_at\` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`updated_at\` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`created_order\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`event_batches\` (
      \`request_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      \`title\` VARCHAR(120) NOT NULL,
      \`type\` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL CHECK (type IN ('guild_war', 'dragon_tiger')),
      \`dates_json\` LONGTEXT NOT NULL CHECK(JSON_VALID(\`dates_json\`))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`event_video_profession_requests\` (
      \`request_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      \`input_json\` LONGTEXT NOT NULL CHECK(JSON_VALID(\`input_json\`)),
      \`result_json\` LONGTEXT NOT NULL CHECK(JSON_VALID(\`result_json\`))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`events\` (
      \`id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      \`title\` VARCHAR(120) NOT NULL,
      \`type\` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`starts_at\` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`registered\` BIGINT NOT NULL,
      \`capacity\` BIGINT NOT NULL,
      \`note\` TEXT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`home_settings\` (
      \`id\` TINYINT NOT NULL PRIMARY KEY CHECK (id = 1),
      \`guild_name\` VARCHAR(255) NOT NULL,
      \`member_count\` BIGINT NOT NULL,
      \`attendance_rate\` BIGINT,
      \`pending_registrations\` BIGINT NOT NULL,
      \`data_mode\` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL CHECK (data_mode IN ('demo', 'empty')),
      \`updated_at\` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`lineup_templates\` (
      \`id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      \`name\` VARCHAR(64) NOT NULL,
      \`request_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
      \`payload_json\` LONGTEXT NOT NULL CHECK(JSON_VALID(\`payload_json\`)),
      \`teams_json\` LONGTEXT NOT NULL CHECK(JSON_VALID(\`teams_json\`)),
      \`created_at\` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`created_order\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`lottery_boards\` (
      \`id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY CHECK (id = 'default'),
      \`board_json\` LONGTEXT NOT NULL CHECK(JSON_VALID(\`board_json\`)),
      \`revision\` BIGINT NOT NULL CHECK (revision >= 0),
      \`updated_at\` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`member_maintenance_requests\` (
      \`request_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      \`input_hash\` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`result_json\` LONGTEXT NOT NULL CHECK(JSON_VALID(\`result_json\`))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`member_reference_overrides\` (
      \`kind\` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`record_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`overrides_json\` LONGTEXT NOT NULL CHECK(JSON_VALID(\`overrides_json\`)),
      PRIMARY KEY(kind, record_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`member_uid_revisions\` (
      \`uid\` VARCHAR(64) NOT NULL PRIMARY KEY,
      \`revision\` BIGINT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`platform_settings\` (
      \`id\` TINYINT NOT NULL PRIMARY KEY CHECK (id = 1),
      \`name\` VARCHAR(64) NOT NULL,
      \`revision\` BIGINT NOT NULL CHECK (revision >= 1),
      \`icon_mime_type\` VARCHAR(255),
      \`icon_base64\` LONGTEXT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`professions\` (
      \`job_id\` INT NOT NULL PRIMARY KEY,
      \`colorcode\` VARCHAR(32) NOT NULL,
      \`name\` VARCHAR(64) NOT NULL UNIQUE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`members\` (
      \`uid\` VARCHAR(64) NOT NULL PRIMARY KEY,
      \`name\` VARCHAR(64) NOT NULL,
      \`primary_profession_id\` INT,
      \`secondary_profession_id\` INT,
      \`primary_profession\` VARCHAR(64) NOT NULL,
      \`secondary_profession\` VARCHAR(64) NOT NULL DEFAULT '',
      \`joined_at\` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`updated_at\` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`removed_at\` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin,
      \`revision\` BIGINT NOT NULL DEFAULT 1,
      \`is_in_guild\` TINYINT NOT NULL DEFAULT 1 CHECK (is_in_guild IN (0, 1)),
      \`is_in_club\` TINYINT NOT NULL DEFAULT 0 CHECK (is_in_club IN (0, 1)),
      CONSTRAINT \`members_secondary_profession_id_fk\` FOREIGN KEY (\`secondary_profession_id\`) REFERENCES \`professions\` (\`job_id\`),
      CONSTRAINT \`members_primary_profession_id_fk\` FOREIGN KEY (\`primary_profession_id\`) REFERENCES \`professions\` (\`job_id\`),
      KEY members_by_name (name, uid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`member_name_history\` (
      \`id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      \`member_uid\` VARCHAR(64) NOT NULL,
      \`name\` VARCHAR(64) NOT NULL,
      \`changed_at\` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`created_order\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
      CONSTRAINT \`member_name_history_member_uid_fk\` FOREIGN KEY (\`member_uid\`) REFERENCES \`members\` (\`uid\`),
      KEY history_by_uid (member_uid, changed_at, created_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`scheduled_events\` (
      \`id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      \`title\` VARCHAR(120) NOT NULL,
      \`type\` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL CHECK (type IN ('activity', 'scrimmage', 'guild_war', 'dragon_tiger')),
      \`request_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
      \`created_at\` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`revision\` BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
      \`updated_at\` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
      \`deleted_at\` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`battle_records\` (
      \`id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      \`upload_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`event_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
      \`event_snapshot_json\` LONGTEXT  CHECK(JSON_VALID(\`event_snapshot_json\`)),
      \`battle_type\` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`played_at\` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`red_team\` VARCHAR(255) NOT NULL,
      \`blue_team\` VARCHAR(255) NOT NULL,
      \`winner\` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin CHECK(winner IN ('red','blue')),
      \`filename\` VARCHAR(255) NOT NULL,
      \`csv_text\` LONGTEXT NOT NULL,
      \`players_json\` LONGTEXT NOT NULL CHECK(JSON_VALID(\`players_json\`)),
      \`content_hash\` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
      \`created_at\` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`round_number\` INT CHECK(round_number IN (1,2)),
      \`our_side\` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin CHECK(our_side IN ('red','blue')),
      \`is_internal\` TINYINT NOT NULL DEFAULT 0 CHECK(is_internal IN (0,1)),
      \`revision\` BIGINT NOT NULL DEFAULT 0 CHECK(revision >= 0),
      \`created_order\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
      CONSTRAINT \`battle_records_event_id_fk\` FOREIGN KEY (\`event_id\`) REFERENCES \`scheduled_events\` (\`id\`),
      CONSTRAINT \`battle_records_upload_id_fk\` FOREIGN KEY (\`upload_id\`) REFERENCES \`battle_uploads\` (\`id\`),
      KEY battle_records_by_date (played_at DESC, created_at DESC, id),
      UNIQUE KEY battle_records_by_event_round (event_id, round_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`battle_player_links\` (
      \`record_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`player_index\` INT NOT NULL CHECK(player_index >= 0),
      \`member_uid\` VARCHAR(64) NOT NULL,
      PRIMARY KEY (record_id, player_index),
      CONSTRAINT \`battle_player_links_member_uid_fk\` FOREIGN KEY (\`member_uid\`) REFERENCES \`members\` (\`uid\`),
      CONSTRAINT \`battle_player_links_record_id_fk\` FOREIGN KEY (\`record_id\`) REFERENCES \`battle_records\` (\`id\`),
      KEY battle_player_links_by_member (member_uid, record_id, player_index)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`event_batch_items\` (
      \`batch_request_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`event_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
      PRIMARY KEY (batch_request_id, event_id),
      CONSTRAINT \`event_batch_items_event_id_fk\` FOREIGN KEY (\`event_id\`) REFERENCES \`scheduled_events\` (\`id\`),
      CONSTRAINT \`event_batch_items_batch_request_id_fk\` FOREIGN KEY (\`batch_request_id\`) REFERENCES \`event_batches\` (\`request_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`event_dates\` (
      \`event_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`date\` DATE NOT NULL,
      PRIMARY KEY (event_id, date),
      CONSTRAINT \`event_dates_event_id_fk\` FOREIGN KEY (\`event_id\`) REFERENCES \`scheduled_events\` (\`id\`),
      KEY event_dates_by_date (date, event_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`event_member_responses\` (
      \`event_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`member_uid\` VARCHAR(64) NOT NULL,
      \`status\` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL CHECK(status IN ('registered', 'leave', 'none')),
      \`note\` TEXT NOT NULL,
      \`revision\` BIGINT NOT NULL CHECK(revision > 0),
      \`updated_at\` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`profession_id\` INT,
      PRIMARY KEY(event_id, member_uid),
      CONSTRAINT \`event_member_responses_profession_id_fk\` FOREIGN KEY (\`profession_id\`) REFERENCES \`professions\` (\`job_id\`),
      CONSTRAINT \`event_member_responses_member_uid_fk\` FOREIGN KEY (\`member_uid\`) REFERENCES \`members\` (\`uid\`),
      CONSTRAINT \`event_member_responses_event_id_fk\` FOREIGN KEY (\`event_id\`) REFERENCES \`scheduled_events\` (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`event_participation_requests\` (
      \`request_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      \`event_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`input_json\` LONGTEXT NOT NULL CHECK(JSON_VALID(\`input_json\`)),
      \`result_json\` LONGTEXT NOT NULL CHECK(JSON_VALID(\`result_json\`)),
      CONSTRAINT \`event_participation_requests_event_id_fk\` FOREIGN KEY (\`event_id\`) REFERENCES \`scheduled_events\` (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`event_registrations\` (
      \`id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      \`event_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`name\` VARCHAR(64) NOT NULL,
      \`profession_id\` INT NOT NULL,
      \`note\` TEXT NOT NULL,
      \`active\` TINYINT NOT NULL CHECK(active IN (0, 1)),
      \`revision\` BIGINT NOT NULL CHECK(revision > 0),
      \`request_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
      \`created_at\` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`updated_at\` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      CONSTRAINT \`event_registrations_profession_id_fk\` FOREIGN KEY (\`profession_id\`) REFERENCES \`professions\` (\`job_id\`),
      CONSTRAINT \`event_registrations_event_id_fk\` FOREIGN KEY (\`event_id\`) REFERENCES \`scheduled_events\` (\`id\`),
      \`active_name\` VARBINARY(256) GENERATED ALWAYS AS (CASE WHEN active = 1 THEN CAST(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(\`name\`, 'A', 'a'), 'B', 'b'), 'C', 'c'), 'D', 'd'), 'E', 'e'), 'F', 'f'), 'G', 'g'), 'H', 'h'), 'I', 'i'), 'J', 'j'), 'K', 'k'), 'L', 'l'), 'M', 'm'), 'N', 'n'), 'O', 'o'), 'P', 'p'), 'Q', 'q'), 'R', 'r'), 'S', 's'), 'T', 't'), 'U', 'u'), 'V', 'v'), 'W', 'w'), 'X', 'x'), 'Y', 'y'), 'Z', 'z') AS BINARY) ELSE NULL END) STORED,
      UNIQUE KEY active_registration_name (event_id, active_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`event_video_requests\` (
      \`request_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      \`event_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`input_json\` LONGTEXT NOT NULL CHECK(JSON_VALID(\`input_json\`)),
      \`result_json\` LONGTEXT NOT NULL CHECK(JSON_VALID(\`result_json\`)),
      CONSTRAINT \`event_video_requests_event_id_fk\` FOREIGN KEY (\`event_id\`) REFERENCES \`scheduled_events\` (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`event_video_submissions\` (
      \`id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      \`event_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`name\` VARCHAR(64) NOT NULL,
      \`first_url\` TEXT NOT NULL,
      \`second_url\` TEXT NOT NULL,
      \`note\` TEXT NOT NULL,
      \`created_at\` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`group_name\` VARCHAR(32) NOT NULL CHECK(group_name IN ('進攻一', '進攻二', '防守團')),
      \`profession_id\` INT,
      \`profession_name\` VARCHAR(64),
      \`profession_colorcode\` VARCHAR(32),
      \`revision\` BIGINT NOT NULL DEFAULT 0 CHECK(revision >= 0),
      CHECK(first_url <> '' OR second_url <> ''),
      CONSTRAINT \`event_video_submissions_profession_id_fk\` FOREIGN KEY (\`profession_id\`) REFERENCES \`professions\` (\`job_id\`),
      CONSTRAINT \`event_video_submissions_event_id_fk\` FOREIGN KEY (\`event_id\`) REFERENCES \`scheduled_events\` (\`id\`),
      KEY event_video_submissions_by_event (event_id, created_at, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`event_videos\` (
      \`id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      \`event_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`round_number\` INT NOT NULL CHECK(round_number IN (1, 2)),
      \`name\` VARCHAR(64) NOT NULL,
      \`url\` TEXT NOT NULL,
      \`group_name\` VARCHAR(32) NOT NULL CHECK(group_name IN ('進攻一', '進攻二', '防守團')),
      \`created_at\` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      CONSTRAINT \`event_videos_event_id_fk\` FOREIGN KEY (\`event_id\`) REFERENCES \`scheduled_events\` (\`id\`),
      \`url_hash\` BINARY(32) GENERATED ALWAYS AS (UNHEX(SHA2(url, 256))) STORED,
      UNIQUE KEY legacy_video_identity (event_id, round_number, name, url_hash, group_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`event_video_profession_overrides\` (
      \`video_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      \`profession_id\` INT NOT NULL,
      \`profession_name\` VARCHAR(64) NOT NULL,
      \`profession_colorcode\` VARCHAR(32) NOT NULL,
      \`revision\` BIGINT NOT NULL CHECK(revision >= 1),
      CONSTRAINT \`event_video_profession_overrides_profession_id_fk\` FOREIGN KEY (\`profession_id\`) REFERENCES \`professions\` (\`job_id\`),
      CONSTRAINT \`event_video_profession_overrides_video_id_fk\` FOREIGN KEY (\`video_id\`) REFERENCES \`event_videos\` (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE \`lineup_versions\` (
      \`id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      \`event_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`version\` BIGINT NOT NULL CHECK(version > 0),
      \`request_id\` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
      \`payload_json\` LONGTEXT NOT NULL CHECK(JSON_VALID(\`payload_json\`)),
      \`snapshot_json\` LONGTEXT NOT NULL CHECK(JSON_VALID(\`snapshot_json\`)),
      \`created_at\` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      UNIQUE(event_id, version),
      CONSTRAINT \`lineup_versions_event_id_fk\` FOREIGN KEY (\`event_id\`) REFERENCES \`scheduled_events\` (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `INSERT INTO professions (job_id, colorcode, name) VALUES (1, '#ffb6c1', '素問'), (2, '#3cb371', '龍吟'), (3, '#add8e6', '碎夢'), (4, '#00bfff', '潮光'), (5, '#f0e68c', '玄機'), (6, '#9932cc', '九靈'), (7, '#ff8c00', '鐵衣'), (8, '#8b0000', '血河'), (9, '#4682b4', '神相')`,
    `INSERT INTO duties (id, name, original_name, created_at, updated_at) VALUES ('duty-bodyguard', '保鑣', '保鑣', DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%dT%H:%i:%s.000Z'), DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%dT%H:%i:%s.000Z')), ('duty-mountain-oath', '山盟', '山盟', DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%dT%H:%i:%s.000Z'), DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%dT%H:%i:%s.000Z')), ('duty-aux-tide', '輔潮', '輔潮', DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%dT%H:%i:%s.000Z'), DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%dT%H:%i:%s.000Z'))`,
    `INSERT INTO home_settings (id, guild_name, member_count, attendance_rate, pending_registrations, data_mode, updated_at) VALUES (1, '你的幫會', 0, NULL, 0, 'empty', DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%dT%H:%i:%s.000Z'))`,
    `INSERT INTO platform_settings (id, name, revision) VALUES (1, '逆水寒', 1)`,
  ],
};
