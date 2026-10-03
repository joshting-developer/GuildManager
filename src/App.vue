<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue';
import {
  mdiSwordCross,
  mdiViewDashboardOutline,
  mdiMenu,
  mdiClose,
  mdiAccountGroupOutline,
} from '@mdi/js';
import HomePage from './pages/HomePage.vue';
import MembersPage from './pages/MembersPage.vue';

const mobileMenu = ref(false);
const source = import.meta.env.VITE_DATA_SOURCE || 'local';
const view = ref(window.location.hash === '#/members' ? 'members' : 'home');
function syncView() {
  view.value = window.location.hash === '#/members' ? 'members' : 'home';
  mobileMenu.value = false;
  window.scrollTo({ top: 0, behavior: 'instant' });
  nextTick(() => document.getElementById('main')?.focus());
}
function navigate(page) {
  window.location.hash = page === 'members' ? '/members' : '/';
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
  <v-app>
    <a class="skip-link" href="#main" @click.prevent="skipToMain">跳至主要內容</a>
    <header class="site-header">
      <div class="header-inner">
        <button class="brand" type="button" aria-label="回到首頁總覽" @click="goHome">
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
            <v-icon :icon="mdiViewDashboardOutline" size="18" />總覽
          </button>
          <button
            type="button"
            :class="{ 'nav-current': view === 'members' }"
            :aria-current="view === 'members' ? 'page' : undefined"
            @click="navigate('members')"
          >
            <v-icon :icon="mdiAccountGroupOutline" size="18" />成員清單
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
        <v-btn variant="text" :prepend-icon="mdiViewDashboardOutline" @click="goHome">總覽</v-btn>
        <v-btn variant="text" :prepend-icon="mdiAccountGroupOutline" @click="navigate('members')"
          >成員清單</v-btn
        >
      </nav>
    </header>
    <main id="main" class="page" tabindex="-1">
      <HomePage v-if="view === 'home'" @open-members="navigate('members')" />
      <MembersPage v-else />
      <footer class="page-footer">
        <span>逆水寒 <span class="footer-divider">/</span> 幫會管理平台</span
        ><span>每一次集結，都有跡可循。</span>
      </footer>
    </main>
  </v-app>
</template>
