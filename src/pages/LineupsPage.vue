<script setup>
import { computed, ref, onMounted, onUnmounted, inject, nextTick } from 'vue';
import { mdiSwordCross, mdiRefresh, mdiContentSaveOutline, mdiAccountGroupOutline } from '@mdi/js';
import { createLineupClient } from '../api/lineups.js';
import { createMemberClient } from '../api/members.js';
import { emptyLineup, editableLineup, eligibleMember, placeMember } from '../domain/lineups.js';
import { eventTypeLabel } from '../domain/event-types.js';
import LineupBoard from './LineupBoard.vue';
import DutyList from './DutyList.vue';
import { createDutyClient } from '../api/duties.js';

const source = import.meta.env.VITE_DATA_SOURCE || 'local';
const client = createLineupClient({ source });
const memberClient = createMemberClient({ source });
const dutyClient = createDutyClient({ source });
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
  seatProfession = ref('primary');
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
      JSON.stringify([seatUid.value, seatProfession.value, seatNote.value, seatDutyIds.value]) !==
        seatBaseline,
);
const latestVersion = computed(() => versions.value[0]?.version || 0);
const assigned = computed(
  () =>
    new Set(
      teams.value
        .flatMap((team) => team.slots)
        .filter((slot) => slot.uid)
        .map((slot) => slot.uid),
    ),
);
const count = computed(
  () => displayedTeams.value.flatMap((team) => team.slots).filter((slot) => slot.uid).length,
);
const eligible = computed(() =>
  members.value.filter((member) => eligibleMember(member, currentEvent.value?.type)),
);
const visibleMembers = computed(() =>
  eligible.value.filter((member) => {
    const needle = (search.value || '').trim().toLocaleLowerCase();
    return (
      (!needle || `${member.uid} ${member.name}`.toLocaleLowerCase().includes(needle)) &&
      (!professionId.value ||
        [member.primaryProfessionId, member.secondaryProfessionId].includes(professionId.value))
    );
  }),
);
const eventOptions = computed(() =>
  events.value.map((event) => ({
    title: `${event.dates[0]} · ${eventTypeLabel(event.type)} · ${event.title}${event.archived ? '（歷史封存）' : ''}`,
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
    title: `${member.name} · ${member.uid}${assigned.value.has(member.uid) ? '（已安排，選取會移動／交換）' : ''}`,
    value: member.uid,
  })),
]);
const seatMember = computed(() => members.value.find((member) => member.uid === seatUid.value));
const seatJobs = computed(() => [
  { title: `主職業：${seatMember.value?.primaryProfession || '未選成員'}`, value: 'primary' },
  ...(seatMember.value?.secondaryProfessionId
    ? [{ title: `副職業：${seatMember.value.secondaryProfession}`, value: 'secondary' }]
    : []),
]);
const invalidAssignments = computed(
  () =>
    teams.value
      .flatMap((team) => team.slots)
      .filter(
        (slot) =>
          slot.uid &&
          (!eligible.value.some((member) => member.uid === slot.uid) ||
            !members.value.find((member) => member.uid === slot.uid)?.[
              `${slot.profession}ProfessionId`
            ]),
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
  currentEvent.value?.type === 'guild_war'
    ? '僅顯示幫派內成員'
    : currentEvent.value?.type === 'dragon_tiger'
      ? '僅顯示俱樂部內成員'
      : '顯示所有成員，包含編外人員',
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
    const data = await client.getHistory(id);
    if (disposed || token !== operation) return;
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
  if (!eligible.value.some((member) => member.uid === uid)) {
    error.value = '這位成員不符合本場資格，請重新載入成員清單';
    return false;
  }
  placeMember(teams.value, uid, teamId, index);
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
    else document.getElementById('lineup-history')?.focus();
  });
}
function openSeat(teamId, index) {
  seat.value = { teamId, index };
  const slot = teams.value.find((team) => team.id === teamId).slots[index];
  seatUid.value = slot.uid;
  seatNote.value = slot.note;
  seatProfession.value = slot.profession;
  seatDutyIds.value = [...(slot.dutyIds || [])];
  seatBaseline = JSON.stringify([
    seatUid.value,
    seatProfession.value,
    seatNote.value,
    seatDutyIds.value,
  ]);
  openDialog('seat');
}
function saveSeat() {
  const slot = teams.value.find((team) => team.id === seat.value.teamId).slots[seat.value.index];
  if (seatUid.value) {
    if (!place(seatUid.value, seat.value.teamId, seat.value.index)) {
      dialogError.value = error.value;
      return;
    }
  } else {
    slot.uid = null;
    slot.profession = 'primary';
  }
  slot.profession = seatUid.value ? seatProfession.value : 'primary';
  slot.note = seatNote.value.trim();
  slot.dutyIds = [...seatDutyIds.value];
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
    const [people, jobs, tasks] = await Promise.all([
      memberClient.getMembers(),
      memberClient.getProfessions(),
      dutyClient.getDuties(),
    ]);
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
    const [people, jobs, tasks] = await Promise.all([
      memberClient.getMembers(),
      memberClient.getProfessions(),
      dutyClient.getDuties(),
    ]);
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
  disposed = true;
  operation++;
  unregisterGuard?.();
  window.removeEventListener('beforeunload', beforeUnload);
});
</script>

