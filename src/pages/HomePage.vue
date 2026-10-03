<script setup>
import {
  mdiAccountGroupOutline,
  mdiCalendarMonthOutline,
  mdiCheckCircleOutline,
  mdiClipboardTextOutline,
  mdiBullhornOutline,
  mdiSwordCross,
} from '@mdi/js';
const stats = [
  { title: '幫會成員', icon: mdiAccountGroupOutline, color: 'blue' },
  { title: '近期活動', icon: mdiCalendarMonthOutline, color: 'violet' },
  { title: '活動出勤率', icon: mdiCheckCircleOutline, color: 'green' },
  { title: '待確認報名', icon: mdiClipboardTextOutline, color: 'orange' },
];
const modules = [
  {
    title: '成員名冊',
    icon: mdiAccountGroupOutline,
    color: 'blue',
    description: '成員名稱、職業與過去名稱。',
  },
  {
    title: '活動安排',
    icon: mdiCalendarMonthOutline,
    color: 'violet',
    description: '集合時間與報名資訊。',
  },
  {
    title: '出勤紀錄',
    icon: mdiClipboardTextOutline,
    color: 'green',
    description: '活動參與與出勤紀錄。',
  },
  { title: '幫戰資料', icon: mdiSwordCross, color: 'orange', description: '對戰與結果資料。' },
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
      <p class="eyebrow">GUILD MANAGER <span class="eyebrow-divider">/</span> 首頁</p>
      <h1 id="page-title">幫會總覽<span class="heading-dot">.</span></h1>
      <p class="page-subtitle">成員概況、近期活動與重要公告，一眼掌握。</p>
    </div>
    <div class="today">
      <span class="today-icon"><v-icon :icon="mdiCalendarMonthOutline" size="24" /></span>
      <div>
        <span class="today-caption">TODAY</span>
        <p>{{ dateLabel }}</p>
      </div>
    </div>
  </section>
  <section class="stats-grid" aria-label="幫會概況">
    <v-card v-for="stat in stats" :key="stat.title" class="stat-card"
      ><div class="stat-label">
        <span>{{ stat.title }}</span
        ><span :class="['icon-box', stat.color]"><v-icon :icon="stat.icon" size="21" /></span>
      </div>
      <p class="stat-pending">待開發</p>
      <p class="stat-note">統計功能尚未開放</p></v-card
    >
  </section>
  <div class="content-grid">
    <section class="panel" aria-labelledby="events-title">
      <div class="section-header">
        <div>
          <p class="eyebrow">UPCOMING EVENTS</p>
          <h2 id="events-title">近期活動</h2>
        </div>
      </div>
      <div class="empty-state">
        <span class="empty-icon"><v-icon :icon="mdiCalendarMonthOutline" size="28" /></span>
        <h3>待開發</h3>
        <p>活動安排與報名功能尚未開放。</p>
      </div>
    </section>
    <section class="panel" aria-labelledby="notices-title">
      <div class="section-header">
        <div>
          <p class="eyebrow">GUILD NOTICE</p>
          <h2 id="notices-title">幫會公告</h2>
        </div>
      </div>
      <div class="empty-state">
        <span class="empty-icon"><v-icon :icon="mdiBullhornOutline" size="28" /></span>
        <h3>待開發</h3>
        <p>公告功能尚未開放。</p>
      </div>
    </section>
  </div>
  <section class="management-section" aria-labelledby="management-title">
    <div class="section-header">
      <div>
        <p class="eyebrow">WORKSPACE</p>
        <h2 id="management-title">幫會管理，從這裡開始</h2>
      </div>
    </div>
    <div class="modules-grid">
      <div v-for="module in modules" :key="module.title" class="module-card">
        <span :class="['icon-box', module.color]"><v-icon :icon="module.icon" size="24" /></span>
        <h3>{{ module.title }}</h3>
        <p>{{ module.description }}</p>
        <span class="module-status">待開發</span>
      </div>
    </div>
  </section>
</template>
