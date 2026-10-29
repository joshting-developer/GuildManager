<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, useId } from 'vue';
import DataLoading from '../components/DataLoading.vue';
import { createEventVideoClient } from '../api/event-videos.js';
import { createMemberClient } from '../api/members.js';

const props = defineProps({ video: { type: Object, required: true } });
const emit = defineEmits(['close', 'updated', 'refreshed']);
const source = import.meta.env.VITE_DATA_SOURCE || 'local';
const client = createEventVideoClient({ source }), memberClient = createMemberClient({ source });
const id = useId(), open = ref(true), select = ref(null);
const record = shallowRef(props.video), professionId = ref(props.video.professionId ?? null);
const professions = shallowRef([]), loading = ref(true), saving = ref(false);
const error = ref(''), fieldError = ref(''), conflict = ref(false);
const dirty = computed(() => professionId.value !== (record.value.professionId ?? null));
const options = computed(() => professions.value.map(item => ({ title: item.name, value: item.job_id })));
const opener = document.activeElement;
let disposed = false, token = 0, attempt;
async function loadOptions() {
  const current = ++token;
  loading.value = true;
  error.value = '';
  try {
    const data = await memberClient.getProfessions();
    if (disposed || current !== token) return;
    if (!Array.isArray(data.professions) || !data.professions.length) throw new Error('職業資料不完整，請重試');
    professions.value = data.professions;
    loading.value = false;
    await nextTick();
    if (!disposed && open.value) select.value?.$el?.querySelector('input')?.focus();
  } catch (cause) {
    if (!disposed && current === token) error.value = cause.message;
  } finally {
    if (!disposed && current === token) loading.value = false;
  }
}
async function reloadVideo() {
  if (saving.value || loading.value) return;
  const current = ++token;
  loading.value = true;
  error.value = '';
  try {
    const result = await client.getVideos(record.value.eventId);
    if (disposed || current !== token) return;
    const latest = result.videos.find(item => item.id === record.value.id);
    if (!latest) throw new Error('找不到這筆影片，請關閉視窗並重新載入');
    record.value = latest;
    attempt = null;
    conflict.value = false;
    emit('refreshed', result);
    // Keep the chosen correction while asking the manager to review the latest value.
  } catch (cause) {
    if (!disposed && current === token) error.value = cause.message;
  } finally {
    if (!disposed && current === token) loading.value = false;
  }
}
async function save() {
  if (saving.value || loading.value || conflict.value || !dirty.value) return;
  error.value = '';
  fieldError.value = '';
  if (!professions.value.some(item => item.job_id === professionId.value)) {
    fieldError.value = '請選擇職業';
    return;
  }
  const current = record.value;
  const input = { professionId: professionId.value, revision: current.revision ?? 0 };
  const fingerprint = JSON.stringify([current.eventId, current.id, input]);
  if (!attempt || attempt.fingerprint !== fingerprint) attempt = { fingerprint, requestId: crypto.randomUUID() };
  saving.value = true;
  const operation = ++token;
  try {
    const result = await client.updateProfession(current.eventId, current.id, { ...input, requestId: attempt.requestId });
    if (disposed || operation !== token) return;
    emit('updated', result.video);
    open.value = false;
  } catch (cause) {
    if (!disposed && operation === token) {
      error.value = cause.message;
      fieldError.value = cause.fields?.professionId || '';
      conflict.value = ['REVISION_CONFLICT', 'VIDEO_NOT_FOUND', 'EVENT_UNAVAILABLE'].includes(cause.code);
    }
  } finally {
    if (!disposed && operation === token) saving.value = false;
  }
}
function close() {
  if (saving.value) return;
  if (dirty.value && !window.confirm('放棄尚未儲存的職業修改？')) return;
  token++;
  open.value = false;
}
function closed() {
  emit('close');
  if (opener?.isConnected) opener.focus({ preventScroll: true });
}
function leaveWarning(event) {
  if (open.value && (dirty.value || saving.value)) { event.preventDefault(); event.returnValue = ''; }
}
onMounted(loadOptions);
window.addEventListener('beforeunload', leaveWarning);
onUnmounted(() => {
  disposed = true;
  token++;
  window.removeEventListener('beforeunload', leaveWarning);
});
</script>

<template>
  <v-dialog :model-value="open" persistent max-width="440" :aria-labelledby="`${id}-title`"
    @click:outside="close" @keydown.esc.prevent.stop="close" @after-leave="closed">
    <v-card class="video-profession-card">
      <h2 :id="`${id}-title`">修改影片職業</h2>
      <p class="video-profession-summary">{{ video.name }} · 目前職業：{{ record.professionName || '未記錄' }}</p>
      <DataLoading v-if="loading">正在載入職業資料…</DataLoading>
      <v-alert v-if="error" type="error" variant="tonal" role="alert" class="mb-4">
        {{ error }}
        <v-btn v-if="conflict" variant="text" :disabled="loading || saving" @click="reloadVideo">重新載入影片</v-btn>
        <v-btn v-else-if="!professions.length" variant="text" :disabled="loading || saving" @click="loadOptions">重試</v-btn>
      </v-alert>
      <form @submit.prevent="save">
        <v-select v-show="!loading" ref="select" v-model="professionId" :items="options" label="正確職業"
          variant="outlined" :disabled="saving || !professions.length" :error-messages="fieldError" aria-required="true" />
        <p v-if="!conflict && dirty" class="video-profession-summary">儲存後只更新這筆影片的職業。</p>
        <DataLoading v-if="saving" compact :spinner="false">正在儲存職業，請稍候…</DataLoading>
        <div class="video-profession-actions">
          <v-btn variant="outlined" :disabled="saving" @click="close">取消</v-btn>
          <v-btn type="submit" color="primary" :loading="saving"
            :disabled="loading || saving || conflict || !dirty || !professions.length">儲存職業</v-btn>
        </div>
      </form>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.video-profession-card { padding: 24px; }
.video-profession-card h2 { font-size: 22px; }
.video-profession-summary { color: var(--color-text-muted); margin: 12px 0 20px; overflow-wrap: anywhere; }
.video-profession-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 12px; margin-top: 20px; }
@media (max-width: 600px) { .video-profession-card { padding: 20px; } }
</style>
