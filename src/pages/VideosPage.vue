<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { mdiRefresh, mdiDownload } from '@mdi/js';
import { createEventClient } from '../api/events.js';
import { createEventVideoClient } from '../api/event-videos.js';
import { eventDisplayTitle, eventTypeLabel } from '../domain/event-types.js';
import { VIDEO_GROUPS } from '../domain/event-videos.js';
import { VIDEO_TABLE_HEADERS, videoTableRow, videoTableCsv } from '../domain/video-table-csv.js';
const source = import.meta.env.VITE_DATA_SOURCE || 'local';
const eventClient = createEventClient({ source });
const videoClient = createEventVideoClient({ source });
const events = ref([]),
  eventId = ref(null),
  videos = ref([]);
const group = ref(null),
  search = ref('');
const loading = ref(false),
  error = ref(''),
  exportError = ref('');
const downloads = new Map();
function exportCsv() {
  if (loading.value || error.value || !visibleVideos.value.length) return;
  exportError.value = '';
  let url, link;
  try {
    const event = events.value.find((item) => item.id === eventId.value);
    const title = eventDisplayTitle(event)
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .slice(0, 64);
    url = URL.createObjectURL(
      new Blob([videoTableCsv(visibleVideos.value)], { type: 'text/csv;charset=utf-8' }),
    );
    link = document.createElement('a');
    link.href = url;
    link.download = `${event.dates[0]}_${title}_影片.csv`;
    document.body.append(link);
    link.click();
    downloads.set(
      url,
      setTimeout(() => {
        URL.revokeObjectURL(url);
        downloads.delete(url);
      }, 1000),
    );
  } catch {
    if (url) URL.revokeObjectURL(url);
    exportError.value = '無法匯出 CSV，請重試';
  } finally {
    link?.remove();
  }
}
let disposed = false,
  token = 0;
const options = computed(() =>
  events.value.map((event) => ({
    value: event.id,
    title: `${event.dates[0]} · ${eventTypeLabel(event.type)}${event.title ? ` · ${eventDisplayTitle(event)}` : ''}`,
  })),
);
const visibleVideos = computed(() =>
  videos.value.filter(
    (video) =>
      (!group.value || video.groupName === group.value) &&
      video.name.toLocaleLowerCase().includes((search.value || '').trim().toLocaleLowerCase()),
  ),
);
async function loadVideos() {
  const current = ++token;
  videos.value = [];
  error.value = '';
  exportError.value = '';
  if (!eventId.value) {
    loading.value = false;
    return;
  }
  const id = eventId.value;
  loading.value = true;
  try {
    const result = await videoClient.getVideos(id);
    if (!disposed && current === token) videos.value = result.videos;
  } catch (cause) {
    if (!disposed && current === token) error.value = cause.message;
  } finally {
    if (!disposed && current === token) loading.value = false;
  }
}
async function load() {
  const current = ++token;
  loading.value = true;
  error.value = '';
  videos.value = [];
  try {
    const data = await eventClient.getEvents();
    if (disposed || current !== token) return;
    if (!Array.isArray(data.events)) throw new Error('場次資料格式不正確，請重試');
    events.value = data.events
      .filter((event) => ['scrimmage', 'guild_war', 'dragon_tiger'].includes(event.type))
      .sort((a, b) => b.dates[0].localeCompare(a.dates[0]) || a.id.localeCompare(b.id));
    if (!events.value.some((event) => event.id === eventId.value)) {
      eventId.value = events.value[0]?.id || null;
      if (eventId.value) return; // The selection watcher loads this event.
    }
    await loadVideos();
  } catch (cause) {
    if (!disposed && current === token) error.value = cause.message;
  } finally {
    if (!disposed && current === token) loading.value = false;
  }
}
watch(eventId, () => {
  group.value = null;
  search.value = '';
  loadVideos();
});
onMounted(load);
onUnmounted(() => {
  disposed = true;
  token++;
  for (const [url, timer] of downloads) {
    clearTimeout(timer);
    URL.revokeObjectURL(url);
  }
  downloads.clear();
});
</script>

