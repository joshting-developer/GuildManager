<script setup>
import DataLoading from '../components/DataLoading.vue';
import { computed, ref, onMounted, onUnmounted, inject, nextTick, watch } from 'vue';
import {
  mdiFullscreen,
  mdiFullscreenExit,
  mdiSwordCross,
  mdiRefresh,
  mdiContentSaveOutline,
  mdiAccountGroupOutline,
  mdiAccountPlusOutline,
  mdiDownload,
} from '@mdi/js';
import { createLineupClient } from '../api/lineups.js';
import { createMemberClient } from '../api/members.js';
import {
  emptyLineup,
  editableLineup,
  eligibleMember,
  participantKey,
  participantReference,
  placeMember,
  addMemberToSlot,
  removeFromSlot,
  restoreToSlot,
  slotAssignments,
  LINEUP_GROUPS,
} from '../domain/lineups.js';
import { eventTypeLabel, eventDisplayTitle } from '../domain/event-types.js';
import { lineupPeople, lineupSourceMembers } from '../domain/lineup-sources.js';
import { lineupImageData, lineupJpeg, lineupImageFilename } from '../domain/lineup-image.js';
import { battleEventLabel, orderBattleEvents } from '../domain/battle-events.js';
import LineupBoard from './LineupBoard.vue';
import DutyList from './DutyList.vue';
import { createParticipationClient } from '../api/participation.js';

const emit = defineEmits(['focus-changed']);
const focusMode = ref(false);
let focusOpener = null,
  previousBodyOverflow = '';
function setFocusMode(value) {
  if (value) {
    focusOpener = document.activeElement;
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  } else document.body.style.overflow = previousBodyOverflow;
  focusMode.value = value;
  emit('focus-changed', value);
  nextTick(() => {
    if (value) document.getElementById('exit-lineup-focus')?.focus();
    else if (focusOpener?.isConnected) focusOpener.focus();
  });
}
const source = import.meta.env.VITE_DATA_SOURCE || 'local';
const client = createLineupClient({ source });
const memberClient = createMemberClient({ source });
const participationClient = createParticipationClient({ source });
const participation = ref({ responses: [], registrations: [] });
const memberTab = ref('guild');
const participantPeople = computed(() => lineupPeople(members.value, participation.value));
const participantsByKey = computed(() => new Map(
  participantPeople.value.map((person) => [participantKey(person), person]),
));
function findPerson(key) {
  return participantsByKey.value.get(key);
}
const sidebarTab = ref('members');
const duties = ref([]),
  catalogBusy = ref(false),
  dutyEditingDirty = ref(false),
  selectedDutyId = ref(''),
  skippedDuties = ref([]),
  seatDutyIds = ref([]);
const events = ref([]),
  templates = ref([]),
  members = ref([]),
  professions = ref([]),
  savedLineup = ref(null);
const templatesLoading = ref(false), templatesLoaded = ref(false), templateError = ref('');
let templateLoadToken = 0;
const eventId = ref(null),
  templateId = ref(null);
const teams = ref(emptyLineup()),
  baseline = ref(JSON.stringify(teams.value));
const loading = ref(true),
  lineupLoading = ref(false),
  membersLoading = ref(false),
  busy = ref(false),
  saving = ref(false),
  exporting = ref(false),
  error = ref(''),
  notice = ref(''),
  skipped = ref([]);
const selectedUid = ref(''),
  search = ref(''),
  professionId = ref(null);
const memberProfessions = ref(new Map());
function memberProfession(member) {
  return member?.secondaryProfessionId &&
    memberProfessions.value.get(participantKey(member)) === 'secondary'
    ? 'secondary'
    : 'primary';
}
function memberJob(member) {
  return professions.value.find(
    (job) => job.job_id === member?.[`${memberProfession(member)}ProfessionId`],
  );
}
function chooseMemberProfession(member, profession) {
  if (
    !readOnly.value && !member.isOnLeave &&
    (profession === 'primary' || member.secondaryProfessionId)
  ) {
    memberProfessions.value.set(participantKey(member), profession);
  }
}
const dialog = ref(null),
  templateName = ref(''),
  dialogError = ref(''),
  seat = ref(null),
  seatUid = ref(null),
  seatNote = ref(''),
  seatProfession = ref('primary'),
  seatSecondUid = ref(null),
  seatSecondProfession = ref('primary'),
  seatAlias = ref(''),
  seatSecondAlias = ref('');
const registrationName = ref(''),
  registrationProfessionId = ref(null),
  registrationNote = ref(''),
  registrationRevision = ref('');
let registrationAttempt = null;
let seatBaseline = '';
let operation = 0,
  disposed = false,
  saveAttempt = null,
  templateAttempt = null,
  dialogOpener = null;
