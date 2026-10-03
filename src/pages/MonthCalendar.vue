<script setup>
import { onMounted, ref } from 'vue';
import { createEventClient } from '../api/events.js';
import CalendarGrid from './CalendarGrid.vue';
import EventCreateDialog from './EventCreateDialog.vue';
import './events.css';
import { eventTypeLabel } from '../domain/event-types.js';
const client = createEventClient({ source: import.meta.env.VITE_DATA_SOURCE || 'local' });
const events = ref([]);
const loading = ref(true);
const error = ref('');
const dayDialog = ref(false);
const selectedDay = ref(null);
const createDialog = ref(false);
const initialDate = ref('');
const notice = ref('');
let opener;
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await client.getEvents();
    if (!Array.isArray(data?.events)) throw new Error('資料回應格式不正確，請稍後再試');
    events.value = data.events;
  } catch (failure) {
    error.value = failure.message;
    events.value = [];
  } finally {
    loading.value = false;
  }
}
onMounted(load);
function openDay(day) {
  opener = document.activeElement;
  selectedDay.value = day;
  dayDialog.value = true;
}
function openCreate(date) {
  initialDate.value = date;
  notice.value = '';
  createDialog.value = true;
}
function onCreated(saved) {
  for (const event of saved) {
    const index = events.value.findIndex((value) => value.id === event.id);
    if (index < 0) events.value.push(event);
    else events.value[index] = event;
  }
  const event = saved[0];
  notice.value =
    saved.length > 1
      ? `「${event.title}」已建立 ${saved.length} 筆獨立安排，每個日期各自一筆。`
      : `「${event.title}」已建立，共 ${event.dates.length} 天。`;
}
function restoreFocus() {
  if (opener?.isConnected) opener.focus();
}
</script>
<template>
  <section class="panel calendar-panel" aria-labelledby="events-title">
    <div class="section-header calendar-heading">
      <div>
        <p class="eyebrow">GUILD CALENDAR</p>
        <h2 id="events-title">近期活動</h2>
      </div>
      <span class="subtle-tag">活動行事曆</span>
    </div>
    <CalendarGrid
      :events="events"
      :creatable="!loading && !error"
      @open-day="openDay"
      @create-date="openCreate"
    />
    <div class="event-notices" aria-live="polite">
      <v-alert v-if="notice" type="success" variant="tonal" closable @click:close="notice = ''">{{
        notice
      }}</v-alert>
    </div>
    <div class="calendar-status" aria-live="polite">
      <p v-if="loading" role="status">正在載入安排…</p>
      <template v-else-if="error"
        ><p role="alert">{{ error }}</p>
        <v-btn variant="text" @click="load">重新載入</v-btn></template
      >
      <p v-else-if="!events.length">尚無安排，點選日期格即可建立第一筆安排。</p>
      <p v-else>點選日期格建立安排；點選安排名稱或筆數查看當天詳情。</p>
    </div>
  </section>
  <EventCreateDialog v-model="createDialog" :initial-date="initialDate" @created="onCreated" />
  <v-dialog
    v-model="dayDialog"
    max-width="520"
    aria-labelledby="calendar-day-title"
    @after-leave="restoreFocus"
  >
    <v-card class="calendar-details-card"
      ><h2 id="calendar-day-title">{{ selectedDay?.date.replaceAll('-', '/') }} 的安排</h2>
      <ul class="calendar-details-list">
        <li v-for="event in selectedDay?.events" :key="event.id">
          <span :class="['event-type', event.type]">{{ eventTypeLabel(event.type) }}</span
          ><strong>{{ event.title }}</strong>
        </li>
      </ul>
      <div class="event-dialog-actions">
        <v-btn variant="outlined" @click="dayDialog = false">關閉</v-btn>
      </div></v-card
    >
  </v-dialog>
</template>
