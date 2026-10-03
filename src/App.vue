<script setup>
import { ref, onMounted, onUnmounted, nextTick, provide } from 'vue';
import {
  mdiSwordCross,
  mdiViewDashboardOutline,
  mdiMenu,
  mdiClose,
  mdiAccountGroupOutline,
  mdiCalendarMonthOutline,
} from '@mdi/js';
import HomePage from './pages/HomePage.vue';
import CalendarHomePage from './pages/CalendarHomePage.vue';
import MembersPage from './pages/MembersPage.vue';
import EventsPage from './pages/EventsPage.vue';
import LineupsPage from './pages/LineupsPage.vue';

const mobileMenu = ref(false);
const lineupFocus = ref(false);
const pageGuard = ref(null);
provide('registerNavigationGuard', (guard) => {
  pageGuard.value = guard;
  return () => {
    if (pageGuard.value === guard) pageGuard.value = null;
  };
});
const source = import.meta.env.VITE_DATA_SOURCE || 'local';
function currentView() {
  const route = window.location.hash.slice(2);
  return ['magament', 'members', 'events', 'lineups'].includes(route) ? route : 'home';
}
const view = ref(currentView());
function syncView() {
  if (currentView() !== view.value && pageGuard.value && !pageGuard.value()) {
    window.location.hash = view.value === 'home' ? '/' : `/${view.value}`;
    return;
  }
  view.value = currentView();
  mobileMenu.value = false;
  window.scrollTo({ top: 0, behavior: 'instant' });
  nextTick(() => document.getElementById('main')?.focus({ preventScroll: true }));
}
function navigate(page) {
  window.location.hash = ['magament', 'members', 'events', 'lineups'].includes(page)
    ? `/${page}`
    : '/';
  mobileMenu.value = false;
}
onMounted(() => window.addEventListener('hashchange', syncView));
onUnmounted(() => window.removeEventListener('hashchange', syncView));
function goHome() {
  navigate('home');
}
function skipToMain() {
  document.getElementById('main')?.focus();
}
</script>

<template>
  <v-app :class="{ 'lineup-route': view === 'lineups' }">
    <a class="skip-link" href="#main" @click.prevent="skipToMain">跳至主要內容</a>
    <header v-show="!lineupFocus" class="site-header">
      <div class="header-inner">
        <button class="brand" type="button" aria-label="回到行事曆首頁" @click="goHome">
          <span class="brand-mark"><v-icon :icon="mdiSwordCross" size="26" /></span>
          <span class="brand-text"><strong>逆水寒</strong><span>幫會管理平台</span></span>
        </button>
        <nav class="desktop-nav" aria-label="主要導覽">
          <button
            type="button"
            :class="{ 'nav-current': view === 'home' }"
            :aria-current="view === 'home' ? 'page' : undefined"
            @click="goHome"
          >
            <v-icon :icon="mdiCalendarMonthOutline" size="18" />行事曆
          </button>
          <button
            type="button"
            :class="{ 'nav-current': view === 'magament' }"
            :aria-current="view === 'magament' ? 'page' : undefined"
            @click="navigate('magament')"
          >
            <v-icon :icon="mdiViewDashboardOutline" size="18" />管理總覽
          </button>
          <button
            type="button"
            :class="{ 'nav-current': view === 'members' }"
            :aria-current="view === 'members' ? 'page' : undefined"
            @click="navigate('members')"
          >
            <v-icon :icon="mdiAccountGroupOutline" size="18" />成員清單
          </button>
          <button
            type="button"
            :class="{ 'nav-current': view === 'events' }"
            :aria-current="view === 'events' ? 'page' : undefined"
            @click="navigate('events')"
          >
            <v-icon :icon="mdiCalendarMonthOutline" size="18" />活動安排
          </button>
          <button
            type="button"
            :class="{ 'nav-current': view === 'lineups' }"
            :aria-current="view === 'lineups' ? 'page' : undefined"
            @click="navigate('lineups')"
          >
            <v-icon :icon="mdiSwordCross" size="18" />戰場排表
          </button>
        </nav>
        <div class="header-actions">
          <span class="environment-tag"
            ><span class="status-dot"></span>{{ source === 'gas' ? '雲端環境' : '本機開發' }}</span
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
        <v-btn variant="text" :prepend-icon="mdiCalendarMonthOutline" @click="goHome">行事曆</v-btn>
        <v-btn variant="text" :prepend-icon="mdiViewDashboardOutline" @click="navigate('magament')"
          >管理總覽</v-btn
        >
        <v-btn variant="text" :prepend-icon="mdiAccountGroupOutline" @click="navigate('members')"
          >成員清單</v-btn
        >
        <v-btn variant="text" :prepend-icon="mdiCalendarMonthOutline" @click="navigate('events')"
          >活動安排</v-btn
        >
        <v-btn variant="text" :prepend-icon="mdiSwordCross" @click="navigate('lineups')"
          >戰場排表</v-btn
        >
      </nav>
    </header>
    <main id="main" class="page" :class="{ 'page-lineups': view === 'lineups' }" tabindex="-1">
      <CalendarHomePage v-if="view === 'home'" />
      <HomePage v-else-if="view === 'magament'" @open-page="navigate" />
      <MembersPage v-else-if="view === 'members'" />
      <EventsPage v-else-if="view === 'events'" />
      <LineupsPage v-else @focus-changed="lineupFocus = $event" />
      <footer v-show="!lineupFocus" class="page-footer">
        <span>逆水寒 <span class="footer-divider">/</span> 幫會管理平台</span
        ><span>每一次集結，都有跡可循。</span>
      </footer>
    </main>
  </v-app>
</template>
