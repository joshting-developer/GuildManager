<script setup>
import DataLoading from '../../components/DataLoading.vue';
import { computed, inject, onMounted, onUnmounted, ref } from 'vue';
import {
  mdiRefresh,
  mdiPencilOutline,
  mdiRestore,
  mdiPlay,
  mdiTrophyOutline,
  mdiAccountMultiplePlus,
} from '@mdi/js';
import { createLotteryClient } from '../../api/lottery.js';
import { createMemberClient } from '../../api/members.js';
import { LOTTERY_MAX_PLAYERS, LOTTERY_MAX_PRIZES, lotteryRunners } from '../../domain/lottery.js';
import { shuffle } from '../../domain/lottery-race.js';
import { LOTTERY_MODES } from './modes.js';

const source = import.meta.env.VITE_DATA_SOURCE || 'local';
const client = createLotteryClient({ source });
const memberClient = createMemberClient({ source });
const MODE_STORAGE_KEY = 'guild-lottery-mode';

const board = ref(null),
  loading = ref(true),
  error = ref(''),
  notice = ref(''),
  actionError = ref(''),
  selectedId = ref(null);
const playing = ref(false),
  drawing = ref(false),
  live = ref(false),
  stageNames = ref([]),
  commentary = ref(''),
  leader = ref('');
const result = ref(null),
  resultOpen = ref(false),
  confetti = ref([]);
const modeKey = ref(readMode());
const stage = ref(null);
let pendingBoard = null,
  timers = [],
  disposed = false,
  loadVersion = 0;

const editorOpen = ref(false),
  playersText = ref(''),
  prizesText = ref(''),
  editorBaseline = ref(''),
  editorError = ref(''),
  editorFields = ref({}),
  saving = ref(false),
  importing = ref(false);
const resetOpen = ref(false),
  resetting = ref(false);
let editorOrigin = null;

const editorDirty = computed(
  () =>
    editorOpen.value &&
    JSON.stringify([playersText.value, prizesText.value]) !== editorBaseline.value,
);
const registerGuard = inject('registerNavigationGuard', null);
const unregister = registerGuard?.(
  () =>
    !saving.value &&
    !resetting.value &&
    (!playing.value || window.confirm('抽獎進行中（結果已保存），確定要離開嗎？')) &&
    (!editorDirty.value || window.confirm('抽獎名單有尚未儲存的修改，確定要離開嗎？')),
);

const mode = computed(
  () => LOTTERY_MODES.find((item) => item.key === modeKey.value) || LOTTERY_MODES[0],
);
const prizes = computed(() => board.value?.prizes || []);
const remainingPrizes = computed(() => prizes.value.filter((prize) => !prize.winner).length);
const drawnCount = computed(() => prizes.value.length - remainingPrizes.value);
const selectedPrize = computed(
  () => prizes.value.find((prize) => prize.id === selectedId.value) || null,
);
const runners = computed(() => (board.value ? lotteryRunners(board.value) : []));
const canStart = computed(
  () =>
    !playing.value &&
    !!selectedPrize.value &&
    !selectedPrize.value.winner &&
    runners.value.length > 0,
);
const busy = computed(() => playing.value || saving.value || resetting.value);
const editorLines = (text) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
const editorPlayers = computed(() => editorLines(playersText.value));
const editorPrizes = computed(() => editorLines(prizesText.value));

function readMode() {
  try {
    const stored = globalThis.localStorage?.getItem(MODE_STORAGE_KEY);
    if (LOTTERY_MODES.some((item) => item.key === stored)) return stored;
  } catch {}
  return LOTTERY_MODES[0].key;
}
function pickMode(key) {
  if (playing.value) return;
  modeKey.value = key;
  try {
    globalThis.localStorage?.setItem(MODE_STORAGE_KEY, key);
  } catch {}
}
function applyBoard(next) {
  board.value = next;
  const current = next.prizes.find((prize) => prize.id === selectedId.value);
  if (!current || current.winner)
    selectedId.value = next.prizes.find((prize) => !prize.winner)?.id || null;
  if (!playing.value) stageNames.value = lotteryRunners(next);
}
async function load() {
  if (playing.value) return;
  const version = ++loadVersion;
  loading.value = !board.value;
  error.value = '';
  try {
    const data = await client.getLottery();
    if (disposed || version !== loadVersion) return;
    applyBoard(data.lottery);
  } catch (cause) {
    if (!disposed && version === loadVersion) error.value = cause.message;
  } finally {
    if (!disposed && version === loadVersion) loading.value = false;
  }
}

