import {
  parseBattleCsv,
  taipeiBattleTime,
  MAX_IMAGE_BYTES,
} from '../../src/domain/battle-records.js';
import { summarizePersonalBattles } from '../../src/domain/personal-battle-statistics.js';
import { analyzeBattleTeams } from '../../src/domain/team-battle-analysis.js';
import { validateBattleMetadata } from '../../src/domain/battle-metadata.js';
import {
  validatePersonalBattleFilters,
  filterPersonalBattles,
  personalBattleProfessions,
} from '../../src/domain/personal-battle-filters.js';
import { canonical, fail, hash, pageNumber, retry, text } from './common.js';
export function createBattles(store, catalog, { uuid, now, files }) {
  const all = () =>
    store
      .all('battles')
      .sort(
        (a, b) =>
          b.playedAt.localeCompare(a.playedAt) ||
          b.createdAt.localeCompare(a.createdAt) ||
          a.id.localeCompare(b.id),
      );
  function get(id) {
    const record = store.get('battles', id);
    if (!record) fail('BATTLE_NOT_FOUND', '找不到這筆戰績');
    return record;
  }
  const metadata = ({ csvFileId, imageFileId, contentHash, players, ...record }) => ({
    ...record,
    revision: record.revision ?? 0,
  });
  const detail = ({ csvFileId, imageFileId, contentHash, ...record }) => {
    const players = store.get('battle_players', record.id)?.players || record.players;
    if (!Array.isArray(players)) fail('STORAGE_CORRUPT', '戰績玩家資料不完整，請聯絡管理者');
    const links = new Map(
      store
        .all('battle_links')
        .filter((link) => link.recordId === record.id)
        .map((link) => [link.playerIndex, link.memberUid]),
    );
    return {
      ...record,
      revision: record.revision ?? 0,
      players: players.map((player, index) =>
        links.has(index) ? { ...player, memberUid: links.get(index) } : player,
      ),
    };
  };
  function image(input) {
    if (input == null) return null;
    const name = text(input.name, '圖片檔名', 160);
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(input.mimeType) ||
      typeof input.base64 !== 'string' ||
      input.base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64)
    )
      fail('BATTLE_INVALID', '圖片格式不正確或超過 4 MB');
    const bytes = files.decode(input.base64).map((value) => value & 255);
    const match = (start, values) => values.every((value, i) => bytes[start + i] === value);
    const valid =
      input.mimeType === 'image/png'
        ? match(0, [137, 80, 78, 71, 13, 10, 26, 10])
        : input.mimeType === 'image/jpeg'
          ? match(0, [255, 216, 255])
          : match(0, [82, 73, 70, 70]) && match(8, [87, 69, 66, 80]);
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || !valid)
      fail('BATTLE_INVALID', '圖片內容與格式不符');
    return { name, mimeType: input.mimeType, base64: input.base64 };
  }
  return {
    getBattleRecords([page = 1, eventId = null]) {
      pageNumber(page);
      if (eventId !== null) text(eventId, '場次', 64);
      const records = all().filter(
        (record) => eventId === null || (record.eventId === eventId && record.roundNumber !== null),
      );
      return {
        records: records.slice((page - 1) * 20, page * 20).map(metadata),
        total: records.length,
        page,
        pageSize: 20,
      };
    },
    getBattleRecord: ([id]) => ({ record: detail(get(id)) }),
    getBattleTeamAnalysis([id]) {
      const record = detail(get(id));
      const lineup = record.eventId ? store.all('lineup_versions')
        .filter((value) => value.eventId === record.eventId)
        .sort((a, b) => b.version - a.version)[0] : null;
      return analyzeBattleTeams(record, lineup || null);
    },
    updateBattleRecord([id, input]) {
      const current = get(id);
      const values = validateBattleMetadata(input, current.type);
      return retry(
        store,
        'updateBattleRecord',
        input.requestId,
        { id, revision: input.revision, values },
        () => {
          if ((current.revision ?? 0) !== input.revision)
            fail('REVISION_CONFLICT', '對戰資訊已更新，請重新載入後再儲存');
          const record = { ...current, ...values, revision: (current.revision ?? 0) + 1 };
          store.put('battles', id, record);
          return { record: metadata(record) };
        },
      );
    },
    getMemberBattleRecords([uid, page = 1, input = {}]) {
      pageNumber(page);
      const filters = validatePersonalBattleFilters(input);
      const member = catalog.member(uid);
      const links = store.all('battle_links').filter((link) => link.memberUid === uid);
      const snapshots = store.getMany('battle_players', [
        ...new Set(links.map((link) => link.recordId)),
      ]);
      const allEntries = all().flatMap((record) =>
        links
          .filter((link) => link.recordId === record.id)
          .sort((a, b) => a.playerIndex - b.playerIndex)
          .map(({ playerIndex }) => {
            const value =
              snapshots.get(record.id)?.players[playerIndex] || record.players?.[playerIndex];
            if (!value) fail('STORAGE_CORRUPT', '個人戰績資料不完整，請聯絡管理者');
            const { memberUid, ...player } = value;
            return {
              recordId: record.id,
              playerIndex,
              type: record.type,
              playedAt: record.playedAt,
              roundNumber: record.roundNumber,
              redTeam: record.redTeam,
              blueTeam: record.blueTeam,
              winner: record.winner,
              isInternal: record.isInternal,
              player,
            };
          }),
      );
      const entries = filterPersonalBattles(allEntries, filters);
      return {
        filters,
        professions: personalBattleProfessions(allEntries),
        member: {
          name: member.name,
          profession: catalog.profession(member.primaryProfessionId).name,
        },
        summary: summarizePersonalBattles(entries),
        entries: entries.slice((page - 1) * 20, page * 20),
        total: entries.length,
        page,
        pageSize: 20,
      };
    },
    saveBattleRecords([input]) {
      if (!Array.isArray(input?.records) || input.records.length < 1 || input.records.length > 2)
        fail('BATTLE_INVALID', '每次請上傳 1–2 個 CSV');
      const attachment = image(input.image);
      const records = input.records.map((record) => {
        if (!record || !['scrimmage', 'guild_war', 'dragon_tiger'].includes(record.type))
          fail('BATTLE_INVALID', '請選擇戰鬥類型');
        if (
          (record.isInternal !== undefined && typeof record.isInternal !== 'boolean') ||
          (record.isInternal && (record.type !== 'scrimmage' || record.winner || record.ourSide))
        )
          fail('BATTLE_INVALID', '只有約戰可設內推，內推請清除敵我與勝方');
        for (const key of ['ourSide', 'winner'])
          if (record[key] != null && record[key] !== '' && !['red', 'blue'].includes(record[key]))
            fail('BATTLE_INVALID', '敵我與獲勝方只能選紅方／藍方或留空');
        const filename = text(record.filename, 'CSV 檔名', 160);
        if (!/\.csv$/i.test(filename)) fail('BATTLE_INVALID', '只能上傳 CSV 檔案');
        const eventId = record.eventId ? text(record.eventId, '場次', 64) : null;
        const roundNumber = record.roundNumber ?? null;
        if (
          record.roundNumber !== undefined &&
          (!eventId ||
            !Number.isSafeInteger(roundNumber) ||
            roundNumber < 1 ||
            roundNumber > (record.type === 'dragon_tiger' ? 1 : 2))
        )
          fail('BATTLE_INVALID', '約戰與幫戰只能第一／第二場，龍虎戰只有一場且需關聯活動');
        const parsed = parseBattleCsv(record.csvText);
        return {
          eventId,
          roundNumber,
          type: record.type,
          playedAt: taipeiBattleTime(record.datetime),
          redTeam: text(record.redTeam, '紅方名稱', 120),
          blueTeam: text(record.blueTeam, '藍方名稱', 120),
          winner: record.winner || null,
          ourSide: record.ourSide || null,
          isInternal: record.isInternal || false,
          filename,
          csvText: record.csvText,
          players: parsed.players,
        };
      });
      return retry(
        store,
        'saveBattleRecords',
        input.requestId,
        { records, image: attachment },
        () => {
          const existing = all(),
            rounds = new Set(),
            contents = new Set();
          // Finish validation of both files before creating Drive attachments.
          const prepared = records.map((record) => {
            let event = null;
            if (record.eventId) {
              const current = catalog.event(record.eventId, { battle: true });
              if (
                current.type !== record.type ||
                current.dates.length !== 1 ||
                current.dates[0] !== record.playedAt.slice(0, 10)
              )
                fail('BATTLE_INVALID', '日期／類型與活動不符，請重新選擇場次');
              const { id, title, type, dates, revision } = current;
              event = { id, title, type, dates, revision };
            }
            if (record.roundNumber !== null) {
              const key = canonical([record.eventId, record.roundNumber]);
              if (rounds.has(key)) fail('BATTLE_INVALID', '同一場只能上傳一個 CSV');
              if (
                existing.some(
                  (item) =>
                    item.eventId === record.eventId && item.roundNumber === record.roundNumber,
                )
              )
                fail('BATTLE_ROUND_EXISTS', '這一場已有戰績，請查看已上傳資料');
              rounds.add(key);
            }
            const { csvText, filename, ...content } = record,
              contentHash = hash(canonical(content));
            if (
              contents.has(contentHash) ||
              existing.some((item) => item.contentHash === contentHash)
            )
              fail('BATTLE_DUPLICATE', '這筆戰績已上傳，請移除重複 CSV');
            contents.add(contentHash);
            return { record, event, contentHash };
          });
          const names = new Map();
          for (const member of store.all('members')) {
            if (!names.has(member.name)) names.set(member.name, []);
            names.get(member.name).push(member.uid);
          }
          const imageFileId = attachment ? files.createBase64(attachment) : null;
          const saved = prepared.map(({ record, event, contentHash }) => {
            const id = uuid(),
              csvFileId = files.createCsv(record.filename, record.csvText);
            const players = record.players.map((player, index) => {
              const matches = names.get(player.player) || [];
              if (matches.length === 1) {
                store.put('battle_links', `${id}:${index}`, {
                  recordId: id,
                  playerIndex: index,
                  memberUid: matches[0],
                });
                return { ...player, memberUid: matches[0] };
              }
              return player;
            });
            const { csvText, players: rawPlayers, ...value } = record;
            const saved = {
              ...value,
              id,
              event,
              createdAt: now(),
              contentHash,
              csvFileId,
              imageFileId,
              image: attachment ? { name: attachment.name, mimeType: attachment.mimeType } : null,
              redCount: players.filter((player) => player.side === 'red').length,
              blueCount: players.filter((player) => player.side === 'blue').length,
            };
            store.put('battle_players', id, { players });
            store.put('battles', id, saved);
            return detail(saved);
          });
          return { records: saved };
        },
      );
    },
    getBattleAttachment([id, kind]) {
      const record = get(id);
      if (kind !== 'csv' && kind !== 'image') fail('ATTACHMENT_INVALID', '未知附件類型');
      const fileId = kind === 'csv' ? record.csvFileId : record.imageFileId;
      if (!fileId) fail('ATTACHMENT_NOT_FOUND', '這筆戰績沒有此附件');
      return {
        base64: files.read(fileId),
        mimeType: kind === 'csv' ? 'text/csv;charset=utf-8' : record.image.mimeType,
        name: kind === 'csv' ? record.filename : record.image.name,
      };
    },
  };
}
