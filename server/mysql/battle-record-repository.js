import { BATTLE_METRICS } from '../../src/domain/battle-statistics.js';
import { fillBattlePlayerStats } from '../database/migrations/0006-battle-player-stats.js';
import { createFileMetadataRepository } from './file-metadata.js';
import { asyncMap } from "./collections.js";
import { createHash, randomUUID } from 'node:crypto';
import {
  BattleRecordError,
  parseBattleCsv,
  taipeiBattleTime,
  MAX_IMAGE_BYTES,
} from '../../src/domain/battle-records.js';
import { analyzeBattleTeams, battleTeamContext, includeBattleTeamContext } from '../../src/domain/team-battle-analysis.js';
import { uniqueNewMemberNames } from '../../src/domain/battle-member-links.js';
import { planBattleMemberSync, publicBattleSyncPlan, validateBattleSyncInput } from '../../src/domain/battle-member-sync.js';
import { battleEditingMetadata, validateBattleMetadata } from '../../src/domain/battle-metadata.js';
import { validateBattleAttributions, applyBattleAttributions } from '../../src/domain/battle-attributions.js';
import {
  validatePersonalBattleFilters,
  personalBattleReadAll,
  personalBattleKeys,
} from '../../src/domain/personal-battle-filters.js';

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
    input.base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
    input.base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)
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
export function createBattleRecordRepository(db, {
  project = (_kind, _id, value) => value,
  projectAll = async (_kind, rows) => rows.map((row) => row.value),
} = {}) {
  const files = createFileMetadataRepository(db);
  // Links are written as multi-row INSERTs; 500 rows keep each statement well under the placeholder limit.
  async function insertLinks(links) {
    for (let start = 0; start < links.length; start += 500) {
      const chunk = links.slice(start, start + 500);
      (await db.prepare(`INSERT INTO battle_player_links (record_id, player_index, member_uid) VALUES ${chunk.map(() => '(?, ?, ?)').join(', ')}`)
        .run(chunk.flat()));
    }
  }
  async function syncPlan() {
    const records = (await db.prepare('SELECT id, players_json FROM battle_records').all());
    const players = (await projectAll('battle', records.map((row) => ({ id: row.id, value: JSON.parse(row.players_json) }))));
    return planBattleMemberSync(
      (await db.prepare('SELECT uid, name FROM members').all()),
      (await db.prepare('SELECT member_uid AS uid, name FROM member_name_history').all()),
      records.map((row, index) => ({ id: row.id, players: players[index] })),
      (await db.prepare('SELECT record_id AS recordId, player_index AS playerIndex FROM battle_player_links').all()),
    );
  }
  const syncFingerprint = plan => createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  function summary(row, players) {
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
    };
  }
  async function get(id) {
    const row = (await db
      .prepare(
        `SELECT r.*, u.image_name,u.image_type FROM battle_records r JOIN battle_uploads u ON u.id=r.upload_id WHERE r.id=?`,
      )
      .get(id));
    if (!row) throw new BattleRecordError('找不到這筆戰績', 404, 'BATTLE_NOT_FOUND');
    const players = (await project('battle', row.id, JSON.parse(row.players_json)));
    for (const link of (await db
      .prepare('SELECT player_index, member_uid FROM battle_player_links WHERE record_id = ?')
      .all(id))) {
      if (players[link.player_index]) players[link.player_index].memberUid = link.member_uid;
    }
    return { ...summary(row, players), players };
  }
  async function analysisLineup(record) {
    if (!record.eventId || ![1, 2].includes(record.roundNumber)) return null;
    const row = (await db.prepare(
      'SELECT id, snapshot_json, created_at FROM lineup_versions WHERE event_id=? ORDER BY version DESC LIMIT 1',
    ).get(record.eventId));
    return row ? { ...(await project('lineup', row.id, JSON.parse(row.snapshot_json))), createdAt: row.created_at } : null;
  }
  return {
    async getBattleUploadRoster() {
      return { members: (await db.prepare(`SELECT m.uid, m.name, m.revision,
        m.is_in_guild AS isInGuild, m.is_in_club AS isInClub, COALESCE(p.name, '未記錄') AS profession
        FROM members m LEFT JOIN professions p ON p.job_id=m.primary_profession_id ORDER BY m.name, m.uid`)
        .all()).map(member => ({ ...member, isInGuild: Boolean(member.isInGuild), isInClub: Boolean(member.isInClub) })) };
    },
    async previewBattleMemberSync() {
      return (await db.transaction(async () => {
        const plan = (await syncPlan());
        return { ...publicBattleSyncPlan(plan), fingerprint: syncFingerprint(plan) };
      }));
    },
    async syncBattleMembers(input) {
      const values = validateBattleSyncInput(input);
      return (await db.transaction(async () => {
        const previous = (await db.prepare('SELECT * FROM battle_sync_requests WHERE request_id=?').get(values.requestId));
        if (previous) {
          if (previous.input_hash !== values.fingerprint)
            throw new BattleRecordError('此操作已用於不同資料，請重新預覽', 409, 'REQUEST_CONFLICT');
          return JSON.parse(previous.result_json);
        }
        const plan = (await syncPlan());
        if (syncFingerprint(plan) !== values.fingerprint)
          throw new BattleRecordError('成員或戰績資料已變動，請重新預覽後同步', 409, 'STALE_SYNC_PREVIEW');
        (await insertLinks(plan.assignments.map((row) => [row.recordId, row.playerIndex, row.memberUid])));
        const result = { ...publicBattleSyncPlan(plan), linkedPlayers: plan.assignments.length };
        (await db.prepare('INSERT INTO battle_sync_requests VALUES (?, ?, ?)').run(values.requestId, values.fingerprint, JSON.stringify(result)));
        return result;
      }));
    },
    async listBattleRecords({ page = 1, eventId = null } = {}) {
      if (!Number.isSafeInteger(page) || page < 1) throw new BattleRecordError('頁碼不正確');
      const where = eventId == null ? '' : ' WHERE r.event_id=? AND r.round_number IS NOT NULL';
      const args = eventId == null ? [] : [text(eventId, '場次', 64)];
      const total = (await db
        .prepare(`SELECT COUNT(*) AS total FROM battle_records r${where}`)
        .get(...args)).total;
      // Pick the page IDs from the date index first, then join metadata; side counts are
      // computed in SQL so the full players JSON never leaves MySQL.
      const rows = await db.prepare(
        `SELECT r.id, r.event_id, r.event_snapshot_json, r.battle_type, r.played_at,
          r.red_team, r.blue_team, r.winner, r.our_side, r.is_internal, r.revision,
          r.filename, r.created_at, r.round_number, u.image_name, u.image_type,
          sides.redCount, sides.blueCount
        FROM (SELECT r.id FROM battle_records r${where}
          ORDER BY r.played_at DESC, r.created_at DESC, r.id LIMIT 20 OFFSET ?) picked
        JOIN battle_records r ON r.id=picked.id JOIN battle_uploads u ON u.id=r.upload_id
        JOIN LATERAL (SELECT COALESCE(SUM(p.side='red'), 0) AS redCount, COALESCE(SUM(p.side='blue'), 0) AS blueCount
          FROM JSON_TABLE(r.players_json, '$[*]' COLUMNS (side VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PATH '$.side' NULL ON ERROR)) p) sides
        ORDER BY r.played_at DESC, r.created_at DESC, r.id`,
      ).all(...args, (page - 1) * 20);
      const records = rows.map(({ redCount, blueCount, ...row }) => ({
        ...summary(row, []), redCount: Number(redCount), blueCount: Number(blueCount),
      }));
      return { records, total, page, pageSize: 20 };
    },
    async getBattleMetadata(id) {
      const row = (await db.prepare(`SELECT id, battle_type AS type, played_at AS playedAt,
        round_number AS roundNumber, red_team AS redTeam, blue_team AS blueTeam,
        winner, our_side AS ourSide, is_internal AS isInternal, revision
        FROM battle_records WHERE id=?`).get(id));
      if (!row) throw new BattleRecordError('找不到這筆戰績', 404, 'BATTLE_NOT_FOUND');
      return battleEditingMetadata(row);
    },
    async getBattleRecord(id, options = {}) {
      const withContext = includeBattleTeamContext(options);
      if (!withContext) return (await get(id));
      return (await db.transaction(async () => {
        const record = (await get(id));
        return { ...record, teamContext: battleTeamContext(record, (await analysisLineup(record))) };
      }));
    },
    async getBattleTeamAnalysis(id) {
      return (await db.transaction(async () => {
        const record = (await get(id));
        return analyzeBattleTeams(record, (await analysisLineup(record)));
      }));
    },
    // Managers delete a mistaken upload so the round can be uploaded again. The upload row
    // (and its image, which may be shared by both rounds) stays for retry receipts.
    async deleteBattleRecord(id, expected) {
      if (!Number.isSafeInteger(expected) || expected < 0)
        throw new BattleRecordError('資料版本不正確，請重新載入');
      return (await db.transaction(async () => {
        const current = (await db.prepare('SELECT revision FROM battle_records WHERE id = ? FOR UPDATE').get(id));
        if (!current) return { deleted: true, id };
        if (current.revision !== expected)
          throw new BattleRecordError(
            '對戰資訊已更新，請重新載入後再刪除',
            409,
            'REVISION_CONFLICT',
          );
        (await db.prepare('DELETE FROM battle_player_links WHERE record_id = ?').run(id));
        (await db.prepare("DELETE FROM member_reference_overrides WHERE kind = 'battle' AND record_id = ?").run(id));
        (await db.prepare('DELETE FROM battle_records WHERE id = ?').run(id));
        return { deleted: true, id };
      }));
    },
    async updateBattleRecord(id, input) {
      return (await db.transaction(async () => {
        (await db.prepare('SELECT id FROM battle_records WHERE id = ? FOR UPDATE').get(id));
        const current = (await get(id));
        const values = validateBattleMetadata(input, current.type);
        const fingerprint = createHash('sha256')
          .update(JSON.stringify([id, input.revision, values]))
          .digest('hex');
        const previous = (await db
          .prepare('SELECT * FROM battle_metadata_requests WHERE request_id = ?')
          .get(input.requestId));
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
        (await db.prepare(
          'UPDATE battle_records SET red_team = ?, blue_team = ?, winner = ?, our_side = ?, is_internal = ?, revision = revision + 1 WHERE id = ?',
        ).run(
          values.redTeam,
          values.blueTeam,
          values.winner,
          values.ourSide,
          values.isInternal ? 1 : 0,
          id,
        ));
        const { players, ...record } = (await get(id));
        const result = { record };
        (await db.prepare(
          'INSERT INTO battle_metadata_requests (request_id, input_hash, result_json) VALUES (?, ?, ?)',
        ).run(input.requestId, fingerprint, JSON.stringify(result)));
        return result;
      }));
    },
    async backfillMemberBattleRecords(newMembers) {
      const names = uniqueNewMemberNames(
        (await db.prepare('SELECT uid, name FROM members').all()),
        newMembers,
      );
      const insert =
        db.prepare(`INSERT INTO battle_player_links (record_id, player_index, member_uid)
        SELECT r.id, p.player_index - 1, ? FROM battle_records r
        JOIN JSON_TABLE(r.players_json, '$[*]' COLUMNS (
          player_index FOR ORDINALITY, player VARCHAR(64) PATH '$.player',
          member_uid VARCHAR(64) PATH '$.memberUid' NULL ON EMPTY
        )) p
        LEFT JOIN battle_player_links l ON l.record_id=r.id AND l.player_index=p.player_index-1
        WHERE BINARY p.player = BINARY ? AND l.record_id IS NULL AND p.member_uid IS NULL`);
      for (const [name, uid] of names) (await insert.run(uid, name));
    },
    async getMemberBattleRecords(uid, { page = 1, ...input } = {}) {
      if (!Number.isSafeInteger(page) || page < 1) throw new BattleRecordError('頁碼不正確');
      const { keys: rawKeys, ...filterInput } = input;
      const keys = personalBattleKeys(rawKeys);
      const filters = validatePersonalBattleFilters(keys ? {} : filterInput);
      const readAll = personalBattleReadAll(filterInput);
      const memberUid = text(uid, '成員', 64);
      const member = (await db
        .prepare('SELECT name, primary_profession AS profession FROM members WHERE uid = ?')
        .get(memberUid));
      if (!member) throw new BattleRecordError('找不到這位成員', 404, 'MEMBER_NOT_FOUND');
      const from = `FROM battle_player_links l
        JOIN battle_player_stats p ON p.record_id=l.record_id AND p.player_index=l.player_index
        JOIN battle_records r ON r.id=l.record_id`;
      const clauses = ['l.member_uid = ?'];
      const args = [memberUid];
      if (filters.startDate) { clauses.push('r.played_at >= ?'); args.push(filters.startDate); }
      if (filters.endDate) { clauses.push('r.played_at < ?'); args.push(new Date(Date.parse(filters.endDate) + 86400000).toISOString().slice(0, 10)); }
      if (filters.profession) { clauses.push('BINARY p.profession = BINARY ?'); args.push(filters.profession); }
      // Selected rows are re-read by key, so cross-page selections never need the full history.
      if (keys) {
        clauses.push(`(l.record_id, l.player_index) IN (${keys.map(() => '(?, ?)').join(', ')})`);
        args.push(...keys.flat());
      }
      const where = 'WHERE ' + clauses.join(' AND ');
      const professions = (await db.prepare(`SELECT DISTINCT p.profession ${from} WHERE l.member_uid=?`).all(memberUid))
        .map(row => row.profession).filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-TW'));
      const rows = await db.prepare(
        `SELECT l.player_index, r.id, r.battle_type, r.played_at, r.round_number,
          r.red_team, r.blue_team, r.winner, r.is_internal, r.created_at, p.player_json
          ${from} ${where}
          ORDER BY r.played_at DESC, r.created_at DESC, r.id, l.player_index LIMIT ? OFFSET ?`,
      ).all(...args, readAll ? 10001 : keys ? keys.length : 20, readAll || keys ? 0 : (page - 1) * 20);
      if (readAll && rows.length > 10000) throw new BattleRecordError('個人戰績超過完整讀取上限, 請縮小日期範圍');
      const entries = rows.map(row => ({
        recordId: row.id, playerIndex: row.player_index, type: row.battle_type,
        playedAt: row.played_at, roundNumber: row.round_number, redTeam: row.red_team,
        blueTeam: row.blue_team, winner: row.winner, isInternal: Boolean(row.is_internal),
        createdAt: row.created_at, player: JSON.parse(row.player_json),
      }));
      if (keys) return { member, entries };
      let summary;
      if (!readAll) {
        const values = BATTLE_METRICS.map(([, key]) =>
          `JSON_VALUE(p.player_json, '$.${key}' RETURNING DOUBLE NULL ON EMPTY NULL ON ERROR) AS \`${key}\``).join(', ');
        const aggregates = BATTLE_METRICS.flatMap(([, key]) => [
          `SUM(\`${key}\`) AS \`${key}Total\``, `COUNT(\`${key}\`) AS \`${key}Count\``,
          `SUM(IF(\`${key}\` IS NOT NULL AND seriousInjury IS NOT NULL, \`${key}\`, 0)) AS \`${key}LifeTotal\``,
          `SUM(IF(\`${key}\` IS NOT NULL AND seriousInjury IS NOT NULL, GREATEST(seriousInjury, 1), 0)) AS \`${key}Lives\``,
          `SUM(\`${key}\` IS NOT NULL AND seriousInjury IS NOT NULL) AS \`${key}LifeCount\``,
        ]).join(', ');
        const stats = await db.prepare(`SELECT COUNT(*) AS rowCount, ${aggregates}
          FROM (SELECT ${values} ${from} ${where}) metrics`).get(...args);
        const results = await db.prepare(`SELECT COUNT(*) AS battleCount,
          SUM(result=1) AS wins, SUM(result=-1) AS losses, SUM(result=0) AS unknown
          FROM (SELECT r.id, CASE WHEN MIN(CASE WHEN r.is_internal=1 OR r.winner IS NULL THEN 0
            WHEN r.winner=JSON_UNQUOTE(JSON_EXTRACT(p.player_json, '$.side')) THEN 1 ELSE -1 END)
            = MAX(CASE WHEN r.is_internal=1 OR r.winner IS NULL THEN 0
            WHEN r.winner=JSON_UNQUOTE(JSON_EXTRACT(p.player_json, '$.side')) THEN 1 ELSE -1 END)
            THEN MIN(CASE WHEN r.is_internal=1 OR r.winner IS NULL THEN 0
            WHEN r.winner=JSON_UNQUOTE(JSON_EXTRACT(p.player_json, '$.side')) THEN 1 ELSE -1 END) ELSE 0 END AS result
            ${from} ${where} GROUP BY r.id) battles`).get(...args);
        summary = {
          ...Object.fromEntries(Object.entries(results).map(([key, value]) => [key, Number(value || 0)])),
          rowCount: Number(stats.rowCount),
          metrics: BATTLE_METRICS.map(([label, key]) => {
            const count = Number(stats[key + 'Count']);
            const total = count ? Number(stats[key + 'Total']) : null;
            const lives = Number(stats[key + 'Lives']);
            return { key, label, total, average: count ? total / count : null,
              missing: Number(stats.rowCount) - count,
              perLife: key === 'seriousInjury' ? total : lives ? Number(stats[key + 'LifeTotal']) / lives : null,
              perLifeMissing: Number(stats.rowCount) - (key === 'seriousInjury' ? count : Number(stats[key + 'LifeCount'])),
            };
          }),
        };
      }
      return { member, filters, professions, ...(readAll ? {} : { summary }), entries,
        total: readAll ? entries.length : summary.rowCount, page: readAll ? 1 : page,
        pageSize: readAll ? entries.length : 20 };
    },
    async saveBattleRecords(input, { preflight = false, fileReferences, assertAccess } = {}) {
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
        const attributions = validateBattleAttributions(record.attributions, parsed.players);
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
          ...(attributions.length ? { attributions } : {}),
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
      return (await db.transaction(async () => {
        await assertAccess?.();
        // Uploads tied to an event queue on that event row (sorted to avoid lock-order deadlocks);
        // others rely on the unique request, content and round keys.
        for (const eventId of [...new Set(records.map((record) => record.eventId).filter(Boolean))].sort())
          (await db.prepare('SELECT id FROM scheduled_events WHERE id=? FOR UPDATE').get(eventId));
        const previous = (await db
          .prepare('SELECT id,input_hash FROM battle_uploads WHERE request_id=?')
          .get(input.requestId));
        if (previous) {
          if (previous.input_hash !== inputHash)
            throw new BattleRecordError(
              '此操作已用於不同資料, 請重新送出',
              409,
              'REQUEST_CONFLICT',
            );
          return {
            records: (await asyncMap(await db
              .prepare('SELECT id FROM battle_records WHERE upload_id=? ORDER BY created_order')
              .all(previous.id), async (row) => (await get(row.id)))),
          };
        }
        const rounds = new Set();
        const prepared = (await asyncMap(records, async (record) => {
          let event = null;
          if (record.eventId) {
            const current = (await db
              .prepare('SELECT id,title,type,revision,deleted_at FROM scheduled_events WHERE id=?')
              .get(record.eventId));
            const dates = (await db
              .prepare('SELECT date FROM event_dates WHERE event_id=? ORDER BY date')
              .all(record.eventId))
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
              (await db
                .prepare('SELECT id FROM battle_records WHERE event_id=? AND round_number=?')
                .get(record.eventId, record.roundNumber))
            )
              throw new BattleRecordError(
                '這一場已有戰績, 請查看已上傳戰績',
                409,
                'BATTLE_ROUND_EXISTS',
              );
          }
          const { filename, csvText, attributions, ...content } = record;
          return { record, event, contentHash: hash(JSON.stringify(content)) };
        }));
        if ((await db.prepare(`SELECT id FROM battle_records WHERE content_hash IN (${prepared.map(() => '?').join(',')}) LIMIT 1`)
          .get(prepared.map((row) => row.contentHash))))
          throw new BattleRecordError(
            '這筆戰績已上傳, 請查看已上傳戰績',
            409,
            'BATTLE_DUPLICATE',
          );
        if (new Set(prepared.map((row) => row.contentHash)).size !== prepared.length)
          throw new BattleRecordError('本次有重複的戰績, 請移除重複 CSV');
        const members = (await db.prepare('SELECT uid, name, revision FROM members').all());
        const byUid = new Map(members.map(member => [member.uid, member])), byName = new Map();
        for (const member of members) {
          if (!byName.has(member.name)) byName.set(member.name, []);
          byName.get(member.name).push(member.uid);
        }
        for (const value of prepared)
          value.attribution = applyBattleAttributions(value.record.players, value.record.attributions || [], byUid);
        if (preflight) return { requiresFiles: true };
        if (!fileReferences || fileReferences.csv.length !== records.length) throw new Error('File staging required');
        for (const file of fileReferences.csv) await files.insert(file);
        if (fileReferences.image) await files.insert(fileReferences.image);
        const uploadId = randomUUID(),
          now = new Date().toISOString();
        (await db.prepare(
          'INSERT INTO battle_uploads (id,request_id,input_hash,image_name,image_type,image_data,created_at,image_file_id) VALUES (?,?,?,?,?,?,?,?)',
        ).run(
          uploadId,
          input.requestId,
          inputHash,
          image?.name || null,
          image?.mimeType || null,
          null,
          now,
          fileReferences.image?.id || null,
        ));
        const ids = [], links = [];
        for (const [index, { record, event, contentHash, attribution }] of prepared.entries()) {
          const id = randomUUID();
          ids.push(id);
          (await db.prepare(
            'INSERT INTO battle_records (id,upload_id,event_id,event_snapshot_json,battle_type,played_at,red_team,blue_team,winner,filename,csv_text,players_json,content_hash,created_at,round_number,our_side,is_internal,csv_file_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
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
            '',
            JSON.stringify(attribution.players),
            contentHash,
            now,
            record.roundNumber ?? null,
            record.ourSide ?? null,
            record.isInternal ? 1 : 0,
            fileReferences.csv[index].id,
          ));
          await db.prepare(fillBattlePlayerStats + ' WHERE r.id = ?').run(id);
          for (const [index, player] of record.players.entries()) {
            const target = attribution.targets.get(index);
            const matches = byName.get(player.player) || [];
            if (target || matches.length === 1) links.push([id, index, target?.uid || matches[0]]);
          }
        }
        (await insertLinks(links));
        return { records: (await asyncMap(ids, get)) };
      }));
    },
    async getBattleAttachment(id, kind) {
      if (kind === 'csv') {
        const row = (await db.prepare('SELECT filename,csv_text,csv_file_id FROM battle_records WHERE id=?').get(id));
        if (!row) throw new BattleRecordError('找不到這筆戰績', 404, 'BATTLE_NOT_FOUND');
        return {
          name: row.filename,
          mimeType: 'text/csv; charset=utf-8',
          ...(row.csv_file_id ? { file: await files.get(row.csv_file_id) } : { bytes: Buffer.from(row.csv_text) }),
        };
      }
      if (kind !== 'image') throw new BattleRecordError('找不到這項附件', 404, 'BATTLE_NOT_FOUND');
      const row = (await db
        .prepare(
          'SELECT u.image_name,u.image_type,u.image_data,u.image_file_id FROM battle_uploads u JOIN battle_records r ON r.upload_id=u.id WHERE r.id=?',
        )
        .get(id));
      if (!row || (!row.image_data && !row.image_file_id))
        throw new BattleRecordError('這筆戰績沒有陣容圖片', 404, 'BATTLE_NOT_FOUND');
      return { name: row.image_name, mimeType: row.image_type, ...(row.image_file_id ? { file: await files.get(row.image_file_id) } : { bytes: row.image_data }) };
    },
  };
}
