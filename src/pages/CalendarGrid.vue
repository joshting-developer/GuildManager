<script setup>
import { computed, ref } from 'vue';
import { mdiChevronLeft, mdiChevronRight } from '@mdi/js';
import './calendar.css';
import { eventTypeLabel } from '../domain/event-types.js';
const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  selectable: Boolean,
  creatable: Boolean,
  initialDate: { type: String, default: '' },
  multiple: Boolean,
  disabled: Boolean,
  events: { type: Array, default: () => [] },
});
const emit = defineEmits(['update:modelValue', 'open-day', 'create-date']);
const eventsByDate = computed(() => {
  const result = new Map();
  for (const event of props.events)
    for (const date of event.dates) {
      if (!result.has(date)) result.set(date, []);
      result.get(date).push(event);
    }
  return result;
});
function selectDate(date) {
  if (props.disabled) return;
  const selected = props.modelValue.includes(date);
  const dates = selected
    ? props.modelValue.filter((value) => value !== date)
    : props.multiple
      ? [...props.modelValue, date]
      : [date];
  emit('update:modelValue', dates.sort());
}

const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).formatToParts(new Date());
const today = Object.fromEntries(
  parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]),
);
const initial = props.initialDate.match(/^([1-9]\d{3})-(0[1-9]|1[0-2])-\d{2}$/);
const view = ref({
  year: initial ? Number(initial[1]) : today.year,
  month: initial ? Number(initial[2]) - 1 : today.month - 1,
});
const monthLabel = computed(() => `${view.value.year} 年 ${view.value.month + 1} 月`);
const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
function makeDate(year, month, day) {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  return date;
}
const weeks = computed(() => {
  const { year, month } = view.value;
  const offset = makeDate(year, month, 1).getUTCDay();
  const days = Array.from({ length: 42 }, (_, index) => {
    // Calculate calendar dates in UTC so browser timezone and DST cannot shift cells.
    const date = makeDate(year, month, index + 1 - offset);
    const dateYear = date.getUTCFullYear();
    const dateMonth = date.getUTCMonth();
    const day = date.getUTCDate();
    return {
      iso: date.toISOString().slice(0, 10),
      day,
      label: `${dateYear} 年 ${dateMonth + 1} 月 ${day} 日`,
      outside: dateMonth !== month,
      isToday: dateYear === today.year && dateMonth === today.month - 1 && day === today.day,
    };
  });
  return Array.from({ length: 6 }, (_, index) => days.slice(index * 7, index * 7 + 7));
});
function moveMonth(amount) {
  const date = makeDate(view.value.year, view.value.month + amount, 1);
  view.value = { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}
function goToday() {
  view.value = { year: today.year, month: today.month - 1 };
}
</script>
<template>
  <div :class="['calendar-grid', { 'date-picker': selectable, 'calendar-creatable': creatable }]">
    <div class="calendar-toolbar">
      <h3 aria-live="polite" aria-atomic="true">{{ monthLabel }}</h3>
      <div class="calendar-navigation" aria-label="切換行事曆月份">
        <v-btn variant="outlined" :disabled="disabled" @click="goToday">今天</v-btn>
        <v-btn
          variant="text"
          :icon="mdiChevronLeft"
          aria-label="上一個月"
          :disabled="disabled || (view.year === 1000 && view.month === 0)"
          @click="moveMonth(-1)"
        />
        <v-btn
          variant="text"
          :icon="mdiChevronRight"
          aria-label="下一個月"
          :disabled="disabled || (view.year === 9999 && view.month === 11)"
          @click="moveMonth(1)"
        />
      </div>
    </div>
    <table class="calendar-table">
      <caption class="sr-only">
        {{
          monthLabel
        }}{{
          selectable ? (multiple ? '，可選取多天' : '，只可選取一天') : '活動安排行事曆'
        }}
      </caption>
      <thead>
        <tr>
          <th v-for="weekday in weekdays" :key="weekday" scope="col">{{ weekday }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(week, index) in weeks" :key="index">
          <td
            v-for="day in week"
            :key="day.iso"
            :class="{ 'calendar-outside': day.outside, 'calendar-today': day.isToday }"
          >
            <button
              v-if="selectable"
              type="button"
              class="date-choice"
              :class="{ 'date-selected': modelValue.includes(day.iso) }"
              :aria-pressed="modelValue.includes(day.iso)"
              :aria-label="day.label"
              :aria-current="day.isToday ? 'date' : undefined"
              :disabled="disabled || !/^[1-9]\d{3}-/.test(day.iso)"
              @click="selectDate(day.iso)"
            >
              {{ day.day }}
            </button>
            <template v-else>
              <button
                v-if="creatable"
                type="button"
                class="calendar-create-date"
                :aria-label="`${day.label}，建立安排`"
                :disabled="disabled || !/^[1-9]\d{3}-/.test(day.iso)"
                @click="emit('create-date', day.iso)"
              />
              <div class="calendar-day">
                <time
                  :datetime="day.iso"
                  :aria-label="day.label"
                  :aria-current="day.isToday ? 'date' : undefined"
                  >{{ day.day }}</time
                ><span v-if="day.isToday" class="calendar-today-label">今天</span>
              </div>
              <button
                v-if="eventsByDate.has(day.iso)"
                type="button"
                class="calendar-day-events"
                :aria-label="`${day.label}，${eventsByDate.get(day.iso).length} 筆安排，查看詳情`"
                @click="emit('open-day', { date: day.iso, events: eventsByDate.get(day.iso) })"
              >
                <span class="calendar-event-count">{{ eventsByDate.get(day.iso).length }} 筆</span>
                <span
                  v-for="event in eventsByDate.get(day.iso).slice(0, 2)"
                  :key="event.id"
                  :class="['calendar-event-label', event.type]"
                  >{{ eventTypeLabel(event.type)
                  }}{{ event.title ? ` · ${event.title}` : '' }}</span
                >
                <span v-if="eventsByDate.get(day.iso).length > 2" class="calendar-event-more"
                  >另 {{ eventsByDate.get(day.iso).length - 2 }} 筆</span
                >
              </button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
