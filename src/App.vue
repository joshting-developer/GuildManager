<script setup>
import { ref } from 'vue';
import { mdiSwordCross, mdiViewDashboardOutline, mdiMenu, mdiClose } from '@mdi/js';
import HomePage from './pages/HomePage.vue';

const mobileMenu = ref(false);
const source = import.meta.env.VITE_DATA_SOURCE || 'local';
function goHome() {
  mobileMenu.value = false;
  window.scrollTo({ top: 0, behavior: 'instant' });
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
          <button type="button" class="nav-current" @click="goHome">
            <v-icon :icon="mdiViewDashboardOutline" size="18" />總覽
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
      </nav>
    </header>
    <main id="main" class="page" tabindex="-1">
      <HomePage />
      <footer class="page-footer">
        <span>逆水寒 <span class="footer-divider">/</span> 幫會管理平台</span
        ><span>每一次集結，都有跡可循。</span>
      </footer>
    </main>
  </v-app>
</template>
