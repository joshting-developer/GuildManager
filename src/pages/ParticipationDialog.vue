<script setup>
import { computed, ref, watch, inject, onUnmounted } from 'vue';
import { createParticipationClient } from '../api/participation.js';
import { createMemberClient } from '../api/members.js';
import { eventDisplayTitle, eventTypeLabel } from '../domain/event-types.js';
const props = defineProps({ modelValue: Boolean, event: { type: Object, required: true } });
const emit = defineEmits(['update:modelValue', 'closed']);
const source = import.meta.env.VITE_DATA_SOURCE || 'local';
const client = createParticipationClient({ source });
const memberClient = createMemberClient({ source });
const calendarAuth = inject('calendarAuth', null);
const requiresLogin = computed(() => ['guild_war', 'dragon_tiger'].includes(props.event.type));
const locked = computed(() => requiresLogin.value && !calendarAuth?.user.value);
const authLoading = computed(() => !!calendarAuth?.loading.value);
const members = ref([]),
  nameSource = ref('manual'),
  selectedMemberUid = ref(null);
const selectedMember = computed(() =>
  members.value.find((member) => member.uid === selectedMemberUid.value),
);
const memberChoices = computed(() =>
  members.value.filter((member) =>
    nameSource.value === 'guild' ? member.isInGuild : member.isInClub,
  ),
);
const nameSources = [
  { value: 'manual', title: '直接輸入名稱' },
  { value: 'guild', title: '幫會成員名單' },
  { value: 'club', title: '龍虎戰成員名單' },
];
const professions = ref([]),
  responses = ref([]),
  registrations = ref([]),
  registrationLeaves = ref([]),
  revision = ref('');
const loading = ref(true),
  busy = ref(false),
  loadError = ref(''),
  error = ref(''),
  notice = ref('');
const tab = ref('form');
const name = ref(''),
  professionId = ref(null),
  status = ref('registered'),
  note = ref('');
const entries = computed(() => [
  ...responses.value.filter((row) => ['registered', 'leave'].includes(row.status)),
  ...registrations.value.map((row) => ({ ...row, status: 'registered' })),
  ...registrationLeaves.value.map((row) => ({ ...row, status: 'leave' })),
]);
const registeredCount = computed(
  () => entries.value.filter((row) => row.status === 'registered').length,
);
const professionCounts = computed(() =>
  professions.value.map((job) => ({
    ...job,
    count: entries.value.filter(
      (row) => row.status === 'registered' && row.professionId === job.job_id,
    ).length,
  })),
);
function formValues() {
  return JSON.stringify([
    name.value,
    selectedMemberUid.value,
    professionId.value,
    status.value,
    note.value,
  ]);
}
const baseline = ref(formValues());
const unsaved = computed(() => formValues() !== baseline.value);
let token = 0,
  disposed = false,
  attempt;
