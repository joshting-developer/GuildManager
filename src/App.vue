<script setup>
import { ref, onMounted, onUnmounted, nextTick, provide } from 'vue';
import {
  mdiSwordCross,
  mdiViewDashboardOutline,
  mdiMenu,
  mdiClose,
  mdiAccountGroupOutline,
  mdiCalendarMonthOutline,
  mdiLogin,
  mdiLogout,
  mdiFileUploadOutline,
  mdiChartBoxOutline,
} from '@mdi/js';
import { createAuthClient } from './api/auth.js';
import { setCsrfToken } from './api/session.js';
import LoginDialog from './components/LoginDialog.vue';
import HomePage from './pages/HomePage.vue';
import CalendarHomePage from './pages/CalendarHomePage.vue';
import MembersPage from './pages/MembersPage.vue';
import EventsPage from './pages/EventsPage.vue';
import LineupsPage from './pages/LineupsPage.vue';
import BattleUploadPage from './pages/BattleUploadPage.vue';
import BattleRecordsPage from './pages/BattleRecordsPage.vue';

const source = import.meta.env.VITE_DATA_SOURCE || 'local';
const authClient = createAuthClient({ source });
const navigation = [
  { page: 'home', label: '行事曆', icon: mdiCalendarMonthOutline },
  { page: 'magament', label: '管理總覽', icon: mdiViewDashboardOutline },
  { page: 'members', label: '成員清單', icon: mdiAccountGroupOutline },
  { page: 'events', label: '活動安排', icon: mdiCalendarMonthOutline },
  { page: 'lineups', label: '戰場排表', icon: mdiSwordCross },
  { page: 'battle-upload', label: '戰績上傳', icon: mdiFileUploadOutline },
  { page: 'battle-records', label: '戰績閱覽', icon: mdiChartBoxOutline },
];
const mobileMenu = ref(false);
const lineupFocus = ref(false);
const pageGuard = ref(null);
const battleUploadEventId = ref(null);
provide('openBattleUpload', (eventId) => {
  battleUploadEventId.value = eventId;
  navigate('battle-upload');
});
const user = ref(null);
const authLoading = ref(true);
const authBusy = ref(false);
const authError = ref('');
const loginOpen = ref(false);
const loginError = ref('');
const authNotice = ref('');
let expiryTimer;
let disposed = false;
let loginOrigin;
let requestedPage = '';
let requestedRecordId = null;
let sessionVersion = 0;
provide('registerNavigationGuard', (guard) => {
  pageGuard.value = guard;
  return () => {
    if (pageGuard.value === guard) pageGuard.value = null;
  };
});
function currentView() {
  const route = window.location.hash.slice(2);
  if (route === 'management') return 'magament';
  if (route.startsWith('battle-records/')) return 'battle-records';
  return navigation.some((item) => item.page === route) ? route : 'home';
}
function currentBattleRecordId() {
  const route = window.location.hash.slice(2);
  if (!route.startsWith('battle-records/')) return null;
  const id = route.slice('battle-records/'.length);
  try {
    return decodeURIComponent(id) || null;
  } catch {
    return id;
  }
}
const battleRecordId = ref(currentBattleRecordId());
const view = ref(currentView());
function returnHome() {
  view.value = 'home';
  lineupFocus.value = false;
  mobileMenu.value = false;
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`);
}
function openLogin(page = 'magament', recordId = null) {
  requestedPage = page;
  requestedRecordId = recordId;
  loginOrigin = document.activeElement;
  loginError.value = '';
  mobileMenu.value = false;
  loginOpen.value = true;
}
function syncView() {
  const next = currentView();
  if (next !== 'home' && !user.value && !authLoading.value) {
    const recordId = currentBattleRecordId();
    returnHome();
    openLogin(next, recordId);
    return;
  }
  if (next !== view.value && pageGuard.value && !pageGuard.value()) {
    window.location.hash = view.value === 'home' ? '/' : `/${view.value}`;
    return;
  }
  view.value = next;
  battleRecordId.value = currentBattleRecordId();
  mobileMenu.value = false;
  window.scrollTo({ top: 0, behavior: 'instant' });
  nextTick(() => document.getElementById('main')?.focus({ preventScroll: true }));
}
function navigate(page) {
  const target = navigation.some((item) => item.page === page) ? page : 'home';
  if (target !== 'home' && !user.value) return openLogin(target);
  window.location.hash = target === 'home' ? '/' : `/${target}`;
  mobileMenu.value = false;
}
function applySession(session) {
  user.value = session.user;
  clearTimeout(expiryTimer);
  if (session.user)
    expiryTimer = setTimeout(
      expireSession,
      Math.max(0, Date.parse(session.expiresAt) - Date.now()),
    );
}
function expireSession() {
  if (!user.value) return;
  sessionVersion++;
  requestedPage = view.value === 'home' ? 'magament' : view.value;
  const recordId = battleRecordId.value;
  user.value = null;
  setCsrfToken('');
  clearTimeout(expiryTimer);
  authNotice.value = '登入已到期, 請重新登入後繼續管理';
  returnHome();
  openLogin(requestedPage, recordId);
}
async function restoreSession() {
  const version = ++sessionVersion;
  authError.value = '';
  try {
    const session = await authClient.getSession();
    if (disposed || version !== sessionVersion) return;
    if (user.value && !session.user) expireSession();
    else applySession(session);
  } catch (error) {
    if (disposed || version !== sessionVersion) return;
    authError.value = error.message;
    if (user.value) expireSession();
  } finally {
    if (!disposed && version === sessionVersion) {
      authLoading.value = false;
      if (view.value !== 'home' && !user.value) {
        const target = view.value;
        returnHome();
        openLogin(target, battleRecordId.value);
      }
    }
  }
}
async function login(input) {
  sessionVersion++;
  authBusy.value = true;
  loginError.value = '';
  try {
    const session = await authClient.login(input);
    applySession(session);
    authError.value = '';
    authNotice.value = '';
    loginOpen.value = false;
    if (requestedPage === 'battle-records' && requestedRecordId) {
      window.location.hash = `/battle-records/${encodeURIComponent(requestedRecordId)}`;
    } else navigate(requestedPage || 'magament');
  } catch (error) {
    loginError.value = error.message;
  } finally {
    authBusy.value = false;
  }
}
async function logout() {
  if (authBusy.value || (pageGuard.value && !pageGuard.value())) return;
  sessionVersion++;
  authBusy.value = true;
  authError.value = '';
  try {
    await authClient.logout();
    user.value = null;
    clearTimeout(expiryTimer);
    returnHome();
    authNotice.value = '已登出';
  } catch (error) {
    authError.value = error.message;
  } finally {
    authBusy.value = false;
  }
}
function restoreLoginFocus() {
  if (view.value === 'home' && loginOrigin?.isConnected && loginOrigin !== document.body)
    loginOrigin.focus();
  else document.getElementById('main')?.focus({ preventScroll: true });
}
function checkSession() {
  if (document.visibilityState === 'visible' && user.value && !authBusy.value) restoreSession();
}
onMounted(() => {
  window.addEventListener('hashchange', syncView);
  window.addEventListener('guild-auth-required', expireSession);
  document.addEventListener('visibilitychange', checkSession);
  restoreSession();
});
onUnmounted(() => {
  disposed = true;
  clearTimeout(expiryTimer);
  window.removeEventListener('hashchange', syncView);
  window.removeEventListener('guild-auth-required', expireSession);
  document.removeEventListener('visibilitychange', checkSession);
});
function skipToMain() {
  document.getElementById('main')?.focus();
}
</script>

<template>
  <v-app :class="{ 'lineup-route': view === 'lineups' && user }">
    <a class="skip-link" href="#main" @click.prevent="skipToMain">跳至主要內容</a>
    <header v-show="!lineupFocus" class="site-header">
      <div class="header-inner">
        <button class="brand" type="button" aria-label="回到行事曆首頁" @click="navigate('home')">
          <span class="brand-mark"><v-icon :icon="mdiSwordCross" size="26" /></span>
          <span class="brand-text"><strong>逆水寒</strong><span>幫會管理平台</span></span>
        </button>
        <nav class="desktop-nav" aria-label="主要導覽">
          <template v-for="item in navigation" :key="item.page">
            <button
              v-if="item.page === 'home' || user"
              type="button"
              :class="{ 'nav-current': view === item.page }"
              :aria-current="view === item.page ? 'page' : undefined"
              @click="navigate(item.page)"
            >
              <v-icon :icon="item.icon" size="18" />{{ item.label }}
            </button>
          </template>
        </nav>
        <div class="header-actions">
          <span class="environment-tag"
            ><span class="status-dot"></span>{{ source === 'gas' ? '雲端環境' : '本機開發' }}</span
          >
          <template v-if="user">
            <span class="login-account" :title="user.username">{{ user.username }}</span>
            <v-btn variant="text" :prepend-icon="mdiLogout" :loading="authBusy" @click="logout"
              >登出</v-btn
            >
          </template>
          <v-btn
            v-else
            color="primary"
            variant="tonal"
            :prepend-icon="mdiLogin"
            :disabled="authLoading"
            @click="openLogin()"
            >{{ authLoading ? '確認登入' : '登入' }}</v-btn
          >
          <v-btn
            v-if="user"
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
      <nav
        v-if="mobileMenu && user"
        id="mobile-navigation"
        class="mobile-nav"
        aria-label="手機導覽"
      >
        <v-btn
          v-for="item in navigation"
          :key="item.page"
          variant="text"
          :prepend-icon="item.icon"
          :aria-current="view === item.page ? 'page' : undefined"
          @click="navigate(item.page)"
          >{{ item.label }}</v-btn
        >
      </nav>
    </header>
    <main
      id="main"
      class="page"
      :class="{ 'page-lineups': view === 'lineups' && user }"
      tabindex="-1"
    >
      <v-alert v-if="authError" type="error" variant="tonal" role="alert" class="mb-4">
        {{ authError }}
        <v-btn variant="text" size="small" @click="restoreSession">重新確認登入</v-btn>
      </v-alert>
      <v-alert v-if="authNotice" type="info" variant="tonal" role="status" class="mb-4">{{
        authNotice
      }}</v-alert>
      <CalendarHomePage v-if="view === 'home'" />
      <v-skeleton-loader
        v-else-if="authLoading"
        type="heading, paragraph, article"
        aria-label="確認登入狀態中"
      />
      <template v-else-if="user">
        <HomePage v-if="view === 'magament'" @open-page="navigate" />
        <MembersPage v-else-if="view === 'members'" />
        <EventsPage v-else-if="view === 'events'" />
        <LineupsPage v-else-if="view === 'lineups'" @focus-changed="lineupFocus = $event" />
        <BattleUploadPage
          v-else-if="view === 'battle-upload'"
          :initial-event-id="battleUploadEventId"
        />
        <BattleRecordsPage v-else-if="view === 'battle-records'" :record-id="battleRecordId" />
      </template>
      <footer v-show="!lineupFocus" class="page-footer">
        <span>逆水寒 <span class="footer-divider">/</span> 幫會管理平台</span
        ><span>每一次集結，都有跡可循。</span>
      </footer>
    </main>
    <LoginDialog
      v-model="loginOpen"
      :source="source"
      :busy="authBusy"
      :error="loginError"
      @login="login"
      @closed="restoreLoginFocus"
    />
  </v-app>
</template>
