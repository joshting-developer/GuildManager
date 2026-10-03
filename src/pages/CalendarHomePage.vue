<script setup>
import MonthCalendar from './MonthCalendar.vue';
</script>
<template>
  <section class="page-heading" aria-labelledby="calendar-home-title">
    <div>
      <p class="eyebrow">GUILD CALENDAR</p>
      <h1 id="calendar-home-title">幫會行事曆<span class="heading-dot">.</span></h1>
      <p class="page-subtitle">點選戰鬥日期，選擇場次後報名或請假。</p>
    </div>
  </section>
  <MonthCalendar :management="false" />
</template>