function resetForm() {
  name.value = '';
  professionId.value = null;
  note.value = '';
  selectedMemberUid.value = null;
  baseline.value = formValues();
  attempt = null;
}
async function load() {
  if (locked.value || authLoading.value) return;
  const currentToken = ++token;
  loading.value = true;
  loadError.value = '';
  error.value = '';
  try {
    const [participation, jobs, roster] = await Promise.all([
      client.getParticipation(props.event.id),
      memberClient.getProfessions(),
      requiresLogin.value ? client.getMembers(props.event.id) : Promise.resolve({ members: [] }),
    ]);
    if (disposed || currentToken !== token) return;
    if (
      participation.eventId !== props.event.id ||
      typeof participation.revision !== 'string' ||
      !Array.isArray(participation.responses) ||
      !Array.isArray(participation.registrations) ||
      !Array.isArray(participation.registrationLeaves) ||
      !Array.isArray(jobs.professions) ||
      !Array.isArray(roster.members)
    )
      throw new Error('資料格式不正確, 請重新載入');
    professions.value = jobs.professions;
    responses.value = participation.responses;
    registrations.value = participation.registrations;
    registrationLeaves.value = participation.registrationLeaves;
    revision.value = participation.revision;
    members.value = roster.members;
    if (
      selectedMemberUid.value &&
      (!selectedMember.value ||
        (nameSource.value === 'guild'
          ? !selectedMember.value.isInGuild
          : !selectedMember.value.isInClub))
    ) {
      selectedMemberUid.value = null;
      name.value = '';
      error.value = '成員已不在此名單內, 請重新選擇';
    }
  } catch (cause) {
    if (currentToken === token) loadError.value = cause.message;
  } finally {
    if (currentToken === token) loading.value = false;
  }
}
watch(status, () => {
  error.value = '';
});
watch(nameSource, () => {
  selectedMemberUid.value = null;
  name.value = '';
  professionId.value = null;
  error.value = '';
  attempt = null;
});
watch(selectedMemberUid, () => {
  if (!selectedMember.value) return;
  name.value = selectedMember.value.name;
  professionId.value = selectedMember.value.primaryProfessionId;
  error.value = '';
});
watch([() => calendarAuth?.user.value?.id, authLoading], () => {
  if (!props.modelValue) return;
  if (locked.value || authLoading.value) {
    token++;
    loading.value = false;
  } else load();
});
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      notice.value = '';
      tab.value = 'form';
      status.value = 'registered';
      nameSource.value = 'manual';
      loading.value = false;
      resetForm();
      load();
    } else {
      token++;
    }
  },
  { immediate: true },
);
onUnmounted(() => {
  disposed = true;
  token++;
});
function close() {
  if (
    !busy.value &&
    (!unsaved.value || window.confirm('有尚未送出的報名／請假資料, 確定要關閉嗎？'))
  ) {
    resetForm();
    emit('update:modelValue', false);
  }
}
async function submit() {
  if (busy.value || loading.value || locked.value || authLoading.value) return;
  error.value = '';
  notice.value = '';
  if (!name.value.trim()) {
    error.value = '請填寫名稱';
    return;
  }
  if (requiresLogin.value && nameSource.value !== 'manual' && !selectedMember.value) {
    error.value = '請選擇成員';
    return;
  }
  if (status.value === 'registered' && !professionId.value) {
    error.value = '請選擇職業';
    return;
  }
  busy.value = true;
  const input = {
    name: name.value.trim(),
    professionId: status.value === 'registered' ? professionId.value : null,
    status: status.value,
    note: note.value.trim(),
    revision: revision.value,
    ...(requiresLogin.value && nameSource.value !== 'manual'
      ? { memberUid: selectedMemberUid.value }
      : {}),
  };
  const encoded = JSON.stringify(input);
  if (attempt?.encoded !== encoded) attempt = { encoded, requestId: crypto.randomUUID() };
  try {
    const result = await client.submitParticipation(props.event.id, {
      ...input,
      requestId: attempt.requestId,
    });
    if (
      result.eventId !== props.event.id ||
      result.name !== input.name ||
      result.status !== input.status
    )
      throw new Error('回應格式不正確, 請重試以確認結果');
    resetForm();
    notice.value = input.status === 'registered' ? '報名成功' : '請假成功';
    await load();
  } catch (cause) {
    error.value = cause.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="640"
    :persistent="busy"
    aria-labelledby="participation-title"
    @after-leave="emit('closed')"
    @update:model-value="!$event && close()"
  >
    <v-card class="participation-card">
      <div class="section-header">
        <div>
          <p class="eyebrow">{{ event.dates[0] }} · {{ eventTypeLabel(event.type) }}</p>
          <h2 id="participation-title">{{ eventDisplayTitle(event) }} · 報名／請假</h2>
        </div>
        <v-btn
          v-if="!locked && !authLoading"
          variant="text"
          :disabled="busy || loading"
          @click="load"
          >重新載入</v-btn
        >
      </div>
      <p v-if="authLoading" role="status">正在確認登入狀態…</p>
      <p v-else-if="locked" role="status">登入已到期，請關閉視窗後使用右上角登入。</p>
      <p v-else-if="loading" role="status">正在載入本場報名資料…</p>
      <v-alert v-else-if="loadError" type="error" variant="tonal" role="alert">{{
        loadError
      }}</v-alert>
      <template v-else>
        <p class="participation-count">報名 {{ registeredCount }} 人</p>
        <v-tabs v-model="tab" color="primary" aria-label="場次報名資訊">
          <v-tab
            id="participation-form-tab"
            value="form"
            aria-controls="participation-form-panel"
            :disabled="busy"
            >報名／請假</v-tab
          >
          <v-tab
            id="participation-professions-tab"
            value="professions"
            aria-controls="participation-professions-panel"
            :disabled="busy"
            >職業統計</v-tab
          >
        </v-tabs>
        <section
          v-show="tab === 'form'"
          id="participation-form-panel"
          role="tabpanel"
          aria-labelledby="participation-form-tab"
          tabindex="0"
        >
          <form class="participation-form" @submit.prevent="submit">
            <v-tabs
              v-if="requiresLogin"
              v-model="nameSource"
              aria-label="選擇名稱方式"
              :disabled="busy"
              class="participation-name-tabs"
            >
              <v-tab
                v-for="item in nameSources"
                :key="item.value"
                :value="item.value"
                :id="`participation-name-${item.value}-tab`"
                :aria-controls="`participation-name-${item.value}-panel`"
                >{{ item.title }}</v-tab
              >
            </v-tabs>
            <div
              :id="`participation-name-${nameSource}-panel`"
              :role="requiresLogin ? 'tabpanel' : undefined"
              :aria-labelledby="requiresLogin ? `participation-name-${nameSource}-tab` : undefined"
            >
              <v-text-field
                v-if="!requiresLogin || nameSource === 'manual'"
                v-model="name"
                label="名稱"
                maxlength="64"
                variant="outlined"
                density="compact"
                :disabled="busy"
                hide-details
                aria-required="true"
              />
              <template v-else>
                <v-autocomplete
                  v-model="selectedMemberUid"
                  :items="memberChoices"
                  item-title="name"
                  item-value="uid"
                  :label="nameSource === 'guild' ? '幫會成員' : '龍虎戰成員'"
                  variant="outlined"
                  density="compact"
                  :disabled="busy"
                  hide-details
                  clearable
                  aria-required="true"
                  no-data-text="沒有符合的成員"
                >
                  <template #item="{ props: itemProps, item }"
                    ><v-list-item
                      v-bind="itemProps"
                      :subtitle="
                        professions.find((job) => job.job_id === item.primaryProfessionId)?.name ||
                        '職業未設定'
                      "
                  /></template>
                </v-autocomplete>
                <p v-if="!memberChoices.length" class="participation-count">
                  {{ nameSource === 'guild' ? '尚無幫會成員' : '尚無龍虎戰成員' }}
                </p>
              </template>
            </div>
            <v-select
              v-model="status"
              :items="[
                { title: '報名', value: 'registered' },
                { title: '請假', value: 'leave' },
              ]"
              label="狀態"
              variant="outlined"
              density="compact"
              :disabled="busy"
              hide-details
            />
            <v-select
              v-if="status === 'registered'"
              v-model="professionId"
              :items="professions"
              item-title="name"
              item-value="job_id"
              label="職業"
              variant="outlined"
              density="compact"
              :disabled="busy"
              hide-details
              aria-required="true"
            />
            <v-text-field
              v-model="note"
              label="備註（選填）"
              maxlength="160"
              variant="outlined"
              density="compact"
              :disabled="busy"
              hide-details
            />
            <v-btn type="submit" color="primary" :loading="busy" :disabled="busy">{{
              status === 'registered' ? '送出報名' : '送出請假'
            }}</v-btn>
          </form>
        </section>
        <section
          v-show="tab === 'professions'"
          id="participation-professions-panel"
          role="tabpanel"
          aria-labelledby="participation-professions-tab"
          tabindex="0"
        >
          <ul class="profession-count-list" aria-label="各職業報名人數">
            <li v-for="job in professionCounts" :key="job.job_id">
              <span class="profession-count-name" :style="{ '--job-color': job.colorcode }">{{
                job.name
              }}</span>
              <strong>{{ job.count }}<small> 人</small></strong>
            </li>
          </ul>
        </section>
        <v-alert v-if="error" type="error" variant="tonal" role="alert">{{ error }}</v-alert>
        <v-alert v-if="notice" type="success" variant="tonal" role="status">{{ notice }}</v-alert>
      </template>
      <div class="event-dialog-actions">
        <v-btn variant="outlined" :disabled="busy" @click="close">關閉</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.participation-card {
  padding: 24px;
  display: block;
  overflow-y: auto;
  max-height: calc(100dvh - 48px);
}
.participation-card > .section-header {
  margin-bottom: 16px;
  align-items: flex-start;
}
.participation-card > .v-alert {
  margin: 12px 0;
}
.participation-form {
  display: grid;
  gap: 16px;
  padding: 20px 0;
}
.participation-form > .v-btn {
  justify-self: start;
}
.participation-count {
  font-size: 13px;
  color: var(--color-text-muted);
}
.profession-count-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  list-style: none;
  padding: 0;
  margin: 20px 0;
}
.profession-count-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  min-height: 52px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
}
.profession-count-name {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.profession-count-name::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1px solid #64748b33;
  background: var(--job-color);
  flex-shrink: 0;
}
.profession-count-list strong {
  font-size: 18px;
  white-space: nowrap;
}
.profession-count-list small {
  font-size: 12px;
  font-weight: 400;
  color: var(--color-text-muted);
}
@media (max-width: 600px) {
  .profession-count-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .participation-card {
    padding: 16px;
  }
}
</style>
