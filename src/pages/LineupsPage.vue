<script setup>
import { computed, ref, onMounted, onUnmounted, inject, nextTick } from 'vue';
import {
  mdiFullscreen,
  mdiFullscreenExit,
  mdiSwordCross,
  mdiRefresh,
  mdiContentSaveOutline,
  mdiAccountGroupOutline,
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
  slotAssignments,
} from '../domain/lineups.js';
import { eventTypeLabel, eventDisplayTitle } from '../domain/event-types.js';
import LineupBoard from './LineupBoard.vue';
import DutyList from './DutyList.vue';
import { createDutyClient } from '../api/duties.js';
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
const dutyClient = createDutyClient({ source });
const participationClient = createParticipationClient({ source });
const participation = ref({ responses: [], registrations: [] });
const memberTab = ref('guild');
const participantPeople = computed(() => [
  ...members.value.map((member) => {
    const response = participation.value.responses.find((row) => row.uid === member.uid);
    return {
      ...member,
      isOnLeave: response?.status === 'leave',
      isRegistered: response?.status === 'registered',
      registrationNote: response?.note || '',
    };
  }),
  ...participation.value.registrations.map((row) => ({
    uid: null,
    registrationId: row.id,
    name: row.name,
    primaryProfessionId: row.professionId,
    primaryProfession: row.profession,
    secondaryProfessionId: null,
    isInGuild: false,
    isInClub: false,
    registrationNote: row.note,
  })),
]);
function findPerson(key) {
  return participantPeople.value.find((person) => participantKey(person) === key);
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
  versions = ref([]);
const eventId = ref(null),
  historyId = ref('draft'),
  templateId = ref(null);
const teams = ref(emptyLineup()),
  baseline = ref(JSON.stringify(teams.value));
const loading = ref(true),
  historyLoading = ref(false),
  busy = ref(false),
  error = ref(''),
  notice = ref(''),
  skipped = ref([]);
const selectedUid = ref(''),
  search = ref(''),
  professionId = ref(null);
const dialog = ref(null),
  templateName = ref(''),
  dialogError = ref(''),
  seat = ref(null),
  seatUid = ref(null),
  seatNote = ref(''),
  seatProfession = ref('primary'),
  seatSecondUid = ref(null),
  seatSecondProfession = ref('primary');
let seatBaseline = '';
let operation = 0,
  disposed = false,
  confirmAttempt = null,
  templateAttempt = null,
  dialogOpener = null;
const currentEvent = computed(() => events.value.find((event) => event.id === eventId.value));
const historical = computed(() => versions.value.find((version) => version.id === historyId.value));
const displayedEvent = computed(() => historical.value?.event || currentEvent.value);
const readOnly = computed(() =>
  Boolean(
    historical.value ||
    currentEvent.value?.archived ||
    busy.value ||
    catalogBusy.value ||
    historyLoading.value,
  ),
);
const displayedTeams = computed(() => historical.value?.teams || teams.value);
const dirty = computed(() => JSON.stringify(teams.value) !== baseline.value);
const dialogDirty = computed(() =>
  dialog.value === 'template'
    ? Boolean(templateName.value.trim())
    : dialog.value === 'seat' &&
      JSON.stringify([
        seatUid.value,
        seatProfession.value,
        seatSecondUid.value,
        seatSecondProfession.value,
        seatNote.value,
        seatDutyIds.value,
      ]) !== seatBaseline,
);
const latestVersion = computed(() => versions.value[0]?.version || 0);
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
const roundCounts = computed(() => {
  const slots = displayedTeams.value.flatMap((team) => team.slots);
  return {
    first: slots.filter((slot) => participantKey(slot)).length,
    second: slots.filter((slot) => participantKey(slot.secondRound || slot)).length,
  };
});
const eligible = computed(() =>
  participantPeople.value.filter((member) => eligibleMember(member, currentEvent.value?.type)),
);
const sourceMembers = computed(() =>
  eligible.value.filter((person) =>
    memberTab.value === 'guild'
      ? person.isInGuild
      : memberTab.value === 'club'
        ? person.isInClub && !person.isInGuild
        : !person.isInGuild && !person.isInClub,
  ),
);
const memberTabLabel = computed(
  () => ({ guild: '幫會成員', club: '俱樂部成員', extra: '額外報名' })[memberTab.value],
);
const visibleMembers = computed(() =>
  sourceMembers.value.filter((member) => {
    const needle = (search.value || '').trim().toLocaleLowerCase();
    return (
      (!needle ||
        `${member.uid || ''} ${member.name} ${member.registrationNote}`
          .toLocaleLowerCase()
          .includes(needle)) &&
      (!professionId.value ||
        [member.primaryProfessionId, member.secondaryProfessionId].includes(professionId.value))
    );
  }),
);
const eventOptions = computed(() =>
  events.value.map((event) => ({
    title: `${event.dates[0]} · ${eventTypeLabel(event.type)}${event.title ? ` · ${event.title}` : ''}${event.archived ? '（歷史封存）' : ''}`,
    value: event.id,
  })),
);
const historyOptions = computed(() => [
  ...(!currentEvent.value?.archived ? [{ title: '工作區（編輯排表）', value: 'draft' }] : []),
  ...versions.value.map((version) => ({
    title: `第 ${version.version} 版 · ${formatTime(version.createdAt)}`,
    value: version.id,
  })),
]);
const slotOptions = computed(() => [
  { title: '空位', value: null },
  ...eligible.value.map((member) => ({
    title: `${member.name} · ${member.uid || '額外報名'}${assigned.value.has(participantKey(member)) ? '（已安排，可移動或分場）' : ''}`,
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
const seatJobs = computed(() => seatJobOptions(seatUid.value));
const seatSecondJobs = computed(() => seatJobOptions(seatSecondUid.value));
const invalidAssignments = computed(
  () =>
    teams.value
      .flatMap((team) => team.slots.flatMap(slotAssignments))
      .filter(
        (slot) =>
          participantKey(slot) &&
          (!eligible.value.some((member) => participantKey(member) === participantKey(slot)) ||
            !findPerson(participantKey(slot))?.[`${slot.profession}ProfessionId`]),
      ).length,
);
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
  selectedUid.value = selectedUid.value === uid ? '' : uid;
  selectedDutyId.value = '';
}
function assignDuty(id, teamId, index) {
  if (readOnly.value) return;
  if (!duties.value.some((duty) => duty.id === id && duty.active)) {
    error.value = '這項職責已停用或不存在，請更新職責清單';
    return;
  }
  const slot = teams.value.find((team) => team.id === teamId)?.slots[index];
  if (!slot) return;
  if (!slot.dutyIds) slot.dutyIds = [];
  if (!slot.dutyIds.includes(id)) slot.dutyIds.push(id);
  selectedDutyId.value = '';
  notice.value = '已分配職責，請確認並儲存本場名單。';
}
const qualification = computed(() =>
  memberTab.value === 'guild'
    ? '幫派內成員，排除本場已請假者。'
    : memberTab.value === 'club'
      ? '僅俱樂部成員，排除幫派內及本場已請假者。'
      : '本場額外報名者及已報名的編外人員。',
);
function formatTime(value) {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}
function mayDiscard(message = '排表有尚未確認的修改，確定要放棄嗎？') {
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
function resetDraft(data) {
  teams.value = editableLineup(data || emptyLineup());
  baseline.value = JSON.stringify(teams.value);
  selectedUid.value = '';
  selectedDutyId.value = '';
  confirmAttempt = null;
}
async function load() {
  if (!mayDiscard()) return;
  loading.value = true;
  error.value = '';
  try {
    const [index, tasks, people, jobs] = await Promise.all([
      client.getIndex(),
      dutyClient.getDuties(),
      memberClient.getMembers(),
      memberClient.getProfessions(),
    ]);
    if (disposed) return;
    events.value = index.events;
    templates.value = index.templates;
    duties.value = tasks.duties;
    members.value = people.members;
    professions.value = jobs.professions;
    const target = events.value.some((event) => event.id === eventId.value)
      ? eventId.value
      : events.value[0]?.id;
    if (target) await loadEvent(target);
    else {
      eventId.value = null;
      versions.value = [];
      resetDraft();
    }
  } catch (cause) {
    error.value = cause.message;
  } finally {
    loading.value = false;
  }
}
async function loadEvent(id) {
  const token = ++operation;
  historyLoading.value = true;
  error.value = '';
  notice.value = '';
  skipped.value = [];
  skippedDuties.value = [];
  try {
    const target = events.value.find((event) => event.id === id);
    const [data, responses] = await Promise.all([
      client.getHistory(id),
      target?.archived
        ? Promise.resolve({ responses: [], registrations: [] })
        : participationClient.getParticipation(id),
    ]);
    if (disposed || token !== operation) return;
    participation.value = responses;
    eventId.value = id;
    versions.value = data.versions;
    resetDraft(data.versions[0]?.teams);
    historyId.value = currentEvent.value?.archived ? data.versions[0]?.id : 'draft';
    templateId.value = null;
  } catch (cause) {
    if (token === operation) error.value = cause.message;
  } finally {
    if (token === operation) historyLoading.value = false;
  }
}
async function changeEvent(id) {
  if (id !== eventId.value && mayDiscard()) await loadEvent(id);
}
function place(uid, teamId, index) {
  if (readOnly.value) return false;
  if (!eligible.value.some((member) => participantKey(member) === uid)) {
    error.value = '這位成員不符合本場資格，請重新載入成員清單';
    return false;
  }
  if (!addMemberToSlot(teams.value, uid, teamId, index)) {
    error.value = '這個位置已有第一場與第二場的成員，請點位置編輯後再調整。';
    return false;
  }
  error.value = '';
  selectedUid.value = '';
  notice.value = '已安排位置，請確認並儲存名單。';
  skipped.value = [];
  return true;
}
function drag(event, uid) {
  event.dataTransfer.setData('application/x-guild-member', uid);
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
    else document.getElementById(focusMode.value ? 'exit-lineup-focus' : 'lineup-history')?.focus();
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
  seatBaseline = JSON.stringify([
    seatUid.value,
    seatProfession.value,
    seatSecondUid.value,
    seatSecondProfession.value,
    seatNote.value,
    seatDutyIds.value,
  ]);
  openDialog('seat');
}
function saveSeat() {
  if (seatUid.value && seatUid.value === seatSecondUid.value) {
    dialogError.value = '第一場與第二場請安排不同成員；同一人兩場沿用時，第二場選空位即可。';
    return;
  }
  const choices = [
    { key: seatUid.value, profession: seatProfession.value },
    { key: seatSecondUid.value, profession: seatSecondProfession.value },
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
    const reference = participantReference(person.key, person.key ? person.profession : 'primary');
    if (index === 0) {
      delete slot.registrationId;
      Object.assign(slot, reference);
    } else slot.secondRound = person.key ? reference : null;
  });
  slot.note = seatNote.value.trim();
  slot.dutyIds = [...seatDutyIds.value];
  error.value = '';
  notice.value = '已套用分場配置，請確認並儲存名單。';
  selectedUid.value = '';
  dialog.value = null;
}
function changeSeatUid(uid) {
  seatUid.value = uid;
  seatProfession.value = 'primary';
}
async function refreshMembers() {
  busy.value = true;
  error.value = '';
  try {
    const [people, jobs, tasks, responses] = await Promise.all([
      memberClient.getMembers(),
      memberClient.getProfessions(),
      dutyClient.getDuties(),
      participationClient.getParticipation(eventId.value),
    ]);
    participation.value = responses;
    duties.value = tasks.duties;
    members.value = people.members;
    professions.value = jobs.professions;
    notice.value = '成員清單已更新，工作區的排表仍保留。';
  } catch (cause) {
    error.value = cause.message;
  } finally {
    busy.value = false;
  }
}
function attempt(previous, payload) {
  const encoded = JSON.stringify(payload);
  return previous?.payload === encoded
    ? previous
    : { payload: encoded, requestId: crypto.randomUUID() };
}
async function confirm() {
  busy.value = true;
  dialogError.value = '';
  try {
    const payload = {
      eventId: eventId.value,
      eventRevision: currentEvent.value.revision,
      expectedVersion: latestVersion.value,
      teams: editableLineup(teams.value),
    };
    confirmAttempt = attempt(confirmAttempt, payload);
    const data = await client.confirm({ ...payload, requestId: confirmAttempt.requestId });
    if (
      data.version?.eventId !== eventId.value ||
      data.version?.version !== latestVersion.value + 1 ||
      !Array.isArray(data.version?.teams)
    )
      throw new Error('排表回應格式不正確，請重試以確認結果');
    versions.value.unshift(data.version);
    resetDraft(data.version.teams);
    historyId.value = data.version.id;
    dialog.value = null;
    error.value = '';
    notice.value = `已確認第 ${data.version.version} 版，保存 ${count.value} 位成員的歷史名單。`;
  } catch (cause) {
    dialogError.value = cause.message;
  } finally {
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
    if (!templates.value.some((template) => template.id === data.template.id))
      templates.value.unshift(data.template);
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
    !mayDiscard('套用範本會取代工作區目前的隊名、位置、職責及備註，確定要套用嗎？')
  )
    return;
  busy.value = true;
  error.value = '';
  try {
    const data = await client.applyTemplate(templateId.value, eventId.value);
    const [people, jobs, tasks, responses] = await Promise.all([
      memberClient.getMembers(),
      memberClient.getProfessions(),
      dutyClient.getDuties(),
      participationClient.getParticipation(eventId.value),
    ]);
    participation.value = responses;
    duties.value = tasks.duties;
    members.value = people.members;
    professions.value = jobs.professions;
    teams.value = data.teams;
    selectedUid.value = '';
    selectedDutyId.value = '';
    historyId.value = 'draft';
    skipped.value = data.skipped;
    skippedDuties.value = data.skippedDuties || [];
    events.value = events.value.map((event) => (event.id === data.event.id ? data.event : event));
    notice.value = `範本已載入工作區${data.skipped.length ? `，跳過 ${data.skipped.length} 位成員` : ''}${skippedDuties.value.length ? `，跳過 ${skippedDuties.value.length} 項停用職責` : ''}，尚未確認本場名單。`;
  } catch (cause) {
    error.value = cause.message;
  } finally {
    busy.value = false;
  }
}
function copyHistory() {
  if (!historical.value || !mayDiscard('載入歷史會取代工作區目前的修改，確定要載入嗎？')) return;
  teams.value = editableLineup(historical.value.teams);
  historyId.value = 'draft';
  selectedUid.value = '';
  selectedDutyId.value = '';
  notice.value = '已載入歷史位置，姓名與職業使用現有資料；請檢查資格後確認為新版本。';
}
onMounted(() => {
  load();
  window.addEventListener('beforeunload', beforeUnload);
});
onUnmounted(() => {
  if (focusMode.value) {
    document.body.style.overflow = previousBodyOverflow;
    emit('focus-changed', false);
  }
  disposed = true;
  operation++;
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
        <p class="page-subtitle">安排每一場的出戰名單，保存範本與當時的陣容。</p>
      </div>
      <div class="lineup-heading-actions">
        <v-btn
          v-if="currentEvent"
          variant="outlined"
          :prepend-icon="mdiFullscreen"
          :disabled="loading || historyLoading"
          @click="setFocusMode(true)"
          >專注排表</v-btn
        >
        <v-btn
          variant="outlined"
          :prepend-icon="mdiRefresh"
          :disabled="loading || busy || catalogBusy || historyLoading"
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
          {{ positionCount }} / 60 個位置 · {{ count }} 人 ·
          {{
            historical ? `第 ${historical.version} 版（唯讀）` : dirty ? '未確認修改' : '工作區'
          }}</span
        >
      </div>
      <div class="lineup-actions">
        <v-btn
          v-if="historical && !currentEvent?.archived"
          variant="outlined"
          :disabled="busy || catalogBusy"
          @click="copyHistory"
          >載入工作區</v-btn
        ><v-btn variant="outlined" :disabled="busy || catalogBusy" @click="openDialog('template')"
          >另存範本</v-btn
        ><v-btn
          v-if="!historical && !currentEvent?.archived"
          color="primary"
          :disabled="busy || catalogBusy || invalidAssignments > 0 || invalidDuties > 0"
          @click="openDialog('confirm')"
          >確認並儲存</v-btn
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
    <div v-if="loading" class="lineup-loading" role="status">正在載入戰場與成員資料…</div>
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
            :model-value="eventId"
            :items="eventOptions"
            label="戰鬥場次"
            density="compact"
            variant="outlined"
            hide-details
            :disabled="busy || catalogBusy || historyLoading"
            @update:model-value="changeEvent"
          /><v-select
            id="lineup-history"
            :model-value="historyId"
            :items="historyOptions"
            label="瀏覽排表"
            density="compact"
            variant="outlined"
            hide-details
            :disabled="busy || catalogBusy || historyLoading"
            @update:model-value="historyId = $event"
          />
        </div>
        <div class="lineup-toolbar-bottom">
          <div>
            <strong>{{ eventDisplayTitle(displayedEvent) }}</strong>
            <p>
              {{ eventTypeLabel(displayedEvent?.type) }} · {{ displayedEvent?.dates[0] }} · 已安排
              {{ positionCount }} / 60 個位置 · {{ count }} 人
              <span class="draft-label">{{
                historical
                  ? `第 ${historical.version} 版 · 歷史唯讀`
                  : dirty
                    ? '有未確認修改'
                    : '工作區'
              }}</span>
            </p>
          </div>
          <div class="lineup-actions">
            <v-btn
              v-if="historical && !currentEvent?.archived"
              variant="outlined"
              :disabled="busy"
              @click="copyHistory"
              >載入工作區</v-btn
            ><v-btn
              variant="outlined"
              :prepend-icon="mdiContentSaveOutline"
              :disabled="busy || catalogBusy || historyLoading"
              @click="openDialog('template')"
              >另存範本</v-btn
            ><v-btn
              v-if="!historical && !currentEvent?.archived"
              color="primary"
              :disabled="
                busy || catalogBusy || historyLoading || invalidAssignments > 0 || invalidDuties > 0
              "
              @click="openDialog('confirm')"
              >確認並儲存</v-btn
            >
          </div>
        </div>
        <div class="lineup-template-tools">
          <v-select
            v-model="templateId"
            :items="templates.map((template) => ({ title: template.name, value: template.id }))"
            label="名單範本"
            density="compact"
            placeholder="尚無範本，先另存一份名單"
            clearable
            variant="outlined"
            hide-details
            :disabled="busy || catalogBusy || historyLoading || currentEvent?.archived"
          /><v-btn
            variant="outlined"
            :disabled="
              !templateId || busy || catalogBusy || historyLoading || currentEvent?.archived
            "
            @click="applyTemplate"
            >套用至工作區</v-btn
          >
        </div>
      </v-card>
      <v-alert v-if="currentEvent?.archived" type="info" variant="tonal" class="lineup-alert"
        >原場次已刪除或改為一般活動，歷史排表仍保留，僅供查看與另存範本。</v-alert
      >
      <v-alert
        v-if="!historical && invalidAssignments"
        type="warning"
        variant="tonal"
        class="lineup-alert"
        role="alert"
        >有
        {{ invalidAssignments }}
        位成員的資格或職業不符合本場要求。請編輯位置移除或重新安排，再確認名單。</v-alert
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
            {{ person.name }}（{{ person.uid || '額外報名' }}）{{
              person.round ? ` · 第${person.round === 1 ? '一' : '二'}場` : ''
            }}
            — {{ person.reason }}
          </li>
        </ul></v-alert
      >
      <v-alert
        v-if="!historical && invalidDuties"
        type="warning"
        variant="tonal"
        class="lineup-alert"
        role="alert"
        >有 {{ invalidDuties }} 個位置使用停用或不存在的職責，請編輯位置移除後再確認。</v-alert
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
      <div v-if="historyLoading" class="lineup-loading" role="status">正在載入本場排表…</div>
      <div v-else-if="currentEvent" class="lineup-workspace">
        <aside class="lineup-members-panel">
          <div v-if="notice" class="lineup-focus-notice" role="status">
            {{ notice }}
          </div>
          <v-tabs
            :model-value="historical || currentEvent.archived ? 'duties' : sidebarTab"
            aria-label="排表來源清單"
            @update:model-value="sidebarTab = $event"
            ><v-tab value="members" :disabled="Boolean(historical || currentEvent.archived)"
              >成員</v-tab
            ><v-tab value="duties">職責分配</v-tab></v-tabs
          >
          <DutyList
            v-show="historical || currentEvent.archived || sidebarTab === 'duties'"
            :duties="duties"
            :disabled="busy || historyLoading"
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
          <v-card
            v-if="!historical && !currentEvent.archived"
            v-show="sidebarTab === 'members'"
            class="lineup-members-card"
            ><div class="lineup-member-heading">
              <h2><v-icon :icon="mdiAccountGroupOutline" size="22" />成員清單</h2>
              <v-btn
                variant="text"
                :icon="mdiRefresh"
                aria-label="更新成員清單並保留排表"
                :disabled="busy"
                @click="refreshMembers"
              />
            </div>
            <p class="lineup-hint">{{ qualification }}</p>
            <v-tabs
              v-model="memberTab"
              class="lineup-member-tabs"
              density="compact"
              aria-label="成員來源分類"
              ><v-tab value="guild">幫會成員</v-tab><v-tab value="club">俱樂部成員</v-tab
              ><v-tab value="extra">額外報名</v-tab></v-tabs
            >
            <p class="lineup-hint">
              拖曳至位置，或先點選成員再點位置。第二位會安排為第二場；每個位置最多兩人，職責與備註共用。
            </p>
            <v-text-field
              v-model="search"
              label="搜尋名稱或 UID"
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
            <p class="lineup-list-count">
              {{ memberTabLabel }} · 符合 {{ visibleMembers.length }} 人 · 尚未安排
              {{ sourceMembers.filter((member) => !assigned.has(participantKey(member))).length }}
              人
            </p>
            <div v-if="selectedUid" class="lineup-selected" role="status">
              已選：{{ findPerson(selectedUid)?.name
              }}<v-btn variant="text" size="small" @click="selectedUid = ''">取消選取</v-btn>
            </div>
            <div class="lineup-member-list">
              <button
                v-for="member in visibleMembers"
                :key="participantKey(member)"
                type="button"
                :class="[
                  'lineup-member',
                  { 'member-selected': selectedUid === participantKey(member) },
                ]"
                :draggable="!busy"
                :disabled="busy"
                :aria-pressed="selectedUid === participantKey(member)"
                :data-member="member.uid || member.registrationId"
                @dragstart="drag($event, participantKey(member))"
                @click="selectMember(participantKey(member))"
              >
                <span class="lineup-member-main"
                  ><strong>{{ member.name }}</strong
                  ><small>{{ member.uid || '額外報名' }}</small></span
                ><span class="lineup-member-job"
                  ><span
                    class="profession-dot"
                    :style="{
                      backgroundColor: professions.find(
                        (job) => job.job_id === member.primaryProfessionId,
                      )?.colorcode,
                    }"
                  ></span
                  >{{ member.primaryProfession
                  }}<small v-if="assigned.has(participantKey(member))">已安排</small></span
                >
                <span v-if="member.registrationNote" class="lineup-registration-note">{{
                  member.registrationNote
                }}</span>
              </button>
              <p v-if="!visibleMembers.length" class="lineup-hint">
                {{
                  sourceMembers.length
                    ? '沒有符合搜尋條件的成員。'
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
          :snapshots="Boolean(historical)"
          :selected-uid="selectedUid"
          @place="place"
          @assign-duty="assignDuty"
          @edit-seat="openSeat"
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
                : dialog === 'template'
                  ? '另存名單範本'
                  : '確認本場名單'
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
            /><v-select
              :model-value="seatSecondUid"
              :items="slotOptions"
              label="第二場成員（選填）"
              variant="outlined"
              :disabled="busy"
              @update:model-value="
                seatSecondUid = $event;
                seatSecondProfession = 'primary';
              "
            /><v-select
              v-model="seatSecondProfession"
              :items="seatSecondJobs"
              label="第二場上場職業"
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
          <template v-else-if="dialog === 'template'"
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
              {{ count }} 位成員的位置、上場職業、隊名與備註。套用到其他場次時會重新檢查資格。
            </p></template
          >
          <template v-else
            ><p>
              <strong>{{ eventDisplayTitle(currentEvent) }}</strong>
            </p>
            <p>{{ eventTypeLabel(currentEvent?.type) }} · {{ currentEvent?.dates[0] }}</p>
            <p>
              將確認第 {{ latestVersion + 1 }} 版，共 {{ count }} 位成員，{{
                60 - positionCount
              }}
              個空位。第一場 {{ roundCounts.first }} 人、第二場 {{ roundCounts.second }} 人。
            </p>
            <p class="lineup-hint">
              保存當時的名稱、職業與位置。往後修改會另建版本，原始名單仍可回看。
            </p></template
          >
        </div>
        <div class="lineup-dialog-actions">
          <v-btn variant="outlined" :disabled="busy || catalogBusy" @click="closeDialog">取消</v-btn
          ><v-btn
            color="primary"
            :loading="busy"
            :disabled="busy"
            @click="
              dialog === 'seat' ? saveSeat() : dialog === 'template' ? saveTemplate() : confirm()
            "
            >{{
              busy
                ? '儲存中…'
                : dialog === 'seat'
                  ? '套用位置'
                  : dialog === 'template'
                    ? '儲存範本'
                    : '確認儲存'
            }}</v-btn
          >
        </div></v-card
      >
    </v-dialog>
  </div>
</template>
