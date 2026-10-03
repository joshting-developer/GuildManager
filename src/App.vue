<script setup>
import { computed, onMounted, ref } from 'vue';
import {
  mdiSwordCross,
  mdiViewDashboardOutline,
  mdiCalendarMonthOutline,
  mdiBullhornOutline,
  mdiArrowTopRight,
  mdiArrowRight,
  mdiAccountGroupOutline,
  mdiCheckCircleOutline,
  mdiClipboardTextOutline,
  mdiClockOutline,
  mdiClose,
  mdiMenu,
  mdiChevronRight,
  mdiPinOutline,
  mdiDatabaseOutline,
} from '@mdi/js';
import { createHomeClient } from './api/home.js';

const source = import.meta.env.VITE_DATA_SOURCE || 'local';
const client = createHomeClient({ source });
const home = ref(null);
const loading = ref(true);
const error = ref('');
const emptyPreview = ref(false);
const filter = ref('all');
const mobileMenu = ref(false);
const dialog = ref(null);
let dialogOpener;
const feedback = ref('');
const navigation = [
  { id: 'overview', title: '總覽', icon: mdiViewDashboardOutline },
  { id: 'events', title: '近期活動', icon: mdiCalendarMonthOutline },
  { id: 'announcements', title: '幫會公告', icon: mdiBullhornOutline },
];
const filters = [
  { id: 'all', title: '全部' },
  { id: 'league', title: '幫會聯賽' },
  { id: 'raid', title: '團本活動' },
];
const modules = [
  {
    title: '成員名冊',
    icon: mdiAccountGroupOutline,
    color: 'blue',
    description: '每一位夥伴，都是幫會的一份力量。',
    detail: '預計整理角色名稱、成員狀態與加入時間。正式欄位與權限將在後續確認。',
  },
  {
    title: '活動安排',
    icon: mdiCalendarMonthOutline,
    color: 'violet',
    description: '集合時間與報名資訊，集中整理。',
    detail: '預計提供活動安排與報名管理。目前首頁可查看示範活動，尚未提供新增或修改。',
  },
  {
    title: '出勤紀錄',
    icon: mdiClipboardTextOutline,
    color: 'green',
    description: '留下每次集結，一起參與的足跡。',
    detail: '預計整理活動參與與出勤紀錄。計算方式與資料欄位尚待確認。',
  },
  {
    title: '幫戰資料',
    icon: mdiSwordCross,
    color: 'orange',
    description: '回顧每一場並肩作戰的紀錄。',
    detail: '預計整理對戰與結果資料。這是管理入口示意，實際功能仍待後續需求確認。',
  },
];
const dateLabel = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
}).format(new Date());
const dateYear = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Taipei', year: 'numeric' }).format(
  new Date(),
);
const events = computed(() => (emptyPreview.value ? [] : home.value?.events || []));
const notices = computed(() => (emptyPreview.value ? [] : home.value?.announcements || []));
const filteredEvents = computed(() =>
  events.value.filter((event) => filter.value === 'all' || event.type === filter.value),
);
const nextEvent = computed(() => events.value[0]);
const stats = computed(() => {
  const summary = emptyPreview.value
    ? { members: 0, upcomingEvents: 0, attendanceRate: null, pendingRegistrations: 0 }
    : home.value?.summary;
  return [
    {
      title: '幫會成員',
      value: summary?.members ?? '—',
      unit: '位',
      note: '名冊中的夥伴',
      icon: mdiAccountGroupOutline,
      color: 'blue',
    },
    {
      title: '近期活動',
      value: summary?.upcomingEvents ?? '—',
      unit: '場',
      note: '接下來的集結',
      icon: mdiCalendarMonthOutline,
      color: 'violet',
    },
    {
      title: '活動出勤率',
      value: summary?.attendanceRate ?? '—',
      unit: '%',
      note: '統計期間待設定',
      icon: mdiCheckCircleOutline,
      color: 'green',
    },
    {
      title: '待確認報名',
      value: summary?.pendingRegistrations ?? '—',
      unit: '筆',
      note: '等待名單確認',
      icon: mdiClipboardTextOutline,
      color: 'orange',
    },
  ];
});
const isDemo = computed(() => home.value?.meta.mode === 'demo');

