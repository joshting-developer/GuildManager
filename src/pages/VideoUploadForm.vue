<script setup>
import DataLoading from '../components/DataLoading.vue';
import { computed, onUnmounted, ref, watch } from 'vue';
import { createEventVideoClient } from '../api/event-videos.js';
import { createEventClient } from '../api/events.js';
import { VIDEO_GROUP_OPTIONS, validateVideoDetails } from '../domain/event-videos.js';
import NameSourcePicker from './NameSourcePicker.vue';

const props = defineProps({
  event: { type: Object, required: true }, disabled: Boolean,
  members: { type: Array, default: () => [] },
  professions: { type: Array, default: () => [] },
});
const emit = defineEmits(['busy', 'dirty', 'event-refreshed']);
const source = import.meta.env.VITE_DATA_SOURCE || 'local';
const client = createEventVideoClient({ source });
const eventClient = createEventClient({ source });
const emptyDraft = () => ({ name: '', professionId: null, firstUrl: '', secondUrl: '', groupName: null, note: '' });
const draft = ref(emptyDraft());
const nameSource = ref('manual');
const selectedMemberUid = ref(null);
const selectedMember = computed(() => props.members.find(member => member.uid === selectedMemberUid.value));
const errors = ref({}),
  notice = ref('');
const eventRevision = ref(props.event.revision);
const busy = ref(false),
  reloading = ref(false),
  reloadError = ref('');
let attempt = null;
let disposed = false,
  reloadToken = 0;
watch(() => props.event, (event) => {
  eventRevision.value = event.revision;
  reloadError.value = '';
});
watch(nameSource, () => {
  selectedMemberUid.value = null;
  draft.value.name = '';
  draft.value.professionId = null;
  errors.value = {};
  notice.value = '';
  attempt = null;
});
watch(selectedMemberUid, () => {
  draft.value.name = selectedMember.value?.name || '';
  draft.value.professionId = selectedMember.value?.primaryProfessionId || null;
  if (selectedMember.value) errors.value = {};
});
watch(() => props.members, () => {
  if (!selectedMemberUid.value) return;
  const member = selectedMember.value;
  if (!member || member.name !== draft.value.name ||
    !(nameSource.value === 'guild' ? member.isInGuild : member.isInClub)) {
    selectedMemberUid.value = null;
    errors.value = { name: '成員資料已更新，請重新選擇', message: '成員資料已更新，請重新選擇' };
  }
});
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
    const data = await eventClient.getEvent(props.event.id);
    if (disposed || token !== reloadToken) return;
    const event = data.event;
    if (!event || event.id !== props.event.id || !['scrimmage', 'guild_war', 'dragon_tiger'].includes(event.type))
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
    if (nameSource.value !== 'manual' && !selectedMember.value) {
      errors.value = { name: '請選擇成員', message: '請選擇成員' };
      return;
    }
    details = validateVideoDetails(draft.value);
  } catch (cause) {
    errors.value = { ...cause.fields, message: cause.message };
    return;
  }
  const input = {
    ...details, eventRevision: eventRevision.value,
    ...(nameSource.value !== 'manual' ? { memberUid: selectedMemberUid.value } : {}),
  };
  const encoded = JSON.stringify(input);
  if (attempt?.encoded !== encoded) attempt = { encoded, requestId: crypto.randomUUID() };
  busy.value = true;
  try {
    await client.submitVideo(props.event.id, { ...input, requestId: attempt.requestId });
    if (disposed) return;
    draft.value = emptyDraft();
    selectedMemberUid.value = null;
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
      <NameSourcePicker v-model:source="nameSource" v-model:name="draft.name"
        v-model:member-uid="selectedMemberUid" :members="members" :professions="professions"
        :disabled="disabled || busy || reloading" :error-messages="errors.name"
        id-prefix="video-name" />
      <v-select v-model="draft.professionId" :items="professions" item-title="name" item-value="job_id"
        label="職業" variant="outlined" density="compact" :disabled="disabled || busy || reloading"
        :error-messages="errors.professionId" aria-required="true" hide-details="auto" />
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
        :items="VIDEO_GROUP_OPTIONS"
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
          v-if="reloadError || errors.message?.includes('場次') || errors.message?.includes('成員')"
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
  min-width: 0;
}
.video-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  padding: 20px 0;
}
.video-fields > .v-btn {
  justify-self: start;
}
</style>