function later(work, delay) {
  const id = setTimeout(() => {
    timers = timers.filter((value) => value !== id);
    if (!disposed) work();
  }, delay);
  timers.push(id);
}

async function start() {
  const prize = selectedPrize.value;
  if (!canStart.value || !prize) return;
  playing.value = true;
  drawing.value = true;
  actionError.value = '';
  notice.value = '';
  commentary.value = '抽籤中…';
  let data;
  try {
    data = await client.drawPrize(prize.id);
  } catch (cause) {
    if (disposed) return;
    drawing.value = false;
    playing.value = false;
    commentary.value = '';
    actionError.value = cause.message;
    if (['LOTTERY_PRIZE_NOT_FOUND', 'LOTTERY_NO_RUNNERS'].includes(cause.code)) load();
    return;
  }
  if (disposed) return;
  drawing.value = false;
  if (data.draw.already) {
    playing.value = false;
    commentary.value = '';
    notice.value = `「${data.draw.prize}」已由其他人抽出，得獎者：${data.draw.winner}`;
    applyBoard(data.lottery);
    return;
  }
  // Keep the saved result off the prize list until the show reveals it.
  pendingBoard = data.lottery;
  const names = shuffle(data.draw.runners);
  stageNames.value = names;
  leader.value = '';
  live.value = true;
  // Let the stage render the drawn runners in full-screen before it starts.
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
  if (disposed || !stage.value) return;
  await stage.value.play(names.indexOf(data.draw.winner));
  if (!disposed) showResult(data.draw.winner, data.draw.prize);
}

function showResult(winner, prize) {
  result.value = { winner, prize };
  resultOpen.value = true;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  const colors = ['#1d4ed8', '#b91c1c', '#047857', '#b45309', '#9932cc', '#00bfff'];
  confetti.value = Array.from({ length: 90 }, (_value, index) => ({
    id: `${Date.now()}-${index}`,
    left: `${Math.random() * 100}vw`,
    background: colors[index % colors.length],
    duration: `${2.2 + Math.random() * 2}s`,
    delay: `${Math.random() * 0.6}s`,
  }));
  later(() => (confetti.value = []), 5000);
}
function finish() {
  resultOpen.value = false;
  live.value = false;
  leader.value = '';
  commentary.value = '';
  playing.value = false;
  if (pendingBoard) applyBoard(pendingBoard);
  pendingBoard = null;
}

