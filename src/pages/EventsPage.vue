<script setup>
import { computed, onMounted, ref } from 'vue';
import {
  mdiCalendarMonthOutline,
  mdiPlus,
  mdiRefresh,
  mdiPencilOutline,
  mdiTrashCanOutline,
  mdiAccountGroupOutline,
} from '@mdi/js';
import { createEventClient } from '../api/events.js';
import EventCreateDialog from './EventCreateDialog.vue';
import EventAttendanceDialog from './EventAttendanceDialog.vue';
import { LINEUP_TYPES } from '../domain/lineups.js';
import './events.css';
import { EVENT_TYPE_OPTIONS, eventTypeLabel, eventDisplayTitle } from '../domain/event-types.js';
const client = createEventClient({ source: import.meta.env.VITE_DATA_SOURCE || 'local' });
const events = ref([]);
const loading = ref(true);
const loadError = ref('');
const notice = ref('');
const typeOptions = EVENT_TYPE_OPTIONS;
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
const editingEvent = ref(null);
const listPanel = ref(null);
const createButton = ref(null);
const attendanceDialog = ref(false);
const attendanceEvent = ref(null);
let attendanceOpener;
function openAttendance(event) {
  attendanceOpener = document.activeElement;
  attendanceEvent.value = event;
  attendanceDialog.value = true;
}
function restoreAttendanceFocus() {
  if (attendanceOpener?.isConnected) attendanceOpener.focus();
}
let formOpener;
function openForm(event = null) {
  formOpener = document.activeElement;
  editingEvent.value = event ? { ...event, dates: [...event.dates] } : null;
  notice.value = '';
  dialog.value = true;
}
function onSaved(value, edited = false) {
  const saved = Array.isArray(value) ? value : [value];
  for (const event of saved) {
    const index = events.value.findIndex((value) => value.id === event.id);
    if (index < 0) events.value.push(event);
    else events.value[index] = event;
  }
  const event = saved[0];
  filter.value = null;
  page.value = Math.floor(filtered.value.findIndex((value) => value.id === event.id) / 20) + 1;
  notice.value =
    saved.length > 1
      ? `「${eventDisplayTitle(event)}」已建立 ${saved.length} 筆獨立安排，每筆可分別修改、刪除。`
      : `「${eventDisplayTitle(event)}」已${edited ? '修改' : '建立'}，共 ${event.dates.length} 天，首頁行事曆已更新。`;
}
function restoreEditFocus() {
  const button =
    editingEvent.value &&
    listPanel.value?.querySelector(`[data-edit-event="${CSS.escape(editingEvent.value.id)}"]`);
  (formOpener?.isConnected ? formOpener : button || createButton.value?.$el)?.focus();
}
const deleteDialog = ref(false);
const deleteTarget = ref(null);
const deleting = ref(false);
const deleteError = ref('');
let deleteOpener;
function openDelete(event) {
  deleteOpener = document.activeElement;
  deleteTarget.value = { ...event, dates: [...event.dates] };
  deleteError.value = '';
  notice.value = '';
  deleteDialog.value = true;
}
function closeDelete(value = false) {
  if (!value && !deleting.value) deleteDialog.value = false;
}
function restoreDeleteFocus() {
  const next = listPanel.value?.querySelector('[data-edit-event]') || createButton.value?.$el;
  (deleteOpener?.isConnected ? deleteOpener : next)?.focus();
}
async function remove() {
  if (deleting.value) return;
  deleting.value = true;
  deleteError.value = '';
  try {
    const data = await client.deleteEvent(deleteTarget.value.id, deleteTarget.value.revision);
    if (data?.id !== deleteTarget.value.id) throw new Error('刪除回應格式不正確，請重試確認結果');
    events.value = events.value.filter((event) => event.id !== data.id);
    page.value = Math.min(page.value, pageCount.value);
    notice.value = `「${eventDisplayTitle(deleteTarget.value)}」已刪除，首頁行事曆已移除這筆安排。`;
    deleteDialog.value = false;
  } catch (error) {
    deleteError.value = error.message;
  } finally {
    deleting.value = false;
  }
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
      <p class="page-subtitle">安排活動、約戰、幫戰與龍虎戰，讓每一天的集結更清楚。</p>
    </div>
    <v-btn
      ref="createButton"
      color="primary"
      :prepend-icon="mdiPlus"
      :disabled="loading || !!loadError"
      @click="openForm()"
      >建立安排</v-btn
    >
  </section>
  <div class="event-notices" aria-live="polite">
    <v-alert v-if="notice" type="success" variant="tonal" closable @click:close="notice = ''">{{
      notice
    }}</v-alert>
  </div>
  <section ref="listPanel" class="panel event-panel" aria-label="活動安排清單">
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
        <h3>尚無安排</h3>
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
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="event in visible" :key="event.id">
                <td class="event-name">{{ eventDisplayTitle(event) }}</td>
                <td>
                  <span :class="['event-type', event.type]">{{ eventTypeLabel(event.type) }}</span>
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
                <td>
                  <div class="event-row-actions">
                    <v-btn
                      v-if="LINEUP_TYPES.includes(event.type)"
                      variant="text"
                      color="primary"
                      :prepend-icon="mdiAccountGroupOutline"
                      :aria-label="`出勤閱覽：${eventDisplayTitle(event)}（${formatDate(event.dates[0])}）`"
                      @click="openAttendance(event)"
                      >出勤閱覽</v-btn
                    >
                    <v-btn
                      variant="text"
                      color="primary"
                      :prepend-icon="mdiPencilOutline"
                      :data-edit-event="event.id"
                      :aria-label="`修改安排：${eventDisplayTitle(event)}${!event.title ? `（${formatDate(event.dates[0])}）` : ''}`"
                      @click="openForm(event)"
                      >修改</v-btn
                    >
                    <v-btn
                      variant="text"
                      color="error"
                      :prepend-icon="mdiTrashCanOutline"
                      :aria-label="`刪除安排：${eventDisplayTitle(event)}${!event.title ? `（${formatDate(event.dates[0])}）` : ''}`"
                      @click="openDelete(event)"
                      >刪除</v-btn
                    >
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
  <EventCreateDialog
    v-model="dialog"
    :event="editingEvent"
    @created="onSaved"
    @updated="onSaved($event, true)"
    @after-leave="restoreEditFocus"
  />
  <EventAttendanceDialog
    v-if="attendanceEvent"
    v-model="attendanceDialog"
    :event="attendanceEvent"
    @closed="restoreAttendanceFocus"
  />
  <v-dialog
    :model-value="deleteDialog"
    :persistent="deleting"
    max-width="520"
    aria-labelledby="event-delete-title"
    @update:model-value="closeDelete"
    @after-leave="restoreDeleteFocus"
  >
    <v-card class="event-dialog">
      <div class="event-dialog-content">
        <h2 id="event-delete-title">刪除安排</h2>
        <p class="event-delete-name">{{ eventDisplayTitle(deleteTarget) }}</p>
        <p class="event-description">
          確定刪除此{{ eventTypeLabel(deleteTarget?.type) }}？ 這筆安排會從清單及全部
          {{ deleteTarget?.dates.length }} 個日期的行事曆移除。
        </p>
        <div class="event-date-list event-delete-dates" aria-label="將移除的安排日期">
          <time v-for="date in deleteTarget?.dates" :key="date" :datetime="date">{{
            formatDate(date)
          }}</time>
        </div>
        <v-alert
          v-if="deleteError"
          type="error"
          variant="tonal"
          class="event-form-alert"
          role="alert"
          >{{ deleteError }}</v-alert
        >
      </div>
      <div class="event-dialog-actions">
        <v-btn variant="outlined" :disabled="deleting" @click="closeDelete()">取消</v-btn>
        <v-btn color="error" :loading="deleting" :disabled="deleting" @click="remove">{{
          deleting ? '刪除中…' : '確認刪除'
        }}</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>
