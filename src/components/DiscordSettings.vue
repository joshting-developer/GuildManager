<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { createAdminClient } from '../api/admin.js';
import DataLoading from './DataLoading.vue';
const client = createAdminClient();
const channels = ref([]), drafts = ref({ leave: '', member: '' });
const loading = ref(true), busy = ref(false), error = ref(''), notice = ref('');
const dirty = computed(() => Object.values(drafts.value).some(Boolean));
const labels = { leave: '請假通知', member: '名冊通知' };
let disposed = false;
onUnmounted(() => { disposed = true; });
async function load() {
  if (busy.value || (dirty.value && !window.confirm('有尚未儲存的設定，確定要重新載入嗎？'))) return;
  loading.value = true;
  error.value = '';
  try {
    const data = await client.getDiscordSettings();
    if (!disposed) { channels.value = data.channels; drafts.value = { leave: '', member: '' }; }
  } catch (cause) { if (!disposed) error.value = cause.message; }
  finally { if (!disposed) loading.value = false; }
}
async function act(row, action) {
  if (busy.value) return;
  if (action === 'remove' && !window.confirm(`確定停用${labels[row.channel]}？`)) return;
  busy.value = true;
  error.value = notice.value = '';
  try {
    if (action === 'test') {
      await client.testDiscord(row.channel);
      if (!disposed) notice.value = '測試訊息已送出';
    } else {
      const data = await client.saveDiscordSettings({ channel: row.channel, revision: row.revision,
        url: action === 'remove' ? '' : drafts.value[row.channel] });
      if (!disposed) {
        channels.value = data.channels;
        drafts.value[row.channel] = '';
        notice.value = action === 'remove' ? '已停用通知' : '已儲存通知設定';
      }
    }
  } catch (cause) { if (!disposed) error.value = cause.message; }
  finally { if (!disposed) busy.value = false; }
}
onMounted(load);
defineExpose({ dirty, busy });
</script>

<template>
  <div>
    <h2 class="admin-section-title">Discord 通知</h2>
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" role="alert">{{ error }}</v-alert>
    <v-alert v-if="notice" type="success" variant="tonal" class="mb-4" role="status">{{ notice }}</v-alert>
    <DataLoading v-if="loading">正在載入通知設定…</DataLoading>
    <template v-else>
      <form v-for="row in channels" :key="row.channel" class="discord-form" @submit.prevent="act(row, 'save')">
        <h3>{{ labels[row.channel] }}</h3>
        <p>{{ row.configured ? '已設定' : '未啟用' }}</p>
        <v-text-field v-model="drafts[row.channel]" :label="`${labels[row.channel]} Webhook 網址`"
          type="password" autocomplete="off" :disabled="busy" hide-details
          placeholder="https://discord.com/api/webhooks/…" />
        <div class="discord-actions">
          <v-btn elevation="0" type="submit" :disabled="busy || !drafts[row.channel].trim()">儲存</v-btn>
          <v-btn elevation="0" variant="outlined" :disabled="busy || !row.configured || dirty" @click="act(row, 'test')">測試發送</v-btn>
          <v-btn elevation="0" variant="text" :disabled="busy || !row.configured" @click="act(row, 'remove')">移除</v-btn>
        </div>
      </form>
      <v-btn elevation="0" variant="text" :disabled="busy" @click="load">重新載入</v-btn>
    </template>
  </div>
</template>

<style scoped>
.discord-form { display: grid; gap: 16px; max-width: 620px; margin: 24px 0 32px; }
.discord-form h3, .discord-form p { margin: 0; }
.discord-actions { display: flex; flex-wrap: wrap; gap: 12px; }
</style>