async function loadHome() {
  loading.value = true;
  error.value = '';
  try {
    home.value = await client.getHomeData();
  } catch (reason) {
    error.value = reason.message || '讀取失敗，請稍後再試';
  } finally {
    loading.value = false;
  }
}
function navigate(id) {
  mobileMenu.value = false;
  document
    .getElementById(id)
    ?.scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  if (id === 'main') document.getElementById(id)?.focus({ preventScroll: true });
}
function openDialog(details) {
  dialogOpener = document.activeElement;
  dialog.value = details;
}
function restoreDialogFocus() {
  dialogOpener?.focus({ preventScroll: true });
}
function toggleEmpty() {
  emptyPreview.value = !emptyPreview.value;
  filter.value = 'all';
  feedback.value = emptyPreview.value ? '已切換空白狀態預覽，不會修改資料' : '已恢復資料預覽';
}
function setFilter(id) {
  filter.value = id;
  feedback.value = `找到 ${filteredEvents.value.length} 場活動`;
}
function eventDate(value, part) {
  const options =
    part === 'day'
      ? { day: '2-digit' }
      : part === 'month'
        ? { month: '2-digit' }
        : part === 'time'
          ? { hour: '2-digit', minute: '2-digit', hour12: false }
          : { month: 'numeric', day: 'numeric', weekday: 'short' };
  return new Intl.DateTimeFormat(part === 'day' ? 'en-GB' : 'zh-TW', {
    timeZone: 'Asia/Taipei',
    ...options,
  }).format(new Date(value));
}
function eventType(event) {
  return event.type === 'league' ? '幫會聯賽' : '團本活動';
}
function openEvent(event) {
  openDialog({
    title: event.title,
    eyebrow: isDemo.value ? '示範活動' : '活動詳情',
    body: event.note,
    facts: [
      eventDate(event.startsAt),
      `${eventDate(event.startsAt, 'time')} 集合`,
      `${event.registered} / ${event.capacity} 位報名`,
    ],
  });
}
onMounted(loadHome);
</script>