<template>
  <section class="page-heading" aria-labelledby="lineups-title">
    <div>
      <p class="eyebrow">GUILD MANAGER / 戰場</p>
      <h1 id="lineups-title">戰場排表<span class="heading-dot">.</span></h1>
      <p class="page-subtitle">安排每一場的出戰名單，保存範本與當時的陣容。</p>
    </div>
    <v-btn
      variant="outlined"
      :prepend-icon="mdiRefresh"
      :disabled="loading || busy || catalogBusy || historyLoading"
      @click="load"
      >重新載入</v-btn
    >
  </section>
  <v-alert v-if="error" type="error" variant="tonal" class="lineup-alert" role="alert"
    >{{ error }}<v-btn v-if="!currentEvent" variant="text" @click="load">重試</v-btn></v-alert
  >
  <v-alert v-if="notice" type="success" variant="tonal" class="lineup-alert" role="status">{{
    notice
  }}</v-alert>
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
    <v-card class="lineup-toolbar">
      <div class="lineup-selects">
        <v-select
          :model-value="eventId"
          :items="eventOptions"
          label="戰鬥場次"
          variant="outlined"
          hide-details
          :disabled="busy || catalogBusy || historyLoading"
          @update:model-value="changeEvent"
        /><v-select
          id="lineup-history"
          :model-value="historyId"
          :items="historyOptions"
          label="瀏覽排表"
          variant="outlined"
          hide-details
          :disabled="busy || catalogBusy || historyLoading"
          @update:model-value="historyId = $event"
        />
      </div>
      <div class="lineup-toolbar-bottom">
        <div>
          <strong>{{ displayedEvent?.title }}</strong>
          <p>
            {{ eventTypeLabel(displayedEvent?.type) }} · {{ displayedEvent?.dates[0] }} · 已安排
            {{ count }} / 60 人
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
          placeholder="尚無範本，先另存一份名單"
          clearable
          variant="outlined"
          hide-details
          :disabled="busy || catalogBusy || historyLoading || currentEvent?.archived"
        /><v-btn
          variant="outlined"
          :disabled="!templateId || busy || catalogBusy || historyLoading || currentEvent?.archived"
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
      個位置的成員或職業不符合本場資格。請編輯位置移除或重新安排，再確認名單。</v-alert
    >
    <v-alert v-if="skipped.length" type="warning" variant="tonal" class="lineup-alert" role="status"
      ><strong>套用時跳過的成員</strong>
      <ul>
        <li v-for="person in skipped" :key="person.uid">
          {{ person.name }}（{{ person.uid }}）：{{ person.reason }}
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
          <p class="lineup-hint">
            拖曳至位置，或先點選成員再點位置。已安排成員會移動；兩個已占用位置會交換，職責與備註保留在原位置。
          </p>
          <v-text-field
            v-model="search"
            label="搜尋名稱或 UID"
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
            variant="outlined"
            hide-details
            :disabled="busy"
          />
          <p class="lineup-list-count">
            符合 {{ visibleMembers.length }} 人 · 尚未安排
            {{ eligible.filter((member) => !assigned.has(member.uid)).length }} 人
          </p>
          <div v-if="selectedUid" class="lineup-selected" role="status">
            已選：{{ members.find((member) => member.uid === selectedUid)?.name
            }}<v-btn variant="text" size="small" @click="selectedUid = ''">取消選取</v-btn>
          </div>
          <div class="lineup-member-list">
            <button
              v-for="member in visibleMembers"
              :key="member.uid"
              type="button"
              :class="['lineup-member', { 'member-selected': selectedUid === member.uid }]"
              :draggable="!busy"
              :disabled="busy"
              :aria-pressed="selectedUid === member.uid"
              :data-member="member.uid"
              @dragstart="drag($event, member.uid)"
              @click="selectMember(member.uid)"
            >
              <span class="lineup-member-main"
                ><strong>{{ member.name }}</strong
                ><small>{{ member.uid }}</small></span
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
                }}<small v-if="assigned.has(member.uid)">已安排</small></span
              >
            </button>
            <p v-if="!visibleMembers.length" class="lineup-hint">
              {{ eligible.length ? '沒有符合搜尋條件的成員。' : '尚無符合本場資格的成員。' }}
            </p>
          </div></v-card
        >
      </aside>
      <LineupBoard
        :teams="displayedTeams"
        :members="members"
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
            dialog === 'seat' ? '編輯位置' : dialog === 'template' ? '另存名單範本' : '確認本場名單'
          }}
        </h2>
        <v-alert v-if="dialogError" type="error" variant="tonal" role="alert">{{
          dialogError
        }}</v-alert>
        <template v-if="dialog === 'seat'"
          ><v-select
            :model-value="seatUid"
            :items="slotOptions"
            label="安排成員"
            variant="outlined"
            :disabled="busy"
            @update:model-value="changeSeatUid"
          /><v-select
            v-model="seatProfession"
            :items="seatJobs"
            label="上場職業"
            variant="outlined"
            :disabled="busy || !seatUid"
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
            選取已安排的成員會移動或交換位置。選空位可移除此位置的成員。
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
            <strong>{{ currentEvent?.title }}</strong>
          </p>
          <p>{{ eventTypeLabel(currentEvent?.type) }} · {{ currentEvent?.dates[0] }}</p>
          <p>
            將確認第 {{ latestVersion + 1 }} 版，共 {{ count }} 位成員，{{ 60 - count }} 個空位。
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
</template>