function openEditor() {
  if (busy.value || !board.value) return;
  editorOrigin = document.activeElement;
  playersText.value = board.value.players.join('\n');
  prizesText.value = board.value.prizes.map((prize) => prize.name).join('\n');
  editorBaseline.value = JSON.stringify([playersText.value, prizesText.value]);
  editorError.value = '';
  editorFields.value = {};
  editorOpen.value = true;
}
function closeEditor() {
  if (saving.value || importing.value) return;
  if (editorDirty.value && !window.confirm('抽獎名單有尚未儲存的修改，確定要關閉嗎？')) return;
  editorOpen.value = false;
}
function restoreEditorFocus() {
  if (editorOrigin?.isConnected) editorOrigin.focus();
}
async function importMembers(field) {
  importing.value = true;
  editorError.value = '';
  try {
    const { members } = await memberClient.getMembers();
    const existing = new Set(editorPlayers.value);
    const added = members
      .filter((member) => member[field])
      .map((member) => member.name)
      .filter((name) => !existing.has(name) && existing.add(name));
    if (added.length) playersText.value = [...editorPlayers.value, ...added].join('\n');
    editorError.value = added.length ? '' : '沒有可帶入的新名稱';
  } catch (cause) {
    editorError.value = cause.message;
  } finally {
    importing.value = false;
  }
}
async function saveEditor() {
  editorFields.value = {};
  editorError.value = '';
  if (editorPlayers.value.length > LOTTERY_MAX_PLAYERS)
    editorFields.value = { players: `最多 ${LOTTERY_MAX_PLAYERS} 位參加人員` };
  if (editorPrizes.value.length > LOTTERY_MAX_PRIZES)
    editorFields.value = { ...editorFields.value, prizes: `最多 ${LOTTERY_MAX_PRIZES} 個獎品` };
  if (Object.keys(editorFields.value).length) return;
  saving.value = true;
  try {
    const data = await client.saveLottery({
      players: editorPlayers.value,
      prizes: editorPrizes.value,
      revision: board.value.revision,
    });
    applyBoard(data.lottery);
    editorOpen.value = false;
    notice.value = `抽獎名單已儲存：${data.lottery.players.length} 位參加人員、${data.lottery.prizes.length} 個獎品。`;
  } catch (cause) {
    editorError.value = cause.message;
    editorFields.value = cause.fields || {};
  } finally {
    saving.value = false;
  }
}

async function confirmReset() {
  resetting.value = true;
  actionError.value = '';
  try {
    const data = await client.resetLottery(board.value.revision);
    selectedId.value = null;
    applyBoard(data.lottery);
    resetOpen.value = false;
    notice.value = '已清空所有得獎紀錄，可以重新開始抽獎。';
  } catch (cause) {
    resetOpen.value = false;
    actionError.value = cause.message;
  } finally {
    resetting.value = false;
  }
}

onMounted(load);
onUnmounted(() => {
  disposed = true;
  unregister?.();
  timers.forEach(clearTimeout);
});
</script>

