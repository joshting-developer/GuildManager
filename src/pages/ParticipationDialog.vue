<script setup>
import { computed, ref, watch, onUnmounted } from 'vue';
import { createParticipationClient } from '../api/participation.js';
import { createMemberClient } from '../api/members.js';
import { eventDisplayTitle, eventTypeLabel } from '../domain/event-types.js';
const props = defineProps({ modelValue: Boolean, event: { type: Object, required: true } });
const emit = defineEmits(['update:modelValue', 'closed']);
const source = import.meta.env.VITE_DATA_SOURCE || 'local';
const client = createParticipationClient({ source });
const memberClient = createMemberClient({ source });
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
const leaveCount = computed(() => entries.value.filter((row) => row.status === 'leave').length);
function formValues() {
  return JSON.stringify([name.value, professionId.value, status.value, note.value]);
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
  baseline.value = formValues();
  attempt = null;
}
async function load() {
  const currentToken = ++token;
  loading.value = true;
  loadError.value = '';
  error.value = '';
  try {
    const [participation, jobs] = await Promise.all([
      client.getParticipation(props.event.id),
      memberClient.getProfessions(),
    ]);
    if (disposed || currentToken !== token) return;
    if (
      participation.eventId !== props.event.id ||
      typeof participation.revision !== 'string' ||
      !Array.isArray(participation.responses) ||
      !Array.isArray(participation.registrations) ||
      !Array.isArray(participation.registrationLeaves) ||
      !Array.isArray(jobs.professions)
    )
      throw new Error('資料格式不正確, 請重新載入');
    professions.value = jobs.professions;
    responses.value = participation.responses;
    registrations.value = participation.registrations;
    registrationLeaves.value = participation.registrationLeaves;
    revision.value = participation.revision;
  } catch (cause) {
    if (currentToken === token) loadError.value = cause.message;
  } finally {
    if (currentToken === token) loading.value = false;
  }
}
watch(status, () => {
  error.value = '';
});
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      notice.value = '';
      status.value = 'registered';
      resetForm();
      load();
    } else token++;
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
  if (busy.value || loading.value) return;
  if (!name.value.trim()) {
    error.value = '請填寫名稱';
    return;
  }
  if (status.value === 'registered' && !professionId.value) {
    error.value = '請選擇職業';
    return;
  }
  busy.value = true;
  error.value = '';
  notice.value = '';
  const input = {
    name: name.value.trim(),
    professionId: status.value === 'registered' ? professionId.value : null,
    status: status.value,
    note: note.value.trim(),
    revision: revision.value,
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
        <v-btn variant="text" :disabled="busy || loading" @click="load">重新載入</v-btn>
      </div>
      <p v-if="loading" role="status">正在載入本場報名資料…</p>
      <v-alert v-else-if="loadError" type="error" variant="tonal" role="alert">{{
        loadError
      }}</v-alert>
      <template v-else>
        <p class="participation-count">報名 {{ registeredCount }} 人 · 請假 {{ leaveCount }} 人</p>
        <form class="participation-form" @submit.prevent="submit">
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
          <v-text-field
            v-model="name"
            label="名稱"
            maxlength="64"
            variant="outlined"
            density="compact"
            :disabled="busy"
            hide-details
            aria-required="true"
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
        <v-alert v-if="error" type="error" variant="tonal" role="alert">{{ error }}</v-alert>
        <v-alert v-if="notice" type="success" variant="tonal" role="status">{{ notice }}</v-alert>
        <ul v-if="entries.length" class="registration-list" aria-label="本場報名／請假名單">
          <li v-for="row in entries" :key="row.id || row.uid">
            <div>
              <strong>{{ row.name }}</strong>
              <span class="registration-job" :style="{ '--job-color': row.colorcode }">{{
                row.profession
              }}</span>
              <p v-if="row.note">{{ row.note }}</p>
            </div>
            <v-chip
              :color="row.status === 'registered' ? 'success' : 'warning'"
              size="small"
              variant="tonal"
              >{{ row.status === 'registered' ? '報名' : '請假' }}</v-chip
            >
          </li>
        </ul>
        <p v-else class="lineup-hint">本場尚無報名／請假資料</p>
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
.registration-list {
  list-style: none;
  padding: 0;
}
.registration-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--color-border);
}
.registration-list li > div {
  min-width: 0;
  overflow-wrap: anywhere;
}
.registration-list span {
  margin-left: 12px;
  font-size: 13px;
}
.registration-list p {
  color: var(--color-text-muted);
  font-size: 13px;
  margin-top: 6px;
}
.registration-job {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-muted);
}
.registration-job::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 1px solid #64748b33;
  background: var(--job-color);
}
@media (max-width: 600px) {
  .participation-card {
    padding: 16px;
  }
}
</style>
