<script setup>
import DataLoading from '../components/DataLoading.vue';
import { onUnmounted, ref, watch } from 'vue';
import { createEventVideoClient } from '../api/event-videos.js';
import { createEventClient } from '../api/events.js';
import { VIDEO_GROUPS, validateVideoDetails } from '../domain/event-videos.js';

const props = defineProps({ event: { type: Object, required: true }, disabled: Boolean });
const emit = defineEmits(['busy', 'dirty', 'event-refreshed']);
const source = import.meta.env.VITE_DATA_SOURCE || 'local';
const client = createEventVideoClient({ source });
const eventClient = createEventClient({ source });
const emptyDraft = () => ({ name: '', firstUrl: '', secondUrl: '', groupName: null, note: '' });
const draft = ref(emptyDraft());
const errors = ref({}),
  notice = ref('');
const eventRevision = ref(props.event.revision);
const busy = ref(false),
  reloading = ref(false),
  reloadError = ref('');
let attempt = null;
let disposed = false,
  reloadToken = 0;
watch(busy, (value) => emit('busy', value), { flush: 'sync' });
watch(
  () => JSON.stringify(draft.value),
  () => {
    emit('dirty', Object.values(draft.value).some(Boolean));
  },
  { flush: 'sync' },
);
async function reloadEvent() {
  const token = ++reloadToken;
  reloading.value = true;
  reloadError.value = '';
  try {
    const data = await eventClient.getEvents();
    if (disposed || token !== reloadToken) return;
    const event = data.events?.find((item) => item.id === props.event.id);
    if (!event || !['scrimmage', 'guild_war', 'dragon_tiger'].includes(event.type))
      throw new Error('這個場次已無法上傳影片，請重新載入行事曆');
    eventRevision.value = event.revision;
    emit('event-refreshed', event);
  } catch (cause) {
    if (!disposed && token === reloadToken) reloadError.value = cause.message;
  } finally {
    if (!disposed && token === reloadToken) reloading.value = false;
  }
}
defineExpose({ reloadEvent });
onUnmounted(() => {
  disposed = true;
  reloadToken++;
});
async function submit() {
  if (busy.value || reloading.value || props.disabled || reloadError.value) return;
  errors.value = {};
  notice.value = '';
  let details;
  try {
    details = validateVideoDetails(draft.value);
  } catch (cause) {
    errors.value = { ...cause.fields, message: cause.message };
    return;
  }
  const input = { ...details, eventRevision: eventRevision.value };
  const encoded = JSON.stringify(input);
  if (attempt?.encoded !== encoded) attempt = { encoded, requestId: crypto.randomUUID() };
  busy.value = true;
  try {
    await client.submitVideo(props.event.id, { ...input, requestId: attempt.requestId });
    if (disposed) return;
    draft.value = emptyDraft();
    attempt = null;
    notice.value = '影片連結上傳成功';
  } catch (cause) {
    if (!disposed) errors.value = { ...cause.fields, message: cause.message };
  } finally {
    if (!disposed) busy.value = false;
  }
}
</script>

<template>
  <div class="video-upload-form">
    <form class="video-fields" @submit.prevent="submit" novalidate>
      <v-text-field
        v-model="draft.name"
        label="角色名稱"
        maxlength="64"
        variant="outlined"
        density="compact"
        :disabled="disabled || busy || reloading"
        :error-messages="errors.name"
        aria-required="true"
        hide-details="auto"
      />
      <v-text-field
        v-model="draft.firstUrl"
        label="第一場網址（選填）"
        placeholder="https://"
        maxlength="2048"
        type="url"
        variant="outlined"
        density="compact"
        :disabled="disabled || busy || reloading"
        :error-messages="errors.firstUrl"
        hide-details="auto"
      />
      <v-text-field
        v-model="draft.secondUrl"
        label="第二場網址（選填）"
        placeholder="https://"
        maxlength="2048"
        type="url"
        variant="outlined"
        density="compact"
        :disabled="disabled || busy || reloading"
        :error-messages="errors.secondUrl"
        hide-details="auto"
      />
      <v-select
        v-model="draft.groupName"
        :items="VIDEO_GROUPS"
        label="團別"
        variant="outlined"
        density="compact"
        :disabled="disabled || busy || reloading"
        :error-messages="errors.groupName"
        aria-required="true"
        hide-details="auto"
      />
      <v-textarea
        v-model="draft.note"
        label="備註（選填）"
        maxlength="500"
        rows="2"
        auto-grow
        variant="outlined"
        density="compact"
        :disabled="disabled || busy || reloading"
        :error-messages="errors.note"
        hide-details="auto"
      />
      <v-alert v-if="errors.message || reloadError" type="error" variant="tonal" role="alert">
        {{ reloadError || errors.message }}
        <v-btn
          v-if="reloadError || errors.message.includes('場次')"
          variant="text"
          :disabled="busy || reloading || disabled"
          @click="reloadEvent"
          >重新載入場次</v-btn
        >
      </v-alert>
      <v-alert v-if="notice" type="success" variant="tonal" role="status">{{ notice }}</v-alert>
      <DataLoading v-if="busy || reloading" compact :spinner="!busy">{{ busy ? '正在上傳影片連結，請稍候…' : '正在重新載入場次…' }}</DataLoading>
      <v-btn
        type="submit"
        color="primary"
        :loading="busy"
        :disabled="disabled || busy || reloading || !!reloadError"
        >送出</v-btn
      >
    </form>
  </div>
</template>

<style scoped>
.video-upload-form {
  padding-top: 12px;
}
.video-fields {
  display: grid;
  gap: 16px;
  padding: 20px 0;
}
.video-fields > .v-btn {
  justify-self: start;
}
</style>
