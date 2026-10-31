import { projectReferences } from './member-maintenance.js';
import { validateLineup } from '../../src/domain/lineup-validation.js';
import { editableLineup, participantKey } from '../../src/domain/lineups.js';
import { canonical, fail, revision, retry, text } from './common.js';
import { withDefaultLineupEvent, lineupEditorEventId } from '../../src/domain/lineup-index.js';
export function createLineups(store, catalog, participation, { uuid, now }) {
  const projected = (kind, value) => projectReferences(store, kind, value.id, value);
  const versions = (eventId) =>
    store
      .all('lineup_versions')
      .filter((version) => version.eventId === eventId)
      .sort((a, b) => b.version - a.version)
      .map((value) => projectReferences(store, 'lineup', value.id, value));
  function latestVersion(eventId, records = store.all('lineup_versions')) {
    let latest = null;
    for (const value of records)
      if (value.eventId === eventId && (!latest || value.version > latest.version)) latest = value;
    return latest ? projected('lineup', latest) : null;
  }
  function lineupEvents(records = store.all('lineup_versions')) {
    const events = catalog.liveEvents().filter(value => ['scrimmage', 'guild_war', 'dragon_tiger'].includes(value.type));
    const ids = new Set(events.map(value => value.id)), latest = new Map();
    for (const value of records)
      if (!latest.has(value.eventId) || latest.get(value.eventId).version < value.version) latest.set(value.eventId, value);
    for (const value of latest.values())
      if (!ids.has(value.eventId)) events.push({ ...value.event, archived: true });
    return events.sort((a, b) => b.dates[0].localeCompare(a.dates[0]) || a.title.localeCompare(b.title));
  }
  function catalogs() {
    return { ...catalog.methods.getMembers(), ...catalog.methods.getProfessions(), ...catalog.methods.getDuties() };
  }
  function currentEvent(eventId, includeCatalogs = false, records) {
    eventId = text(eventId, '場次', 128);
    if (!eventId || typeof includeCatalogs !== 'boolean') fail('LINEUP_INVALID', '排表讀取選項格式不正確');
    const latest = latestVersion(eventId, records);
    const live = store.get('events', eventId);
    const current = live && !live.deletedAt && ['scrimmage', 'guild_war', 'dragon_tiger'].includes(live.type)
      ? event(eventId) : latest ? { ...latest.event, archived: true } : null;
    if (!current) fail('EVENT_UNAVAILABLE', '這場安排已無法排表，請重新載入');
    const sources = includeCatalogs ? catalogs() : {};
    return { event: current, versions: latest ? [latest] : [],
      participation: current.archived ? null : participation.methods.getEventParticipation([eventId]),
      ...sources };
  }
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
    getLineupIndex([options] = []) {
      const index = {
        events: lineupEvents(),
        templates: store.all('templates').map(value => projected('template', value)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      };
      if (options?.include !== 'default') return index;
      return withDefaultLineupEvent(index, {
        history: (id) => versions(id),
        participation: (id) => participation.methods.getEventParticipation([id]),
      });
    },
    getLineupEditor([preferredId] = []) {
      const records = store.all('lineup_versions');
      const events = lineupEvents(records);
      const eventId = lineupEditorEventId(events, preferredId);
      return { events, ...catalogs(),
        selected: eventId ? { eventId, ...currentEvent(eventId, false, records) } : null };
    },
    getLineupEvent: ([eventId, includeCatalogs = false]) => currentEvent(eventId, includeCatalogs),
    getLineupSources([eventId]) {
      const current = event(text(eventId, '場次', 128));
      return { event: current, ...catalogs(), participation: participation.methods.getEventParticipation([eventId]) };
    },
    getLineupTemplates() {
      return { templates: store.all('templates').map(({ id, name, createdAt }) => ({ id, name, createdAt }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
    },
    getLineupHistory: ([eventId]) => ({ versions: versions(eventId) }),
    confirmLineup([input]) {
      const teams = validateLineup(input?.teams);
      if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0)
        fail('LINEUP_INVALID', '排表版本不正確');
      return {
        version: projected('lineup', retry(
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
        )),
      };
    },
    createLineupTemplate([input]) {
      const name = text(input?.name, '範本名稱', 64),
        teams = validateLineup(input.teams),
        templateId = input.templateId == null ? null : text(input.templateId, '範本', 64);
      return {
        template: projected('template', retry(store, 'createLineupTemplate', input.requestId, { name, teams, ...(templateId ? { templateId } : {}) }, () => {
          // Saving back to a chosen template, or under a name already in use, updates it in place.
          const target = templateId
            ? store.get('templates', templateId)
            : store.all('templates').filter((value) => value.name === name)
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
          if (templateId && !target) fail('TEMPLATE_NOT_FOUND', '找不到這份範本，請重新載入');
          const template = { id: target?.id || uuid(), name, teams: snapshot(teams), createdAt: target?.createdAt || now() };
          store.put('templates', template.id, template);
          if (!target) return template;
          // The new snapshot holds current UIDs; older remaps no longer apply to it.
          store.remove('requests', `member-ref:template:${target.id}`);
          return { ...template, replaced: true };
        })),
      };
    },
    deleteLineupTemplate([id]) {
      text(id, '範本', 64);
      store.remove('templates', id);
      store.remove('requests', `member-ref:template:${id}`);
      return { deleted: true, id };
    },
    applyLineupTemplate([id, eventId]) {
      const currentEvent = event(eventId),
        rawTemplate = store.get('templates', id);
      const template = rawTemplate ? projectReferences(store, 'template', id, rawTemplate) : null;
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
