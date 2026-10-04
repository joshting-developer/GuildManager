<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { mdiRefresh, mdiOpenInNew } from '@mdi/js';
import { createEventClient } from '../api/events.js';
import { createEventVideoClient } from '../api/event-videos.js';
import { eventDisplayTitle, eventTypeLabel } from '../domain/event-types.js';
import { VIDEO_GROUPS } from '../domain/event-videos.js';
const source = import.meta.env.VITE_DATA_SOURCE || 'local';
const eventClient = createEventClient({ source });
const videoClient = createEventVideoClient({ source });
const events = ref([]),
  eventId = ref(null),
  videos = ref([]);
const round = ref(1),
  group = ref(null);
const loading = ref(false),
  error = ref('');
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
      video.roundNumber === round.value && (!group.value || video.groupName === group.value),
  ),
);
async function loadVideos() {
  const current = ++token;
  videos.value = [];
  error.value = '';
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
  round.value = 1;
  group.value = null;
  loadVideos();
});
onMounted(load);
onUnmounted(() => {
  disposed = true;
  token++;
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
      <span v-if="!loading && !error" class="videos-muted">{{ visibleVideos.length }} 部</span>
    </div>
    <v-tabs v-model="round" color="primary" aria-label="影片閱覽場序">
      <v-tab
        v-for="number in [1, 2]"
        :key="number"
        :value="number"
        :id="`videos-round-${number}-tab`"
        :aria-controls="`videos-round-${number}-panel`"
        >{{ number === 1 ? '第一場' : '第二場' }}</v-tab
      >
    </v-tabs>
    <div
      :id="`videos-round-${round}-panel`"
      role="tabpanel"
      :aria-labelledby="`videos-round-${round}-tab`"
    >
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
        class="video-group-filter"
      />
      <p v-if="loading" role="status" class="videos-state">正在載入影片…</p>
      <v-alert v-else-if="error" type="error" variant="tonal" role="alert"
        >{{ error }} <v-btn variant="text" @click="load">重試</v-btn></v-alert
      >
      <p v-else-if="!eventId" class="videos-state">尚無戰鬥場次，請先建立活動安排</p>
      <p v-else-if="!visibleVideos.length" class="videos-state">
        {{ group ? '這個團別尚無影片' : '本場尚無影片' }}
      </p>
      <ul v-else class="videos-list" aria-label="已上傳的影片連結">
        <li v-for="video in visibleVideos" :key="video.id">
          <div class="video-info">
            <strong>{{ video.name }}</strong
            ><v-chip size="small" variant="tonal" color="primary">{{ video.groupName }}</v-chip>
            <a :href="video.url" target="_blank" rel="noopener noreferrer" class="video-url">{{
              video.url
            }}</a>
          </div>
          <v-btn
            :href="video.url"
            target="_blank"
            rel="noopener noreferrer"
            variant="outlined"
            color="primary"
            :append-icon="mdiOpenInNew"
            :aria-label="`開啟 ${video.name} 的影片`"
            >開啟影片</v-btn
          >
        </li>
      </ul>
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
.video-group-filter {
  max-width: 240px;
  margin: 20px 0;
}
.videos-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 12px;
}
.videos-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: 16px;
}
.video-info {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.video-info strong {
  overflow-wrap: anywhere;
}
.video-url {
  flex-basis: 100%;
  color: var(--color-text-muted);
  overflow-wrap: anywhere;
  font-size: 13px;
}
@media (max-width: 600px) {
  .videos-card {
    padding: 16px;
  }
  .videos-list li {
    align-items: flex-start;
    flex-direction: column;
  }
  .video-info {
    width: 100%;
  }
}
</style>
