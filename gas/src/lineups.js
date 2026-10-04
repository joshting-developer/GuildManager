import { validateLineup } from '../../src/domain/lineup-validation.js';
import { editableLineup, participantKey } from '../../src/domain/lineups.js';
import { canonical, fail, revision, retry, text } from './common.js';
export function createLineups(store, catalog, participation, { uuid, now }) {
  const versions = (eventId) =>
    store
      .all('lineup_versions')
      .filter((version) => version.eventId === eventId)
      .sort((a, b) => b.version - a.version);
  function event(id) {
    const current = catalog.event(id, { battle: true });
    if (current.dates.length !== 1) fail('EVENT_UNAVAILABLE', '排表需要單日戰鬥場次');
    const { title, type, dates, revision } = current;
    return { id, title, type, dates, revision };
  }
  function people(eventId) {
    const eligible = eventId
      ? participation.eligible(eventId)
      : {
          members: store.all('members'),
          registrations: store.all('registrations').filter((guest) => guest.active),
        };
    return new Map(
      [
        ...eligible.members,
        ...eligible.registrations.map((guest) => ({
          ...guest,
          uid: null,
          registrationId: guest.id,
          primaryProfessionId: guest.professionId,
          secondaryProfessionId: null,
        })),
      ].map((person) => [participantKey(person), person]),
    );
  }
  function snapshot(teams, eventId) {
    const current = people(eventId);
    function person(assignment) {
      if (!participantKey(assignment)) return { ...assignment, member: null };
      const value = current.get(participantKey(assignment));
      if (!value) fail('INELIGIBLE_MEMBER', '人員已請假、取消報名或不符合本場資格，請重新載入');
      if (!value[`${assignment.profession}ProfessionId`])
        fail('LINEUP_INVALID', `${value.name} 沒有可用的副職業，請重新選擇`);
      return {
        ...assignment,
        member: {
          uid: value.uid,
          name: value.name,
          ...(value.registrationId
            ? { registrationId: value.registrationId, eventId: value.eventId, note: value.note }
            : {}),
          primaryProfession: catalog.profession(value.primaryProfessionId),
          secondaryProfession: value.secondaryProfessionId
            ? catalog.profession(value.secondaryProfessionId)
            : null,
        },
      };
    }
    return teams.map((team) => ({
      ...team,
      slots: team.slots.map((slot) => ({
        ...person(slot),
        secondRound: slot.secondRound ? person(slot.secondRound) : null,
        duties: slot.dutyIds.map((id) => {
          const duty = store.get('duties', id);
          if (!duty?.active) fail('DUTY_UNAVAILABLE', '排表職責已停用或不存在，請移除後再儲存');
          return { id: duty.id, name: duty.name };
        }),
      })),
    }));
  }
  return {
    getLineupIndex() {
      const events = catalog
        .liveEvents()
        .filter((value) => ['scrimmage', 'guild_war', 'dragon_tiger'].includes(value.type));
      const ids = new Set(events.map((value) => value.id));
      const latest = new Map();
      for (const version of store.all('lineup_versions'))
        if (!latest.has(version.eventId) || latest.get(version.eventId).version < version.version)
          latest.set(version.eventId, version);
      for (const version of latest.values())
        if (!ids.has(version.eventId)) events.push({ ...version.event, archived: true });
      return {
        events: events.sort(
          (a, b) => b.dates[0].localeCompare(a.dates[0]) || a.title.localeCompare(b.title),
        ),
        templates: store.all('templates').sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      };
    },
    getLineupHistory: ([eventId]) => ({ versions: versions(eventId) }),
    confirmLineup([input]) {
      const teams = validateLineup(input?.teams);
      if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0)
        fail('LINEUP_INVALID', '排表版本不正確');
      return {
        version: retry(
          store,
          'confirmLineup',
          input.requestId,
          {
            eventId: input.eventId,
            expectedVersion: input.expectedVersion,
            eventRevision: input.eventRevision,
            teams,
          },
          () => {
            const current = event(input.eventId);
            revision(input.eventRevision, current.revision);
            const latest = versions(input.eventId)[0];
            if ((latest?.version || 0) !== input.expectedVersion)
              fail('LINEUP_CONFLICT', '排表已有新的儲存資料，請重新載入');
            const version = {
              id: uuid(),
              eventId: current.id,
              version: (latest?.version || 0) + 1,
              createdAt: now(),
              event: current,
              teams: snapshot(teams, current.id),
            };
            store.put('lineup_versions', version.id, version);
            return version;
          },
        ),
      };
    },
    createLineupTemplate([input]) {
      const name = text(input?.name, '範本名稱', 64),
        teams = validateLineup(input.teams);
      return {
        template: retry(store, 'createLineupTemplate', input.requestId, { name, teams }, () => {
          const template = { id: uuid(), name, teams: snapshot(teams), createdAt: now() };
          store.put('templates', template.id, template);
          return template;
        }),
      };
    },
    applyLineupTemplate([id, eventId]) {
      const currentEvent = event(eventId),
        template = store.get('templates', id);
      if (!template) fail('TEMPLATE_NOT_FOUND', '找不到這份範本，請重新載入');
      const current = people(eventId),
        skipped = [],
        skippedDuties = [];
      const teams = editableLineup(template.teams).map((team, teamIndex) => ({
        ...team,
        slots: team.slots.map((slot, slotIndex) => {
          const saved = template.teams[teamIndex].slots[slotIndex];
          function apply(person, round) {
            if (!participantKey(person)) return person;
            const value = current.get(participantKey(person));
            const reason = !value
              ? person.registrationId
                ? '額外報名不屬於本場或已取消'
                : '本場已請假或不符合資格'
              : !value[`${person.profession}ProfessionId`]
                ? '原本的職業已無法使用'
                : '';
            if (!reason) return person;
            skipped.push({
              uid: person.uid,
              ...(person.registrationId ? { registrationId: person.registrationId } : {}),
              name: (round === 2 ? saved.secondRound : saved)?.member?.name || '找不到人員',
              teamName: team.name,
              position: slotIndex + 1,
              round,
              reason,
            });
            if (round === 2) return null;
            const cleared = { ...person, uid: null, profession: 'primary' };
            delete cleared.registrationId;
            return cleared;
          }
          const dutyIds = slot.dutyIds.filter((id) => {
            const duty = store.get('duties', id);
            if (duty?.active) return true;
            skippedDuties.push({
              id,
              name: saved.duties?.find((item) => item.id === id)?.name || duty?.name || id,
              teamId: team.id,
              teamName: team.name,
              position: slotIndex + 1,
              reason: '職責已停用或不存在',
            });
            return false;
          });
          return { ...apply(slot, 1), secondRound: apply(slot.secondRound, 2), dutyIds };
        }),
      }));
      return { teams, skipped, skippedDuties, event: currentEvent };
    },
  };
}