const currentEvent = computed(() => events.value.find((event) => event.id === eventId.value));
const archived = computed(() => Boolean(currentEvent.value?.archived));
const displayedEvent = computed(() =>
  archived.value ? savedLineup.value?.event || currentEvent.value : currentEvent.value,
);
const readOnly = computed(() =>
  Boolean(archived.value || busy.value || catalogBusy.value || lineupLoading.value),
);
const displayedTeams = computed(() =>
  archived.value ? savedLineup.value?.teams || teams.value : teams.value,
);
const dirty = computed(() => JSON.stringify(teams.value) !== baseline.value);
const saveStatus = computed(() =>
  archived.value
    ? '已封存'
    : dirty.value
      ? '有未儲存修改'
      : savedLineup.value
        ? '已儲存'
        : '尚未儲存',
);
const dialogDirty = computed(() =>
  dialog.value === 'registration'
    ? Boolean(registrationName.value || registrationProfessionId.value || registrationNote.value)
    : dialog.value === 'template'
      ? Boolean(templateName.value.trim())
      : dialog.value === 'seat' &&
        JSON.stringify([
          seatUid.value,
          seatProfession.value,
          seatSecondUid.value,
          seatSecondProfession.value,
          seatNote.value,
          seatDutyIds.value,
          seatAlias.value,
          seatSecondAlias.value,
        ]) !== seatBaseline,
);
const latestVersion = computed(() => savedLineup.value?.version || 0);
const assigned = computed(
  () =>
    new Set(
      teams.value
        .flatMap((team) => team.slots)
        .flatMap(slotAssignments)
        .filter((person) => participantKey(person))
        .map(participantKey),
    ),
);
const count = computed(
  () =>
    displayedTeams.value
      .flatMap((team) => team.slots.flatMap(slotAssignments))
      .filter((person) => participantKey(person)).length,
);
const positionCount = computed(
  () =>
    displayedTeams.value
      .flatMap((team) => team.slots)
      .filter((slot) => slotAssignments(slot).some((person) => participantKey(person))).length,
);
const eligible = computed(() =>
  participantPeople.value.filter((member) => eligibleMember(member, currentEvent.value?.type)),
);
const eligibleKeys = computed(() => new Set(eligible.value.map(participantKey)));
watch(eligible, (people) => {
  if (selectedUid.value && !people.some((person) => participantKey(person) === selectedUid.value)) {
    selectedUid.value = '';
  }
});
const sourceMembers = computed(() =>
  lineupSourceMembers(participantPeople.value, {
    type: currentEvent.value?.type,
    tab: memberTab.value,
  }),
);
const MEMBER_SOURCE_TABS = [
  { value: 'guild', label: '幫會成員' },
  { value: 'club', label: '俱樂部成員' },
  { value: 'external', label: '編外成員' },
  { value: 'extra', label: '本場外援' },
];
const memberTabLabel = computed(
  () => ({ guild: '幫會成員', club: '俱樂部成員', external: '編外成員', extra: '本場外援' })[memberTab.value],
);
const availableSourceMembers = computed(() =>
  sourceMembers.value.filter((member) =>
    member.isOnLeave || !assigned.value.has(participantKey(member)),
  ),
);
const unassignedCount = computed(
  () => availableSourceMembers.value.filter((member) => !member.isOnLeave).length,
);
const visibleMembers = computed(() =>
  availableSourceMembers.value.filter((member) => {
    const needle = (search.value || '').trim().toLocaleLowerCase();
    return (
      (!needle ||
        `${member.name} ${member.registrationNote}`.toLocaleLowerCase().includes(needle)) &&
      (!professionId.value ||
        [member.primaryProfessionId, member.secondaryProfessionId].includes(professionId.value))
    );
  }),
);
const eventOptions = computed(() =>
  events.value.map((event) => ({
    title: `${battleEventLabel(event)}${event.archived ? '（已封存）' : ''}`,
    value: event.id,
  })),
);
const slotOptions = computed(() => [
  { title: '空位', value: null },
  ...eligible.value.map((member) => ({
    title: `${member.name}${member.registrationId ? '（本場外援）' : ''}${assigned.value.has(participantKey(member)) ? '（已安排，可移動或分場）' : ''}`,
    value: participantKey(member),
  })),
]);
function seatJobOptions(uid) {
  const member = findPerson(uid);
  return [
    { title: `主職業：${member?.primaryProfession || '未選成員'}`, value: 'primary' },
    ...(member?.secondaryProfessionId
      ? [{ title: `副職業：${member.secondaryProfession}`, value: 'secondary' }]
      : []),
  ];
}
// 本場外援 on the seat being edited can be deleted from here, since placed people are
// hidden from the member list.
const seatGuestKeys = computed(() =>
  [seatUid.value, seatSecondUid.value].filter((key) => key?.startsWith('registration:')),
);
const seatJobs = computed(() => seatJobOptions(seatUid.value));
const seatSecondJobs = computed(() => seatJobOptions(seatSecondUid.value));
// Each problem names the person, the seat and why, so the warning says who to fix.
const invalidSeats = computed(() =>
  teams.value.flatMap((team) => {
    const group = LINEUP_GROUPS.find((item) => team.id.startsWith(`${item.id}-`));
    return team.slots.flatMap((slot, index) =>
      slotAssignments(slot).flatMap((entry, round) => {
        const key = participantKey(entry);
        if (!key) return [];
        const person = findPerson(key);
        const reason = !eligibleKeys.value.has(key)
          ? person?.isOnLeave
            ? '已請假'
            : person
              ? '不符合本場資格'
              : '已不在名單或報名已取消'
          : !person?.[`${entry.profession}ProfessionId`]
            ? `沒有設定${entry.profession === 'secondary' ? '副' : '主'}職業`
            : '';
        if (!reason) return [];
        return [
          {
            key: `${team.id}-${index}-${round}`,
            name: person?.name || entry.member?.name || '找不到成員',
            seat: `${group?.name || ''} ${team.name} 第 ${index + 1} 位${slot.secondRound ? (round ? '（第二場）' : '（第一場）') : ''}`,
            reason,
          },
        ];
      }),
    );
  }),
);
const invalidAssignments = computed(() => invalidSeats.value.length);
const invalidDuties = computed(
  () =>
    teams.value
      .flatMap((team) => team.slots)
      .filter((slot) =>
        (slot.dutyIds || []).some(
          (id) => !duties.value.some((duty) => duty.id === id && duty.active),
        ),
      ).length,
);
const canSave = computed(
  () =>
    Boolean(currentEvent.value) &&
    !readOnly.value &&
    !invalidAssignments.value &&
    !invalidDuties.value &&
    (dirty.value || !savedLineup.value),
);
const seatDutyOptions = computed(() => [
  ...duties.value
    .filter((duty) => duty.active || seatDutyIds.value.includes(duty.id))
    .map((duty) => ({
      title: `${duty.name}${duty.active ? '' : '（停用，請移除）'}`,
      value: duty.id,
    })),
  ...seatDutyIds.value
    .filter((id) => !duties.value.some((duty) => duty.id === id))
    .map((id) => ({ title: '職責不存在（請移除）', value: id })),
]);
function updateDuties(data) {
  duties.value = data;
  if (!data.some((duty) => duty.id === selectedDutyId.value && duty.active))
    selectedDutyId.value = '';
}
function selectDuty(id) {
  selectedDutyId.value = id;
  selectedUid.value = '';
}
function selectMember(uid) {
  if (readOnly.value || !eligible.value.some((member) => participantKey(member) === uid)) return;
  selectedUid.value = selectedUid.value === uid ? '' : uid;
  selectedDutyId.value = '';
}
function assignDuty(id, teamId, index) {
  if (readOnly.value) return;
  lastRemoval.value = null;
  if (!duties.value.some((duty) => duty.id === id && duty.active)) {
    error.value = '這項職責已停用或不存在，請更新職責清單';
    return;
  }
  const slot = teams.value.find((team) => team.id === teamId)?.slots[index];
  if (!slot) return;
  if (!slot.dutyIds) slot.dutyIds = [];
  if (!slot.dutyIds.includes(id)) slot.dutyIds.push(id);
  selectedDutyId.value = '';
  notice.value = '已分配職責，請儲存排表。';
}
const qualification = computed(() =>
  memberTab.value === 'guild'
    ? '幫派內成員；已請假者列於最下方，無法安排。'
    : memberTab.value === 'club'
      ? '僅俱樂部成員；已請假者列於最下方，無法安排。'
      : memberTab.value === 'external'
        ? '名冊中的編外成員，不必報名即可安排；本場已報名者排在最前，已請假者列於最下方，無法安排。'
        : '只報名本場、不在名冊的外援；已請假者列於最下方，無法安排。',
);
function mayDiscard(message = '排表有尚未儲存的修改，確定要放棄嗎？') {
  return (
    !(busy.value || catalogBusy.value) &&
    (!(dirty.value || dialogDirty.value || dutyEditingDirty.value) || window.confirm(message))
  );
}
const registerGuard = inject('registerNavigationGuard', null);
const unregisterGuard = registerGuard?.(() => mayDiscard());
function beforeUnload(event) {
  if (
    dirty.value ||
    dialogDirty.value ||
    dutyEditingDirty.value ||
    busy.value ||
    catalogBusy.value
  ) {
    event.preventDefault();
    event.returnValue = '';
  }
}
function resetLineup(data) {
  teams.value = editableLineup(data || emptyLineup());
  baseline.value = JSON.stringify(teams.value);
  selectedUid.value = '';
  selectedDutyId.value = '';
  saveAttempt = null;
}
async function load() {
  if (!mayDiscard()) return;
  const token = ++operation;
  templateLoadToken++;
  templates.value = [];
  templatesLoaded.value = templatesLoading.value = false;
  templateError.value = '';
  loading.value = true;
  lineupLoading.value = false;
  error.value = '';
  try {
    const data = await client.getEditor(eventId.value);
    if (disposed || token !== operation) return;
    events.value = orderBattleEvents(data.events, { prefer: 'upcoming' });
    updateCatalogs(data);
    if (data.selected) applyEvent(data.selected.eventId, data.selected, data.selected.participation);
    else {
      eventId.value = null;
      savedLineup.value = null;
      resetLineup();
    }
  } catch (cause) {
    if (!disposed && token === operation) error.value = cause.message;
  } finally {
    if (!disposed && token === operation) loading.value = false;
  }
}
function updateCatalogs(data) {
  duties.value = data.duties;
  members.value = data.members;
  professions.value = data.professions;
}
async function loadEvent(id) {
  lastRemoval.value = null;
  const token = ++operation;
  lineupLoading.value = true;
  error.value = '';
  notice.value = '';
  skipped.value = [];
  skippedDuties.value = [];
  try {
    const data = await client.getEvent(id);
    if (disposed || token !== operation) return;
    applyEvent(id, data, data.participation);
  } catch (cause) {
    if (!disposed && token === operation) error.value = cause.message;
  } finally {
    if (!disposed && token === operation) lineupLoading.value = false;
  }
}
function applyEvent(id, data, responses) {
  lastRemoval.value = null;
  notice.value = '';
  skipped.value = [];
  skippedDuties.value = [];
  participation.value = responses || { responses: [], registrations: [] };
  if (data.event) events.value = events.value.map(event => event.id === id ? data.event : event);
  eventId.value = id;
  savedLineup.value = data.versions[0] || null;
  resetLineup(savedLineup.value?.teams);
  templateId.value = null;
}
async function loadTemplates(open = true) {
  if (!open || templatesLoaded.value || templatesLoading.value) return;
  const token = ++templateLoadToken;
  templatesLoading.value = true;
  templateError.value = '';
  try {
    const data = await client.getTemplates();
    if (disposed || token !== templateLoadToken) return;
    templates.value = data.templates;
    templatesLoaded.value = true;
  } catch (cause) {
    if (!disposed && token === templateLoadToken) templateError.value = cause.message;
  } finally {
    if (!disposed && token === templateLoadToken) templatesLoading.value = false;
  }
}
async function changeEvent(id) {
  if (id !== eventId.value && mayDiscard()) await loadEvent(id);
}
// Deleting a 本場外援 removes the registration itself (no leave record, no Discord notice)
// and takes them off every seat of this draft; the lineup still needs saving.
async function deleteGuest(key) {
  if (readOnly.value || !key?.startsWith('registration:')) return;
  const id = key.slice('registration:'.length);
  const row = [
    ...(participation.value.registrations || []),
    ...(participation.value.registrationLeaves || []),
  ].find((item) => item.id === id);
  const name = row?.name || findPerson(key)?.name || '這位外援';
  if (!row) {
    error.value = `找不到 ${name} 的報名資料，請更新成員清單後再試。`;
    return;
  }
  if (!window.confirm(`確定刪除「${name}」的本場外援報名？會一併從排表拿掉，刪除後無法復原。`)) return;
  busy.value = true;
  error.value = '';
  try {
    await client.deleteGuest(eventId.value, id, row.revision);
    let removedSeats = 0;
    for (const team of teams.value)
      team.slots.forEach((slot, index) => {
        for (const round of [1, 2])
          if (participantKey(round === 1 ? slot : slot.secondRound) === key && removeFromSlot(teams.value, team.id, index, round))
            removedSeats += 1;
      });
    lastRemoval.value = null;
    if (selectedUid.value === key) selectedUid.value = '';
    if (dialog.value === 'seat') dialog.value = null;
    participation.value = await participationClient.getParticipation(eventId.value);
    notice.value = removedSeats
      ? `已刪除 ${name} 的本場外援報名並從排表拿掉，請儲存排表。`
      : `已刪除 ${name} 的本場外援報名。`;
  } catch (cause) {
    error.value = `刪除 ${name} 失敗：${cause.message}`;
  } finally {
    busy.value = false;
  }
}
// Removing a seat (✕ or dragging it back to the member list) keeps an undo until the next edit.
const lastRemoval = ref(null);
const draggingSeat = ref(false);
function removeSeat(teamId, index, round) {
  if (readOnly.value) return;
  const removed = removeFromSlot(teams.value, teamId, index, round);
  if (!removed) return;
  const name = findPerson(removed.key)?.name || '成員';
  lastRemoval.value = { teamId, index, round, removed, name };
  error.value = '';
  skipped.value = [];
  notice.value = `已移除 ${name}，請儲存排表。`;
}
function undoRemoval() {
  const removal = lastRemoval.value;
  lastRemoval.value = null;
  if (!removal) return;
  if (restoreToSlot(teams.value, removal.teamId, removal.index, removal.round, removal.removed))
    notice.value = `已復原 ${removal.name}，請儲存排表。`;
  else {
    notice.value = '';
    error.value = `${removal.name} 已安排到其他位置或原位置已有人，無法復原。`;
  }
}
function seatDragOver(event) {
  if (readOnly.value || !event.dataTransfer.types.includes('application/x-guild-seat')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  draggingSeat.value = true;
}
// A seat dropped anywhere else (or a cancelled drag) must not leave the drop zone highlighted.
function endSeatDrag() {
  draggingSeat.value = false;
}
window.addEventListener('dragend', endSeatDrag);
onUnmounted(() => window.removeEventListener('dragend', endSeatDrag));
function seatDrop(event) {
  draggingSeat.value = false;
  const raw = event.dataTransfer.getData('application/x-guild-seat');
  if (!raw || readOnly.value) return;
  event.preventDefault();
  try {
    const { teamId, index, round } = JSON.parse(raw);
    removeSeat(teamId, index, round);
  } catch {}
}
function place(uid, teamId, index, profession) {
  if (readOnly.value) return false;
  lastRemoval.value = null;
  if (!eligible.value.some((member) => participantKey(member) === uid)) {
    error.value = '這位成員不符合本場資格，請重新載入成員清單';
    return false;
  }
  if (
    profession !== undefined &&
    (!['primary', 'secondary'].includes(profession) ||
      (profession === 'secondary' && !findPerson(uid)?.secondaryProfessionId))
  ) {
    error.value = '這位成員沒有可使用的副職業，請重新選擇職業';
    return false;
  }
  if (!addMemberToSlot(teams.value, uid, teamId, index)) {
    error.value = '這個位置已有第一場與第二場的成員，請點位置編輯後再調整。';
    return false;
  }
  if (profession !== undefined) {
    const entry = teams.value
      .flatMap((team) => team.slots)
      .flatMap(slotAssignments)
      .find((person) => participantKey(person) === uid);
    entry.profession = profession;
  }
  error.value = '';
  selectedUid.value = '';
  notice.value = '已安排位置，請儲存排表。';
  skipped.value = [];
  return true;
}
function drag(event, member) {
  if (readOnly.value || !eligibleMember(member, currentEvent.value?.type)) {
    event.preventDefault();
    return;
  }
  event.dataTransfer.setData('application/x-guild-member', participantKey(member));
  event.dataTransfer.setData('application/x-guild-profession', memberProfession(member));
  event.dataTransfer.effectAllowed = 'move';
}
function renameTeam(id, name) {
  if (!readOnly.value) teams.value.find((team) => team.id === id).name = name;
}
function openDialog(type) {
  dialogOpener = document.activeElement;
  dialogError.value = '';
  dialog.value = type;
  if (type === 'template') {
    templateName.value = '';
    templateAttempt = null;
  } else if (type === 'registration') {
    registrationName.value = '';
    registrationProfessionId.value = null;
    registrationNote.value = '';
    registrationRevision.value = '';
    registrationAttempt = null;
    reloadRegistration();
  }
}
async function reloadRegistration() {
  if (busy.value) return;
  busy.value = true;
  dialogError.value = '';
  registrationRevision.value = '';
  try {
    const responses = await participationClient.getParticipation(eventId.value);
    if (disposed) return;
    if (responses.eventId !== eventId.value || !responses.revision) {
      throw new Error('資料格式不正確, 請重新載入');
    }
    participation.value = responses;
    registrationRevision.value = responses.revision;
  } catch (cause) {
    dialogError.value = cause.message;
  } finally {
    busy.value = false;
  }
}
async function submitRegistration() {
  if (readOnly.value || !registrationRevision.value) return;
  dialogError.value = '';
  if (!registrationName.value.trim()) {
    dialogError.value = '請填寫名稱';
    return;
  }
  if (!registrationProfessionId.value) {
    dialogError.value = '請選擇職業';
    return;
  }
  const input = {
    name: registrationName.value.trim(),
    professionId: registrationProfessionId.value,
    status: 'registered',
    note: registrationNote.value.trim(),
    revision: registrationRevision.value,
  };
  registrationAttempt = attempt(registrationAttempt, input);
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const result = await participationClient.submitParticipation(eventId.value, {
      ...input,
      requestId: registrationAttempt.requestId,
    });
    if (disposed) return;
    if (
      result.eventId !== eventId.value ||
      result.name !== input.name ||
      result.status !== 'registered'
    ) {
      throw new Error('回應格式不正確, 請重試以確認結果');
    }
    notice.value = '報名成功';
    try {
      const [people, responses] = await Promise.all([
        memberClient.getMembers(),
        participationClient.getParticipation(eventId.value),
      ]);
      if (disposed) return;
      members.value = people.members;
      participation.value = responses;
      const member = members.value.find(
        (row) => row.name.toLocaleLowerCase() === input.name.toLocaleLowerCase(),
      );
      memberTab.value = member?.isInGuild ? 'guild' : member?.isInClub ? 'club' : member ? 'external' : 'extra';
      search.value = '';
      professionId.value = null;
    } catch (cause) {
      error.value = `報名已成功, 名單更新失敗: ${cause.message}。請更新成員清單`;
    }
    dialog.value = null;
  } catch (cause) {
    dialogError.value = cause.message;
  } finally {
    busy.value = false;
  }
}
function closeDialog() {
  if (
    !busy.value &&
    (!dialogDirty.value || window.confirm('視窗有尚未套用或儲存的修改，確定要關閉嗎？'))
  )
    dialog.value = null;
}
function restoreFocus() {
  nextTick(() => {
    if (dialogOpener?.isConnected) dialogOpener.focus();
    else document.getElementById(focusMode.value ? 'exit-lineup-focus' : 'lineup-event')?.focus();
  });
}
function openSeat(teamId, index) {
  seat.value = { teamId, index };
  const slot = teams.value.find((team) => team.id === teamId).slots[index];
  seatUid.value = participantKey(slot);
  seatNote.value = slot.note;
  seatProfession.value = slot.profession;
  seatSecondUid.value = participantKey(slot.secondRound);
  seatSecondProfession.value = slot.secondRound?.profession || 'primary';
  seatDutyIds.value = [...(slot.dutyIds || [])];
  seatAlias.value = slot.alias || '';
  seatSecondAlias.value = slot.secondRound?.alias || '';
  seatBaseline = JSON.stringify([
    seatUid.value,
    seatProfession.value,
    seatSecondUid.value,
    seatSecondProfession.value,
    seatNote.value,
    seatDutyIds.value,
    seatAlias.value,
    seatSecondAlias.value,
  ]);
  openDialog('seat');
}
function saveSeat() {
  lastRemoval.value = null;
  if (seatUid.value && seatUid.value === seatSecondUid.value) {
    dialogError.value = '第一場與第二場請安排不同成員；同一人兩場沿用時，第二場選空位即可。';
    return;
  }
  const choices = [
    { key: seatUid.value, profession: seatProfession.value, alias: seatAlias.value.trim() },
    {
      key: seatSecondUid.value,
      profession: seatSecondProfession.value,
      alias: seatSecondAlias.value.trim(),
    },
  ];
  for (const person of choices) {
    if (
      person.key &&
      (!eligible.value.some((member) => participantKey(member) === person.key) ||
        !findPerson(person.key)?.[`${person.profession}ProfessionId`])
    ) {
      dialogError.value = '成員資格或上場職業已無法使用，請重新選擇。';
      return;
    }
  }
  const slot = teams.value.find((team) => team.id === seat.value.teamId).slots[seat.value.index];
  choices.forEach((person, index) => {
    if (person.key)
      placeMember(teams.value, person.key, seat.value.teamId, seat.value.index, index + 1);
    const reference = {
      ...participantReference(person.key, person.key ? person.profession : 'primary'),
      ...(person.key && person.alias ? { alias: person.alias } : {}),
    };
    if (index === 0) {
      delete slot.registrationId;
      delete slot.alias;
      Object.assign(slot, reference);
    } else slot.secondRound = person.key ? reference : null;
  });
  slot.note = seatNote.value.trim();
  slot.dutyIds = [...seatDutyIds.value];
  error.value = '';
  notice.value = '已套用分場配置，請儲存排表。';
  selectedUid.value = '';
  dialog.value = null;
}
function changeSeatUid(uid) {
  seatUid.value = uid;
  seatProfession.value = 'primary';
  seatAlias.value = '';
}
async function refreshMembers() {
  busy.value = true;
  membersLoading.value = true;
  error.value = '';
  try {
    const data = await client.getSources(eventId.value);
    if (disposed) return;
    participation.value = data.participation || { responses: [], registrations: [] };
    updateCatalogs(data);
    events.value = events.value.map(event => event.id === data.event.id ? data.event : event);
    notice.value = '成員清單已更新，目前的排表仍保留。';
  } catch (cause) {
    error.value = cause.message;
  } finally {
    busy.value = false;
    membersLoading.value = false;
  }
}
function attempt(previous, payload) {
  const encoded = JSON.stringify(payload);
  return previous?.payload === encoded
    ? previous
    : { payload: encoded, requestId: crypto.randomUUID() };
}
async function saveLineup() {
  if (!canSave.value) return;
  busy.value = true;
  saving.value = true;
  error.value = '';
  notice.value = '';
  try {
    const payload = {
      eventId: eventId.value,
      eventRevision: currentEvent.value.revision,
      expectedVersion: latestVersion.value,
      teams: editableLineup(teams.value),
    };
    saveAttempt = attempt(saveAttempt, payload);
    const data = await client.confirm({ ...payload, requestId: saveAttempt.requestId });
    if (
      data.version?.eventId !== eventId.value ||
      data.version?.version !== latestVersion.value + 1 ||
      !Array.isArray(data.version?.teams)
    )
      throw new Error('排表回應格式不正確，請重試以確認儲存結果');
    savedLineup.value = data.version;
    resetLineup(data.version.teams);
    error.value = '';
    notice.value = `排表已儲存，共 ${count.value} 位成員。`;
  } catch (cause) {
    error.value = cause.message;
  } finally {
    saving.value = false;
    busy.value = false;
  }
}
async function saveTemplate() {
  if (!templateName.value.trim()) {
    dialogError.value = '請填寫範本名稱';
    return;
  }
  busy.value = true;
  dialogError.value = '';
  try {
    const payload = {
      name: templateName.value.trim(),
      teams: editableLineup(displayedTeams.value),
    };
    templateAttempt = attempt(templateAttempt, payload);
    const data = await client.createTemplate({ ...payload, requestId: templateAttempt.requestId });
    if (!data.template?.id || !Array.isArray(data.template?.teams))
      throw new Error('範本回應格式不正確，請重試以確認結果');
    templateLoadToken++;
    templatesLoading.value = false;
    if (!templates.value.some((template) => template.id === data.template.id))
      templates.value.unshift({ id: data.template.id, name: data.template.name, createdAt: data.template.createdAt });
    templateId.value = data.template.id;
    dialog.value = null;
    notice.value = `已儲存範本「${data.template.name}」，其他場次可重複套用。`;
  } catch (cause) {
    dialogError.value = cause.message;
  } finally {
    busy.value = false;
  }
}
async function applyTemplate() {
  if (
    !templateId.value ||
    !mayDiscard('套用範本會取代目前的隊名、位置、職責及備註，確定要套用嗎？')
  )
    return;
  busy.value = true;
  error.value = '';
  try {
    const data = await client.applyTemplate(templateId.value, eventId.value);
    const current = await client.getSources(eventId.value);
    if (disposed) return;
    participation.value = current.participation || { responses: [], registrations: [] };
    updateCatalogs(current);
    teams.value = data.teams;
    selectedUid.value = '';
    selectedDutyId.value = '';
    skipped.value = data.skipped;
    skippedDuties.value = data.skippedDuties || [];
    events.value = events.value.map((event) => (event.id === data.event.id ? data.event : event));
    notice.value = `範本已套用${data.skipped.length ? `，跳過 ${data.skipped.length} 位成員` : ''}${skippedDuties.value.length ? `，跳過 ${skippedDuties.value.length} 項停用職責` : ''}，請儲存排表。`;
  } catch (cause) {
    error.value = cause.message;
  } finally {
    busy.value = false;
  }
}
onMounted(() => {
  load();
  window.addEventListener('beforeunload', beforeUnload);
});
async function downloadLineupImage() {
  if (
    !displayedEvent.value ||
    loading.value ||
    lineupLoading.value ||
    busy.value ||
    catalogBusy.value
  )
    return;
  const data = lineupImageData({
    event: displayedEvent.value,
    teams: displayedTeams.value,
    members: participantPeople.value,
    professions: professions.value,
    duties: duties.value,
    snapshots: archived.value,
    status: saveStatus.value,
    theme: document.documentElement.dataset.theme,
  });
  busy.value = true;
  exporting.value = true;
  error.value = '';
  try {
    const blob = await lineupJpeg(data);
    if (disposed) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = lineupImageFilename(data);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    notice.value = '已下載 JPG, 內容為目前排表。';
  } catch (cause) {
    if (!disposed) error.value = `排表圖片下載失敗: ${cause.message}。請再試一次`;
  } finally {
    busy.value = false;
    exporting.value = false;
  }
}
onUnmounted(() => {
  if (focusMode.value) {
    document.body.style.overflow = previousBodyOverflow;
    emit('focus-changed', false);
  }
  disposed = true;
  operation++;
  templateLoadToken++;
  unregisterGuard?.();
  window.removeEventListener('beforeunload', beforeUnload);
});
</script>

