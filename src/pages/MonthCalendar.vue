<script setup>
import { onMounted, ref } from 'vue';
import { createEventClient } from '../api/events.js';
import CalendarGrid from './CalendarGrid.vue';
import './events.css';
const client = createEventClient({ source: import.meta.env.VITE_DATA_SOURCE || 'local' });
const events = ref([]);
const loading = ref(true);
const error = ref('');
const dayDialog = ref(false);
const selectedDay = ref(null);
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
      <span class="subtle-tag">活動／約戰行事曆</span>
    </div>
    <CalendarGrid :events="events" @open-day="openDay" />
    <div class="calendar-status" aria-live="polite">
      <p v-if="loading" role="status">正在載入活動與約戰…</p>
      <template v-else-if="error"
        ><p role="alert">{{ error }}</p>
        <v-btn variant="text" @click="load">重新載入</v-btn></template
      >
      <p v-else-if="!events.length">尚無活動或約戰，可從「活動安排」建立第一筆安排。</p>
      <p v-else>點選有安排的日期查看詳情，活動的每個日期都會顯示在月曆中。</p>
    </div>
  </section>
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
          <span :class="['event-type', event.type]">{{
            event.type === 'scrimmage' ? '約戰' : '活動'
          }}</span
          ><strong>{{ event.title }}</strong>
        </li>
      </ul>
      <div class="event-dialog-actions">
        <v-btn variant="outlined" @click="dayDialog = false">關閉</v-btn>
      </div></v-card
    >
  </v-dialog>
</template>