<template>
  <v-app>
    <a class="skip-link" href="#main" @click.prevent="navigate('main')">跳至主要內容</a>
    <header class="site-header">
      <div class="header-inner">
        <button class="brand" type="button" aria-label="回到首頁總覽" @click="navigate('overview')">
          <span class="brand-mark"><v-icon :icon="mdiSwordCross" size="26" /></span>
          <span class="brand-text"><strong>逆水寒</strong><span>幫會管理平台</span></span>
        </button>
        <nav class="desktop-nav" aria-label="主要導覽">
          <button
            v-for="item in navigation"
            :key="item.id"
            type="button"
            :class="{ 'nav-current': item.id === 'overview' }"
            @click="navigate(item.id)"
          >
            <v-icon :icon="item.icon" size="18" />{{ item.title }}
          </button>
        </nav>
        <div class="header-actions">
          <span class="environment-tag"
            ><span class="status-dot"></span>{{ source === 'gas' ? '雲端預覽' : '本機預覽' }}</span
          >
          <v-btn
            class="mobile-menu-button"
            variant="text"
            :icon="mobileMenu ? mdiClose : mdiMenu"
            aria-label="主要導覽選單"
            :aria-expanded="mobileMenu"
            aria-controls="mobile-navigation"
            @click="mobileMenu = !mobileMenu"
          />
        </div>
      </div>
      <nav v-if="mobileMenu" id="mobile-navigation" class="mobile-nav" aria-label="手機導覽">
        <v-btn
          v-for="item in navigation"
          :key="item.id"
          variant="text"
          :prepend-icon="item.icon"
          @click="navigate(item.id)"
          >{{ item.title }}</v-btn
        >
      </nav>
    </header>

    <main id="main" class="page" tabindex="-1">
      <section id="overview" class="page-heading" aria-labelledby="page-title">
        <div>
          <p class="eyebrow">GUILD MANAGER <span class="eyebrow-divider">/</span> 首頁</p>
          <h1 id="page-title">幫會總覽<span class="heading-dot">.</span></h1>
          <p class="page-subtitle">成員概況、近期活動與重要公告，一眼掌握。</p>
        </div>
        <div class="today">
          <span class="today-icon"><v-icon :icon="mdiCalendarMonthOutline" size="24" /></span>
          <div>
            <span class="today-caption">TODAY · {{ dateYear }}</span>
            <p>{{ dateLabel }}</p>
          </div>
        </div>
      </section>

      <div v-if="home && !error" class="preview-banner">
        <div class="preview-message">
          <v-icon :icon="mdiDatabaseOutline" size="19" /><span
            ><strong>{{ emptyPreview ? '空白狀態預覽' : isDemo ? '示範資料' : '資料預覽' }}</strong
            ><span class="banner-divider">·</span
            >{{
              emptyPreview
                ? '僅切換畫面，不會修改資料'
                : isDemo
                  ? '目前顯示本機範例，正式資料尚未串接'
                  : '目前尚未提供資料編輯功能'
            }}</span
          >
        </div>
        <v-btn v-if="isDemo" variant="text" size="small" :height="44" @click="toggleEmpty"
          >{{ emptyPreview ? '恢復示範資料' : '查看空白狀態'
          }}<v-icon :icon="mdiArrowRight" size="16" end
        /></v-btn>
      </div>
      <v-card v-if="error" class="error-card" role="alert">
        <h2>暫時無法取得幫會資料</h2>
        <p>{{ error }}</p>
        <v-btn color="primary" :loading="loading" @click="loadHome">重新讀取</v-btn>
      </v-card>

      <section class="stats-grid" aria-label="幫會概況">
        <v-card v-for="stat in stats" :key="stat.title" class="stat-card">
          <div class="stat-label">
            <span>{{ stat.title }}</span
            ><span :class="['icon-box', stat.color]"><v-icon :icon="stat.icon" size="21" /></span>
          </div>
          <v-skeleton-loader v-if="loading" type="heading" />
          <p v-else class="stat-value">
            {{ stat.value }}<span v-if="stat.value !== '—'">{{ stat.unit }}</span>
          </p>
          <p class="stat-note">{{ stat.note }}</p>
        </v-card>
      </section>

      <div class="content-grid">
        <section id="events" class="panel events-panel" aria-labelledby="events-title">
          <div class="section-header">
            <div>
              <p class="eyebrow">UPCOMING EVENTS</p>
              <h2 id="events-title">下一次，並肩而行</h2>
            </div>
            <span class="subtle-tag">近期活動</span>
          </div>
          <div v-if="nextEvent && !error" class="next-event">
            <div class="next-event-icon"><v-icon :icon="mdiSwordCross" size="25" /></div>
            <div class="next-event-copy">
              <p>下一場集結 <span v-if="isDemo">· 示範</span></p>
              <strong>{{ nextEvent.title }}</strong
              ><span
                >{{ eventDate(nextEvent.startsAt) }} ·
                {{ eventDate(nextEvent.startsAt, 'time') }}</span
              >
            </div>
            <v-btn color="primary" variant="flat" size="small" @click="openEvent(nextEvent)"
              >查看活動<v-icon :icon="mdiArrowTopRight" size="16" end
            /></v-btn>
          </div>
          <div class="events-toolbar">
            <div class="filter-group" role="group" aria-label="活動類型篩選">
              <button
                v-for="item in filters"
                :key="item.id"
                type="button"
                :aria-pressed="filter === item.id"
                :class="{ active: filter === item.id }"
                @click="setFilter(item.id)"
              >
                {{ item.title }}
              </button>
            </div>
            <span class="result-count">{{ filteredEvents.length }} 場活動</span>
          </div>
          <v-skeleton-loader
            v-if="loading"
            type="list-item-two-line, list-item-two-line, list-item-two-line"
          />
          <div v-else-if="!error && filteredEvents.length" class="event-list">
            <article v-for="event in filteredEvents" :key="event.id" class="event-row">
              <div class="date-tile">
                <span>{{ eventDate(event.startsAt, 'month') }}</span
                ><strong>{{ eventDate(event.startsAt, 'day') }}</strong>
              </div>
              <div class="event-copy">
                <div class="event-title">
                  <h3>{{ event.title }}</h3>
                  <v-chip
                    :color="event.type === 'league' ? 'blue-darken-3' : 'deep-purple-darken-2'"
                    >{{ eventType(event) }}</v-chip
                  >
                </div>
                <p>
                  <v-icon :icon="mdiClockOutline" size="15" />{{ eventDate(event.startsAt, 'time')
                  }}<span>·</span><v-icon :icon="mdiAccountGroupOutline" size="16" />{{
                    event.registered
                  }}
                  / {{ event.capacity }} 位
                </p>
              </div>
              <v-btn
                variant="text"
                class="event-detail"
                :icon="mdiChevronRight"
                :aria-label="`查看${event.title}`"
                @click="openEvent(event)"
              />
            </article>
          </div>
          <div v-else class="empty-state">
            <span class="empty-icon"><v-icon :icon="mdiCalendarMonthOutline" size="28" /></span>
            <h3>
              {{
                error
                  ? '活動資料尚未讀取'
                  : filter !== 'all'
                    ? '沒有符合條件的活動'
                    : '下一次集結，等你安排'
              }}
            </h3>
            <p>
              {{
                error
                  ? '重新讀取後再查看活動。'
                  : filter !== 'all'
                    ? '試試其他類型，或清除篩選。'
                    : '活動資料接入後，集合時間與名單會顯示在這裡。'
              }}
            </p>
            <v-btn v-if="filter !== 'all'" variant="text" color="primary" @click="setFilter('all')"
              >清除篩選</v-btn
            >
          </div>
          <div class="panel-footnote">
            <v-icon :icon="mdiClockOutline" size="15" />活動時間以台北時區顯示<span
              v-if="isDemo && !emptyPreview"
              >· 示範活動</span
            >
          </div>
        </section>

        <section id="announcements" class="panel notices-panel" aria-labelledby="notices-title">
          <div class="section-header">
            <div>
              <p class="eyebrow">GUILD NOTICE</p>
              <h2 id="notices-title">幫會大小事</h2>
            </div>
            <span class="notice-heading-icon"><v-icon :icon="mdiBullhornOutline" size="25" /></span>
          </div>
          <v-skeleton-loader v-if="loading" type="paragraph, paragraph" />
          <div v-else-if="notices.length && !error" class="notice-list">
            <article v-for="notice in notices" :key="notice.id" class="notice-item">
              <div class="notice-meta">
                <span v-if="notice.pinned" class="pinned"
                  ><v-icon :icon="mdiPinOutline" size="15" />置頂公告</span
                ><span v-else>幫會公告</span
                ><time :datetime="notice.publishedAt">{{ eventDate(notice.publishedAt) }}</time>
              </div>
              <h3>{{ notice.title }}</h3>
              <p>{{ notice.body }}</p>
            </article>
          </div>
          <div v-else class="empty-state">
            <span class="empty-icon"><v-icon :icon="mdiBullhornOutline" size="28" /></span>
            <h3>{{ error ? '公告資料尚未讀取' : '重要消息，不再錯過' }}</h3>
            <p>{{ error ? '重新讀取後再查看公告。' : '幫會公告接入後，最新消息會集中在這裡。' }}</p>
          </div>
          <div class="notice-note">
            <span class="status-dot"></span
            >{{ isDemo && !emptyPreview ? '以上公告為示範內容' : '公告管理功能尚未串接' }}
          </div>
        </section>
      </div>

      <section id="management" class="management-section" aria-labelledby="management-title">
        <div class="section-header">
          <div>
            <p class="eyebrow">WORKSPACE</p>
            <h2 id="management-title">幫會管理，從這裡開始</h2>
          </div>
          <span class="section-description">管理入口預覽 · 尚未串接</span>
        </div>
        <div class="modules-grid">
          <button
            v-for="module in modules"
            :key="module.title"
            type="button"
            class="module-card"
            @click="
              openDialog({
                title: module.title,
                eyebrow: '管理入口 · 尚未串接',
                body: module.detail,
              })
            "
          >
            <span :class="['icon-box', module.color]"><v-icon :icon="module.icon" size="24" /></span
            ><v-icon class="module-arrow" :icon="mdiArrowTopRight" size="20" />
            <h3>{{ module.title }}</h3>
            <p>{{ module.description }}</p>
            <span class="module-status">功能規劃中</span>
          </button>
        </div>
      </section>
      <footer class="page-footer">
        <span>逆水寒 <span class="footer-divider">/</span> 幫會管理平台</span
        ><span>每一次集結，都有跡可循。</span>
      </footer>
      <p class="sr-only" role="status" aria-live="polite">{{ feedback }}</p>
    </main>

    <v-dialog
      :model-value="Boolean(dialog)"
      max-width="520"
      aria-labelledby="detail-title"
      aria-describedby="detail-description"
      @after-leave="restoreDialogFocus"
      @update:model-value="
        (open) => {
          if (!open) dialog = null;
        }
      "
    >
      <v-card v-if="dialog" class="detail-dialog"
        ><div class="dialog-top">
          <p class="eyebrow">{{ dialog.eyebrow }}</p>
          <v-btn variant="text" :icon="mdiClose" aria-label="關閉詳細資訊" @click="dialog = null" />
        </div>
        <h2 id="detail-title">{{ dialog.title }}</h2>
        <div v-if="dialog.facts" class="dialog-facts">
          <span v-for="fact in dialog.facts" :key="fact">{{ fact }}</span>
        </div>
        <p id="detail-description" class="dialog-body">{{ dialog.body }}</p>
        <p class="dialog-note">目前為首頁預覽，尚未提供報名或編輯功能。</p>
        <v-btn color="primary" block @click="dialog = null">知道了</v-btn></v-card
      >
    </v-dialog>
  </v-app>
</template>
