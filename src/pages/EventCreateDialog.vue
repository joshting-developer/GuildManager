<script setup>
import DataLoading from '../components/DataLoading.vue';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { mdiClose } from '@mdi/js';
import { createEventClient } from '../api/events.js';
import CalendarGrid from './CalendarGrid.vue';
import { EVENT_TYPE_OPTIONS, eventTypeLabel, isBattleType } from '../domain/event-types.js';
import './events.css';
const props = defineProps({
  modelValue: Boolean,
  initialDate: { type: String, default: '' },
  event: { type: Object, default: null },
});
const emit = defineEmits(['update:modelValue', 'created', 'updated', 'after-leave']);
const client = createEventClient({ source: import.meta.env.VITE_DATA_SOURCE || 'local' });
const calendarKey = ref(0);
const editing = computed(() => Boolean(props.event));
const dialogTitle = computed(() => (editing.value ? '修改安排' : '建立安排'));
const calendarDate = computed(() => props.event?.dates[0] || props.initialDate);
const typeOptions = EVENT_TYPE_OPTIONS;
const saving = ref(false);
const form = ref({ title: '', type: 'activity', dates: [] });
const optionalTitle = computed(() => isBattleType(form.value.type));
const batchCreating = computed(() => !editing.value && isBattleType(form.value.type));
function allowsMultipleDates(type) {
  return type === 'activity' || (!editing.value && isBattleType(type));
}
const multipleDates = computed(() => allowsMultipleDates(form.value.type));
const errors = ref({});
const saveError = ref('');
const typeNotice = ref('');
let baseline = '';
let requestId;
let opener;
const dirty = computed(() => JSON.stringify(form.value) !== baseline);
function openForm() {
  opener = document.activeElement;
  form.value = props.event
    ? { title: props.event.title, type: props.event.type, dates: [...props.event.dates] }
    : { title: '', type: 'activity', dates: props.initialDate ? [props.initialDate] : [] };
  calendarKey.value += 1;
  baseline = JSON.stringify(form.value);
  requestId = crypto.randomUUID();
  errors.value = {};
  saveError.value = '';
  typeNotice.value = '';
}
function closeForm(value = false) {
  if (value || saving.value) return;
  if (dirty.value && !window.confirm('放棄尚未儲存的安排？')) return;
  emit('update:modelValue', false);
}
function restoreFocus() {
  if (opener?.isConnected) opener.focus();
  emit('after-leave');
}
function changeType(type) {
  errors.value.type = '';
  errors.value.title = '';
  typeNotice.value = '';
  if (!allowsMultipleDates(type) && form.value.dates.length > 1) {
    form.value.dates = [];
    typeNotice.value = `已切換為${eventTypeLabel(type)}，請重新選擇一天。`;
    errors.value.dates = '';
  }
}
function changeDates(dates) {
  if (dates.length > 366) {
    errors.value.dates = '每次最多選擇 366 天';
    return;
  }
  form.value.dates = dates;
  errors.value.dates = '';
}
async function save() {
  if (saving.value) return;
  errors.value = {};
  if (!optionalTitle.value && !form.value.title.trim()) errors.value.title = '請填寫安排名稱';
  if (!form.value.dates.length) errors.value.dates = '請選擇日期';
  if (!multipleDates.value && form.value.dates.length !== 1)
    errors.value.dates = `${eventTypeLabel(form.value.type)}每筆安排只能選擇一天`;
  if (Object.keys(errors.value).length) return;
  saving.value = true;
  saveError.value = '';
  try {
    const values = { ...form.value, dates: [...form.value.dates] };
    const data = editing.value
      ? await client.updateEvent(props.event.id, { ...values, revision: props.event.revision })
      : await client.createEvent({ ...values, requestId });
    const saved = editing.value ? [data?.event] : data?.events || [data?.event];
    const expected = batchCreating.value ? form.value.dates.length : 1;
    if (
      !Array.isArray(saved) ||
      saved.length !== expected ||
      saved.some((event) => !event?.id || !Array.isArray(event.dates)) ||
      new Set(saved.map((event) => event.id)).size !== saved.length ||
      (editing.value && saved[0].id !== props.event.id)
    )
      throw new Error('儲存回應格式不正確，請重試確認結果');
    emit(editing.value ? 'updated' : 'created', editing.value ? saved[0] : saved);
    emit('update:modelValue', false);
  } catch (error) {
    errors.value = error.fields || {};
    saveError.value = error.message;
  } finally {
    saving.value = false;
  }
}
function preventLoss(event) {
  if (!props.modelValue || !dirty.value) return;
  event.preventDefault();
  event.returnValue = '';
}
watch(
  () => props.modelValue,
  (open) => {
    if (open) openForm();
  },
);
onMounted(() => window.addEventListener('beforeunload', preventLoss));
onUnmounted(() => window.removeEventListener('beforeunload', preventLoss));
function formatDate(date) {
  return date.replaceAll('-', '/');
}
</script>
<template>
  <v-dialog
    :model-value="modelValue"
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
              <p class="eyebrow">{{ editing ? 'EDIT SCHEDULE' : 'NEW SCHEDULE' }}</p>
              <h2 id="event-form-title">{{ dialogTitle }}</h2>
            </div>
            <v-btn
              variant="text"
              :icon="mdiClose"
              aria-label="關閉安排表單"
              :disabled="saving"
              @click="closeForm()"
            />
          </div>
          <p class="event-description">
            活動可選多天；幫戰、龍虎戰可批次建立多個日期，每天各自一筆。約戰只選一天，日期以台北日期為準。
          </p>
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
            :class="{ 'event-title-optional': optionalTitle }"
            :label="optionalTitle ? '安排名稱（選填）' : '安排名稱 *'"
            :aria-required="!optionalTitle"
            :hint="optionalTitle ? '對手尚未確定時可留空，會以類型與日期顯示。' : ''"
            :persistent-hint="optionalTitle"
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
                multipleDates ? '／可選不連續日期' : '／每筆只能選一天'
              }}</span
            >
          </div>
          <p v-if="batchCreating" class="event-type-notice" role="status">
            將建立 {{ form.dates.length }} 筆獨立的{{
              eventTypeLabel(form.type)
            }}安排，每筆可分別修改、刪除。
          </p>
          <p v-else-if="editing && isBattleType(form.type)" class="event-type-notice">
            只修改這一場{{ eventTypeLabel(form.type) }}，其他日期的場次不受影響。
          </p>
          <p v-if="errors.dates" class="event-field-error" role="alert">{{ errors.dates }}</p>
          <CalendarGrid
            :key="`calendar-${calendarKey}`"
            :initial-date="calendarDate"
            :model-value="form.dates"
            selectable
            :multiple="multipleDates"
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
        <DataLoading v-if="saving" compact>正在儲存活動安排，請稍候…</DataLoading>
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
