<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { createEventVideoClient } from '../api/event-videos.js';
import { createEventClient } from '../api/events.js';
import { VIDEO_GROUPS, validateVideoDetails } from '../domain/event-videos.js';

const props = defineProps({ event: { type: Object, required: true }, disabled: Boolean });
const emit = defineEmits(['busy', 'dirty', 'event-refreshed']);
const source = import.meta.env.VITE_DATA_SOURCE || 'local';
const client = createEventVideoClient({ source });
const eventClient = createEventClient({ source });
const round = ref(1);
const emptyDraft = () => ({ name: '', url: '', groupName: null });
const drafts = ref([emptyDraft(), emptyDraft()]);
const draft = computed(() => drafts.value[round.value - 1]);
const errors = ref([{}, {}]),
  notices = ref(['', '']);
const eventRevision = ref(props.event.revision);
const busy = ref(false),
  reloading = ref(false),
  reloadError = ref('');
const attempts = [null, null];
let disposed = false,
  reloadToken = 0;
watch(busy, (value) => emit('busy', value), { flush: 'sync' });
watch(
  () => JSON.stringify(drafts.value),
  () => {
    emit(
      'dirty',
      drafts.value.some((item) => item.name || item.url || item.groupName),
    );
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
  const index = round.value - 1;
  errors.value[index] = {};
  notices.value[index] = '';
  let details;
  try {
    details = validateVideoDetails({ ...drafts.value[index], roundNumber: round.value });
  } catch (cause) {
    errors.value[index] = { ...cause.fields, message: cause.message };
    return;
  }
  const input = { ...details, eventRevision: eventRevision.value };
  const encoded = JSON.stringify(input);
  if (attempts[index]?.encoded !== encoded)
    attempts[index] = { encoded, requestId: crypto.randomUUID() };
  busy.value = true;
  try {
    await client.submitVideo(props.event.id, { ...input, requestId: attempts[index].requestId });
    if (disposed) return;
    drafts.value[index] = emptyDraft();
    attempts[index] = null;
    notices.value[index] = '影片連結上傳成功';
  } catch (cause) {
    if (!disposed) errors.value[index] = { ...cause.fields, message: cause.message };
  } finally {
    if (!disposed) busy.value = false;
  }
}
</script>

<template>
  <div class="video-upload-form">
    <v-tabs v-model="round" color="primary" aria-label="影片上傳場序">
      <v-tab
        v-for="number in [1, 2]"
        :key="number"
        :value="number"
        :id="`video-round-${number}-tab`"
        :aria-controls="`video-round-${number}-panel`"
        :disabled="busy || reloading"
        >{{ number === 1 ? '第一場' : '第二場' }}</v-tab
      >
    </v-tabs>
    <form
      :id="`video-round-${round}-panel`"
      role="tabpanel"
      :aria-labelledby="`video-round-${round}-tab`"
      class="video-fields"
      @submit.prevent="submit"
      novalidate
    >
      <v-text-field
        v-model="draft.name"
        label="名稱"
        maxlength="64"
        variant="outlined"
        density="compact"
        :disabled="disabled || busy || reloading"
        :error-messages="errors[round - 1].name"
        aria-required="true"
        hide-details="auto"
      />
      <v-text-field
        v-model="draft.url"
        label="影片網址"
        placeholder="https://"
        maxlength="2048"
        type="url"
        variant="outlined"
        density="compact"
        :disabled="disabled || busy || reloading"
        :error-messages="errors[round - 1].url"
        aria-required="true"
        hide-details="auto"
      />
      <v-select
        v-model="draft.groupName"
        :items="VIDEO_GROUPS"
        label="團別"
        variant="outlined"
        density="compact"
        :disabled="disabled || busy || reloading"
        :error-messages="errors[round - 1].groupName"
        aria-required="true"
        hide-details="auto"
      />
      <v-alert
        v-if="errors[round - 1].message || reloadError"
        type="error"
        variant="tonal"
        role="alert"
      >
        {{ reloadError || errors[round - 1].message }}
        <v-btn
          v-if="reloadError || errors[round - 1].message.includes('場次')"
          variant="text"
          :disabled="busy || reloading || disabled"
          @click="reloadEvent"
          >重新載入場次</v-btn
        >
      </v-alert>
      <v-alert v-if="notices[round - 1]" type="success" variant="tonal" role="status">{{
        notices[round - 1]
      }}</v-alert>
      <v-btn
        type="submit"
        color="primary"
        :loading="busy"
        :disabled="disabled || busy || reloading || !!reloadError"
        >上傳影片連結</v-btn
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
