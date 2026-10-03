<script setup>
import {
  mdiAccountGroupOutline,
  mdiCalendarMonthOutline,
  mdiClipboardTextOutline,
  mdiSwordCross,
  mdiFileUploadOutline,
} from '@mdi/js';
import MonthCalendar from './MonthCalendar.vue';
const emit = defineEmits(['open-page']);
const modules = [
  {
    id: 'members',
    title: '成員清單',
    icon: mdiAccountGroupOutline,
    color: 'blue',
    description: '成員名稱、職業與過去名稱。',
  },
  {
    id: 'events',
    title: '活動安排',
    icon: mdiCalendarMonthOutline,
    color: 'violet',
    description: '活動、約戰、幫戰與龍虎戰安排。',
  },
  {
    id: 'lineups',
    title: '戰場排表',
    icon: mdiSwordCross,
    color: 'orange',
    description: '安排出戰陣容，儲存與套用名單範本。',
  },
  {
    id: 'attendance',
    title: '出勤紀錄',
    icon: mdiClipboardTextOutline,
    color: 'green',
    description: '活動參與與出勤紀錄。',
  },
  {
    id: 'battle-upload',
    title: '戰績上傳',
    icon: mdiFileUploadOutline,
    color: 'orange',
    description: '匯入戰績 CSV, 保存對戰結果。',
  },
];
const dateLabel = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
}).format(new Date());
</script>

<template>
  <section class="page-heading" aria-labelledby="page-title">
    <div>
      <p class="eyebrow">GUILD MANAGER <span class="eyebrow-divider">/</span> 管理總覽</p>
      <h1 id="page-title">幫會總覽<span class="heading-dot">.</span></h1>
      <p class="page-subtitle">管理成員資料，掌握近期活動與出勤。</p>
    </div>
    <div class="today">
      <span class="today-icon"><v-icon :icon="mdiCalendarMonthOutline" size="24" /></span>
      <div>
        <span class="today-caption">TODAY</span>
        <p>{{ dateLabel }}</p>
      </div>
    </div>
  </section>
  <section class="home-management" aria-labelledby="management-title">
    <h2 id="management-title" class="sr-only">幫會管理功能</h2>
    <div class="modules-grid">
      <component
        :is="
          ['members', 'events', 'lineups', 'battle-upload'].includes(module.id) ? 'button' : 'div'
        "
        v-for="module in modules"
        :key="module.id"
        class="module-card"
        :type="
          ['members', 'events', 'lineups', 'battle-upload'].includes(module.id)
            ? 'button'
            : undefined
        "
        @click="
          ['members', 'events', 'lineups', 'battle-upload'].includes(module.id) &&
          emit('open-page', module.id)
        "
      >
        <span :class="['icon-box', module.color]"><v-icon :icon="module.icon" size="24" /></span>
        <h3>{{ module.title }}</h3>
        <p>{{ module.description }}</p>
        <span class="module-status">{{
          ['members', 'events', 'lineups', 'battle-upload'].includes(module.id)
            ? `開啟${module.title} →`
            : '待開發'
        }}</span>
      </component>
    </div>
  </section>
  <MonthCalendar />
</template>
