<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { mdiCalendarMonthOutline, mdiPlus, mdiRefresh, mdiClose } from '@mdi/js';
import { createEventClient } from '../api/events.js';
import CalendarGrid from './CalendarGrid.vue';
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
const saving = ref(false);
const form = ref({ title: '', type: 'activity', dates: [] });
const errors = ref({});
const saveError = ref('');
const typeNotice = ref('');
let baseline = '';
let requestId;
let opener;
const dirty = computed(() => JSON.stringify(form.value) !== baseline);
function openForm() {
  opener = document.activeElement;
  form.value = { title: '', type: 'activity', dates: [] };
  baseline = JSON.stringify(form.value);
  requestId = crypto.randomUUID();
  errors.value = {};
  saveError.value = '';
  typeNotice.value = '';
  dialog.value = true;
}
function closeForm(value = false) {
  if (value || saving.value) return;
  if (dirty.value && !window.confirm('放棄尚未儲存的安排？')) return;
  dialog.value = false;
}
function restoreFocus() {
  if (opener?.isConnected) opener.focus();
}
function changeType(type) {
  errors.value.type = '';
  typeNotice.value = '';
  if (type === 'scrimmage' && form.value.dates.length > 1) {
    form.value.dates = [];
    typeNotice.value = '已切換為約戰，請重新選擇一天。';
    errors.value.dates = '';
  }
}
function changeDates(dates) {
  if (dates.length > 366) {
    errors.value.dates = '每筆活動最多選擇 366 天';
    return;
  }
  form.value.dates = dates;
  errors.value.dates = '';
}
async function save() {
  if (saving.value) return;
  errors.value = {};
  if (!form.value.title.trim()) errors.value.title = '請填寫安排名稱';
  if (!form.value.dates.length) errors.value.dates = '請選擇日期';
  if (form.value.type === 'scrimmage' && form.value.dates.length !== 1)
    errors.value.dates = '約戰只能選擇一天';
  if (Object.keys(errors.value).length) return;
  saving.value = true;
  saveError.value = '';
  notice.value = '';
  try {
    const data = await client.createEvent({
      ...form.value,
      dates: [...form.value.dates],
      requestId,
    });
    if (!data?.event?.id || !Array.isArray(data.event.dates))
      throw new Error('儲存回應格式不正確，請重試確認結果');
    const index = events.value.findIndex((event) => event.id === data.event.id);
    if (index < 0) events.value.push(data.event);
    else events.value[index] = data.event;
    filter.value = null;
    page.value =
      Math.floor(filtered.value.findIndex((event) => event.id === data.event.id) / 20) + 1;
    notice.value = `「${data.event.title}」已建立，共 ${data.event.dates.length} 天，首頁行事曆已可查看。`;
    dialog.value = false;
  } catch (error) {
    errors.value = error.fields || {};
    saveError.value = error.message;
  } finally {
    saving.value = false;
  }
}
function preventLoss(event) {
  if (!dialog.value || !dirty.value) return;
  event.preventDefault();
  event.returnValue = '';
}
onMounted(() => {
  load();
  window.addEventListener('beforeunload', preventLoss);
});
onUnmounted(() => window.removeEventListener('beforeunload', preventLoss));
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
  <v-dialog
    :model-value="dialog"
    :persistent="saving"
    max-width="680"
    aria-labelledby="event-form-title"
    @update:model-value="closeForm"
    @after-leave="restoreFocus"
  >
    <v-card class="event-dialog"
      ><form class="event-form" @submit.prevent="save">
        <div class="event-dialog-content">
          <div class="event-dialog-heading">
            <div>
              <p class="eyebrow">NEW SCHEDULE</p>
              <h2 id="event-form-title">建立安排</h2>
            </div>
            <v-btn
              variant="text"
              :icon="mdiClose"
              aria-label="關閉安排表單"
              :disabled="saving"
              @click="closeForm()"
            />
          </div>
          <p class="event-description">活動可選多個日期，約戰只選一天。日期以台北日期為準。</p>
          <v-alert
            v-if="saveError"
            type="error"
            variant="tonal"
            class="event-form-alert"
            role="alert"
            >{{ saveError }}</v-alert
          >
          <v-text-field
            v-model="form.title"
            label="安排名稱 *"
            variant="outlined"
            maxlength="120"
            :disabled="saving"
            :error-messages="errors.title"
            autocomplete="off"
            @update:model-value="errors.title = ''"
          />
          <v-select
            v-model="form.type"
            label="安排類型 *"
            :items="typeOptions"
            variant="outlined"
            :disabled="saving"
            :error-messages="errors.type"
            @update:model-value="changeType"
          />
          <p v-if="typeNotice" class="event-type-notice" role="status">{{ typeNotice }}</p>
          <div class="event-date-heading">
            <h3>安排日期 *</h3>
            <span aria-live="polite"
              >已選 {{ form.dates.length }} 天{{
                form.type === 'scrimmage' ? '／只能選一天' : '／可選不連續日期'
              }}</span
            >
          </div>
          <p v-if="errors.dates" class="event-field-error" role="alert">{{ errors.dates }}</p>
          <CalendarGrid
            :model-value="form.dates"
            selectable
            :multiple="form.type === 'activity'"
            :disabled="saving"
            @update:model-value="changeDates"
          />
          <div v-if="form.dates.length" class="event-selected-dates" aria-label="已選日期">
            <v-chip
              v-for="date in form.dates"
              :key="date"
              closable
              :disabled="saving"
              :aria-label="`已選 ${formatDate(date)}`"
              @click:close="changeDates(form.dates.filter((value) => value !== date))"
              >{{ formatDate(date) }}</v-chip
            >
          </div>
        </div>
        <div class="event-dialog-actions">
          <v-btn variant="outlined" :disabled="saving" @click="closeForm()">取消</v-btn
          ><v-btn type="submit" color="primary" :loading="saving" :disabled="saving">{{
            saving ? '儲存中…' : '儲存'
          }}</v-btn>
        </div>
      </form></v-card
    >
  </v-dialog>
</template>
