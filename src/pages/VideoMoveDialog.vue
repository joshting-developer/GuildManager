<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, useId } from 'vue';
import DataLoading from '../components/DataLoading.vue';
import { createEventVideoClient } from '../api/event-videos.js';
import { battleEventLabel } from '../domain/battle-events.js';

const props = defineProps({
  video: { type: Object, required: true },
  events: { type: Array, required: true },
  hasMore: Boolean,
  eventsLoading: Boolean,
  eventsError: { type: String, default: '' },
});
const emit = defineEmits(['close', 'moved', 'refreshed', 'load-more']);
const client = createEventVideoClient();
const id = useId(), open = ref(true), select = ref(null);
const record = shallowRef(props.video), targetEventId = ref(null);
const saving = ref(false), reloading = ref(false), error = ref(''), fieldError = ref(''), conflict = ref(false);
const currentLabel = computed(() => {
  const event = props.events.find(item => item.id === record.value.eventId);
  return event ? battleEventLabel(event) : '目前場次';
});
const options = computed(() => props.events
  .filter(event => event.id !== record.value.eventId)
  .map(event => ({ value: event.id, title: battleEventLabel(event) })));
const dirty = computed(() => targetEventId.value !== null);
const opener = document.activeElement;
let disposed = false, token = 0, attempt;
async function reloadVideo() {
  if (saving.value || reloading.value) return;
  const current = ++token;
  reloading.value = true;
  error.value = '';
  try {
    const result = await client.getVideos(record.value.eventId, { videoId: record.value.id });
    if (disposed || current !== token) return;
    emit('refreshed', result);
    const latest = result.videos.find(item => item.id === record.value.id);
    if (!latest) throw new Error('這筆影片已不在本場，請關閉視窗查看最新清單');
    record.value = latest;
    attempt = null;
    conflict.value = false;
  } catch (cause) {
    if (!disposed && current === token) error.value = cause.message;
  } finally {
    if (!disposed && current === token) reloading.value = false;
  }
}
async function save() {
  if (saving.value || reloading.value || conflict.value) return;
  error.value = '';
  fieldError.value = '';
  if (!options.value.some(option => option.value === targetEventId.value)) {
    fieldError.value = '請選擇要更換的場次';
    return;
  }
  const current = record.value;
  const input = { targetEventId: targetEventId.value, revision: current.revision ?? 0 };
  const fingerprint = JSON.stringify([current.eventId, current.id, input]);
  if (!attempt || attempt.fingerprint !== fingerprint) attempt = { fingerprint, requestId: crypto.randomUUID() };
  saving.value = true;
  const operation = ++token;
  try {
    const result = await client.moveVideo(current.eventId, current.id, { ...input, requestId: attempt.requestId });
    if (disposed || operation !== token) return;
    const target = props.events.find(event => event.id === result.video.eventId);
    emit('moved', { ...result, targetLabel: target ? battleEventLabel(target) : '新場次' });
    open.value = false;
  } catch (cause) {
    if (!disposed && operation === token) {
      error.value = cause.message;
      fieldError.value = cause.fields?.targetEventId || '';
      conflict.value = ['REVISION_CONFLICT', 'VIDEO_NOT_FOUND', 'EVENT_UNAVAILABLE'].includes(cause.code);
    }
  } finally {
    if (!disposed && operation === token) saving.value = false;
  }
}
function close() {
  if (saving.value) return;
  if (dirty.value && !window.confirm('放棄尚未儲存的場次更換？')) return;
  token++;
  open.value = false;
}
function closed() {
  emit('close');
  if (opener?.isConnected) opener.focus({ preventScroll: true });
}
onMounted(async () => {
  await nextTick();
  if (!disposed) select.value?.$el?.querySelector('input')?.focus();
});
onUnmounted(() => {
  disposed = true;
  token++;
});
</script>

<template>
  <v-dialog :model-value="open" persistent max-width="480" :aria-labelledby="`${id}-title`"
    @click:outside="close" @keydown.esc.prevent.stop="close" @after-leave="closed">
    <v-card class="video-dialog-card">
      <h2 :id="`${id}-title`">更換影片場次</h2>
      <p class="video-dialog-summary">{{ record.name }} · 目前場次：{{ currentLabel }}</p>
      <v-alert v-if="error" type="error" variant="tonal" role="alert" class="mb-4">
        {{ error }}
        <v-btn v-if="conflict" variant="text" :disabled="reloading || saving" @click="reloadVideo">重新載入影片</v-btn>
      </v-alert>
      <DataLoading v-if="reloading" compact>正在重新載入影片…</DataLoading>
      <form @submit.prevent="save">
        <v-select ref="select" v-model="targetEventId" :items="options" label="正確場次" variant="outlined"
          :disabled="saving || reloading" :error-messages="fieldError" aria-required="true"
          no-data-text="沒有其他戰鬥場次" />
        <v-btn v-if="hasMore" variant="text" :loading="eventsLoading" :disabled="saving || reloading" @click="emit('load-more')">載入更多場次</v-btn>
        <p v-if="eventsError" role="alert">{{ eventsError }}</p>
        <p v-if="!conflict && dirty" class="video-dialog-summary">儲存後這筆影片會移到所選場次，其他欄位不變。</p>
        <DataLoading v-if="saving" compact :spinner="false">正在更換場次，請稍候…</DataLoading>
        <div class="video-dialog-actions">
          <v-btn variant="outlined" :disabled="saving" @click="close">取消</v-btn>
          <v-btn type="submit" color="primary" :loading="saving"
            :disabled="reloading || saving || conflict || !dirty">更換場次</v-btn>
        </div>
      </form>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.video-dialog-card { padding: 24px; }
.video-dialog-card h2 { font-size: 22px; }
.video-dialog-summary { color: var(--color-text-muted); margin: 12px 0 20px; overflow-wrap: anywhere; }
.video-dialog-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 12px; margin-top: 20px; }
@media (max-width: 600px) { .video-dialog-card { padding: 20px; } }
</style>
