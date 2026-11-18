<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import DataLoading from './DataLoading.vue';
import { createAttendanceClient } from '../api/attendance.js';
const emit = defineEmits(['saved']);
const client = createAttendanceClient();
const settings = ref(null), threshold = ref(3), message = ref(''), loading = ref(false), busy = ref(false), error = ref(''), notice = ref('');
const dirty = computed(() => settings.value && (threshold.value !== settings.value.threshold || message.value !== settings.value.message));
let disposed = false;

async function load() {
  if (busy.value || (dirty.value && !window.confirm('放棄尚未儲存的請假設定？'))) return;
  loading.value = true; error.value = '';
  try { const data = await client.getSettings(); if (!disposed) apply(data); }
  catch (cause) { if (!disposed) error.value = cause.message; }
  finally { if (!disposed) loading.value = false; }
}
function apply(data) { if (!Number.isSafeInteger(data?.settings?.threshold) || !Number.isSafeInteger(data.settings.revision) || typeof data.settings.message !== 'string') throw new Error('設定資料格式不正確'); settings.value = data.settings; threshold.value = data.settings.threshold; message.value = data.settings.message; }
async function save() {
  if (busy.value) return;
  busy.value = true; error.value = ''; notice.value = '';
  try { const data = await client.saveSettings({threshold:threshold.value,message:message.value,revision:settings.value.revision}); if (!disposed) { apply(data); notice.value = '已儲存請假設定'; emit('saved'); } }
  catch (cause) { if (!disposed) error.value = cause.message; }
  finally { if (!disposed) busy.value = false; }
}
function canClose() { return !busy.value && (!dirty.value || window.confirm('有尚未儲存的請假設定, 確定要關閉嗎？')); }
defineExpose({canClose,busy});
onMounted(load);
onUnmounted(() => { disposed = true; });
</script>
<template>
  <section aria-labelledby="leave-settings-title" class="leave-settings">
    <h2 id="leave-settings-title" class="admin-section-title">請假關心提醒</h2>
    <DataLoading v-if="loading">正在載入請假設定…</DataLoading>
    <v-alert v-if="error" type="error" variant="tonal" role="alert" class="my-4">{{ error }}<v-btn variant="text" :disabled="busy || loading" @click="load">重新載入</v-btn></v-alert>
    <form v-if="settings && !loading" @submit.prevent="save" class="leave-settings-form">
      <v-text-field v-model.number="threshold" type="number" min="0" max="100" label="每月請假門檻（次）" hint="0 表示關閉提醒；按活動日期所在月份, 同場有效請假只算一次" persistent-hint variant="outlined" :disabled="busy" />
      <v-textarea v-model="message" label="關心訊息" maxlength="300" counter="300" rows="3" auto-grow variant="outlined" :disabled="busy" />
      <v-alert v-if="notice" type="success" variant="tonal" role="status">{{ notice }}</v-alert>
      <v-btn type="submit" color="primary" :loading="busy" :disabled="busy || !dirty">儲存請假設定</v-btn>
    </form>
  </section>
</template>
<style scoped>
.leave-settings h2 { font-size:1.25rem; margin:0; }
.leave-settings-form { display: grid; gap: 20px; max-width: 620px; margin-top: 24px; }
.leave-settings-form > .v-btn { justify-self: start; }
</style>
