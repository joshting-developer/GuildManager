import { CLEANING_RULES, NUMERIC_NAME, PLACEHOLDER_HISTORY_NAME, PLACEHOLDER_UID, createCleaningReport } from './cleaning.js';

// Insert order respects foreign keys; column lists match migrations 0001–0004.
export const IMPORT_TABLES = {
  duties: ['id', 'name', 'active', 'revision', 'request_id', 'original_name', 'created_at', 'updated_at'],
  members: ['uid', 'name', 'primary_profession_id', 'secondary_profession_id', 'primary_profession', 'secondary_profession', 'joined_at', 'updated_at', 'removed_at', 'revision', 'is_in_guild', 'is_in_club'],
  member_name_history: ['id', 'member_uid', 'name', 'changed_at'],
  member_uid_revisions: ['uid', 'revision'],
  scheduled_events: ['id', 'title', 'type', 'request_id', 'created_at', 'revision', 'updated_at', 'deleted_at'],
  event_dates: ['event_id', 'date'],
  event_member_responses: ['event_id', 'member_uid', 'status', 'note', 'revision', 'updated_at', 'profession_id'],
  event_registrations: ['id', 'event_id', 'name', 'profession_id', 'note', 'active', 'revision', 'request_id', 'created_at', 'updated_at'],
  event_video_submissions: ['id', 'event_id', 'name', 'first_url', 'second_url', 'note', 'created_at', 'group_name', 'profession_id', 'profession_name', 'profession_colorcode', 'revision'],
  lineup_versions: ['id', 'event_id', 'version', 'request_id', 'payload_json', 'snapshot_json', 'created_at'],
  lineup_templates: ['id', 'name', 'request_id', 'payload_json', 'teams_json', 'created_at'],
  battle_uploads: ['id', 'request_id', 'input_hash', 'image_name', 'image_type', 'image_data', 'created_at', 'image_file_id'],
  battle_records: ['id', 'upload_id', 'event_id', 'event_snapshot_json', 'battle_type', 'played_at', 'red_team', 'blue_team', 'winner', 'filename', 'csv_text', 'players_json', 'content_hash', 'created_at', 'round_number', 'our_side', 'is_internal', 'revision', 'csv_file_id'],
  battle_player_links: ['record_id', 'player_index', 'member_uid'],
  member_reference_overrides: ['kind', 'record_id', 'overrides_json'],
  lottery_boards: ['id', 'board_json', 'revision', 'updated_at'],
};

