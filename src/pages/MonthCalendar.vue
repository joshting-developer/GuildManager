<script setup>
import { computed, ref } from 'vue';
import { mdiChevronLeft, mdiChevronRight } from '@mdi/js';
import './calendar.css';

const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).formatToParts(new Date());
const today = Object.fromEntries(
  parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]),
);
const view = ref({ year: today.year, month: today.month - 1 });
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
  <section class="panel calendar-panel" aria-labelledby="events-title">
    <div class="section-header calendar-heading">
      <div>
        <p class="eyebrow">GUILD CALENDAR</p>
        <h2 id="events-title">近期活動</h2>
      </div>
      <span class="subtle-tag">約戰行事曆</span>
    </div>
    <div class="calendar-toolbar">
      <h3 aria-live="polite" aria-atomic="true">{{ monthLabel }}</h3>
      <div class="calendar-navigation" aria-label="切換行事曆月份">
        <v-btn variant="outlined" @click="goToday">今天</v-btn>
        <v-btn variant="text" :icon="mdiChevronLeft" aria-label="上一個月" @click="moveMonth(-1)" />
        <v-btn variant="text" :icon="mdiChevronRight" aria-label="下一個月" @click="moveMonth(1)" />
      </div>
    </div>
    <table class="calendar-table">
      <caption class="sr-only">
        {{
          monthLabel
        }}約戰行事曆，約戰資料尚未串接
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
            <div class="calendar-day">
              <time
                :datetime="day.iso"
                :aria-label="day.label"
                :aria-current="day.isToday ? 'date' : undefined"
                >{{ day.day }}</time
              ><span v-if="day.isToday" class="calendar-today-label">今天</span>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <p class="calendar-status">約戰資料尚未串接，串接後會顯示各日期的約戰安排。</p>
  </section>
</template>
