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
const people = ref([]),
  professions = ref([]),
  responses = ref([]),
  registrations = ref([]);
const loading = ref(true),
  busy = ref(false),
  loadError = ref(''),
  error = ref(''),
  notice = ref('');
const tab = ref('member'),
  uid = ref(null),
  status = ref('registered'),
  note = ref('');
const guestName = ref(''),
  guestProfession = ref(null),
  guestNote = ref('');
const currentResponse = computed(() => responses.value.find((row) => row.uid === uid.value));
const labels = { registered: '已報名', leave: '已請假', none: '未回應' };
let token = 0,
  disposed = false,
  guestAttempt;
const responseBaseline = ref('');
const unsaved = computed(
  () =>
    Boolean(guestName.value || guestProfession.value || guestNote.value) ||
    (responseBaseline.value &&
      JSON.stringify([status.value, note.value]) !== responseBaseline.value),
);
async function load() {
  const currentToken = ++token;
  loading.value = true;
  loadError.value = '';
  error.value = '';
  try {
    const [participation, members, jobs] = await Promise.all([
      client.getParticipation(props.event.id),
      memberClient.getMembers(),
      memberClient.getProfessions(),
    ]);
    if (disposed || currentToken !== token) return;
    if (
      participation.eventId !== props.event.id ||
      !Array.isArray(participation.responses) ||
      !Array.isArray(participation.registrations) ||
      !Array.isArray(members.members) ||
      !Array.isArray(jobs.professions)
    )
      throw new Error('資料格式不正確，請重新載入');
    people.value = members.members;
    professions.value = jobs.professions;
    responses.value = participation.responses;
    registrations.value = participation.registrations;
    syncResponse();
  } catch (cause) {
    if (currentToken === token) loadError.value = cause.message;
  } finally {
    if (currentToken === token) loading.value = false;
  }
}
function syncResponse() {
  status.value = currentResponse.value?.status || 'registered';
  note.value = currentResponse.value?.note || '';
  responseBaseline.value = JSON.stringify([status.value, note.value]);
  error.value = '';
}
watch(uid, syncResponse);
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      notice.value = '';
      tab.value = 'member';
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
    (!unsaved.value || window.confirm('有尚未送出的報名／請假資料，確定要關閉嗎？'))
  ) {
    guestName.value = '';
    guestProfession.value = null;
    guestNote.value = '';
    guestAttempt = null;
    uid.value = null;
    emit('update:modelValue', false);
  }
}
async function saveResponse() {
  if (!uid.value) {
    error.value = '請先選擇自己在名冊中的成員';
    return;
  }
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const result = await client.saveResponse(props.event.id, {
      uid: uid.value,
      status: status.value,
      note: note.value,
      revision: currentResponse.value?.revision || 0,
    });
    const row = result.response;
    if (
      row?.uid !== uid.value ||
      row.eventId !== props.event.id ||
      !Number.isSafeInteger(row.revision)
    )
      throw new Error('回應格式不正確，請重試以確認結果');
    const index = responses.value.findIndex((value) => value.uid === row.uid);
    if (index < 0) responses.value.push(row);
    else responses.value[index] = row;
    responseBaseline.value = JSON.stringify([status.value, note.value]);
    notice.value =
      row.status === 'none'
        ? '已取消本場回應。'
        : row.status === 'leave'
          ? '本場請假已儲存，排表來源將排除此成員。'
          : '本場報名已儲存。';
  } catch (cause) {
    error.value = cause.message;
  } finally {
    busy.value = false;
  }
}
async function registerGuest() {
  if (!guestName.value.trim() || !guestProfession.value) {
    error.value = '請填寫名稱並選擇職業';
    return;
  }
  busy.value = true;
  error.value = '';
  notice.value = '';
  const input = {
    name: guestName.value.trim(),
    professionId: guestProfession.value,
    note: guestNote.value.trim(),
  };
  const encoded = JSON.stringify(input);
  if (guestAttempt?.encoded !== encoded) guestAttempt = { encoded, requestId: crypto.randomUUID() };
  try {
    const result = await client.registerGuest(props.event.id, {
      ...input,
      requestId: guestAttempt.requestId,
    });
    if (!result.registration?.id || result.registration.eventId !== props.event.id)
      throw new Error('報名回應格式不正確，請重試以確認結果');
    if (result.registration.active === false) {
      guestAttempt = null;
      throw new Error('這筆報名已取消，請重新送出報名');
    }
    if (result.registration.active !== true) throw new Error('報名回應格式不正確，請重試');
    if (
      !registrations.value.some((row) => row.id === result.registration.id) &&
      result.registration.active
    )
      registrations.value.push(result.registration);
    notice.value = '額外報名成功，已加入本場排表來源。';
    guestName.value = '';
    guestProfession.value = null;
    guestNote.value = '';
    guestAttempt = null;
  } catch (cause) {
    error.value = cause.message;
  } finally {
    busy.value = false;
  }
}
async function cancelGuest(row) {
  if (!window.confirm(`確定取消「${row.name}」在本場的額外報名？`)) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const result = await client.cancelGuest(props.event.id, row.id, row.revision);
    if (result.registration?.id !== row.id || result.registration.active !== false)
      throw new Error('取消回應格式不正確，請重試');
    registrations.value = registrations.value.filter((value) => value.id !== row.id);
    notice.value = '額外報名已取消，原有排表歷史仍保留。';
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
    max-width="720"
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
      <p class="lineup-hint">
        目前本機尚未登入，請確認選擇的是自己的成員資料；回應只適用於這一場。
      </p>
      <p v-if="loading" role="status">正在載入本場報名資料…</p>
      <v-alert v-else-if="loadError" type="error" variant="tonal" role="alert">{{
        loadError
      }}</v-alert>
      <template v-else>
        <p class="participation-count">
          成員報名 {{ responses.filter((row) => row.status === 'registered').length }} 人 · 請假
          {{ responses.filter((row) => row.status === 'leave').length }} 人 · 額外報名
          {{ registrations.length }} 人
        </p>
        <v-tabs v-model="tab" aria-label="報名方式" :disabled="busy"
          ><v-tab value="member">成員報名／請假</v-tab><v-tab value="guest">額外報名</v-tab></v-tabs
        >
        <form v-if="tab === 'member'" class="participation-form" @submit.prevent="saveResponse">
          <v-autocomplete
            v-model="uid"
            :items="
              people.map((person) => ({
                title: `${person.name} · ${person.uid}`,
                value: person.uid,
              }))
            "
            label="選擇自己的成員資料"
            variant="outlined"
            density="compact"
            :disabled="busy"
            hide-details
          />
          <p v-if="uid" class="lineup-hint">
            目前狀態：{{ labels[currentResponse?.status || 'none'] }}
          </p>
          <v-select
            v-model="status"
            :items="[
              { title: '我要報名', value: 'registered' },
              { title: '我要請假', value: 'leave' },
              { title: '取消報名／請假', value: 'none' },
            ]"
            label="本場參與狀態"
            variant="outlined"
            density="compact"
            :disabled="busy"
            hide-details
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
          <v-btn type="submit" color="primary" :loading="busy" :disabled="busy">儲存回應</v-btn>
        </form>
        <form v-else class="participation-form" @submit.prevent="registerGuest">
          <p class="lineup-hint">
            不需要 UID；若已在成員名冊，請改用「成員報名／請假」，避免重複身分。
          </p>
          <v-text-field
            v-model="guestName"
            label="報名名稱"
            maxlength="64"
            variant="outlined"
            density="compact"
            :disabled="busy"
            hide-details
            aria-required="true"
          />
          <v-select
            v-model="guestProfession"
            :items="professions"
            item-title="name"
            item-value="job_id"
            label="報名職業"
            variant="outlined"
            density="compact"
            :disabled="busy"
            hide-details
            aria-required="true"
          />
          <v-text-field
            v-model="guestNote"
            label="報名備註（選填）"
            maxlength="160"
            variant="outlined"
            density="compact"
            :disabled="busy"
            hide-details
          />
          <v-btn type="submit" color="primary" :loading="busy" :disabled="busy">送出額外報名</v-btn>
          <ul v-if="registrations.length" class="registration-list" aria-label="本場額外報名清單">
            <li v-for="row in registrations" :key="row.id">
              <div>
                <strong>{{ row.name }}</strong
                ><span class="registration-job" :style="{ '--job-color': row.colorcode }">{{
                  row.profession
                }}</span>
                <p v-if="row.note">{{ row.note }}</p>
              </div>
              <v-btn
                variant="text"
                size="small"
                :disabled="busy"
                :aria-label="`取消 ${row.name} 的額外報名`"
                @click="cancelGuest(row)"
                >取消報名</v-btn
              >
            </li>
          </ul>
          <p v-else class="lineup-hint">本場尚無額外報名。</p>
        </form>
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
.participation-card > .v-tabs {
  margin-top: 12px;
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
