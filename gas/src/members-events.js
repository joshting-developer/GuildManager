import { validateMember } from '../../server/member-validation.js';
import { parseMemberImport } from '../../server/member-import.js';
import { validateEvent } from '../../src/domain/event-validation.js';
import { canonical, fail, hash, revision, retry, text } from './common.js';
import { linkNewMemberBattles } from './member-battle-links.js';

export const PROFESSIONS = [
  [1, '#ffb6c1', '素問'],
  [2, '#3cb371', '龍吟'],
  [3, '#add8e6', '碎夢'],
  [4, '#00bfff', '潮光'],
  [5, '#f0e68c', '玄機'],
  [6, '#9932cc', '九靈'],
  [7, '#ff8c00', '鐵衣'],
  [8, '#8b0000', '血河'],
  [9, '#4682b4', '神相'],
].map(([job_id, colorcode, name]) => ({ job_id, colorcode, name }));
export const battleType = (type) => ['scrimmage', 'guild_war', 'dragon_tiger'].includes(type);
export function createCatalog(store, { uuid, now, guildName }) {
  const professions = () => store.all('professions').sort((a, b) => a.job_id - b.job_id);
  function profession(id) {
    if (!Number.isSafeInteger(id) || id < 1) fail('VALIDATION_ERROR', '請選擇有效職業');
    const job = store.get('professions', id);
    if (!job) fail('VALIDATION_ERROR', '職業不存在，請重新載入職業清單');
    return job;
  }
  const memberDto = (member) => ({
    ...member,
    primaryProfession: profession(member.primaryProfessionId).name,
    primaryColorcode: profession(member.primaryProfessionId).colorcode,
    secondaryProfession: member.secondaryProfessionId
      ? profession(member.secondaryProfessionId).name
      : null,
    secondaryColorcode: member.secondaryProfessionId
      ? profession(member.secondaryProfessionId).colorcode
      : null,
    previousNames: store
      .all('name_history')
      .filter((item) => item.uid === member.uid)
      .sort((a, b) => b.changedAt.localeCompare(a.changedAt))
      .map(({ uid, ...item }) => item),
  });
  function member(uid) {
    const value = store.get('members', uid);
    if (!value) fail('MEMBER_NOT_FOUND', '找不到這位成員，請重新載入');
    return value;
  }
  function event(id, { archived = false, battle = false } = {}) {
    const value = store.get('events', id);
    if (!value || (!archived && value.deletedAt))
      fail('EVENT_NOT_FOUND', '找不到有效場次，請重新載入');
    if (battle && !battleType(value.type)) fail('EVENT_INVALID', '一般活動不支援戰鬥操作');
    return value;
  }
  const liveEvents = () =>
    store
      .all('events')
      .filter((item) => !item.deletedAt)
      .map(({ deletedAt, ...item }) => item)
      .sort((a, b) => a.dates[0].localeCompare(b.dates[0]) || a.id.localeCompare(b.id));
  function addMember(input, { linkBattles = true } = {}) {
    const value = validateMember(input);
    profession(value.primaryProfessionId);
    if (value.secondaryProfessionId) profession(value.secondaryProfessionId);
    if (store.get('members', value.uid))
      fail('DUPLICATE_UID', '這個 UID 已在成員清單中', { uid: '這個 UID 已存在' });
    const result = { ...value, revision: 1, joinedAt: now(), updatedAt: now() };
    store.put('members', value.uid, result);
    if (linkBattles) linkNewMemberBattles(store, [result]);
    return memberDto(result);
  }
  function preview(input) {
    const parsed = parseMemberImport(input?.text, professions()),
      states = [];
    const summary = { added: 0, restored: 0, skipped: 0 };
    const rows = parsed.rows.map((row) => {
      const existing = store.get('members', row.uid),
        action = existing ? 'skip' : 'add';
      states.push(existing?.revision ?? null);
      summary[existing ? 'skipped' : 'added']++;
      return { ...row, action };
    });
    return {
      rows,
      issues: parsed.issues,
      summary,
      fingerprint: parsed.issues.length ? null : hash(canonical({ rows, states })),
    };
  }
  const methods = {
    getProfessions: () => ({ professions: professions() }),
    getMembers: () => ({
      members: store
        .all('members')
        .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.uid.localeCompare(b.uid))
        .map(memberDto),
    }),
    getParticipationMembers: () => ({
      members: store
        .all('members')
        .map(({ uid, name }) => ({ uid, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }),
    addMember: ([input]) => ({ member: addMember(input) }),
    updateMember([uid, input]) {
      const values = validateMember(input, { editing: true }),
        old = member(uid);
      const same = Object.entries(values)
        .filter(([key]) => key !== 'revision')
        .every(([key, value]) => old[key] === value);
      // A lost response may be retried, but a distinct stale edit must never overwrite.
      if (same && old.revision === values.revision + 1) return { member: memberDto(old) };
      if (values.revision !== old.revision)
        fail('STALE_MEMBER', '這位成員的資料已更新，請重新載入後再操作');
      profession(values.primaryProfessionId);
      if (values.secondaryProfessionId) profession(values.secondaryProfessionId);
      if (same) return { member: memberDto(old) };
      if (old.name !== values.name) {
        const id = uuid();
        store.put('name_history', id, { id, uid, name: old.name, changedAt: now() });
      }
      const updated = { ...old, ...values, revision: old.revision + 1, updatedAt: now() };
      store.put('members', uid, updated);
      return { member: memberDto(updated) };
    },
    removeMember([uid, expected]) {
      const old = member(uid);
      if (
        !old.isInGuild &&
        !old.isInClub &&
        (old.revision === expected || old.revision === expected + 1)
      )
        return { uid, member: memberDto(old) };
      if (expected !== old.revision)
        fail('STALE_MEMBER', '這位成員的資料已更新，請重新載入後再操作');
      const updated = {
        ...old,
        isInGuild: false,
        isInClub: false,
        revision: old.revision + 1,
        updatedAt: now(),
      };
      store.put('members', uid, updated);
      return { uid, member: memberDto(updated) };
    },
    previewMemberImport: ([input]) => preview(input),
    importMembers([input]) {
      const result = preview(input);
      if (result.issues.length) {
        const error = new Error('資料有錯誤，請修正後重新預覽');
        Object.assign(error, { code: 'IMPORT_INVALID', rows: result.issues });
        throw error;
      }
      if (!input?.fingerprint || input.fingerprint !== result.fingerprint)
        fail('STALE_IMPORT', '資料或成員清單已變動，請重新預覽後再匯入');
      const members = result.rows
        .filter((row) => row.action === 'add')
        .map(({ uid, name, primaryProfessionId, secondaryProfessionId }) =>
          addMember(
            { uid, name, primaryProfessionId, secondaryProfessionId },
            { linkBattles: false },
          ),
        );
      linkNewMemberBattles(store, members);
      return { members, summary: result.summary };
    },
    getEvents: () => ({ events: liveEvents() }),
    createEvent([input]) {
      const values = validateEvent(input, { singleBattleDate: false });
      return retry(store, 'createEvent', values.requestId, values, () => {
        const batches = ['guild_war', 'dragon_tiger'].includes(values.type)
          ? values.dates.map((date) => [date])
          : [values.dates];
        const events = batches.map((dates) => {
          const value = {
            id: uuid(),
            title: values.title,
            type: values.type,
            dates,
            revision: 1,
            createdAt: now(),
            updatedAt: now(),
            deletedAt: null,
          };
          store.put('events', value.id, value);
          const { deletedAt, ...dto } = value;
          return dto;
        });
        return ['guild_war', 'dragon_tiger'].includes(values.type)
          ? { events }
          : { event: events[0] };
      });
    },
    updateEvent([id, input]) {
      const values = validateEvent(input, { requireRequestId: false }),
        old = event(id);
      const same =
        values.title === old.title &&
        values.type === old.type &&
        canonical(values.dates) === canonical(old.dates);
      if (!(same && old.revision === input.revision + 1)) revision(input.revision, old.revision);
      if (same) {
        const { deletedAt, ...dto } = old;
        return { event: dto };
      }
      const updated = {
        ...old,
        title: values.title,
        type: values.type,
        dates: values.dates,
        revision: old.revision + 1,
        updatedAt: now(),
      };
      store.put('events', id, updated);
      const { deletedAt, ...dto } = updated;
      return { event: dto };
    },
    deleteEvent([id, expected]) {
      const old = event(id, { archived: true });
      if (old.deletedAt && old.revision === expected + 1) return { id };
      revision(expected, old.revision);
      store.put('events', id, {
        ...old,
        revision: old.revision + 1,
        deletedAt: now(),
        updatedAt: now(),
      });
      return { id };
    },
    getDuties: () => ({
      duties: store
        .all('duties')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    }),
    addDuty([input]) {
      const name = text(input?.name, '職責', 40);
      if (store.all('duties').some((duty) => duty.name.toLowerCase() === name.toLowerCase()))
        fail('DUPLICATE_DUTY', '已有同名職責');
      const duty = {
        id: uuid(),
        name,
        active: true,
        revision: 1,
        createdAt: now(),
        updatedAt: now(),
      };
      store.put('duties', duty.id, duty);
      return { duty };
    },
    updateDuty([id, input]) {
      const old = store.get('duties', id);
      if (!old) fail('DUTY_NOT_FOUND', '找不到這個職責');
      const name = text(input?.name, '職責', 40),
        active = input.active;
      if (typeof active !== 'boolean') fail('VALIDATION_ERROR', '職責啟用狀態格式不正確');
      revision(input.revision, old.revision);
      if (
        store
          .all('duties')
          .some((duty) => duty.id !== id && duty.name.toLowerCase() === name.toLowerCase())
      )
        fail('DUPLICATE_DUTY', '已有同名職責');
      const updated = { ...old, name, active, revision: old.revision + 1, updatedAt: now() };
      store.put('duties', id, updated);
      return { duty: updated };
    },
    getHomeData: () => ({
      guild: { name: guildName },
      summary: {
        members: null,
        upcomingEvents: null,
        attendanceRate: null,
        pendingRegistrations: null,
      },
      events: liveEvents(),
      meta: { mode: liveEvents().length ? 'live' : 'empty', updatedAt: now() },
    }),
  };
  return { methods, profession, professions, member, event, liveEvents };
}