<template>
  <div :class="['lineups-page', { 'lineup-focus-mode': focusMode }]">
    <section v-show="!focusMode" class="page-heading" aria-labelledby="lineups-title">
      <div>
        <p class="eyebrow">GUILD MANAGER / 戰場</p>
        <h1 id="lineups-title">戰場排表<span class="heading-dot">.</span></h1>
        <p class="page-subtitle">直接編輯並儲存出戰名單，想保留的配置可另存範本。</p>
      </div>
      <div class="lineup-heading-actions">
        <v-btn
          v-if="currentEvent"
          variant="outlined"
          :prepend-icon="mdiDownload"
          :loading="exporting"
          :disabled="loading || lineupLoading || busy || catalogBusy"
          @click="downloadLineupImage"
          >{{ exporting ? '產生中…' : '下載 JPG' }}</v-btn
        >
        <v-btn
          v-if="currentEvent"
          variant="outlined"
          :prepend-icon="mdiFullscreen"
          :disabled="loading || lineupLoading"
          @click="setFocusMode(true)"
          >專注排表</v-btn
        >
        <v-btn
          variant="outlined"
          :prepend-icon="mdiRefresh"
          :disabled="loading || busy || catalogBusy || lineupLoading"
          @click="load"
          >重新載入</v-btn
        >
      </div>
    </section>
    <div v-if="focusMode" class="lineup-focus-bar">
      <div class="lineup-focus-caption">
        <strong>{{ eventDisplayTitle(displayedEvent) }}</strong
        ><span
          >{{ eventTypeLabel(displayedEvent?.type) }} · {{ displayedEvent?.dates[0] }} ·
          {{ positionCount }} / 60 個位置 · {{ count }} 人 · {{ saveStatus }}</span
        >
      </div>
      <div class="lineup-actions">
        <v-btn
          variant="outlined"
          :prepend-icon="mdiDownload"
          :loading="exporting"
          :disabled="loading || lineupLoading || busy || catalogBusy"
          @click="downloadLineupImage"
          >{{ exporting ? '產生中…' : '下載 JPG' }}</v-btn
        >
        <v-btn variant="outlined" :disabled="busy || catalogBusy" @click="openDialog('template')"
          >另存範本</v-btn
        ><v-btn
          v-if="!archived"
          color="primary"
          :loading="saving"
          :disabled="!canSave"
          @click="saveLineup"
          >{{ saving ? '儲存中…' : '儲存排表' }}</v-btn
        ><v-btn
          id="exit-lineup-focus"
          variant="outlined"
          :prepend-icon="mdiFullscreenExit"
          @click="setFocusMode(false)"
          >返回一般檢視</v-btn
        >
      </div>
    </div>
    <v-alert v-if="error" type="error" variant="tonal" class="lineup-alert" role="alert"
      >{{ error }}<v-btn v-if="!currentEvent" variant="text" @click="load">重試</v-btn></v-alert
    >
    <v-alert
      v-if="notice && !currentEvent"
      type="success"
      variant="tonal"
      class="lineup-alert"
      role="status"
      >{{ notice }}</v-alert
    >
    <DataLoading v-if="busy && !membersLoading && !dialog" compact :spinner="!saving">{{ saving ? '正在儲存排表，請稍候…' : '正在處理排表資料…' }}</DataLoading>
    <DataLoading v-if="loading">正在載入戰場與成員資料…</DataLoading>
    <v-card v-else-if="!events.length && !error" class="lineup-empty"
      ><v-icon :icon="mdiSwordCross" size="32" />
      <h2>尚無戰鬥場次</h2>
      <p>先到「活動安排」建立約戰、幫戰或龍虎戰，再回來安排成員。</p></v-card
    >
    <DutyList
      v-if="!loading && !events.length && !error"
      :duties="duties"
      :disabled="busy"
      :assignable="false"
      @updated="updateDuties"
      @busy-changed="catalogBusy = $event"
      @unsaved-changed="dutyEditingDirty = $event"
    />
    <template v-if="!loading && events.length">
      <v-card v-show="!focusMode" class="lineup-toolbar">
        <div class="lineup-selects">
          <v-select
            id="lineup-event"
            :model-value="eventId"
            :items="eventOptions"
            label="戰鬥場次"
            density="compact"
            variant="outlined"
            hide-details
            :disabled="busy || catalogBusy || lineupLoading"
            :loading="lineupLoading"
            @update:model-value="changeEvent"
          />
        </div>
        <div class="lineup-template-tools">
          <v-select
            v-model="templateId"
            :items="templates.map((template) => ({ title: template.name, value: template.id }))"
            label="名單範本"
            :loading="templatesLoading"
            :error-messages="templateError"
            :no-data-text="templatesLoading ? '正在載入範本…' : templatesLoaded ? '尚無範本，先另存一份名單' : '開啟後載入範本'"
            @update:menu="loadTemplates"
            density="compact"
            placeholder="選擇範本時載入清單"
            clearable
            variant="outlined"
            hide-details="auto"
            :disabled="busy || catalogBusy || lineupLoading || archived"
          /><v-btn
            variant="outlined"
            :disabled="!templateId || busy || catalogBusy || lineupLoading || archived"
            @click="applyTemplate"
            >套用範本</v-btn
          >
          <v-btn v-if="templateError" variant="text" :disabled="templatesLoading" @click="loadTemplates()">重試範本清單</v-btn>
        </div>
        <div class="lineup-toolbar-bottom">
          <div>
            <strong>{{ eventDisplayTitle(displayedEvent) }}</strong>
            <p>
              <span class="lineup-event-context"
                >{{ eventTypeLabel(displayedEvent?.type) }} ·
                {{ displayedEvent?.dates[0] }} · </span
              >已安排 {{ positionCount }} / 60 個位置 · {{ count }} 人
              <span class="lineup-save-status">{{ saveStatus }}</span>
            </p>
          </div>
          <div class="lineup-actions">
            <v-btn
              variant="outlined"
              :prepend-icon="mdiContentSaveOutline"
              :disabled="busy || catalogBusy || lineupLoading"
              @click="openDialog('template')"
              >另存範本</v-btn
            ><v-btn
              v-if="!archived"
              color="primary"
              :loading="saving"
              :disabled="!canSave"
              @click="saveLineup"
              >{{ saving ? '儲存中…' : '儲存排表' }}</v-btn
            >
          </div>
        </div>
      </v-card>
      <v-alert v-if="archived" type="info" variant="tonal" class="lineup-alert"
        >原場次已刪除或改為一般活動，最後儲存的排表僅供查看與另存範本。</v-alert
      >
      <v-alert
        v-if="!archived && invalidAssignments"
        type="warning"
        variant="tonal"
        class="lineup-alert"
        role="alert"
        >有 {{ invalidAssignments }} 位成員的資格或職業不符合本場要求，請編輯位置移除或重新安排，再儲存排表：
        <ul class="lineup-invalid-list">
          <li v-for="item in invalidSeats" :key="item.key">
            <strong>{{ item.name }}</strong>（{{ item.seat }}）：{{ item.reason }}
          </li>
        </ul></v-alert
      >
      <v-alert
        v-if="skipped.length"
        type="warning"
        variant="tonal"
        class="lineup-alert"
        role="status"
        ><strong>套用時跳過的成員</strong>
        <ul>
          <li v-for="person in skipped" :key="participantKey(person)">
            {{ person.name }}{{ person.registrationId ? '（本場外援）' : ''
            }}{{ person.round ? ` · 第${person.round === 1 ? '一' : '二'}場` : '' }} —
            {{ person.reason }}
          </li>
        </ul></v-alert
      >
      <v-alert
        v-if="!archived && invalidDuties"
        type="warning"
        variant="tonal"
        class="lineup-alert"
        role="alert"
        >有 {{ invalidDuties }} 個位置使用停用或不存在的職責，請編輯位置移除後再儲存。</v-alert
      >
      <v-alert
        v-if="skippedDuties.length"
        type="warning"
        variant="tonal"
        class="lineup-alert"
        role="status"
        ><strong>套用時跳過的職責</strong>
        <ul>
          <li v-for="(duty, index) in skippedDuties" :key="index">
            {{ duty.teamName }} 第 {{ duty.position }} 位：{{ duty.name }} — {{ duty.reason }}
          </li>
        </ul></v-alert
      >
      <DataLoading v-if="lineupLoading">正在載入本場排表…</DataLoading>
      <div v-else-if="currentEvent" class="lineup-workspace">
        <aside
          class="lineup-members-panel"
          :class="{ 'lineup-drop-remove': draggingSeat }"
          @dragover="seatDragOver"
          @dragleave="!$event.currentTarget.contains($event.relatedTarget) && (draggingSeat = false)"
          @drop="seatDrop"
        >
          <p v-if="draggingSeat" class="lineup-drop-hint">放開即從排表移除</p>
          <div v-if="notice" class="lineup-focus-notice" role="status">
            {{ notice }}
            <v-btn
              v-if="lastRemoval"
              size="x-small"
              variant="text"
              color="primary"
              class="lineup-undo"
              @click="undoRemoval"
              >復原</v-btn
            >
          </div>
          <v-tabs
            :model-value="archived ? 'duties' : sidebarTab"
            aria-label="排表來源清單"
            @update:model-value="sidebarTab = $event"
            ><v-tab value="members" :disabled="archived">成員</v-tab
            ><v-tab value="duties">職責分配</v-tab></v-tabs
          >
          <DutyList
            v-show="archived || sidebarTab === 'duties'"
            :duties="duties"
            :disabled="busy || lineupLoading"
            :assignable="!readOnly"
            :selected-id="selectedDutyId"
            @updated="updateDuties"
            @select="selectDuty"
            @busy-changed="catalogBusy = $event"
            @unsaved-changed="dutyEditingDirty = $event"
          />
          <div v-if="selectedDutyId" class="lineup-selected" role="status">
            已選職責：{{ duties.find((duty) => duty.id === selectedDutyId)?.name
            }}<v-btn variant="text" @click="selectedDutyId = ''">取消職責選取</v-btn>
          </div>
          <v-card v-if="!archived" v-show="sidebarTab === 'members'" class="lineup-members-card"
            ><div class="lineup-member-heading">
              <h2><v-icon :icon="mdiAccountGroupOutline" size="22" />成員清單</h2>
              <v-btn
                variant="text"
                :icon="mdiRefresh"
                aria-label="更新成員清單並保留排表"
                :disabled="busy"
                :loading="membersLoading"
                @click="refreshMembers"
              />
            </div>
            <p class="lineup-hint">{{ qualification }}</p>
            <!-- Four sources fit a 2×2 grid with full names; tabs would scroll in the narrow sidebar. -->
            <div class="lineup-source-tabs" role="tablist" aria-label="成員來源分類">
              <button
                v-for="tab in MEMBER_SOURCE_TABS"
                :key="tab.value"
                type="button"
                role="tab"
                :aria-selected="memberTab === tab.value"
                :class="{ 'is-active': memberTab === tab.value }"
                @click="memberTab = tab.value"
              >
                {{ tab.label }}
              </button>
            </div>
            <v-btn
              v-if="memberTab === 'extra'"
              variant="outlined"
              color="primary"
              block
              :prepend-icon="mdiAccountPlusOutline"
              :disabled="readOnly"
              @click="openDialog('registration')"
              >代為報名</v-btn
            >
            <v-text-field
              v-model="search"
              label="搜尋名稱或報名備註"
              density="compact"
              variant="outlined"
              hide-details
              clearable
              :disabled="busy"
            /><v-select
              v-model="professionId"
              :items="[
                { title: '所有職業', value: null },
                ...professions.map((job) => ({ title: job.name, value: job.job_id })),
              ]"
              label="職業篩選"
              density="compact"
              variant="outlined"
              hide-details
              :disabled="busy"
            />
            <DataLoading v-if="membersLoading" compact :spinner="false">正在更新成員與職業…</DataLoading>
            <p v-else class="lineup-list-count">
              {{ memberTabLabel }} · 符合 {{ visibleMembers.length }} 人 · 尚未安排
              {{ unassignedCount }}
              人
            </p>
            <div v-if="selectedUid" class="lineup-selected" role="status">
              已選：{{ findPerson(selectedUid)?.name }} ·
              {{ memberJob(findPerson(selectedUid))?.name
              }}<v-btn variant="text" size="small" @click="selectedUid = ''">取消選取</v-btn>
            </div>
            <div class="lineup-member-list">
              <div
                v-for="member in visibleMembers"
                :key="participantKey(member)"
                :class="[
                  'lineup-member',
                  {
                    'member-selected': selectedUid === participantKey(member),
                    'member-disabled': readOnly,
                    'member-on-leave': member.isOnLeave,
                  },
                ]"
                :data-member="member.uid || member.registrationId"
              >
                <button
                  type="button"
                  class="lineup-member-select"
                  :draggable="!readOnly && !member.isOnLeave"
                  :disabled="readOnly || member.isOnLeave"
                  :aria-pressed="selectedUid === participantKey(member)"
                  @dragstart="drag($event, member)"
                  @click="selectMember(participantKey(member))"
                >
                  <span class="lineup-member-main"
                    ><strong>{{ member.name }}</strong
                    ><small v-if="member.registrationId">本場外援</small
                    ><small v-else-if="memberTab === 'external' && member.isRegistered" class="lineup-registered-badge">已報名</small
                    ><span v-if="member.isOnLeave" class="lineup-leave-badge">已請假</span></span
                  ><span class="lineup-member-job"
                    ><span
                      class="profession-dot"
                      :style="{
                        backgroundColor: memberJob(member)?.colorcode,
                      }"
                    ></span
                    >{{ memberJob(member)?.name }}</span
                  >
                  <span v-if="member.registrationNote" class="lineup-registration-note">{{
                    member.registrationNote
                  }}</span>
                </button>
                <button
                  v-if="member.registrationId && !readOnly"
                  type="button"
                  class="lineup-guest-delete"
                  :aria-label="`刪除 ${member.name} 的本場外援報名`"
                  :title="`刪除 ${member.name} 的本場外援報名`"
                  @click="deleteGuest(participantKey(member))"
                >
                  刪除
                </button>
                <div
                  class="lineup-member-professions"
                  role="group"
                  :aria-label="`${member.name} 上場職業`"
                >
                  <button
                    type="button"
                    :disabled="readOnly || member.isOnLeave"
                    :title="`主職業：${member.primaryProfession}`"
                    :aria-label="`${member.name} 使用主職業：${member.primaryProfession}`"
                    :aria-pressed="memberProfession(member) === 'primary'"
                    @click="chooseMemberProfession(member, 'primary')"
                  >
                    主
                  </button>
                  <button
                    v-if="member.secondaryProfessionId"
                    type="button"
                    :disabled="readOnly || member.isOnLeave"
                    :title="`副職業：${member.secondaryProfession}`"
                    :aria-label="`${member.name} 使用副職業：${member.secondaryProfession}`"
                    :aria-pressed="memberProfession(member) === 'secondary'"
                    @click="chooseMemberProfession(member, 'secondary')"
                  >
                    副
                  </button>
                </div>
              </div>
              <p v-if="!visibleMembers.length" class="lineup-hint">
                {{
                  availableSourceMembers.length
                    ? '沒有符合搜尋條件的成員。'
                    : sourceMembers.length
                      ? `本頁${memberTabLabel}皆已安排，可點排表位置調整。`
                      : `本場尚無可安排的${memberTabLabel}。`
                }}
              </p>
            </div></v-card
          >
        </aside>
        <LineupBoard
          :teams="displayedTeams"
          :members="participantPeople"
          :professions="professions"
          :duties="duties"
          :selected-duty-id="selectedDutyId"
          :read-only="readOnly"
          :snapshots="archived"
          :selected-uid="selectedUid"
          :selected-profession="memberProfession(findPerson(selectedUid))"
          @place="place"
          @assign-duty="assignDuty"
          @edit-seat="openSeat"
          @remove-seat="removeSeat"
          @rename-team="renameTeam"
        />
      </div>
    </template>
    <v-dialog
      :model-value="Boolean(dialog)"
      max-width="540"
      :persistent="busy"
      aria-labelledby="lineup-dialog-title"
      @update:model-value="!$event && closeDialog()"
      @after-leave="restoreFocus"
    >
      <v-card class="lineup-dialog"
        ><div class="lineup-dialog-content">
          <h2 id="lineup-dialog-title">
            {{
              dialog === 'seat'
                ? '編輯位置'
                : dialog === 'registration'
                  ? '代為報名'
                  : '另存名單範本'
            }}
          </h2>
          <v-alert v-if="dialogError" type="error" variant="tonal" role="alert">{{
            dialogError
          }}</v-alert>
          <template v-if="dialog === 'seat'"
            ><v-select
              :model-value="seatUid"
              :items="slotOptions"
              label="第一場成員"
              variant="outlined"
              :disabled="busy"
              @update:model-value="changeSeatUid"
            /><v-select
              v-model="seatProfession"
              :items="seatJobs"
              label="第一場上場職業"
              variant="outlined"
              :disabled="busy || !seatUid"
            /><v-text-field
              v-model="seatAlias"
              label="第一場小名（選填，排表與下載圖改顯示小名）"
              maxlength="20"
              variant="outlined"
              :disabled="busy || !seatUid"
            /><v-select
              :model-value="seatSecondUid"
              :items="slotOptions"
              label="第二場成員（選填）"
              variant="outlined"
              :disabled="busy"
              @update:model-value="
                seatSecondUid = $event;
                seatSecondProfession = 'primary';
                seatSecondAlias = '';
              "
            /><v-select
              v-model="seatSecondProfession"
              :items="seatSecondJobs"
              label="第二場上場職業"
              variant="outlined"
              :disabled="busy || !seatSecondUid"
            /><v-text-field
              v-model="seatSecondAlias"
              label="第二場小名（選填）"
              maxlength="20"
              variant="outlined"
              :disabled="busy || !seatSecondUid"
            /><v-select
              v-model="seatDutyIds"
              :items="seatDutyOptions"
              label="分配職責"
              multiple
              chips
              closable-chips
              variant="outlined"
              :disabled="busy"
            />
            <div v-if="seatGuestKeys.length" class="lineup-seat-guest-actions">
              <v-btn
                v-for="key in seatGuestKeys"
                :key="key"
                variant="text"
                color="error"
                size="small"
                :disabled="busy"
                @click="deleteGuest(key)"
                >刪除本場外援 {{ findPerson(key)?.name || '' }}</v-btn
              >
            </div>
            <v-text-field
              v-model="seatNote"
              label="補充備註"
              maxlength="160"
              variant="outlined"
              :disabled="busy"
            />
            <p class="lineup-hint">
              未指定第二場時沿用第一場成員。選空位可移除該場分配；明確選取已安排成員會移動或交換該場位置。職責與備註兩場共用。
            </p></template
          >
          <template v-else-if="dialog === 'registration'">
            <p class="lineup-hint">
              {{ currentEvent?.dates[0] }} · {{ eventTypeLabel(currentEvent?.type)
              }}<template v-if="currentEvent?.title"> · {{ currentEvent.title }}</template>
            </p>
            <v-btn variant="text" :disabled="busy" @click="reloadRegistration">重新載入</v-btn>
            <form id="lineup-registration-form" @submit.prevent="submitRegistration">
              <v-text-field
                v-model="registrationName"
                label="名稱"
                maxlength="64"
                variant="outlined"
                :disabled="busy"
                aria-required="true"
                autofocus
              />
              <v-select
                v-model="registrationProfessionId"
                :items="professions"
                item-title="name"
                item-value="job_id"
                label="職業"
                variant="outlined"
                :disabled="busy"
                aria-required="true"
              />
              <v-text-field
                v-model="registrationNote"
                label="備註（選填）"
                maxlength="160"
                variant="outlined"
                :disabled="busy"
              />
            </form>
          </template>
          <template v-else
            ><v-text-field
              v-model="templateName"
              label="範本名稱"
              maxlength="80"
              variant="outlined"
              :disabled="busy"
              autofocus
            />
            <p>
              保存目前
              {{ count }} 位成員的位置、上場職業、隊名、職責與備註。套用到其他場次時會重新檢查資格。
            </p></template
          >
        </div>
        <DataLoading v-if="busy" compact :spinner="false">正在處理資料，請稍候…</DataLoading>
        <div class="lineup-dialog-actions">
          <v-btn variant="outlined" :disabled="busy || catalogBusy" @click="closeDialog">取消</v-btn
          ><v-btn
            color="primary"
            :loading="busy"
            :disabled="busy || (dialog === 'registration' && !registrationRevision)"
            :type="dialog === 'registration' ? 'submit' : 'button'"
            :form="dialog === 'registration' ? 'lineup-registration-form' : undefined"
            @click="
              dialog === 'seat' ? saveSeat() : dialog === 'template' ? saveTemplate() : undefined
            "
            >{{
              busy
                ? '處理中…'
                : dialog === 'seat'
                  ? '套用位置'
                  : dialog === 'registration'
                    ? '送出報名'
                    : '儲存範本'
            }}</v-btn
          >
        </div></v-card
      >
    </v-dialog>
  </div>
</template>
