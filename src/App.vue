<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, provide, watch } from 'vue';
import {
  mdiSwordCross,
  mdiViewDashboardOutline,
  mdiMenu,
  mdiAccountGroupOutline,
  mdiCalendarMonthOutline,
  mdiLogin,
  mdiLogout,
  mdiFileUploadOutline,
  mdiChartBoxOutline,
  mdiAccountCogOutline,
  mdiVideoOutline,
  mdiHorseVariantFast,
} from '@mdi/js';
import { createAuthClient } from './api/auth.js';
import { createPlatformSettingsClient } from './api/platform-settings.js';
import { createPlatformCache, normalizeCachedPlatform } from './api/platform-cache.js';
import { setCsrfToken } from './api/session.js';
import LoginDialog from './components/LoginDialog.vue';
import DataLoading from './components/DataLoading.vue';
import PlatformBrand from './components/PlatformBrand.vue';
import MobileNavigation from './components/MobileNavigation.vue';
import SnowField from './components/SnowField.vue';
import HomePage from './pages/HomePage.vue';
import CalendarHomePage from './pages/CalendarHomePage.vue';
import MembersPage from './pages/MembersPage.vue';
import EventsPage from './pages/EventsPage.vue';
import LineupsPage from './pages/LineupsPage.vue';
import BattleUploadPage from './pages/BattleUploadPage.vue';
import BattleRecordsPage from './pages/BattleRecordsPage.vue';
import AdminPage from './pages/AdminPage.vue';
import MemberBattleRecordsPage from './pages/MemberBattleRecordsPage.vue';
import VideosPage from './pages/VideosPage.vue';
import LotteryPage from './pages/LotteryPage.vue';

const source = import.meta.env.VITE_DATA_SOURCE || 'local';
const authClient = createAuthClient({ source });
const platformClient = createPlatformSettingsClient({ source });
const platformCache = createPlatformCache({ source, namespace: globalThis.__GUILD_GAS_KEY__ });
const initialPlatform = source === 'gas'
  ? normalizeCachedPlatform(globalThis.__GUILD_PLATFORM__)
  : null;
const cachedPlatform = initialPlatform || platformCache.read();
const platformName = ref(cachedPlatform?.name || ''),
  platformIcon = ref(cachedPlatform?.iconSrc || null),
  platformError = ref('');
