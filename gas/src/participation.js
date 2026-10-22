import { canonical, fail, hash, lower, revision, retry, text } from './common.js';
import { eventAttendance } from '../../src/domain/event-attendance.js';
import { leaveNotice } from '../../src/domain/discord-notifications.js';
import { participationTarget, validParticipationExpectation, sameParticipationTarget } from '../../src/domain/participation-target.js';
export function createParticipation(store, catalog, { uuid, now, notify = () => {} }) {
  // Queued notices are delivered by the RPC layer only after the store commits.
  function notifyLeave(eventId, action, name, professionId) {
    if (!action) return;
    const { title, type, dates } = catalog.event(eventId, { battle: true });
    const profession = professionId ? catalog.profession(professionId).name : '';
    notify({ type: 'leave', action, event: { title, type, date: dates[0] }, name, profession });
  }
  const responseKey = (eventId, uid) => canonical([eventId, uid]);
  const rawResponses = (eventId) =>
    store
      .all('responses')
      .filter((item) => item.eventId === eventId)
      .sort((a, b) => a.uid.localeCompare(b.uid));
  const guests = (eventId) =>
    store
      .all('registrations')
      .filter((item) => item.eventId === eventId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const currentRevision = (eventId, responses = rawResponses(eventId), registrations = guests(eventId)) =>
    hash(
      canonical([
        catalog.event(eventId, { battle: true }).revision,
        responses.map(({ uid, revision }) => [uid, revision]),
        registrations.map(({ id, revision }) => [id, revision]),
      ]),
    );
  const guestDto = (guest) => ({
    ...guest,
    profession: catalog.profession(guest.professionId).name,
    colorcode: catalog.profession(guest.professionId).colorcode,
  });
  function saveResponse(eventId, input) {
    catalog.event(eventId, { battle: true });
    const uid = text(input?.uid, '成員資料', 64),
      member = catalog.member(uid);
    const note = text(input.note ?? '', '備註', 160, false),
      status = input.status;
    if (!['registered', 'leave', 'none'].includes(status))
      fail('VALIDATION_ERROR', '請選擇報名或請假');
    const key = responseKey(eventId, uid),
      old = store.get('responses', key);
    const professionId = input.professionId ?? old?.professionId ?? null;
    if (professionId !== null) catalog.profession(professionId);
    const same =
      old && old.status === status && old.note === note && old.professionId === professionId;
    if (!(same && old.revision === input.revision + 1))
      revision(input.revision, old?.revision || 0);
    if (same) return old;
    const value = {
      eventId,
      uid,
      status,
      note,
      professionId,
      revision: (old?.revision || 0) + 1,
      updatedAt: now(),
    };
    store.put('responses', key, value);
    notifyLeave(
      eventId,
      leaveNotice(old?.status ?? 'none', status),
      member.name,
      professionId ?? member.primaryProfessionId,
    );
    return value;
  }
  function createGuest(eventId, input) {
    catalog.event(eventId, { battle: true });
    const name = text(input?.name, '名稱', 64),
      note = text(input.note ?? '', '備註', 160, false);
    catalog.profession(input.professionId);
    if (store.all('members').some((member) => lower(member.name) === lower(name)))
      fail('REGISTRATION_MEMBER', '這位成員已在名冊中，請使用報名表單');
    const matches = guests(eventId).filter((item) => lower(item.name) === lower(name));
    if (matches.some((item) => item.active)) fail('REGISTRATION_EXISTS', '這位人員已報名');
    const old = matches[matches.length - 1],
      id = old?.id || uuid();
    const value = {
      id,
      eventId,
      name,
      note,
      professionId: input.professionId,
      active: true,
      revision: (old?.revision || 0) + 1,
      createdAt: old?.createdAt || now(),
      updatedAt: now(),
    };
    store.put('registrations', id, value);
    return guestDto(value);
  }
  function submit(eventId, input) {
    const name = text(input?.name, '名稱', 64),
      note = text(input.note ?? '', '備註', 160, false),
      status = input.status;
    if (!['registered', 'leave'].includes(status)) fail('VALIDATION_ERROR', '請選擇報名或請假');
    if (typeof input.revision !== 'string' || !/^[a-f0-9]{64}$/.test(input.revision))
      fail('VALIDATION_ERROR', '資料版本不正確，請重新載入');
    if (input.expectedParticipant !== undefined && !validParticipationExpectation(input.expectedParticipant))
      fail('VALIDATION_ERROR', '人員資料版本不正確，請重新載入');
    const professionId = status === 'registered' ? input.professionId : null;
    const memberUid = input.memberUid === undefined ? null : text(input.memberUid, '成員資料', 64);
    const normalized = {
      eventId,
      name,
      note,
      status,
      professionId,
      memberUid,
      revision: input.revision,
      ...(input.expectedParticipant !== undefined ? { expectedParticipant: input.expectedParticipant } : {}),
    };
    return retry(store, 'submitParticipation', input.requestId, normalized, () => {
      const event = catalog.event(eventId, { battle: true });
      if (input.expectedParticipant !== undefined) {
        if (event.revision !== input.expectedParticipant.eventRevision)
          fail('EVENT_CHANGED', '場次已修改，請重新載入場次後再送出');
        const person = participationTarget(normalized, methods.getEventParticipationForm([eventId]));
        if (!sameParticipationTarget(person, input.expectedParticipant.person))
          fail('PARTICIPATION_CHANGED', '這位人員的資料已更新，請重新載入確認後再送出');
      } else if (currentRevision(eventId) !== input.revision)
        fail('PARTICIPATION_CHANGED', '本場報名資料已更新，請重新載入後再送出');
      if (status === 'registered') catalog.profession(professionId);
      const responses = rawResponses(eventId);
      const members = store
        .all('members')
        .filter(
          (member) =>
            lower(member.name) === lower(name) &&
            (memberUid
              ? member.uid === memberUid && (member.isInGuild || member.isInClub)
              : status === 'registered' ||
                member.isInGuild ||
                member.isInClub ||
                responses.some(
                  (row) => row.uid === member.uid && ['registered', 'leave'].includes(row.status),
                )),
        );
      if (memberUid && !members.length)
        fail('PARTICIPATION_MEMBER_CHANGED', '成員資料已更新，請重新載入名單後再選擇');
      const matchingGuests = memberUid
        ? []
        : guests(eventId)
            .filter((item) => lower(item.name) === lower(name))
            .sort(
              (a, b) =>
                Number(a.active) - Number(b.active) || a.updatedAt.localeCompare(b.updatedAt),
            );
      const guest = matchingGuests[matchingGuests.length - 1];
      if (members.length > 1 || (members.length && guest))
        fail('PARTICIPATION_AMBIGUOUS', '有同名資料，無法確認人員，請聯絡管理者');
      if (members.length) {
        const uid = members[0].uid;
        saveResponse(eventId, {
          uid,
          status,
          note,
          revision: store.get('responses', responseKey(eventId, uid))?.revision || 0,
          ...(professionId ? { professionId } : {}),
        });
      } else if (guest) {
        store.put('registrations', guest.id, {
          ...guest,
          active: status === 'registered',
          note,
          professionId: professionId || guest.professionId,
          revision: guest.revision + 1,
          updatedAt: now(),
        });
        notifyLeave(
          eventId,
          leaveNotice(guest.active ? 'registered' : 'leave', status),
          guest.name,
          professionId || guest.professionId,
        );
      } else if (status === 'registered') createGuest(eventId, { name, note, professionId });
      else fail('PARTICIPATION_NOT_FOUND', '沒有報名或沒有資料');
      return { eventId, name, status };
    });
  }
  const methods = {
    getEventAttendance([eventId]) {
      return eventAttendance(methods.getEventParticipation([eventId]));
    },
    cancelEventLeave([eventId, input]) {
      catalog.event(eventId, { battle: true });
      const id = text(input?.id, '人員資料', 64);
      if (!['member', 'registration'].includes(input?.source))
        fail('VALIDATION_ERROR', '人員來源不正確，請重新載入');
      if (!Number.isSafeInteger(input.revision) || input.revision < 1)
        fail('VALIDATION_ERROR', '資料版本不正確，請重新載入');
      const changed = () => fail('PARTICIPATION_CHANGED', '請假資料已更新，請重新載入後再操作');
      if (input.source === 'member') {
        const current = store.get('responses', responseKey(eventId, id));
        if (current?.status === 'none' && current.revision === input.revision + 1)
          return { eventId, cancelled: true };
        if (!current || current.status !== 'leave' || current.revision !== input.revision) changed();
        saveResponse(eventId, { uid: id, status: 'none', note: current.note, revision: input.revision });
      } else {
        const current = store.get('registrations', id);
        if (!current || current.eventId !== eventId) changed();
        if (current.active && current.revision === input.revision + 1)
          return { eventId, cancelled: true };
        if (
          current.active || current.revision !== input.revision ||
          !methods.getEventParticipation([eventId]).registrationLeaves.some((row) => row.id === id)
        ) changed();
        store.put('registrations', id, { ...current, active: true, revision: current.revision + 1, updatedAt: now() });
        notifyLeave(eventId, 'cancel', current.name, current.professionId);
      }
      return { eventId, cancelled: true };
    },
    getEventParticipation([eventId]) {
      catalog.event(eventId, { battle: true });
      // Load every referenced member and the profession table in one pass each;
      // looking them up row by row cost two Sheets reads per person.
      store.all('professions');
      const responses = rawResponses(eventId);
      store.getMany('members', responses.map((row) => row.uid));
      const allGuests = guests(eventId);
      const activeNames = new Set(allGuests.filter((row) => row.active).map((row) => lower(row.name)));
      return {
        eventId,
        revision: currentRevision(eventId, responses, allGuests),
        responses: responses.map((row) => {
          const member = catalog.member(row.uid),
            professionId = row.professionId || member.primaryProfessionId;
          const job = catalog.profession(professionId);
          return {
            ...row,
            name: member.name,
            professionId,
            profession: job.name,
            colorcode: job.colorcode,
          };
        }),
        registrations: allGuests.filter((row) => row.active).map(guestDto),
        registrationLeaves: allGuests
          .filter(
            (row) =>
              !row.active &&
              !activeNames.has(lower(row.name)),
          )
          .map(guestDto),
      };
    },
    getEventParticipationForm([eventId]) {
      // Warm the complete roster first so participation does not fetch members again.
      const roster = methods.getEventParticipationMembers([eventId]);
      const jobs = catalog.methods.getProfessions();
      return { ...methods.getEventParticipation([eventId]), ...roster, ...jobs };
    },
    getEventParticipationMembers([eventId]) {
      catalog.event(eventId, { battle: true });
      return {
        eventId,
        members: store
          .all('members')
          .filter((member) => member.isInGuild || member.isInClub)
          .map(
            ({ uid, name, primaryProfessionId, secondaryProfessionId, isInGuild, isInClub }) => ({
              uid,
              name,
              primaryProfessionId,
              secondaryProfessionId,
              isInGuild,
              isInClub,
            }),
          )
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    },
    submitParticipation: ([eventId, input]) => submit(eventId, input),
    saveMemberResponse: ([eventId, input]) => ({ response: saveResponse(eventId, input) }),
    addGuestRegistration: ([eventId, input]) => ({
      registration: retry(
        store,
        'addGuestRegistration',
        input?.requestId,
        { eventId, ...input },
        () => createGuest(eventId, input),
      ),
    }),
    // Managers delete a mistaken 本場外援 outright: no leave record and no Discord notice.
    deleteGuestRegistration([eventId, id, expected]) {
      catalog.event(eventId, { battle: true });
      if (!Number.isSafeInteger(expected) || expected < 0) fail('VALIDATION_ERROR', '資料版本不正確，請重新載入');
      const old = store.get('registrations', id);
      if (!old) return { deleted: true, id };
      if (old.eventId !== eventId) fail('REGISTRATION_NOT_FOUND', '找不到這筆報名');
      revision(expected, old.revision);
      store.remove('registrations', id);
      return { deleted: true, id };
    },
    cancelGuestRegistration([eventId, id, expected]) {
      catalog.event(eventId, { battle: true });
      const old = store.get('registrations', id);
      if (!old || old.eventId !== eventId) fail('REGISTRATION_NOT_FOUND', '找不到這筆報名');
      if (!old.active && old.revision === expected + 1) return { registration: guestDto(old) };
      revision(expected, old.revision);
      const value = { ...old, active: false, revision: old.revision + 1, updatedAt: now() };
      store.put('registrations', id, value);
      notifyLeave(eventId, 'leave', old.name, old.professionId);
      return { registration: guestDto(value) };
    },
  };
  function eligible(eventId) {
    const responses = rawResponses(eventId);
    // Roster members (幫會, 俱樂部 and 編外) are eligible unless on leave, as in eligibleMember.
    const members = store.all('members').filter(
      (member) => responses.find((row) => row.uid === member.uid)?.status !== 'leave',
    );
    return { members, registrations: guests(eventId).filter((guest) => guest.active) };
  }
  return { methods, eligible };
}
