<script setup>
import { computed, onMounted, onUnmounted, shallowRef } from 'vue';
import { migrationPhase, migrationCountdown, NEW_SITE_URL } from '../migration.js';

const now = shallowRef(Date.now());
const collapsed = shallowRef(false);
const phase = computed(() => migrationPhase(now.value));
const countdown = computed(() => migrationCountdown(now.value));
let timer;
function refresh() { now.value = Date.now(); }
onMounted(() => {
  timer = setInterval(refresh, 1000);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
});
onUnmounted(() => {
  clearInterval(timer);
  window.removeEventListener('focus', refresh);
  document.removeEventListener('visibilitychange', refresh);
});
</script>

<template>
  <template v-if="phase === 'legacy'">
    <slot />
    <aside class="migration-countdown" aria-label="新站上線倒數">
      <button
        class="migration-toggle"
        type="button"
        :aria-expanded="!collapsed"
        aria-controls="migration-countdown-link"
        @click="collapsed = !collapsed"
      >{{ collapsed ? '新站倒數' : '收合' }}</button>
      <a
        v-show="!collapsed"
        id="migration-countdown-link"
        class="migration-countdown-link"
        :href="NEW_SITE_URL"
        target="_top"
      >
        <span>新站上線倒數</span>
        <strong>{{ countdown }}</strong>
        <span>前往新站 →</span>
      </a>
    </aside>
  </template>
  <main v-else class="migration-page">
    <section class="migration-message" aria-labelledby="migration-title">
      <p class="migration-label">幫會管理平台 · 網站搬遷</p>
      <h1 id="migration-title" aria-live="polite">
        {{ phase === 'moving' ? '新站將於 00:00 開放' : '新站已上線，前往使用' }}
      </h1>
      <p>舊站已停止使用，請前往新站</p>
      <p v-if="phase === 'moving'">11/27（五）00:00 開放（台灣時間）<br>距離開放 {{ countdown }}</p>
      <a class="migration-link" :href="NEW_SITE_URL" target="_top">前往新站 →</a>
    </section>
  </main>
</template>

<style scoped>
.migration-countdown {
  position: fixed;
  right: max(12px, env(safe-area-inset-right));
  bottom: calc(88px + env(safe-area-inset-bottom));
  z-index: 2500;
  display: grid;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-surface);
  color: var(--color-text);
  text-decoration: none;
  font-size: 13px;
  box-shadow: 0 3px 14px #00000012;
}
.migration-toggle {
  min-width: 80px;
  min-height: 44px;
  padding: 8px 12px;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  cursor: pointer;
  border: 0;
}
.migration-countdown-link {
  display: grid;
  gap: 4px;
  padding: 0 16px 12px;
  color: var(--color-text);
  text-decoration: none;
}
.migration-countdown strong { font-size: 18px; font-variant-numeric: tabular-nums; }
.migration-countdown span:last-child { color: var(--color-primary); }
.migration-page {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 32px 20px;
  background: var(--color-page);
  color: var(--color-text);
}
.migration-message { width: min(100%, 560px); }
.migration-label { color: var(--color-text-muted); }
h1 { margin: 16px 0; font-size: clamp(24px, 5vw, 32px); line-height: 1.5; }
p { margin: 12px 0; line-height: 1.8; }
.migration-link {
  display: inline-flex;
  align-items: center;
  min-height: 48px;
  margin-top: 20px;
  padding: 12px 24px;
  border-radius: 8px;
  background: var(--color-primary-strong);
  color: var(--color-on-primary);
  text-decoration: none;
}
a:focus-visible, button:focus-visible { outline: 3px solid var(--color-primary); outline-offset: -3px; }
</style>
