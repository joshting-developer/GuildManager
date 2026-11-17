export const attendance = {
  id: '0005_attendance',
  statements: [
    `CREATE TABLE leave_settings (
      id INT PRIMARY KEY, threshold INT NOT NULL CHECK (threshold BETWEEN 0 AND 100),
      message VARCHAR(300) NOT NULL, revision BIGINT NOT NULL DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    "INSERT INTO leave_settings VALUES (1, 3, '最近辛苦了, 記得好好休息。有需要的話, 可以找幹部聊聊', 1)",
    `CREATE TABLE attendance_records (
      event_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      event_date DATE NOT NULL, member_uid VARCHAR(64) NOT NULL,
      member_name VARCHAR(64) NOT NULL, status VARCHAR(16) NOT NULL CHECK (status IN ('present','absent','unrecorded')),
      note VARCHAR(160) NOT NULL, revision BIGINT NOT NULL,
      actor_id VARCHAR(64) NOT NULL, updated_at VARCHAR(40) NOT NULL,
      PRIMARY KEY (event_id,event_date,member_uid), KEY attendance_by_member (member_uid,event_date,event_id),
      CONSTRAINT attendance_event_fk FOREIGN KEY(event_id) REFERENCES scheduled_events(id),
      CONSTRAINT attendance_member_fk FOREIGN KEY(member_uid) REFERENCES members(uid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE attendance_requests (
      request_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      actor_id VARCHAR(64) NOT NULL, input_hash CHAR(64) NOT NULL, result_json TEXT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    'CREATE INDEX responses_by_member_status ON event_member_responses(member_uid,status,event_id)',
  ],
};
