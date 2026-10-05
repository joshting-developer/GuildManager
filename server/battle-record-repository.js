import { createHash, randomUUID } from 'node:crypto';
import {
  BattleRecordError,
  parseBattleCsv,
  taipeiBattleTime,
  MAX_IMAGE_BYTES,
} from '../src/domain/battle-records.js';
import { summarizePersonalBattles } from '../src/domain/personal-battle-statistics.js';
import { uniqueNewMemberNames } from '../src/domain/battle-member-links.js';
import { planBattleMemberSync, publicBattleSyncPlan, validateBattleSyncInput } from '../src/domain/battle-member-sync.js';
import { validateBattleMetadata } from '../src/domain/battle-metadata.js';
import {
  validatePersonalBattleFilters,
  filterPersonalBattles,
  personalBattleProfessions,
} from '../src/domain/personal-battle-filters.js';

function text(value, label, limit = 120) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > limit ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new BattleRecordError(`${label}須為 1–${limit} 字`);
  return value.trim();
}
function imageAttachment(input) {
  if (input == null) return null;
  const name = text(input.name, '圖片檔名', 160);
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(input.mimeType) ||
    typeof input.base64 !== 'string' ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64)
  )
    throw new BattleRecordError('陣容圖片只支援 PNG、JPEG、WebP');
  const bytes = Buffer.from(input.base64, 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES)
    throw new BattleRecordError('陣容圖片不可為空或超過 4 MB');
  const valid =
    input.mimeType === 'image/png'
      ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : input.mimeType === 'image/jpeg'
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!valid) throw new BattleRecordError('圖片內容與格式不符');
  return { name, mimeType: input.mimeType, bytes };
}
export function createBattleRecordRepository(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS battle_uploads (
      id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, input_hash TEXT NOT NULL,
      image_name TEXT, image_type TEXT, image_data BLOB, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS battle_records (
      id TEXT PRIMARY KEY, upload_id TEXT NOT NULL REFERENCES battle_uploads(id),
      event_id TEXT REFERENCES scheduled_events(id), event_snapshot_json TEXT,
      battle_type TEXT NOT NULL, played_at TEXT NOT NULL, red_team TEXT NOT NULL,
      blue_team TEXT NOT NULL, winner TEXT CHECK(winner IN ('red','blue')),
      filename TEXT NOT NULL, csv_text TEXT NOT NULL, players_json TEXT NOT NULL,
      content_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS battle_records_by_date ON battle_records(played_at DESC);
  `);
  // Existing uploads have no reliable round information; keep their original values intact.
  if (!db.pragma('table_info(battle_records)').some((column) => column.name === 'round_number'))
    db.exec(
      'ALTER TABLE battle_records ADD COLUMN round_number INTEGER CHECK(round_number IN (1,2))',
    );
  if (!db.pragma('table_info(battle_records)').some((column) => column.name === 'our_side'))
    db.exec(
      "ALTER TABLE battle_records ADD COLUMN our_side TEXT CHECK(our_side IN ('red','blue'))",
    );
  if (!db.pragma('table_info(battle_records)').some((column) => column.name === 'is_internal'))
    db.exec(
      'ALTER TABLE battle_records ADD COLUMN is_internal INTEGER NOT NULL DEFAULT 0 CHECK(is_internal IN (0,1))',
    );
  if (!db.pragma('table_info(battle_records)').some((column) => column.name === 'revision'))
    db.exec(
      'ALTER TABLE battle_records ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0)',
    );
  if (db.pragma('table_info(battle_records)').find((column) => column.name === 'winner').notnull) {
    // SQLite cannot remove NOT NULL with ALTER COLUMN; copy every column in one transaction.
    db.transaction(() => {
      const schema = db
        .prepare("SELECT sql FROM sqlite_master WHERE name='battle_records'")
        .get().sql;
      const columns = db
        .pragma('table_info(battle_records)')
        .map((column) => column.name)
        .join(',');
      db.exec(
        schema
          .replace(
            /^CREATE TABLE (?:"battle_records"|battle_records)/,
            'CREATE TABLE battle_records_optional',
          )
          .replace('winner TEXT NOT NULL', 'winner TEXT'),
      );
      db.exec(`INSERT INTO battle_records_optional (${columns}) SELECT ${columns} FROM battle_records ORDER BY rowid;
        DROP TABLE battle_records; ALTER TABLE battle_records_optional RENAME TO battle_records;
        CREATE INDEX battle_records_by_date ON battle_records(played_at DESC);`);
    })();
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS battle_records_by_event_round
    ON battle_records(event_id,round_number) WHERE round_number IS NOT NULL`);
  // Keep the immutable CSV/player snapshots and existing retry hashes unchanged.
  db.exec(`
    CREATE TABLE IF NOT EXISTS battle_metadata_requests (
      request_id TEXT PRIMARY KEY, input_hash TEXT NOT NULL, result_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS battle_player_links (
      record_id TEXT NOT NULL REFERENCES battle_records(id),
      player_index INTEGER NOT NULL CHECK(player_index >= 0),
      member_uid TEXT NOT NULL REFERENCES members(uid),
      PRIMARY KEY (record_id, player_index)
    );
    CREATE INDEX IF NOT EXISTS battle_player_links_by_member ON battle_player_links(member_uid, record_id);
    CREATE TABLE IF NOT EXISTS battle_sync_requests (
      request_id TEXT PRIMARY KEY, input_hash TEXT NOT NULL, result_json TEXT NOT NULL
    );
  `);
  function syncPlan() {
    return planBattleMemberSync(
      db.prepare('SELECT uid, name FROM members').all(),
      db.prepare('SELECT member_uid AS uid, name FROM member_name_history').all(),
      db.prepare('SELECT id, players_json FROM battle_records').all().map(row => ({
        id: row.id, players: JSON.parse(row.players_json),
      })),
      db.prepare('SELECT record_id AS recordId, player_index AS playerIndex FROM battle_player_links').all(),
    );
  }
  const syncFingerprint = plan => createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  function get(id) {
    const row = db
      .prepare(
        `SELECT r.*, u.image_name,u.image_type FROM battle_records r JOIN battle_uploads u ON u.id=r.upload_id WHERE r.id=?`,
      )
      .get(id);
    if (!row) throw new BattleRecordError('找不到這筆戰績', 404, 'BATTLE_NOT_FOUND');
    const players = JSON.parse(row.players_json);
    for (const link of db
      .prepare('SELECT player_index, member_uid FROM battle_player_links WHERE record_id = ?')
      .all(id)) {
      if (players[link.player_index]) players[link.player_index].memberUid = link.member_uid;
    }
    return {
      id: row.id,
      eventId: row.event_id,
      roundNumber: row.round_number,
      event: row.event_snapshot_json ? JSON.parse(row.event_snapshot_json) : null,
      type: row.battle_type,
      playedAt: row.played_at,
      redTeam: row.red_team,
      blueTeam: row.blue_team,
      winner: row.winner,
      ourSide: row.our_side,
      isInternal: Boolean(row.is_internal),
      revision: row.revision,
      filename: row.filename,
      createdAt: row.created_at,
      redCount: players.filter((p) => p.side === 'red').length,
      blueCount: players.filter((p) => p.side === 'blue').length,
      image: row.image_name ? { name: row.image_name, mimeType: row.image_type } : null,
      players,
    };
  }
  return {
    previewBattleMemberSync() {
      return db.transaction(() => {
        const plan = syncPlan();
        return { ...publicBattleSyncPlan(plan), fingerprint: syncFingerprint(plan) };
      })();
    },
    syncBattleMembers(input) {
      const values = validateBattleSyncInput(input);
      return db.transaction(() => {
        const previous = db.prepare('SELECT * FROM battle_sync_requests WHERE request_id=?').get(values.requestId);
        if (previous) {
          if (previous.input_hash !== values.fingerprint)
            throw new BattleRecordError('此操作已用於不同資料，請重新預覽', 409, 'REQUEST_CONFLICT');
          return JSON.parse(previous.result_json);
        }
        const plan = syncPlan();
        if (syncFingerprint(plan) !== values.fingerprint)
          throw new BattleRecordError('成員或戰績資料已變動，請重新預覽後同步', 409, 'STALE_SYNC_PREVIEW');
        const insert = db.prepare('INSERT INTO battle_player_links (record_id, player_index, member_uid) VALUES (?, ?, ?)');
        for (const row of plan.assignments) insert.run(row.recordId, row.playerIndex, row.memberUid);
        const result = { ...publicBattleSyncPlan(plan), linkedPlayers: plan.assignments.length };
        db.prepare('INSERT INTO battle_sync_requests VALUES (?, ?, ?)').run(values.requestId, values.fingerprint, JSON.stringify(result));
        return result;
      })();
    },
    listBattleRecords({ page = 1, eventId = null } = {}) {
      if (!Number.isSafeInteger(page) || page < 1) throw new BattleRecordError('頁碼不正確');
      const where = eventId == null ? '' : ' WHERE event_id=? AND round_number IS NOT NULL';
      const args = eventId == null ? [] : [text(eventId, '場次', 64)];
      const total = db
        .prepare(`SELECT COUNT(*) AS total FROM battle_records${where}`)
        .get(...args).total;
      const records = db
        .prepare(
          `SELECT id FROM battle_records${where} ORDER BY played_at DESC, created_at DESC, id LIMIT 20 OFFSET ?`,
        )
        .all(...args, (page - 1) * 20)
        .map((row) => {
          const { players, ...record } = get(row.id);
          return record;
        });
      return { records, total, page, pageSize: 20 };
    },
    getBattleRecord: get,
    updateBattleRecord(id, input) {
      return db.transaction(() => {
        const current = get(id);
        const values = validateBattleMetadata(input, current.type);
        const fingerprint = createHash('sha256')
          .update(JSON.stringify([id, input.revision, values]))
          .digest('hex');
        const previous = db
          .prepare('SELECT * FROM battle_metadata_requests WHERE request_id = ?')
          .get(input.requestId);
        if (previous) {
          if (previous.input_hash !== fingerprint)
            throw new BattleRecordError(
              '此操作已用於不同資料，請重新送出',
              409,
              'REQUEST_CONFLICT',
            );
          return JSON.parse(previous.result_json);
        }
        if (current.revision !== input.revision)
          throw new BattleRecordError(
            '對戰資訊已更新，請重新載入後再儲存',
            409,
            'REVISION_CONFLICT',
          );
        db.prepare(
          'UPDATE battle_records SET red_team = ?, blue_team = ?, winner = ?, our_side = ?, is_internal = ?, revision = revision + 1 WHERE id = ?',
        ).run(
          values.redTeam,
          values.blueTeam,
          values.winner,
          values.ourSide,
          values.isInternal ? 1 : 0,
          id,
        );
        const { players, ...record } = get(id);
        const result = { record };
        db.prepare(
          'INSERT INTO battle_metadata_requests (request_id, input_hash, result_json) VALUES (?, ?, ?)',
        ).run(input.requestId, fingerprint, JSON.stringify(result));
        return result;
      })();
    },
    backfillMemberBattleRecords(newMembers) {
      const names = uniqueNewMemberNames(
        db.prepare('SELECT uid, name FROM members').all(),
        newMembers,
      );
      const insert =
        db.prepare(`INSERT INTO battle_player_links (record_id, player_index, member_uid)
        SELECT r.id, CAST(p.key AS INTEGER), ? FROM battle_records r, json_each(r.players_json) p
        LEFT JOIN battle_player_links l ON l.record_id = r.id AND l.player_index = CAST(p.key AS INTEGER)
        WHERE json_extract(p.value, '$.player') = ? AND l.record_id IS NULL
        AND json_extract(p.value, '$.memberUid') IS NULL`);
      for (const [name, uid] of names) insert.run(uid, name);
    },
    getMemberBattleRecords(uid, { page = 1, ...input } = {}) {
      if (!Number.isSafeInteger(page) || page < 1) throw new BattleRecordError('頁碼不正確');
      const filters = validatePersonalBattleFilters(input);
      const memberUid = text(uid, '成員', 64);
      const member = db
        .prepare('SELECT name, primary_profession AS profession FROM members WHERE uid = ?')
        .get(memberUid);
      if (!member) throw new BattleRecordError('找不到這位成員', 404, 'MEMBER_NOT_FOUND');
      const links = db
        .prepare(
          `SELECT l.player_index, r.id, r.battle_type, r.played_at, r.round_number,
        r.red_team, r.blue_team, r.winner, r.is_internal,
        json_extract(r.players_json, '$[' || l.player_index || ']') AS player_json
        FROM battle_player_links l JOIN battle_records r ON r.id = l.record_id
        WHERE l.member_uid = ? ORDER BY r.played_at DESC, r.created_at DESC, r.id, l.player_index`,
        )
        .all(memberUid);
      const allEntries = links.map((row) => ({
        recordId: row.id,
        playerIndex: row.player_index,
        type: row.battle_type,
        playedAt: row.played_at,
        roundNumber: row.round_number,
        redTeam: row.red_team,
        blueTeam: row.blue_team,
        winner: row.winner,
        isInternal: Boolean(row.is_internal),
        player: JSON.parse(row.player_json),
      }));
      const entries = filterPersonalBattles(allEntries, filters);
      return {
        member,
        filters,
        professions: personalBattleProfessions(allEntries),
        summary: summarizePersonalBattles(entries),
        entries: entries.slice((page - 1) * 20, page * 20),
        total: entries.length,
        page,
        pageSize: 20,
      };
    },
    saveBattleRecords(input) {
      if (
        !input ||
        typeof input.requestId !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,64}$/.test(input.requestId)
      )
        throw new BattleRecordError('操作識別碼不正確, 請重新送出');
      if (!Array.isArray(input.records) || input.records.length < 1 || input.records.length > 2)
        throw new BattleRecordError('每次請上傳 1–2 個 CSV');
      const image = imageAttachment(input.image);
      const records = input.records.map((record) => {
        if (!record || !['scrimmage', 'guild_war', 'dragon_tiger'].includes(record.type))
          throw new BattleRecordError('請選擇戰鬥類型');
        if (record.isInternal !== undefined && typeof record.isInternal !== 'boolean')
          throw new BattleRecordError('是否為內推須為是／否');
        if (record.isInternal && record.type !== 'scrimmage')
          throw new BattleRecordError('只有約戰可以設定內推');
        if (record.isInternal && (record.winner || record.ourSide))
          throw new BattleRecordError('內推不指定敵我與勝方, 請清除後再送出');
        const filename = text(record.filename, 'CSV 檔名', 160);
        if (!/\.csv$/i.test(filename)) throw new BattleRecordError('只能上傳 CSV 檔案');
        if (
          record.eventId != null &&
          (typeof record.eventId !== 'string' || record.eventId.length > 64)
        )
          throw new BattleRecordError('場次格式不正確');
        if (
          record.winner != null &&
          record.winner !== '' &&
          !['red', 'blue'].includes(record.winner)
        )
          throw new BattleRecordError('獲勝方只能選擇紅方或藍方, 也可留空');
        if (
          record.ourSide != null &&
          record.ourSide !== '' &&
          !['red', 'blue'].includes(record.ourSide)
        )
          throw new BattleRecordError('我方只能選擇紅方或藍方, 也可留空');
        if (
          record.roundNumber !== undefined &&
          (!record.eventId ||
            !Number.isInteger(record.roundNumber) ||
            record.roundNumber < 1 ||
            record.roundNumber > (record.type === 'dragon_tiger' ? 1 : 2))
        )
          throw new BattleRecordError('約戰與幫戰只能第一場／第二場, 龍虎戰只有一場且需關聯活動');
        const parsed = parseBattleCsv(record.csvText);
        return {
          eventId: record.eventId || null,
          type: record.type,
          playedAt: taipeiBattleTime(record.datetime),
          redTeam: text(record.redTeam, '紅方名稱'),
          blueTeam: text(record.blueTeam, '藍方名稱'),
          winner: record.winner || null,
          filename,
          csvText: record.csvText,
          players: parsed.players,
          ...(record.roundNumber !== undefined ? { roundNumber: record.roundNumber } : {}),
          ...(record.ourSide ? { ourSide: record.ourSide } : {}),
          ...(record.isInternal ? { isInternal: true } : {}),
        };
      });
      const hash = (value) => createHash('sha256').update(value).digest('hex');
      const inputHash = hash(
        JSON.stringify({
          records,
          image: image
            ? { name: image.name, mimeType: image.mimeType, hash: hash(image.bytes) }
            : null,
        }),
      );
      return db.transaction(() => {
        const previous = db
          .prepare('SELECT id,input_hash FROM battle_uploads WHERE request_id=?')
          .get(input.requestId);
        if (previous) {
          if (previous.input_hash !== inputHash)
            throw new BattleRecordError(
              '此操作已用於不同資料, 請重新送出',
              409,
              'REQUEST_CONFLICT',
            );
          return {
            records: db
              .prepare('SELECT id FROM battle_records WHERE upload_id=? ORDER BY rowid')
              .all(previous.id)
              .map((row) => get(row.id)),
          };
        }
        const rounds = new Set();
        const prepared = records.map((record) => {
          let event = null;
          if (record.eventId) {
            const current = db
              .prepare('SELECT id,title,type,revision,deleted_at FROM scheduled_events WHERE id=?')
              .get(record.eventId);
            const dates = db
              .prepare('SELECT date FROM event_dates WHERE event_id=? ORDER BY date')
              .all(record.eventId)
              .map((row) => row.date);
            if (
              !current ||
              current.deleted_at ||
              current.type !== record.type ||
              dates.length !== 1 ||
              dates[0] !== record.playedAt.slice(0, 10)
            )
              throw new BattleRecordError('對戰類型／日期與所選場次不符, 或場次已移除, 請重新選擇');
            event = {
              id: current.id,
              title: current.title,
              type: current.type,
              dates,
              revision: current.revision,
            };
          }
          if (record.roundNumber !== undefined) {
            const key = `${record.eventId}:${record.roundNumber}`;
            if (rounds.has(key)) throw new BattleRecordError('同一場只能上傳一個 CSV');
            rounds.add(key);
            if (
              db
                .prepare('SELECT id FROM battle_records WHERE event_id=? AND round_number=?')
                .get(record.eventId, record.roundNumber)
            )
              throw new BattleRecordError(
                '這一場已有戰績, 請查看已上傳戰績',
                409,
                'BATTLE_ROUND_EXISTS',
              );
          }
          const { filename, csvText, ...content } = record;
          const contentHash = hash(JSON.stringify(content));
          if (db.prepare('SELECT id FROM battle_records WHERE content_hash=?').get(contentHash))
            throw new BattleRecordError(
              '這筆戰績已上傳, 請查看已上傳戰績',
              409,
              'BATTLE_DUPLICATE',
            );
          return { record, event, contentHash };
        });
        if (new Set(prepared.map((row) => row.contentHash)).size !== prepared.length)
          throw new BattleRecordError('本次有重複的戰績, 請移除重複 CSV');
        const uploadId = randomUUID(),
          now = new Date().toISOString();
        db.prepare(
          'INSERT INTO battle_uploads (id,request_id,input_hash,image_name,image_type,image_data,created_at) VALUES (?,?,?,?,?,?,?)',
        ).run(
          uploadId,
          input.requestId,
          inputHash,
          image?.name || null,
          image?.mimeType || null,
          image?.bytes || null,
          now,
        );
        const ids = [];
        for (const { record, event, contentHash } of prepared) {
          const id = randomUUID();
          ids.push(id);
          db.prepare(
            'INSERT INTO battle_records (id,upload_id,event_id,event_snapshot_json,battle_type,played_at,red_team,blue_team,winner,filename,csv_text,players_json,content_hash,created_at,round_number,our_side,is_internal) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          ).run(
            id,
            uploadId,
            record.eventId,
            event ? JSON.stringify(event) : null,
            record.type,
            record.playedAt,
            record.redTeam,
            record.blueTeam,
            record.winner,
            record.filename,
            record.csvText,
            JSON.stringify(record.players),
            contentHash,
            now,
            record.roundNumber ?? null,
            record.ourSide ?? null,
            record.isInternal ? 1 : 0,
          );
          const findMember = db.prepare('SELECT uid FROM members WHERE name = ?');
          const insertLink = db.prepare(
            'INSERT INTO battle_player_links (record_id, player_index, member_uid) VALUES (?, ?, ?)',
          );
          record.players.forEach((player, index) => {
            const matches = findMember.all(player.player);
            if (matches.length === 1) insertLink.run(id, index, matches[0].uid);
          });
        }
        return { records: ids.map(get) };
      })();
    },
    getBattleAttachment(id, kind) {
      get(id);
      if (kind === 'csv') {
        const row = db.prepare('SELECT filename,csv_text FROM battle_records WHERE id=?').get(id);
        return {
          name: row.filename,
          mimeType: 'text/csv; charset=utf-8',
          bytes: Buffer.from(row.csv_text),
        };
      }
      if (kind !== 'image') throw new BattleRecordError('找不到這項附件', 404, 'BATTLE_NOT_FOUND');
      const row = db
        .prepare(
          'SELECT u.image_name,u.image_type,u.image_data FROM battle_uploads u JOIN battle_records r ON r.upload_id=u.id WHERE r.id=?',
        )
        .get(id);
      if (!row.image_data)
        throw new BattleRecordError('這筆戰績沒有陣容圖片', 404, 'BATTLE_NOT_FOUND');
      return { name: row.image_name, mimeType: row.image_type, bytes: row.image_data };
    },
  };
}
