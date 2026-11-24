<script setup>
import { computed, defineAsyncComponent, onMounted, onUnmounted, shallowRef } from 'vue';
import DataLoading from './DataLoading.vue';
import launchBackground from '../assets/jian-ying-li-hua-launch.webp';
import PageLoadError from './PageLoadError.vue';
import { countdownParts, LAUNCH_TIME, PREVIEW_SEQUENCE, PREVIEW_STORAGE_KEY, previewSequence } from '../domain/launch-countdown.js';

const App = defineAsyncComponent({
  loader: () => import('../App.vue'), loadingComponent: DataLoading,
  errorComponent: PageLoadError, delay: 0, timeout: 30000,
});
function hasPreview() {
  try { return localStorage.getItem(PREVIEW_STORAGE_KEY) === '1'; } catch { return false; }
}
const now = shallowRef(Date.now());
const opened = shallowRef(now.value >= LAUNCH_TIME || hasPreview());
const parts = computed(() => countdownParts(now.value));
const timerLabel = computed(() => `距離開放還有${parts.value.map(part => `${part.value}${part.label}`).join('')}`);
let buffer = '', timer;
function stop() {
  clearInterval(timer);
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('storage', onStorage);
  window.removeEventListener('focus', update);
  document.removeEventListener('visibilitychange', update);
}
function enter() {
  opened.value = true;
  stop();
}
function update() {
  now.value = Date.now();
  if (now.value >= LAUNCH_TIME || hasPreview()) enter();
}
function onKeydown(event) {
  if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]')) return;
  buffer = previewSequence(buffer, event);
  if (buffer !== PREVIEW_SEQUENCE) return;
  try { localStorage.setItem(PREVIEW_STORAGE_KEY, '1'); } catch { /* Preview still works for this page when storage is unavailable. */ }
  enter();
}
function onStorage(event) {
  if (event.key === PREVIEW_STORAGE_KEY && event.newValue === '1') enter();
}
onMounted(() => {
  if (opened.value) return;
  document.title = '劍映梨花';
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('storage', onStorage);
  window.addEventListener('focus', update);
  document.addEventListener('visibilitychange', update);
  timer = setInterval(update, 1000);
  update();
});
onUnmounted(stop);
</script>

<template>
  <App v-if="opened" />
  <main v-else class="launch-countdown" aria-labelledby="launch-title">
    <img class="launch-background" :src="launchBackground" alt="" aria-hidden="true" fetchpriority="high" />
    <div class="launch-content">
      <h1 id="launch-title" class="launch-title">劍映梨花</h1>
      <dl class="launch-timer" role="timer" aria-live="off" :aria-label="timerLabel">
        <div v-for="part in parts" :key="part.label" class="launch-unit">
          <dt class="launch-unit-label">{{ part.label }}</dt>
          <dd class="launch-digit">{{ part.text }}</dd>
        </div>
      </dl>
    </div>
  </main>
</template>

<style scoped>
.launch-countdown {
  --launch-background: #10191e;
  --launch-ink: #f4f5f1;
  --launch-muted: #b8c1c3;
  --launch-separator: #a4afb0;
  --launch-scrim: rgb(7 17 23 / 42%);
  --launch-title-font: 'Noto Serif TC', 'Songti TC', 'PMingLiU', serif;
  position: relative;
  isolation: isolate;
  display: grid;
  place-items: center;
  min-height: 100svh;
  padding: max(32px, env(safe-area-inset-top)) 24px max(32px, env(safe-area-inset-bottom));
  background: var(--launch-background);
  color: var(--launch-ink);
  text-align: center;
}
.launch-background { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center; }
.launch-countdown::after { content: ''; position: absolute; inset: 0; background: var(--launch-scrim); pointer-events: none; }
.launch-content { position: relative; z-index: 1; width: min(100%, 1200px); padding-block: 48px; }
.launch-title { font-family: var(--launch-title-font); font-size: clamp(36px, 4.5vw, 64px); letter-spacing: 0.16em; padding-left: 0.16em; font-weight: 600; line-height: 1.4; overflow-wrap: break-word; }
.launch-timer { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 64px 0 56px; }
.launch-unit { position: relative; display: flex; flex-direction: column-reverse; gap: 16px; min-width: 0; }
.launch-unit:not(:last-child)::after { content: ':'; position: absolute; right: -0.12em; top: 0; color: var(--launch-separator); font-size: clamp(48px, 10vw, 144px); line-height: 1; }
.launch-digit { margin: 0; font-size: clamp(48px, 10vw, 144px); font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1; letter-spacing: -0.035em; }
.launch-unit-label { font-size: 18px; color: var(--launch-muted); }
@media (max-width: 600px) {
  .launch-countdown { padding-inline: 20px; }
  .launch-content { padding-block: 24px; }
  .launch-background { object-position: right center; }
  .launch-timer { margin: 48px 0 40px; }
  .launch-unit { gap: 12px; }
  .launch-unit-label { font-size: 14px; }
}
</style>
