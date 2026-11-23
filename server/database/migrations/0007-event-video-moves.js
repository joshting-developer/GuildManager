export const eventVideoMoves = {
  id: '0007_event_video_moves',
  statements: [
    `CREATE TABLE event_video_move_requests (
      request_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      input_json LONGTEXT NOT NULL CHECK(JSON_VALID(input_json)),
      result_json LONGTEXT NOT NULL CHECK(JSON_VALID(result_json))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
  ],
};