<template>
  <section class="page-heading" aria-labelledby="videos-title">
    <div>
      <p class="eyebrow">GUILD MANAGER <span class="eyebrow-divider">/</span> 戰鬥影片</p>
      <h1 id="videos-title">影片閱覽<span class="heading-dot">.</span></h1>
    </div>
    <v-btn variant="outlined" :prepend-icon="mdiRefresh" :disabled="loading" @click="load"
      >重新載入</v-btn
    >
  </section>
  <v-card class="videos-card">
    <v-select
      v-model="eventId"
      :items="options"
      label="戰鬥場次"
      variant="outlined"
      density="compact"
      :disabled="loading"
      hide-details
      no-data-text="尚無戰鬥場次"
    />
  </v-card>
  <v-card class="videos-card" :aria-busy="loading">
    <div class="section-header">
      <h2>場次影片</h2>
      <div class="video-table-actions">
        <span v-if="!loading && !error" class="videos-muted">{{ visibleVideos.length }} 筆</span>
        <v-btn
          variant="outlined"
          :prepend-icon="mdiDownload"
          :disabled="loading || !!error || !visibleVideos.length"
          @click="exportCsv"
          >匯出 CSV</v-btn
        >
      </div>
    </div>
    <div class="video-filters">
      <v-text-field
        v-model="search"
        label="搜尋角色名稱"
        variant="outlined"
        density="compact"
        hide-details
        clearable
        @click:clear="search = ''"
      />
      <v-select
        v-model="group"
        :items="[
          { title: '所有團別', value: null },
          ...VIDEO_GROUPS.map((value) => ({ title: value, value })),
        ]"
        label="團別篩選"
        variant="outlined"
        density="compact"
        hide-details
      />
    </div>
    <v-alert v-if="exportError" type="error" variant="tonal" role="alert" class="mb-4">{{
      exportError
    }}</v-alert>
    <p v-if="loading" role="status" class="videos-state">正在載入影片…</p>
    <v-alert v-else-if="error" type="error" variant="tonal" role="alert"
      >{{ error }} <v-btn variant="text" @click="load">重試</v-btn></v-alert
    >
    <p v-else-if="!eventId" class="videos-state">尚無戰鬥場次，請先建立活動安排</p>
    <p v-else-if="!videos.length" class="videos-state">本場尚無影片</p>
    <p v-else-if="!visibleVideos.length" class="videos-state">沒有符合篩選條件的影片</p>
    <div
      v-else
      class="videos-table-scroll"
      tabindex="0"
      role="region"
      aria-label="場次影片表格，可左右捲動"
    >
      <table class="videos-table">
        <caption class="sr-only">
          本場影片提交紀錄，網址以文字呈現，可選取複製
        </caption>
        <thead>
          <tr>
            <th v-for="header in VIDEO_TABLE_HEADERS" :key="header" scope="col">{{ header }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="video in visibleVideos" :key="video.id">
            <td
              v-for="(value, index) in videoTableRow(video)"
              :key="index"
              :class="{ 'video-url': index === 1 || index === 2, 'video-note': index === 4 }"
            >
              {{ value }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </v-card>
</template>

<style scoped>
.videos-card {
  padding: 24px;
  margin-bottom: 24px;
}
.videos-muted,
.videos-state {
  color: var(--color-text-muted);
}
.videos-state {
  padding: 24px 0;
}
.video-table-actions {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
}
.video-filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 240px;
  gap: 16px;
  margin: 20px 0;
}
.videos-table-scroll {
  max-width: 100%;
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: 16px;
}
.videos-table {
  width: 100%;
  min-width: 760px;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 14px;
}
.videos-table th,
.videos-table td {
  padding: 14px 16px;
  text-align: left;
  vertical-align: top;
  overflow-wrap: anywhere;
}
.videos-table th {
  background: #f8fafc;
  color: var(--color-text-muted);
  font-weight: 600;
}
.videos-table td {
  border-top: 1px solid var(--color-border);
}
.videos-table th:first-child {
  width: 16%;
}
.videos-table th:nth-child(2),
.videos-table th:nth-child(3) {
  width: 24%;
}
.videos-table th:nth-child(4) {
  width: 12%;
}
.video-note {
  white-space: pre-wrap;
}
.video-url {
  user-select: text;
}
@media (max-width: 600px) {
  .videos-card {
    padding: 16px;
  }
  .video-filters {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
