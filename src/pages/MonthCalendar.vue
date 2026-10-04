<script setup>
import { onMounted, onUnmounted, ref, watch, inject, computed } from 'vue';
import { createEventClient } from '../api/events.js';
import { createParticipationClient } from '../api/participation.js';
import CalendarGrid from './CalendarGrid.vue';
import EventCreateDialog from './EventCreateDialog.vue';
import ParticipationDialog from './ParticipationDialog.vue';
import { LINEUP_TYPES } from '../domain/lineups.js';
import './events.css';
import { visibleCalendarEvents, calendarRequiresLogin } from '../domain/calendar-access.js';
import { eventTypeLabel, eventDisplayTitle } from '../domain/event-types.js';
const props = defineProps({ management: { type: Boolean, default: true } });
const calendarAuth = inject('calendarAuth', null);
const openBattleUpload = inject('openBattleUpload', null);
const selectedEvent = ref(null);
function refreshSelectedEvent(event) {
  if (selectedEvent.value?.id !== event.id) return;
  selectedEvent.value = event;
  events.value = events.value.map((item) => (item.id === event.id ? event : item));
}
const participationDialog = ref(false);
const client = createEventClient({ source: import.meta.env.VITE_DATA_SOURCE || 'local' });
const participationClient = createParticipationClient({
  source: import.meta.env.VITE_DATA_SOURCE || 'local',
});
const participationCounts = ref({});
let participationToken = 0;
const events = ref([]);
const visibleEvents = computed(() => visibleCalendarEvents(events.value, calendarAuth?.user.value));
const loading = ref(true);
const error = ref('');
const dayDialog = ref(false);
const selectedDay = ref(null);
const createDialog = ref(false);
const initialDate = ref('');
const notice = ref('');
let opener;
let loadToken = 0;
async function load() {
  const currentToken = ++loadToken;
  loading.value = true;
  error.value = '';
  try {
    const data = await client.getEvents();
    if (currentToken !== loadToken) return;
    if (!Array.isArray(data?.events)) throw new Error('資料回應格式不正確，請稍後再試');
    events.value = data.events;
  } catch (failure) {
    if (currentToken !== loadToken) return;
    error.value = failure.message;
    events.value = [];
  } finally {
    if (currentToken === loadToken) loading.value = false;
  }
}
onMounted(load);
watch(
  [() => calendarAuth?.user.value?.id, () => calendarAuth?.user.value?.role],
  () => {
    loadToken++;
    events.value = [];
    dayDialog.value = false;
    selectedDay.value = null;
    if (selectedEvent.value && calendarRequiresLogin(selectedEvent.value))
      participationDialog.value = false;
    load();
  },
  { flush: 'sync' },
);
function openDay(day) {
  opener = document.activeElement;
  selectedDay.value = day;
  dayDialog.value = true;
  loadParticipationCounts();
}
async function loadParticipationCounts() {
  const currentToken = ++participationToken;
  participationCounts.value = {};
  if (!props.management || !selectedDay.value || !dayDialog.value) return;
  const battles = selectedDay.value.events.filter((event) => LINEUP_TYPES.includes(event.type));
  for (const event of battles) participationCounts.value[event.id] = { loading: true };
  await Promise.allSettled(
    battles.map(async (event) => {
      try {
        const data = await participationClient.getParticipation(event.id);
        if (
          data.eventId !== event.id ||
          !Array.isArray(data.responses) ||
          !Array.isArray(data.registrations) ||
          !Array.isArray(data.registrationLeaves)
        )
          throw new Error('報名資料格式不正確, 請重試');
        if (currentToken !== participationToken) return;
        participationCounts.value[event.id] = {
          registered:
            data.responses.filter((row) => row.status === 'registered').length +
            data.registrations.length,
          leave:
            data.responses.filter((row) => row.status === 'leave').length +
            data.registrationLeaves.length,
        };
      } catch (cause) {
        if (currentToken === participationToken)
          participationCounts.value[event.id] = { error: cause.message };
      }
    }),
  );
}
watch(
  dayDialog,
  (open) => {
    if (!open) participationToken++;
  },
  { flush: 'sync' },
);
onUnmounted(() => {
  participationToken++;
  loadToken++;
});
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
      ? `「${eventDisplayTitle(event)}」已建立 ${saved.length} 筆獨立安排，每個日期各自一筆。`
      : `「${eventDisplayTitle(event)}」已建立，共 ${event.dates.length} 天。`;
}
function restoreFocus() {
  if (!participationDialog.value && opener?.isConnected) opener.focus();
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
      :events="visibleEvents"
      :creatable="management && !loading && !error"
      :browsable="!management && !loading && !error"
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
      <p v-else-if="!visibleEvents.length">
        {{ management ? '尚無安排，點選日期格即可建立第一筆安排。' : '目前尚無活動安排。' }}
      </p>
      <p v-else>
        {{
          management
            ? '點選日期格建立安排；點選安排名稱或筆數查看當天詳情。'
            : '點選有安排的日期查看場次；約戰、幫戰與龍虎戰可報名／請假。'
        }}
      </p>
    </div>
  </section>
  <EventCreateDialog
    v-if="management"
    v-model="createDialog"
    :initial-date="initialDate"
    @created="onCreated"
  />
  <ParticipationDialog
    v-if="selectedEvent"
    :key="selectedEvent.id"
    v-model="participationDialog"
    :event="selectedEvent"
    @closed="restoreFocus"
    @event-refreshed="refreshSelectedEvent"
  />
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
          <span :class="['event-type', event.type]">{{ eventTypeLabel(event.type) }}</span>
          <div class="calendar-detail-content">
            <strong>{{ eventDisplayTitle(event) }}</strong>
            <div
              v-if="management && LINEUP_TYPES.includes(event.type)"
              class="calendar-participation-summary"
              aria-live="polite"
            >
              <span v-if="participationCounts[event.id]?.loading">正在載入報名／請假人數…</span>
              <template v-else-if="participationCounts[event.id]?.error">
                <p role="alert">{{ participationCounts[event.id].error }}</p>
                <v-btn
                  variant="text"
                  size="small"
                  :aria-label="`重新載入 ${eventDisplayTitle(event)} 的報名／請假人數`"
                  @click="loadParticipationCounts"
                  >重試</v-btn
                >
              </template>
              <span v-else-if="participationCounts[event.id]"
                >報名 {{ participationCounts[event.id].registered }} 人／請假
                {{ participationCounts[event.id].leave }} 人</span
              >
            </div>
          </div>
          <v-btn
            v-if="management && openBattleUpload && LINEUP_TYPES.includes(event.type)"
            variant="tonal"
            color="primary"
            :aria-label="`${eventDisplayTitle(event)} ${selectedDay.date} 上傳戰績`"
            @click="
              dayDialog = false;
              openBattleUpload(event.id);
            "
            >上傳戰績</v-btn
          >
          <v-btn
            v-if="!management && LINEUP_TYPES.includes(event.type)"
            variant="tonal"
            color="primary"
            :aria-label="`${eventDisplayTitle(event)} ${selectedDay.date} 報名／請假／影片`"
            @click="
              selectedEvent = event;
              dayDialog = false;
              participationDialog = true;
            "
            >報名／請假／影片</v-btn
          >
        </li>
      </ul>
      <div class="event-dialog-actions">
        <v-btn variant="outlined" @click="dayDialog = false">關閉</v-btn>
      </div></v-card
    >
  </v-dialog>
</template>