<template>
  <section class="page-heading" aria-labelledby="lottery-title">
    <div>
      <p class="eyebrow">GUILD MANAGER <span class="eyebrow-divider">/</span> 幫會活動</p>
      <h1 id="lottery-title">抽獎活動<span class="heading-dot">.</span></h1>
      <p class="page-subtitle">
        選一種玩法，每個獎品抽一次；結果由伺服器先決定並保存，動畫只負責揭曉。
      </p>
    </div>
    <v-btn variant="outlined" :prepend-icon="mdiRefresh" :disabled="loading || busy" @click="load"
      >重新載入</v-btn
    >
  </section>
  <v-alert
    v-if="notice"
    type="success"
    variant="tonal"
    role="status"
    class="mb-4"
    closable
    @click:close="notice = ''"
    >{{ notice }}</v-alert
  >
  <v-alert
    v-if="actionError"
    type="error"
    variant="tonal"
    role="alert"
    class="mb-4"
    closable
    @click:close="actionError = ''"
    >{{ actionError }}</v-alert
  >
  <DataLoading v-if="loading">正在載入抽獎名單…</DataLoading>
  <v-alert v-else-if="error" type="error" variant="tonal" role="alert"
    >{{ error }} <v-btn variant="text" @click="load">重試</v-btn></v-alert
  >
  <div v-else-if="board" class="lottery-layout">
    <v-card class="lottery-card lottery-prizes">
      <div class="section-header">
        <h2>獎品</h2>
        <span class="lottery-muted">剩 {{ remainingPrizes }} / {{ prizes.length }}</span>
      </div>
      <div class="lottery-actions">
        <v-btn
          variant="outlined"
          :prepend-icon="mdiPencilOutline"
          :disabled="busy"
          @click="openEditor"
          >編輯名單</v-btn
        >
        <v-btn
          variant="outlined"
          color="error"
          :prepend-icon="mdiRestore"
          :disabled="busy || !drawnCount"
          @click="resetOpen = true"
          >清空得獎紀錄</v-btn
        >
      </div>
      <p v-if="!prizes.length" class="lottery-state">
        尚無獎品，請按「編輯名單」加入參加人員與獎品。
      </p>
      <ol v-else class="prize-list" aria-label="獎品清單">
        <li v-for="(prize, index) in prizes" :key="prize.id">
          <button
            type="button"
            class="prize-item"
            :class="{ 'prize-selected': prize.id === selectedId, 'prize-done': prize.winner }"
            :aria-pressed="prize.id === selectedId"
            :disabled="!!prize.winner || playing"
            @click="selectedId = prize.id"
          >
            <span class="prize-number">{{ index + 1 }}</span>
            <span class="prize-name">{{ prize.name }}</span>
            <span v-if="prize.winner" class="prize-winner"
              ><v-icon :icon="mdiTrophyOutline" size="16" />{{ prize.winner }}</span
            >
          </button>
        </li>
      </ol>
    </v-card>

    <v-card class="lottery-card lottery-stage" :class="{ 'lottery-live': live }">
      <div v-if="!live" class="mode-picker" role="radiogroup" aria-label="抽獎玩法">
        <button
          v-for="item in LOTTERY_MODES"
          :key="item.key"
          type="button"
          role="radio"
          class="mode-card"
          :class="{ 'mode-active': item.key === mode.key }"
          :aria-checked="item.key === mode.key"
          :disabled="playing"
          @click="pickMode(item.key)"
        >
          <span class="mode-emoji" aria-hidden="true">{{ item.emoji }}</span>
          <span class="mode-text">
            <strong>{{ item.title }}</strong>
            <span>{{ item.description }}</span>
          </span>
        </button>
      </div>
      <div class="stage-top">
        <div class="stage-head">
          <p class="now-prize">
            <template v-if="selectedPrize || live">
              本場獎品：<strong>{{ selectedPrize?.name }}</strong>
              <span class="lottery-muted"> · {{ stageNames.length }} 位參加</span>
              <span v-if="live && leader" class="now-leader">
                · 目前領先：<strong>{{ leader }}</strong></span
              >
            </template>
            <template v-else-if="prizes.length">獎品全部抽完了 🎉</template>
            <template v-else>尚未設定獎品</template>
          </p>
          <v-btn
            v-if="!live"
            color="primary"
            size="large"
            :prepend-icon="mdiPlay"
            :loading="drawing"
            :disabled="!canStart"
            @click="start"
            >{{ mode.start }}</v-btn
          >
        </div>
        <p class="commentary" aria-live="off">{{ commentary }}</p>
      </div>
      <p v-if="selectedPrize && !runners.length && !playing" class="lottery-state">
        所有參加人員都已經中獎了
      </p>
      <p v-else-if="!board.players.length" class="lottery-state">
        尚無參加人員，請按「編輯名單」加入。
      </p>
      <component
        :is="mode.component"
        v-else
        :key="mode.key"
        ref="stage"
        :names="stageNames"
        :live="live"
        @say="commentary = $event"
        @leader="leader = $event"
      />
    </v-card>
  </div>

  <div class="confetti-layer" aria-hidden="true">
    <span
      v-for="piece in confetti"
      :key="piece.id"
      class="confetti"
      :style="{
        left: piece.left,
        background: piece.background,
        animationDuration: piece.duration,
        animationDelay: piece.delay,
      }"
    ></span>
  </div>

  <v-dialog v-model="resultOpen" persistent max-width="640" aria-labelledby="lottery-result-title">
    <v-card class="result-card">
      <p id="lottery-result-title" class="result-label">🏆 冠軍</p>
      <p class="result-name">{{ result?.winner }}</p>
      <p class="result-prize">
        抽中 <strong>{{ result?.prize }}</strong>
      </p>
      <v-btn color="primary" size="large" @click="finish">請大家恭喜他！</v-btn>
    </v-card>
  </v-dialog>

  <v-dialog
    v-model="resetOpen"
    :persistent="resetting"
    max-width="460"
    aria-labelledby="lottery-reset-title"
  >
    <v-card class="lottery-dialog">
      <h2 id="lottery-reset-title">清空得獎紀錄？</h2>
      <p>將清除 {{ drawnCount }} 個已抽出獎品的得獎者，參加人員與獎品清單保留，可以重新開始抽。</p>
      <div class="dialog-actions">
        <v-btn variant="text" :disabled="resetting" @click="resetOpen = false">取消</v-btn>
        <v-btn color="error" :loading="resetting" @click="confirmReset">清空</v-btn>
      </div>
    </v-card>
  </v-dialog>

  <v-dialog
    :model-value="editorOpen"
    persistent
    max-width="760"
    aria-labelledby="lottery-editor-title"
    @update:model-value="!$event && closeEditor()"
    @keydown.esc="closeEditor"
    @after-leave="restoreEditorFocus"
  >
    <v-card class="lottery-dialog">
      <h2 id="lottery-editor-title">編輯抽獎名單</h2>
      <p class="lottery-muted">
        每行一筆。參加人員重複的名稱只會參賽一次；獎品由上往下抽，可重複同名獎品。已抽出的獎品若名稱仍保留，得獎者會跟著保留。
      </p>
      <v-alert v-if="editorError" type="error" variant="tonal" role="alert" class="mb-4">{{
        editorError
      }}</v-alert>
      <div class="editor-grid">
        <div>
          <v-textarea
            v-model="playersText"
            label="參加人員"
            variant="outlined"
            rows="10"
            spellcheck="false"
            :disabled="saving || importing"
            :error-messages="editorFields.players"
            :hint="`${editorPlayers.length} 位，最多 ${LOTTERY_MAX_PLAYERS} 位`"
            persistent-hint
          />
          <div class="editor-import">
            <v-btn
              variant="text"
              size="small"
              :prepend-icon="mdiAccountMultiplePlus"
              :loading="importing"
              :disabled="saving"
              @click="importMembers('isInGuild')"
              >帶入幫會成員</v-btn
            >
            <v-btn
              variant="text"
              size="small"
              :prepend-icon="mdiAccountMultiplePlus"
              :loading="importing"
              :disabled="saving"
              @click="importMembers('isInClub')"
              >帶入俱樂部成員</v-btn
            >
          </div>
        </div>
        <v-textarea
          v-model="prizesText"
          label="獎品"
          variant="outlined"
          rows="10"
          spellcheck="false"
          :disabled="saving || importing"
          :error-messages="editorFields.prizes"
          :hint="`${editorPrizes.length} 個，最多 ${LOTTERY_MAX_PRIZES} 個`"
          persistent-hint
        />
      </div>
      <div class="dialog-actions">
        <v-btn variant="text" :disabled="saving || importing" @click="closeEditor">取消</v-btn>
        <v-btn color="primary" :loading="saving" :disabled="importing" @click="saveEditor">{{
          saving ? '儲存中…' : '儲存名單'
        }}</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.lottery-layout {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}
