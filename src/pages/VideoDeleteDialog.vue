<script setup>
import { onUnmounted, ref, useId } from 'vue';
import DataLoading from '../components/DataLoading.vue';
import { createEventVideoClient } from '../api/event-videos.js';
import { videoGroupLabel } from '../domain/event-videos.js';

const props = defineProps({
  video: { type: Object, required: true },
  eventLabel: { type: String, required: true },
});
const emit = defineEmits(['close', 'deleted', 'reload']);
const client = createEventVideoClient();
const id = useId(), open = ref(true), saving = ref(false), error = ref(''), conflict = ref(false);
const opener = document.activeElement;
let disposed = false, token = 0, deleted = false;
async function confirmDelete() {
  if (saving.value || conflict.value) return;
  error.value = '';
  saving.value = true;
  const operation = ++token;
  try {
    await client.deleteVideo(props.video.eventId, props.video.id, { revision: props.video.revision ?? 0 });
    if (disposed || operation !== token) return;
    deleted = true;
    emit('deleted', props.video);
    open.value = false;
  } catch (cause) {
    if (!disposed && operation === token) {
      error.value = cause.message;
      conflict.value = ['REVISION_CONFLICT', 'VIDEO_NOT_FOUND', 'EVENT_UNAVAILABLE'].includes(cause.code);
    }
  } finally {
    if (!disposed && operation === token) saving.value = false;
  }
}
function close() {
  if (saving.value) return;
  token++;
  open.value = false;
}
function reload() {
  emit('reload');
  close();
}
function closed() {
  emit('close');
  // A deleted row's button is gone; the page moves focus itself.
  if (!deleted && opener?.isConnected) opener.focus({ preventScroll: true });
}
onUnmounted(() => {
  disposed = true;
  token++;
});
</script>

<template>
  <v-dialog :model-value="open" persistent max-width="480" :aria-labelledby="`${id}-title`"
    @click:outside="close" @keydown.esc.prevent.stop="close" @after-leave="closed">
    <v-card class="video-dialog-card">
      <h2 :id="`${id}-title`">刪除影片</h2>
      <p class="video-dialog-summary">確定要刪除以下 1 筆影片？刪除後無法復原。</p>
      <dl class="video-delete-detail">
        <dt>場次</dt><dd>{{ eventLabel }}</dd>
        <dt>角色名稱</dt><dd>{{ video.name }}</dd>
        <dt>團別</dt><dd>{{ videoGroupLabel(video.groupName) }}</dd>
        <dt>第一場</dt><dd>{{ video.firstUrl || '—' }}</dd>
        <dt>第二場</dt><dd>{{ video.secondUrl || '—' }}</dd>
      </dl>
      <v-alert v-if="error" type="error" variant="tonal" role="alert" class="mb-4">
        {{ error }}
        <v-btn v-if="conflict" variant="text" :disabled="saving" @click="reload">重新載入本場影片</v-btn>
      </v-alert>
      <DataLoading v-if="saving" compact :spinner="false">正在刪除影片，請稍候…</DataLoading>
      <div class="video-dialog-actions">
        <v-btn variant="outlined" :disabled="saving" @click="close">取消</v-btn>
        <v-btn color="error" :loading="saving" :disabled="saving || conflict" @click="confirmDelete">確認刪除</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.video-dialog-card { padding: 24px; }
.video-dialog-card h2 { font-size: 22px; }
.video-dialog-summary { color: var(--color-text-muted); margin: 12px 0 16px; }
.video-delete-detail { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px 16px; margin: 0 0 20px; }
.video-delete-detail dt { color: var(--color-text-muted); }
.video-delete-detail dd { margin: 0; overflow-wrap: anywhere; }
.video-dialog-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 12px; margin-top: 20px; }
@media (max-width: 600px) { .video-dialog-card { padding: 20px; } }
</style>