if (initialPlatform) platformCache.write(initialPlatform);
if (cachedPlatform) document.title = `${cachedPlatform.name} · 幫會管理平台`;
let platformLoadVersion = 0;
function applyPlatform(platform) {
  platformLoadVersion++;
  platformName.value = platform.name;
  platformIcon.value = platform.iconSrc || null;
  platformCache.write(platform);
  document.title = `${platform.name} · 幫會管理平台`;
  platformError.value = '';
}
async function loadPlatform() {
  const version = ++platformLoadVersion;
  try {
    const result = await platformClient.getSettings();
    if (!disposed && version === platformLoadVersion) applyPlatform(result.platform);
  } catch (cause) {
    if (!disposed && version === platformLoadVersion) platformError.value = cause.message;
  }
}
const navigation = [
  { page: 'magament', label: '管理總覽', icon: mdiViewDashboardOutline },
  { page: 'members', signedIn: true, label: '成員清單', icon: mdiAccountGroupOutline },
  { page: 'events', label: '活動安排', icon: mdiCalendarMonthOutline },
  { page: 'lineups', label: '戰場排表', icon: mdiSwordCross },
  { page: 'battle-upload', label: '戰績上傳', icon: mdiFileUploadOutline },
  {
    page: 'battle-records',
    signedIn: true,
    label: '戰績閱覽',
    icon: mdiChartBoxOutline,
  },
  {
    page: 'admin',
    label: '帳號管理',
    icon: mdiAccountCogOutline,
    adminOnly: true,
  },
  { page: 'videos', label: '影片閱覽', icon: mdiVideoOutline },
  // Occasional tool: reachable from 管理總覽 and the drawer, keeping the desktop bar on one line.
  { page: 'lottery', label: '抽獎賽馬', icon: mdiHorseVariantFast, drawerOnly: true },
];
const mobileMenu = ref(false);
const mobileMenuButton = ref(null);
let menuOriginRoute;
let mobileViewport;
watch(mobileMenu, (open) => {
  if (open) menuOriginRoute = window.location.hash;
});
function closeDesktopMenu(event) {
  if (!event.matches) mobileMenu.value = false;
}
function restoreMenuFocus() {
  const button = mobileMenuButton.value?.$el;
  if (menuOriginRoute === window.location.hash && button?.getClientRects().length) {
    button.focus({ preventScroll: true });
  } else document.getElementById('main')?.focus({ preventScroll: true });
}
const lineupFocus = ref(false);
const pageGuard = ref(null);
const battleUploadEventId = ref(null);
provide('openBattleUpload', (eventId) => {
  battleUploadEventId.value = eventId;
  navigate('battle-upload');
});
const user = ref(null);
watch(user, (value) => {
  if (!value) mobileMenu.value = false;
});
const canManage = computed(() => ['admin', 'manager'].includes(user.value?.role));
const canReadBattles = computed(() => ['admin', 'manager', 'member'].includes(user.value?.role));
const memberCanVisit = (page) => ['home', 'members', 'battle-records', 'member-records'].includes(page);
const visibleNavigation = computed(() =>
  navigation.filter(
    (item) =>
      (canManage.value || (item.signedIn && canReadBattles.value)) &&
      (!item.adminOnly || user.value?.role === 'admin'),
  ),
);
const authLoading = ref(true);
const authBusy = ref(false);
const authError = ref('');
const loginOpen = ref(false);
const loginError = ref('');
const authNotice = ref('');
provide('calendarAuth', { user, loading: authLoading });
let expiryTimer;
let disposed = false;
let loginOrigin;
const requestedPage = ref('');
let requestedDetailId = null;
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
  if (route.startsWith('member-records/')) return 'member-records';
  if (route.startsWith('battle-records/')) return 'battle-records';
  return navigation.some((item) => item.page === route) ? route : 'home';
}
function currentDetailId() {
  const route = window.location.hash.slice(2);
  const prefix = route.startsWith('member-records/') ? 'member-records/' : 'battle-records/';
  if (!route.startsWith(prefix)) return null;
  const id = route.slice(prefix.length);
  try {
    return decodeURIComponent(id) || null;
  } catch {
    return id;
  }
}
const detailId = ref(currentDetailId());
const view = ref(currentView());
// Same pages game hid its petals on: dense editors and the full-screen race.
const showSnow = computed(() => !['lineups', 'members', 'lottery'].includes(view.value));
function returnHome() {
  view.value = 'home';
  lineupFocus.value = false;
  mobileMenu.value = false;
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`);
}
function openLogin(page = 'home', recordId = null) {
  requestedPage.value = page;
  requestedDetailId = recordId;
  loginOrigin = document.activeElement;
  loginError.value = '';
  mobileMenu.value = false;
  loginOpen.value = true;
}
function syncView() {
  const next = currentView();
  if (next !== 'home' && !user.value && !authLoading.value) {
    const recordId = currentDetailId();
    returnHome();
    openLogin(next, recordId);
    return;
  }
  if (next !== view.value && pageGuard.value && !pageGuard.value()) {
    window.location.hash = view.value === 'home' ? '/' : `/${view.value}`;
    return;
  }
  if (!memberCanVisit(next) && user.value?.role === 'member') {
    authNotice.value = 'member 登入可使用行事曆、成員清單與戰績閱覽，其他管理操作需要管理者帳號';
    returnHome();
    return;
  }
  view.value = next;
  if (next === 'admin' && user.value?.role !== 'admin' && !authLoading.value) {
    authNotice.value = '只有 admin 可以管理帳號';
    returnHome();
    return;
  }
  detailId.value = currentDetailId();
  mobileMenu.value = false;
  window.scrollTo({ top: 0, behavior: 'instant' });
  nextTick(() => document.getElementById('main')?.focus({ preventScroll: true }));
}
function navigate(page) {
  const target = navigation.some((item) => item.page === page) ? page : 'home';
  if (target !== 'home' && !user.value) return openLogin(target);
  if (!memberCanVisit(target) && user.value?.role === 'member') {
    authNotice.value = 'member 登入可使用行事曆、成員清單與戰績閱覽，其他管理操作需要管理者帳號';
    returnHome();
    return;
  }
  if (target === 'admin' && user.value?.role !== 'admin') {
    authNotice.value = '只有 admin 可以管理帳號';
    returnHome();
    return;
  }
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
  requestedPage.value = view.value === 'home' ? 'magament' : view.value;
  const recordId = detailId.value;
  user.value = null;
  setCsrfToken('');
  clearTimeout(expiryTimer);
  if (view.value === 'home') {
    authNotice.value = '登入已到期, 請重新登入後繼續報名';
    return;
  }
  authNotice.value = '登入已到期, 請重新登入後繼續操作';
  returnHome();
  openLogin(requestedPage.value, recordId);
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
        openLogin(target, detailId.value);
      }
      if (!memberCanVisit(view.value) && user.value?.role === 'member') {
        authNotice.value = 'member 登入可使用行事曆、成員清單與戰績閱覽，其他管理操作需要管理者帳號';
        returnHome();
      }
      if (view.value === 'admin' && user.value && user.value.role !== 'admin') {
        authNotice.value = '只有 admin 可以管理帳號';
        returnHome();
      }
    }
  }
}
async function login(input) {
  sessionVersion++;
  authBusy.value = true;
  loginError.value = '';
  try {
    const session =
      input.mode === 'member'
        ? await authClient.loginMember({ password: input.password })
        : await authClient.login({
            username: input.username,
            password: input.password,
          });
    applySession(session);
    authError.value = '';
    authNotice.value = '';
    loginOpen.value = false;
    if (['battle-records', 'member-records'].includes(requestedPage.value) && requestedDetailId) {
      window.location.hash = `/${requestedPage.value}/${encodeURIComponent(requestedDetailId)}`;
    } else
      navigate(
        input.mode === 'member' && requestedPage.value === 'magament'
          ? 'battle-records'
          : requestedPage.value || 'magament',
      );
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
  mobileViewport = window.matchMedia('(max-width: 1100px)');
  mobileViewport.addEventListener('change', closeDesktopMenu);
  window.addEventListener('hashchange', syncView);
  window.addEventListener('guild-auth-required', expireSession);
  document.addEventListener('visibilitychange', checkSession);
  restoreSession();
  if (!initialPlatform) loadPlatform();
});
onUnmounted(() => {
  mobileViewport?.removeEventListener('change', closeDesktopMenu);
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
    <SnowField v-if="showSnow" />
    <a class="skip-link" href="#main" @click.prevent="skipToMain">跳至主要內容</a>
    <header v-show="!lineupFocus" class="site-header">
      <div class="header-inner">
        <PlatformBrand
          :name="platformName"
          :icon-src="platformIcon"
          :loading="!platformName && !platformError"
          @home="navigate('home')"
        />
        <nav class="desktop-nav" aria-label="主要導覽">
          <template v-for="item in visibleNavigation" :key="item.page">
            <button
              v-if="!item.adminOnly && !item.drawerOnly"
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
            <v-btn
              v-if="user.role === 'admin'"
              class="admin-account-button"
              variant="text"
              :prepend-icon="mdiAccountCogOutline"
              aria-label="帳號管理"
              :title="`帳號管理：${user.username}`"
              @click="navigate('admin')"
              >{{ user.username }}</v-btn
            >
            <span v-else-if="user.role !== 'member'" class="login-account" :title="user.username">{{
              user.username
            }}</span>
            <v-btn
              class="desktop-logout"
              variant="text"
              :prepend-icon="mdiLogout"
              :loading="authBusy"
              @click="logout"
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
            ref="mobileMenuButton"
            class="mobile-menu-button"
            variant="text"
            :icon="mdiMenu"
            aria-label="主要導覽選單"
            aria-haspopup="dialog"
            :aria-expanded="mobileMenu"
            aria-controls="mobile-navigation"
            @click="mobileMenu = !mobileMenu"
          />
        </div>
      </div>
    </header>
    <MobileNavigation
      v-model="mobileMenu"
      :items="visibleNavigation"
      :current-page="view"
      :account="user?.role !== 'member' ? user?.username : undefined"
      :busy="authBusy"
      :error="authError"
      @navigate="navigate"
      @logout="logout"
      @closed="restoreMenuFocus"
    />
    <main
      id="main"
      class="page"
      :class="{ 'page-lineups': view === 'lineups' && user, 'page-above-snow': showSnow }"
      tabindex="-1"
    >
      <v-alert v-if="authError" type="error" variant="tonal" role="alert" class="mb-4">
        {{ authError }}
        <v-btn variant="text" size="small" @click="restoreSession">重新確認登入</v-btn>
      </v-alert>
      <v-alert v-if="platformError" type="error" variant="tonal" role="alert" class="mb-4">
        {{ platformError }}
        <v-btn variant="text" size="small" @click="loadPlatform">重新載入平台名稱</v-btn>
      </v-alert>
      <v-alert v-if="authNotice" type="info" variant="tonal" role="status" class="mb-4">{{
        authNotice
      }}</v-alert>
      <CalendarHomePage v-if="view === 'home'" />
      <div v-else-if="authLoading" aria-busy="true">
        <DataLoading>正在確認登入狀態…</DataLoading>
        <v-skeleton-loader type="heading, paragraph, article" aria-hidden="true" />
      </div>
      <BattleRecordsPage
        v-else-if="canReadBattles && view === 'battle-records'"
        :record-id="detailId"
      />
      <MemberBattleRecordsPage
        v-else-if="canReadBattles && view === 'member-records' && detailId"
        :key="detailId"
        :member-uid="detailId"
      />
      <MembersPage v-else-if="canReadBattles && view === 'members'" />
      <template v-else-if="canManage">
        <HomePage v-if="view === 'magament'" @open-page="navigate" />
        <EventsPage v-else-if="view === 'events'" />
        <LineupsPage v-else-if="view === 'lineups'" @focus-changed="lineupFocus = $event" />
        <BattleUploadPage
          v-else-if="view === 'battle-upload'"
          :initial-event-id="battleUploadEventId"
        />
        <VideosPage v-else-if="view === 'videos'" />
        <LotteryPage v-else-if="view === 'lottery'" />
        <AdminPage
          v-else-if="view === 'admin' && user.role === 'admin'"
          @platform-updated="applyPlatform"
        />
      </template>
      <footer v-show="!lineupFocus" class="page-footer">
        <span>{{ platformName || '幫會平台' }} <span class="footer-divider">/</span> 幫會管理平台</span
        ><span>每一次集結，都有跡可循。</span>
      </footer>
    </main>
    <LoginDialog
      v-model="loginOpen"
      :source="source"
      :busy="authBusy"
      :error="loginError"
      @login="login"
      @mode-change="loginError = ''"
      @closed="restoreLoginFocus"
    />
  </v-app>
</template>