.lottery-card {
  padding: 24px;
  min-width: 0;
}
.lottery-muted,
.lottery-state {
  color: var(--color-text-muted);
}
.lottery-state {
  padding: 16px 0;
}
.lottery-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}
.prize-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 8px;
}
.prize-item {
  width: 100%;
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: #fff;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}
.prize-item:hover:not(:disabled) {
  border-color: #93c5fd;
}
.prize-item:focus-visible {
  outline: 2px solid #1d4ed8;
  outline-offset: 2px;
}
.prize-selected {
  border-color: #1d4ed8;
  background: #eff6ff;
}
.prize-done {
  cursor: default;
  background: #f8fafc;
}
.prize-done .prize-name {
  color: var(--color-text-muted);
}
.prize-item:disabled:not(.prize-done) {
  cursor: default;
}
.prize-number {
  min-width: 22px;
  color: var(--color-text-muted);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.prize-name {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.prize-winner {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #b45309;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}
.stage-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.now-prize {
  flex: 1;
  min-width: 200px;
  margin: 0;
  font-size: 17px;
}
.now-prize strong {
  color: #1d4ed8;
}
.mode-picker {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}
.mode-card {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 72px;
  padding: 12px 16px;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  background: #fff;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}
.mode-card:hover:not(:disabled) {
  border-color: #93c5fd;
}
.mode-card:focus-visible {
  outline: 2px solid #1d4ed8;
  outline-offset: 2px;
}
.mode-active {
  border-color: #1d4ed8;
  background: #eff6ff;
}
.mode-emoji {
  font-size: 34px;
  line-height: 1;
}
.mode-text {
  display: grid;
  gap: 2px;
}
.mode-text span {
  color: var(--color-text-muted);
  font-size: 13px;
}
.commentary {
  min-height: 34px;
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 700;
}
.now-leader {
  white-space: nowrap;
}
.now-prize .now-leader strong {
  color: #b45309;
}
/* During the race the stage fills the viewport so long rosters stay visible. */
.lottery-live.v-card {
  animation: lottery-enter 0.45s ease-out;
  position: fixed;
  inset: 0;
  z-index: 2000;
  border-radius: 0;
  border: 0;
  overflow: auto;
  padding: 12px 16px;
  background: var(--color-page, #f7f9fc);
}
@keyframes lottery-enter {
  from {
    opacity: 0;
    transform: scale(0.98);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.lottery-live .stage-top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
  grid-template-areas: 'head commentary';
  align-items: center;
  gap: 4px 24px;
  margin-bottom: 10px;
}
.lottery-live .stage-head {
  grid-area: head;
  margin-bottom: 0;
}
.lottery-live .now-prize {
  flex: none;
  font-size: 26px;
  font-weight: 700;
}
/* Live play-by-play sits top-right in large type; a fixed two-line box keeps the track still. */
.lottery-live .commentary {
  grid-area: commentary;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: 2.6em;
  margin: 0;
  padding: 6px 20px;
  border: 1px solid #bfdbfe;
  border-radius: 16px;
  background: #eff6ff;
  color: #0f172a;
  font-size: 38px;
  line-height: 1.25;
  text-align: right;
  overflow-wrap: anywhere;
}
.lottery-live .commentary:empty {
  visibility: hidden;
}
.confetti-layer {
  position: fixed;
  inset: 0;
  z-index: 2500;
  overflow: hidden;
  pointer-events: none;
}
.confetti {
  position: absolute;
  top: -12px;
  width: 9px;
  height: 14px;
  animation: lottery-fall linear forwards;
}
@keyframes lottery-fall {
  to {
    transform: translateY(110vh) rotate(720deg);
  }
}
.result-card {
  padding: 40px 32px;
  text-align: center;
}
.result-label {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 8px;
}
.result-name {
  margin: 12px 0 8px;
  color: #b45309;
  font-size: 56px;
  font-weight: 800;
  line-height: 1.15;
  overflow-wrap: anywhere;
}
.result-prize {
  margin: 0 0 24px;
  font-size: 26px;
  overflow-wrap: anywhere;
}
.lottery-dialog {
  padding: 28px;
}
.lottery-dialog h2 {
  margin-bottom: 8px;
}
.editor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-top: 16px;
}
.editor-import {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
@media (prefers-reduced-motion: reduce) {
  .lottery-live.v-card {
    animation: none;
  }
}
@media (max-width: 900px) {
  .lottery-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 600px) {
  .lottery-card,
  .lottery-dialog {
    padding: 16px;
  }
  .mode-picker {
    grid-template-columns: minmax(0, 1fr);
  }
  .stage-head .v-btn {
    flex: 1 1 100%;
  }
  .commentary {
    font-size: 18px;
  }
  .lottery-live .stage-top {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'head'
      'commentary';
  }
  .lottery-live .now-prize {
    font-size: 20px;
  }
  .lottery-live .commentary {
    justify-content: center;
    font-size: 24px;
    text-align: center;
  }
  .result-name {
    font-size: 40px;
  }
  .result-prize {
    font-size: 20px;
  }
  .editor-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
