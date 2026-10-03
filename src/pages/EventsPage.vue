<script setup>
import { computed, onMounted, ref } from 'vue';
import { mdiCalendarMonthOutline, mdiPlus, mdiRefresh } from '@mdi/js';
import { createEventClient } from '../api/events.js';
import EventCreateDialog from './EventCreateDialog.vue';
import './events.css';
const client = createEventClient({ source: import.meta.env.VITE_DATA_SOURCE || 'local' });
const events = ref([]);
const loading = ref(true);
const loadError = ref('');
const notice = ref('');
const typeOptions = [
  { title: '活動', value: 'activity' },
  { title: '約戰', value: 'scrimmage' },
];
const filter = ref(null);
const page = ref(1);
const filtered = computed(() =>
  events.value
    .filter((event) => !filter.value || event.type === filter.value)
    .sort((a, b) => a.dates[0].localeCompare(b.dates[0]) || a.createdAt.localeCompare(b.createdAt)),
);
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / 20)));
const visible = computed(() => filtered.value.slice((page.value - 1) * 20, page.value * 20));
async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    const data = await client.getEvents();
    if (!Array.isArray(data?.events)) throw new Error('資料回應格式不正確，請稍後再試');
    events.value = data.events;
    page.value = 1;
  } catch (error) {
    loadError.value = error.message;
  } finally {
    loading.value = false;
  }
}
const dialog = ref(false);
function openForm() {
  notice.value = '';
  dialog.value = true;
}
function onCreated(event) {
  const index = events.value.findIndex((value) => value.id === event.id);
  if (index < 0) events.value.push(event);
  else events.value[index] = event;
  filter.value = null;
  page.value = Math.floor(filtered.value.findIndex((value) => value.id === event.id) / 20) + 1;
  notice.value = `「${event.title}」已建立，共 ${event.dates.length} 天，首頁行事曆已可查看。`;
}
onMounted(load);
function formatDate(date) {
  return date.replaceAll('-', '/');
}
</script>
<template>
  <section class="page-heading" aria-labelledby="schedule-title">
    <div>
      <p class="eyebrow">GUILD SCHEDULE <span class="eyebrow-divider">/</span> 活動管理</p>
      <h1 id="schedule-title">活動安排<span class="heading-dot">.</span></h1>
      <p class="page-subtitle">安排活動與約戰，讓每一天的集結更清楚。</p>
    </div>
    <v-btn
      color="primary"
      :prepend-icon="mdiPlus"
      :disabled="loading || !!loadError"
      @click="openForm"
      >建立安排</v-btn
    >
  </section>
  <div class="event-notices" aria-live="polite">
    <v-alert v-if="notice" type="success" variant="tonal" closable @click:close="notice = ''">{{
      notice
    }}</v-alert>
  </div>
  <section class="panel event-panel" aria-label="活動與約戰清單">
    <div class="section-header">
      <div class="event-list-heading">
        <span class="icon-box violet"><v-icon :icon="mdiCalendarMonthOutline" size="22" /></span>
        <div>
          <h2>安排清單</h2>
          <p v-if="!loading && !loadError" class="event-muted">共 {{ events.length }} 筆安排</p>
        </div>
      </div>
      <v-btn variant="outlined" :prepend-icon="mdiRefresh" :disabled="loading" @click="load"
        >重新載入</v-btn
      >
    </div>
    <div v-if="loading" class="empty-state" role="status">
      <v-skeleton-loader type="table-row, table-row" />
      <p>正在載入安排…</p>
    </div>
    <div v-else-if="loadError" class="empty-state" role="alert">
      <h3>無法載入安排</h3>
      <p>{{ loadError }}</p>
      <v-btn variant="outlined" @click="load">重試</v-btn>
    </div>
    <template v-else>
      <div v-if="events.length" class="event-filters">
        <v-select
          v-model="filter"
          :items="typeOptions"
          label="篩選安排類型"
          variant="outlined"
          density="compact"
          hide-details
          clearable
          @update:model-value="page = 1"
        /><v-btn
          variant="text"
          :disabled="!filter"
          @click="
            filter = null;
            page = 1;
          "
          >清除篩選</v-btn
        >
      </div>
      <div v-if="!events.length" class="empty-state">
        <span class="empty-icon"><v-icon :icon="mdiCalendarMonthOutline" size="28" /></span>
        <h3>尚無活動或約戰</h3>
        <p>點選「建立安排」，選擇類型與日期。</p>
      </div>
      <div v-else-if="!filtered.length" class="empty-state">
        <h3>沒有符合條件的安排</h3>
        <v-btn
          variant="text"
          @click="
            filter = null;
            page = 1;
          "
          >清除篩選</v-btn
        >
      </div>
      <template v-else>
        <p class="event-result" aria-live="polite">顯示 {{ filtered.length }} 筆安排</p>
        <div class="event-table-scroll" tabindex="0" aria-label="安排表格，可左右捲動">
          <table class="event-table">
            <thead>
              <tr>
                <th scope="col">名稱</th>
                <th scope="col">類型</th>
                <th scope="col">安排日期</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="event in visible" :key="event.id">
                <td class="event-name">{{ event.title }}</td>
                <td>
                  <span :class="['event-type', event.type]">{{
                    event.type === 'scrimmage' ? '約戰' : '活動'
                  }}</span>
                </td>
                <td>
                  <details v-if="event.dates.length > 3" class="event-date-details">
                    <summary>
                      {{ formatDate(event.dates[0]) }} 等 {{ event.dates.length }} 天
                    </summary>
                    <div class="event-date-list">
                      <time v-for="date in event.dates" :key="date" :datetime="date">{{
                        formatDate(date)
                      }}</time>
                    </div>
                  </details>
                  <div v-else class="event-date-list">
                    <time v-for="date in event.dates" :key="date" :datetime="date">{{
                      formatDate(date)
                    }}</time>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <v-pagination
          v-if="pageCount > 1"
          v-model="page"
          :length="pageCount"
          :total-visible="5"
          aria-label="安排清單分頁"
        />
      </template>
    </template>
  </section>
  <EventCreateDialog v-model="dialog" @created="onCreated" />
</template>