const EVENT_TYPES = new Set(['activity', 'scrimmage', 'guild_war', 'dragon_tiger']);
const RESPONSE_STATUSES = new Set(['registered', 'leave', 'none']);
const VIDEO_GROUPS = new Set(['進攻一', '進攻二', '防守團']);
const SIDES = new Set(['red', 'blue']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Legacy rows never had v2 retry keys; a fixed prefix keeps them unique and unreplayable.
const legacyKey = (kind, id) => `legacy-${kind}:${id}`;
const byTime = (field) => (a, b) => String(a[field]).localeCompare(String(b[field])) || String(a.id).localeCompare(String(b.id));

export function transformLegacyStore({ tables }) {
  const report = createCleaningReport();
  const values = (table) => [...tables.get(table).values];
  const rows = Object.fromEntries(Object.keys(IMPORT_TABLES).map((table) => [table, []]));
  const drop = (table, key, reason) => report.hit('R5', { table, key, reason, kept: false });
  const length = (table, key, label, value, maximum) => {
    if (typeof value !== 'string' || [...value].length > maximum) report.anomaly(table, key, `${label} 長度超過 ${maximum} 或不是文字`);
  };

  const professions = new Map(values('professions').map(([, value]) => [value.job_id, value]));
  const professionName = (id) => (id == null ? null : professions.get(id)?.name);

  // Placeholder members only survive when something references them (R3).
  const usage = usageIndex(tables);
  const members = new Map();
  for (const [uid, member] of values('members')) {
    if (PLACEHOLDER_UID.test(uid)) {
      const references = usage.count(uid);
      report.hit('R3', { table: 'members', key: uid, references, kept: references > 0 });
      if (!references) continue;
    }
    members.set(uid, member);
  }

  for (const [id, duty] of values('duties').sort(([, a], [, b]) => byTime('createdAt')(a, b))) {
    length('duties', id, '職責名稱', duty.name, 64);
    rows.duties.push({ id, name: duty.name, active: duty.active ? 1 : 0, revision: duty.revision, request_id: null, original_name: duty.name, created_at: duty.createdAt, updated_at: duty.updatedAt });
  }

  for (const [uid, member] of [...members].sort(([, a], [, b]) => byTime('joinedAt')(a, b))) {
    length('members', uid, 'UID', uid, 64);
    length('members', uid, '成員名稱', member.name, 64);
    const primary = professionName(member.primaryProfessionId);
    const secondary = professionName(member.secondaryProfessionId);
    if (!primary) report.anomaly('members', uid, '主職業對不到職業表');
    if (member.secondaryProfessionId != null && !secondary) report.anomaly('members', uid, '副職業對不到職業表');
    rows.members.push({
      uid, name: member.name, primary_profession_id: member.primaryProfessionId, secondary_profession_id: member.secondaryProfessionId ?? null,
      primary_profession: primary || '', secondary_profession: secondary || '', joined_at: member.joinedAt, updated_at: member.updatedAt,
      removed_at: null, revision: member.revision, is_in_guild: member.isInGuild ? 1 : 0, is_in_club: member.isInClub ? 1 : 0,
    });
  }

  for (const [id, entry] of values('name_history').sort(([, a], [, b]) => byTime('changedAt')(a, b))) {
    const member = members.get(entry.uid);
    if (!member) {
      drop('name_history', id, '成員不存在');
      continue;
    }
    if (PLACEHOLDER_HISTORY_NAME.test(entry.name)) report.hit('R1', { table: 'name_history', key: id, uid: entry.uid, name: entry.name, kept: true });
    if (entry.name === member.name) report.hit('R2', { table: 'name_history', key: id, uid: entry.uid, name: entry.name, kept: true });
    length('name_history', id, '曾用名', entry.name, 64);
    rows.member_name_history.push({ id, member_uid: entry.uid, name: entry.name, changed_at: entry.changedAt });
  }

  const events = new Map(values('events'));
  for (const [id, event] of [...events].sort(([, a], [, b]) => byTime('createdAt')(a, b))) {
    if (!EVENT_TYPES.has(event.type)) report.anomaly('events', id, `未知的場次類型 ${event.type}`);
    length('events', id, '場次標題', event.title, 120);
    if (!Array.isArray(event.dates) || !event.dates.length || event.dates.some((date) => !DATE.test(date)) || new Set(event.dates).size !== event.dates.length)
      report.anomaly('events', id, '場次日期格式不正確或重複');
    rows.scheduled_events.push({ id, title: event.title, type: event.type, request_id: legacyKey('event', id), created_at: event.createdAt, revision: event.revision, updated_at: event.updatedAt || '', deleted_at: event.deletedAt || null });
    for (const date of event.dates || []) rows.event_dates.push({ event_id: id, date });
  }

  for (const [key, response] of values('responses').sort(([a], [b]) => a.localeCompare(b))) {
    if (!events.has(response.eventId)) { drop('responses', key, '場次不存在'); continue; }
    if (!members.has(response.uid)) { drop('responses', key, '成員不存在'); continue; }
    if (!RESPONSE_STATUSES.has(response.status)) report.anomaly('responses', key, `未知的出席狀態 ${response.status}`);
    if (response.professionId != null && !professions.has(response.professionId)) report.anomaly('responses', key, '職業對不到職業表');
    rows.event_member_responses.push({ event_id: response.eventId, member_uid: response.uid, status: response.status, note: response.note || '', revision: response.revision, updated_at: response.updatedAt, profession_id: response.professionId ?? null });
  }

  const activeNames = new Set();
  for (const [id, registration] of values('registrations').sort(([, a], [, b]) => byTime('createdAt')(a, b))) {
    if (!events.has(registration.eventId)) { drop('registrations', id, '場次不存在'); continue; }
    if (NUMERIC_NAME.test(registration.name)) {
      const references = usage.count(id);
      report.hit('R4', { table: 'registrations', key: id, name: registration.name, references, kept: references > 0 });
      if (!references) continue;
    }
    if (!professions.has(registration.professionId)) report.anomaly('registrations', id, '職業對不到職業表');
    length('registrations', id, '報名名稱', registration.name, 64);
    // Mirrors the active_name generated column: ASCII-only case folding.
    const folded = `${registration.eventId}\u0000${registration.name.replace(/[A-Z]/g, (c) => c.toLowerCase())}`;
    if (registration.active) {
      if (activeNames.has(folded)) report.anomaly('registrations', id, '同場次有重複的有效報名名稱');
      activeNames.add(folded);
    }
    rows.event_registrations.push({ id, event_id: registration.eventId, name: registration.name, profession_id: registration.professionId, note: registration.note || '', active: registration.active ? 1 : 0, revision: registration.revision, request_id: legacyKey('registration', id), created_at: registration.createdAt, updated_at: registration.updatedAt });
  }

  for (const [id, video] of values('videos').sort(([, a], [, b]) => byTime('createdAt')(a, b))) {
    if (!events.has(video.eventId)) { drop('videos', id, '場次不存在'); continue; }
    if (!VIDEO_GROUPS.has(video.groupName)) report.anomaly('videos', id, `未知的影片分組 ${video.groupName}`);
    if (!video.firstUrl && !video.secondUrl) report.anomaly('videos', id, '影片沒有網址');
    if (video.professionId != null && !professions.has(video.professionId)) report.anomaly('videos', id, '職業對不到職業表');
    length('videos', id, '影片名稱', video.name, 64);
    rows.event_video_submissions.push({ id, event_id: video.eventId, name: video.name, first_url: video.firstUrl || '', second_url: video.secondUrl || '', note: video.note || '', created_at: video.createdAt, group_name: video.groupName, profession_id: video.professionId ?? null, profession_name: video.professionName ?? null, profession_colorcode: video.professionColorcode ?? null, revision: video.revision ?? 0 });
  }

  const lineupIds = new Set();
  const lineupVersions = new Set();
  for (const [id, lineup] of values('lineup_versions').sort(([, a], [, b]) => a.eventId.localeCompare(b.eventId) || a.version - b.version)) {
    if (!events.has(lineup.eventId)) { drop('lineup_versions', id, '場次不存在'); continue; }
    const versionKey = `${lineup.eventId}:${lineup.version}`;
    if (lineupVersions.has(versionKey)) report.anomaly('lineup_versions', id, '同場次有重複的排表版本');
    lineupVersions.add(versionKey);
    lineupIds.add(id);
    rows.lineup_versions.push({ id, event_id: lineup.eventId, version: lineup.version, request_id: legacyKey('lineup', id), payload_json: '{}', snapshot_json: JSON.stringify({ event: lineup.event, teams: lineup.teams }), created_at: lineup.createdAt });
  }

  const templateIds = new Set();
  for (const [id, template] of values('templates').sort(([, a], [, b]) => byTime('createdAt')(a, b))) {
    templateIds.add(id);
    length('templates', id, '範本名稱', template.name, 64);
    rows.lineup_templates.push({ id, name: template.name, request_id: legacyKey('template', id), payload_json: '{}', teams_json: JSON.stringify(template.teams), created_at: template.createdAt });
  }

  const battlePlayers = tables.get('battle_players').values;
  const battleIds = new Set();
  const rounds = new Set();
  for (const [id, battle] of values('battles').sort(([, a], [, b]) => byTime('createdAt')(a, b))) {
    if (battle.eventId != null && !events.has(battle.eventId)) { drop('battles', id, '場次不存在'); continue; }
    const players = battlePlayers.get(id)?.players;
    if (!Array.isArray(players)) { report.anomaly('battles', id, '戰績缺少玩家資料'); continue; }
    if (players.length !== battle.redCount + battle.blueCount) report.anomaly('battles', id, '玩家數與紅藍人數不符');
    if (battle.winner != null && !SIDES.has(battle.winner)) report.anomaly('battles', id, `未知的勝方 ${battle.winner}`);
    if (battle.ourSide != null && !SIDES.has(battle.ourSide)) report.anomaly('battles', id, `未知的我方 ${battle.ourSide}`);
    if (battle.roundNumber != null && ![1, 2].includes(battle.roundNumber)) report.anomaly('battles', id, `未知的場次輪數 ${battle.roundNumber}`);
    if (battle.eventId != null && battle.roundNumber != null) {
      const roundKey = `${battle.eventId}:${battle.roundNumber}`;
      if (rounds.has(roundKey)) report.anomaly('battles', id, '同場次同輪有兩筆戰績');
      rounds.add(roundKey);
    }
    battleIds.add(id);
    const uploadId = legacyKey('upload', id);
    rows.battle_uploads.push({ id: uploadId, request_id: uploadId, input_hash: battle.contentHash, image_name: null, image_type: null, image_data: null, created_at: battle.createdAt, image_file_id: null });
    // CSV bytes move to R2 in GM-30; until then csv_text stays empty like every v2 upload.
    rows.battle_records.push({
      id, upload_id: uploadId, event_id: battle.eventId ?? null, event_snapshot_json: battle.event ? JSON.stringify(battle.event) : null,
      battle_type: battle.type, played_at: battle.playedAt, red_team: battle.redTeam, blue_team: battle.blueTeam, winner: battle.winner ?? null,
      filename: battle.filename, csv_text: '', players_json: JSON.stringify(players), content_hash: battle.contentHash, created_at: battle.createdAt,
      round_number: battle.roundNumber ?? null, our_side: battle.ourSide ?? null, is_internal: battle.isInternal ? 1 : 0, revision: battle.revision ?? 0, csv_file_id: null,
    });
  }
  for (const id of battlePlayers.keys()) if (!battleIds.has(id) && !tables.get('battles').values.has(id)) drop('battle_players', id, '戰績不存在');

  for (const [key, link] of values('battle_links').sort(([, a], [, b]) => a.recordId.localeCompare(b.recordId) || a.playerIndex - b.playerIndex)) {
    if (!battleIds.has(link.recordId)) { drop('battle_links', key, '戰績不存在'); continue; }
    if (!members.has(link.memberUid)) { drop('battle_links', key, '成員不存在'); continue; }
    rows.battle_player_links.push({ record_id: link.recordId, player_index: link.playerIndex, member_uid: link.memberUid });
  }

  const overrideTargets = { lineup: lineupIds, battle: battleIds, template: templateIds };
  for (const [key, value] of values('requests').sort(([a], [b]) => a.localeCompare(b))) {
    const reference = key.match(/^member-ref:(lineup|battle|template):(.+)$/);
    if (reference) {
      if (!overrideTargets[reference[1]].has(reference[2])) { drop('requests', key, '對應的排表／戰績／範本不存在'); continue; }
      if (!Array.isArray(value.overrides)) { report.anomaly('requests', key, '成員對應修正格式不正確'); continue; }
      rows.member_reference_overrides.push({ kind: reference[1], record_id: reference[2], overrides_json: JSON.stringify(value.overrides) });
      continue;
    }
    const revision = key.match(/^member-revision:(.+)$/);
    if (revision) {
      if (!members.has(revision[1])) { drop('requests', key, '成員不存在'); continue; }
      rows.member_uid_revisions.push({ uid: revision[1], revision: value.revision });
      continue;
    }
    // Remaining keys are GAS retry results; v2 requestIds start fresh.
    if (!('hash' in value && 'result' in value)) report.anomaly('requests', key, '無法辨識的 requests 紀錄');
  }

  const lottery = tables.get('lottery').values.get('default');
  if (lottery) rows.lottery_boards.push({ id: 'default', board_json: JSON.stringify(lottery), revision: lottery.revision, updated_at: lottery.updatedAt ?? null });

  const platform = tables.get('settings').values.get('platform');
  const settings = {
    professions: [...professions.values()].map((value) => ({ job_id: value.job_id, colorcode: value.colorcode, name: value.name })),
    platform: platform ? { name: platform.name, revision: platform.revision, icon: platform.icon || null } : null,
  };
  if (platform) length('settings', 'platform', '平台名稱', platform.name, 64);
  for (const [key] of tables.get('settings').values) if (key !== 'platform') report.anomaly('settings', key, '無法辨識的設定');

  return { rows, settings, report };
}

// Counts references to an id across every place that can point at a member or registration.
// Member-ref overrides only remap old ids, so they do not count as use.
function usageIndex(tables) {
  const sources = [
    ...[...tables.get('lineup_versions').values.values()].map((value) => value.teams),
    ...[...tables.get('templates').values.values()].map((value) => value.teams),
    ...[...tables.get('battle_players').values.values()].map((value) => value.players),
    ...[...tables.get('responses').values.values()].map((value) => value.uid),
    ...[...tables.get('battle_links').values.values()].map((value) => value.memberUid),
  ].map((value) => JSON.stringify(value));
  return {
    count(id) {
      const needle = JSON.stringify(id);
      return sources.reduce((total, text) => total + text.split(needle).length - 1, 0);
    },
  };
}

export { CLEANING_RULES };
