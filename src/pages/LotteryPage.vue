<script setup>
import DataLoading from '../components/DataLoading.vue';
import { computed, inject, nextTick, onMounted, onUnmounted, ref } from 'vue';
import {
  mdiRefresh,
  mdiPencilOutline,
  mdiRestore,
  mdiFlagCheckered,
  mdiTrophyOutline,
  mdiAccountMultiplePlus,
} from '@mdi/js';
import { createLotteryClient } from '../api/lottery.js';
import { createMemberClient } from '../api/members.js';
import { LOTTERY_MAX_PLAYERS, LOTTERY_MAX_PRIZES, lotteryRunners } from '../domain/lottery.js';
import {
  AFTER_MS,
  MISHAPS,
  RACE_ICONS,
  RACE_MS,
  horseClock,
  planRace,
  raceIcon,
  shuffle,
} from '../domain/lottery-race.js';

const source = import.meta.env.VITE_DATA_SOURCE || 'local';
const client = createLotteryClient({ source });
const memberClient = createMemberClient({ source });
const ICON_STORAGE_KEY = 'guild-lottery-icon';

const board = ref(null),
  loading = ref(true),
  error = ref(''),
  notice = ref(''),
  actionError = ref(''),
  selectedId = ref(null);
const racing = ref(false),
  drawing = ref(false),
  live = ref(false),
  lanes = ref([]),
  commentary = ref(''),
  leaders = ref([]),
  countdownText = ref('');
const result = ref(null),
  resultOpen = ref(false),
  confetti = ref([]);
const iconKey = ref(readIcon());
const track = ref(null);
const horseElements = [],
  runElements = [];
let pendingBoard = null,
  frame = 0,
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
    (!racing.value || window.confirm('比賽進行中（結果已保存），確定要離開嗎？')) &&
    (!editorDirty.value || window.confirm('抽獎名單有尚未儲存的修改，確定要離開嗎？')),
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
    !racing.value &&
    !!selectedPrize.value &&
    !selectedPrize.value.winner &&
    runners.value.length > 0,
);
const busy = computed(() => racing.value || saving.value || resetting.value);
const editorLines = (text) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
const editorPlayers = computed(() => editorLines(playersText.value));
const editorPrizes = computed(() => editorLines(prizesText.value));

function readIcon() {
  try {
    const stored = globalThis.localStorage?.getItem(ICON_STORAGE_KEY);
    if (RACE_ICONS.some((icon) => icon.key === stored)) return stored;
  } catch {}
  return 'horse';
}
function pickIcon(key) {
  iconKey.value = key;
  try {
    globalThis.localStorage?.setItem(ICON_STORAGE_KEY, key);
  } catch {}
}
function applyBoard(next) {
  board.value = next;
  const current = next.prizes.find((prize) => prize.id === selectedId.value);
  if (!current || current.winner)
    selectedId.value = next.prizes.find((prize) => !prize.winner)?.id || null;
  if (!racing.value) showLanes(lotteryRunners(next));
}
async function load() {
  if (racing.value) return;
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

// Large rosters (50–60 people) split into side-by-side columns on wide screens so
// each lane stays readable; phones keep one column and scroll.
function trackColumns(count) {
  const width = track.value?.clientWidth ?? window.innerWidth;
  if (count > 40 && width >= 1500) return 3;
  if (count > 20 && width >= 900) return 2;
  return 1;
}
function laneHeight(rows) {
  const top = track.value?.getBoundingClientRect().top ?? 0;
  const room = live.value ? window.innerHeight - top - 14 : Math.max(360, window.innerHeight - 260);
  return Math.max(14, Math.min(44, Math.floor(room / Math.max(rows, 1))));
}
function sizeTrack() {
  if (!track.value) return;
  const columns = trackColumns(lanes.value.length);
  const rows = Math.max(1, Math.ceil(lanes.value.length / columns));
  const height = laneHeight(rows);
  track.value.style.setProperty('--columns', columns);
  track.value.style.setProperty('--rows', rows);
  track.value.style.setProperty('--lane-h', `${height}px`);
  track.value.style.setProperty('--name-fs', `${Math.min(20, Math.max(13, height))}px`);
}
function showLanes(names) {
  horseElements.length = 0;
  runElements.length = 0;
  lanes.value = names.map((name) => ({ name, state: '', place: 0 }));
  nextTick(sizeTrack);
}

function later(work, delay) {
  const id = setTimeout(() => {
    timers = timers.filter((value) => value !== id);
    if (!disposed) work();
  }, delay);
  timers.push(id);
}
function countdown(done) {
  const steps = ['3', '2', '1', 'GO!'];
  let index = 0;
  const next = () => {
    if (index >= steps.length) {
      countdownText.value = '';
      done();
      return;
    }
    countdownText.value = steps[index++];
    later(next, index === steps.length ? 500 : 800);
  };
  next();
}

async function startRace() {
  const prize = selectedPrize.value;
  if (!canStart.value || !prize) return;
  racing.value = true;
  drawing.value = true;
  actionError.value = '';
  notice.value = '';
  commentary.value = '抽籤中…';
  try {
    const data = await client.drawPrize(prize.id);
    if (disposed) return;
    drawing.value = false;
    if (data.draw.already) {
      racing.value = false;
      commentary.value = '';
      notice.value = `「${data.draw.prize}」已由其他人抽出，得獎者：${data.draw.winner}`;
      applyBoard(data.lottery);
      return;
    }
    // Keep the saved result off the prize list until the race reveals it.
    pendingBoard = data.lottery;
    runRace(shuffle(data.draw.runners), data.draw.winner, data.draw.prize);
  } catch (cause) {
    if (disposed) return;
    drawing.value = false;
    racing.value = false;
    commentary.value = '';
    actionError.value = cause.message;
    if (['LOTTERY_PRIZE_NOT_FOUND', 'LOTTERY_NO_RUNNERS'].includes(cause.code)) load();
  }
}

function runRace(names, winner, prizeName) {
  live.value = true;
  showLanes(names);
  leaders.value = [];
  commentary.value = '各就各位…';
  const { plans, rank } = planRace(names, winner);
  const pickLine = (lines) => lines[Math.floor(Math.random() * lines.length)];
  let lastSay = -1e9,
    saidSprint = false,
    saidWin = false,
    lastBoard = 0;
  const say = (text, now, force) => {
    if (!force && now - lastSay < 1100) return;
    lastSay = now;
    commentary.value = text;
  };
  nextTick(() =>
    countdown(() => {
      lanes.value.forEach((lane) => (lane.state = 'gallop'));
      say('比賽開始！', 0, true);
      const start = performance.now();
      const done = new Set();
      const step = (now) => {
        if (disposed) return;
        const t = now - start;
        const positions = names.map((name, index) => {
          const plan = plans[index];
          const lane = lanes.value[index];
          let x = done.has(index) ? 1 : plan.profile(horseClock(t, plan.events));
          let state = '';
          if (!done.has(index)) {
            const event = plan.events.find(
              (item) => t >= item.start && t < item.start + item.duration,
            );
            if (event) {
              const progress = (t - event.start) / event.duration;
              if (event.type === 'back') {
                x -= 0.09 * Math.sin(Math.PI * progress);
                state = progress < 0.5 ? 'back' : '';
              } else state = event.type;
              if (!event.said) {
                event.said = true;
                const line =
                  event.start === 0 && event.type === 'sleep'
                    ? '{n} 起跑還在睡…'
                    : pickLine(MISHAPS[event.type].say);
                say(line.replace('{n}', name), t, false);
              }
            }
          }
          x = Math.max(0, Math.min(1, x));
          const nextState = done.has(index) ? '' : state || 'gallop';
          if (lane.state !== nextState) lane.state = nextState;
          const horse = horseElements[index],
            run = runElements[index];
          if (horse && run) {
            const width = run.clientWidth - horse.offsetWidth - 26;
            horse.style.transform = `translate(${x * width}px, -50%)`;
          }
          // Finishing order follows the planned times, so dropped frames cannot reorder it.
          if (x >= 1 && !done.has(index)) {
            done.add(index);
            lane.state = '';
            lane.place = rank[name];
          }
          return x;
        });
        if (now - lastBoard > 200) {
          lastBoard = now;
          const top = positions
            .map((_x, index) => index)
            // Finished runners all sit at 1; their planned rank keeps the podium correct.
            .sort((a, b) => positions[b] - positions[a] || rank[names[a]] - rank[names[b]])
            .slice(0, 3);
          leaders.value = top.map((index) => names[index]);
          if (!saidSprint && positions[top[0]] > 0.85) {
            saidSprint = true;
            say(`最後衝刺！${names[top[0]]} 暫時領先！`, t, true);
          }
        }
        if (!saidWin && t >= RACE_MS) {
          saidWin = true;
          say(`🏁 ${winner} 衝線奪冠！`, t, true);
        }
        if (t < RACE_MS + AFTER_MS && done.size < names.length) frame = requestAnimationFrame(step);
        else {
          lanes.value.forEach((lane) => (lane.state = ''));
          leaders.value = names
            .slice()
            .sort((a, b) => rank[a] - rank[b])
            .slice(0, 3);
          showResult(winner, prizeName);
        }
      };
      frame = requestAnimationFrame(step);
    }),
  );
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
function finishRace() {
  resultOpen.value = false;
  live.value = false;
  leaders.value = [];
  commentary.value = '';
  racing.value = false;
  if (pendingBoard) applyBoard(pendingBoard);
  pendingBoard = null;
  nextTick(sizeTrack);
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

function setHorse(index, element) {
  if (element) horseElements[index] = element;
}
function setRun(index, element) {
  if (element) runElements[index] = element;
}
const resize = () => sizeTrack();
onMounted(() => {
  window.addEventListener('resize', resize);
  load();
});
onUnmounted(() => {
  disposed = true;
  unregister?.();
  cancelAnimationFrame(frame);
  timers.forEach(clearTimeout);
  window.removeEventListener('resize', resize);
});
</script>

<template>
  <section class="page-heading" aria-labelledby="lottery-title">
    <div>
      <p class="eyebrow">GUILD MANAGER <span class="eyebrow-divider">/</span> 幫會活動</p>
      <h1 id="lottery-title">抽獎賽馬<span class="heading-dot">.</span></h1>
      <p class="page-subtitle">每個獎品跑一場，第一個衝線的人抽中；結果由伺服器先決定並保存。</p>
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
            :disabled="!!prize.winner || racing"
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
      <div class="stage-top">
        <div class="stage-head">
          <p class="now-prize">
            <template v-if="selectedPrize || live">
              本場獎品：<strong>{{ selectedPrize?.name }}</strong>
              <span class="lottery-muted"> · {{ lanes.length }} 位參賽</span>
            </template>
            <template v-else-if="prizes.length">獎品全部抽完了 🎉</template>
            <template v-else>尚未設定獎品</template>
          </p>
          <v-select
            v-if="!live"
            class="icon-select"
            :model-value="iconKey"
            :items="RACE_ICONS.map((icon) => ({ title: icon.label, value: icon.key }))"
            label="賽跑角色"
            variant="outlined"
            density="compact"
            hide-details
            :disabled="racing"
            @update:model-value="pickIcon"
          />
          <v-btn
            v-if="!live"
            color="primary"
            size="large"
            :prepend-icon="mdiFlagCheckered"
            :loading="drawing"
            :disabled="!canStart"
            @click="startRace"
            >開跑</v-btn
          >
        </div>
        <p class="commentary" aria-live="off">{{ commentary }}</p>
        <p class="leaders" aria-live="off">
          <span v-for="(name, index) in leaders" :key="index"
            >{{ ['🥇', '🥈', '🥉'][index] }} {{ name }}</span
          >
        </p>
      </div>
      <p v-if="selectedPrize && !runners.length && !racing" class="lottery-state">
        所有參加人員都已經中獎了
      </p>
      <div ref="track" class="track">
        <p v-if="!lanes.length" class="lottery-state track-empty">
          {{ board.players.length ? '沒有可參賽的人' : '尚無參加人員' }}
        </p>
        <div
          v-for="(lane, index) in lanes"
          :key="`${lane.name}-${index}`"
          class="lane"
          :class="{ 'lane-win': lane.place === 1 }"
        >
          <div class="lane-name" :title="lane.name">{{ lane.name }}</div>
          <div :ref="(element) => setRun(index, element)" class="lane-run">
            <div class="finish" aria-hidden="true"></div>
            <div
              :ref="(element) => setHorse(index, element)"
              class="horse"
              :class="lane.state"
              aria-hidden="true"
            >
              <span class="horse-body">{{ raceIcon(lane.name, iconKey) }}</span
              ><span class="horse-fx">{{ MISHAPS[lane.state]?.fx || '' }}</span>
            </div>
            <span v-if="lane.place" class="place" :class="{ 'place-first': lane.place === 1 }">{{
              lane.place === 1 ? '🏆' : `#${lane.place}`
            }}</span>
          </div>
        </div>
      </div>
    </v-card>
  </div>

  <div v-if="countdownText" class="race-countdown" aria-hidden="true">
    <span :key="countdownText">{{ countdownText }}</span>
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
      <v-btn color="primary" size="large" @click="finishRace">請大家恭喜他！</v-btn>
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
.icon-select {
  flex: 0 0 180px;
}
.commentary {
  min-height: 34px;
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 700;
}
.leaders {
  min-height: 28px;
  margin: 0 0 10px;
  font-size: 18px;
  font-weight: 700;
  color: #b45309;
}
.leaders span {
  margin-right: 20px;
  white-space: nowrap;
}
/* During the race the stage fills the viewport so long rosters stay visible. */
.lottery-live.v-card {
  position: fixed;
  inset: 0;
  z-index: 2000;
  border-radius: 0;
  border: 0;
  overflow: auto;
  padding: 12px 16px;
  background: var(--color-page, #f7f9fc);
}
.lottery-live .stage-top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
  grid-template-areas:
    'head commentary'
    'leaders commentary';
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
.lottery-live .leaders {
  grid-area: leaders;
  margin: 0;
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
.track {
  position: relative;
  display: grid;
  grid-auto-flow: column;
  grid-template-columns: repeat(var(--columns, 1), minmax(0, 1fr));
  grid-template-rows: repeat(var(--rows, 1), var(--lane-h, 40px));
  column-gap: 10px;
  overflow: hidden;
  border: 1px solid #86b49a;
  border-radius: 16px;
  background:
    repeating-linear-gradient(90deg, transparent 0 59px, rgba(255, 255, 255, 0.35) 59px 60px),
    linear-gradient(180deg, #d9f0e1, #c4e5cf);
}
.track:has(> .track-empty) {
  display: block;
}
.track-empty {
  text-align: center;
}
.lane {
  position: relative;
  display: flex;
  align-items: center;
  height: var(--lane-h, 40px);
  border-bottom: 1px dashed rgba(15, 23, 42, 0.12);
}
.lane:last-child {
  border-bottom: 0;
}
.lane-win {
  background: rgba(245, 158, 11, 0.22);
}
.lane-name {
  flex-shrink: 0;
  width: 140px;
  height: 100%;
  display: flex;
  align-items: center;
  padding: 0 8px;
  overflow: hidden;
  border-right: 2px solid rgba(15, 23, 42, 0.35);
  background: rgba(255, 255, 255, 0.75);
  font-size: var(--name-fs, 14px);
  font-weight: 700;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lane-run {
  position: relative;
  flex: 1;
  height: 100%;
}
.finish {
  position: absolute;
  top: 0;
  right: 26px;
  bottom: 0;
  width: 8px;
  background: repeating-linear-gradient(180deg, #fff 0 6px, #111 6px 12px);
  opacity: 0.85;
}
.horse {
  position: absolute;
  top: 50%;
  left: 0;
  z-index: 1;
  font-size: calc(var(--lane-h, 40px) * 1.4);
  line-height: 1;
  transform: translate(0, -50%);
  will-change: transform;
}
.horse-body {
  display: inline-block;
  transform: scaleX(-1);
}
.horse-fx {
  position: absolute;
  top: -55%;
  left: 55%;
  font-size: max(12px, 0.6em);
  animation: lottery-bob 0.5s ease-in-out infinite alternate;
}
.horse-fx:empty {
  display: none;
}
.gallop .horse-body {
  animation: lottery-gallop 0.28s ease-in-out infinite alternate;
}
.fall .horse-body {
  animation: lottery-tumble 0.35s ease-out forwards;
}
.sleep .horse-body {
  transform: scaleX(-1) rotate(10deg);
  filter: grayscale(0.5);
}
.eat .horse-body {
  animation: lottery-nibble 0.22s ease-in-out infinite alternate;
}
.back .horse-body {
  animation: lottery-gallop-back 0.24s ease-in-out infinite alternate;
}
.boost .horse-body {
  animation: lottery-gallop 0.1s ease-in-out infinite alternate;
  filter: drop-shadow(-6px 0 3px rgba(255, 120, 0, 0.8));
}
.place {
  position: absolute;
  top: 50%;
  right: 2px;
  transform: translateY(-50%);
  padding: 1px 5px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.75);
  color: #fff;
  font-size: var(--name-fs, 12px);
  font-weight: 700;
}
.place-first {
  background: #f59e0b;
  color: #0f172a;
}
@keyframes lottery-gallop {
  from {
    transform: scaleX(-1) translateY(-2px) rotate(-4deg);
  }
  to {
    transform: scaleX(-1) translateY(2px) rotate(4deg);
  }
}
@keyframes lottery-gallop-back {
  from {
    transform: translateY(-2px) rotate(4deg);
  }
  to {
    transform: translateY(2px) rotate(-4deg);
  }
}
@keyframes lottery-tumble {
  0% {
    transform: scaleX(-1) rotate(0);
  }
  60% {
    transform: scaleX(-1) rotate(-140deg) translateY(-3px);
  }
  100% {
    transform: scaleX(-1) rotate(-115deg);
  }
}
@keyframes lottery-nibble {
  from {
    transform: scaleX(-1) rotate(0);
  }
  to {
    transform: scaleX(-1) rotate(22deg);
  }
}
@keyframes lottery-bob {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(-3px);
  }
}
.race-countdown {
  position: fixed;
  inset: 0;
  z-index: 2100;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  color: #1d4ed8;
  font-size: 112px;
  font-weight: 800;
  text-shadow: 0 0 30px rgba(29, 78, 216, 0.35);
}
.race-countdown span {
  animation: lottery-pop 0.8s ease-out both;
}
@keyframes lottery-pop {
  from {
    transform: scale(2.2);
    opacity: 0;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
  to {
    transform: scale(0.9);
    opacity: 0;
  }
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
  .lane-name {
    width: 90px;
    padding: 0 5px;
  }
  .icon-select {
    flex: 1 1 100%;
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
      'commentary'
      'leaders';
  }
  .lottery-live .now-prize {
    font-size: 20px;
  }
  .lottery-live .commentary {
    justify-content: center;
    font-size: 24px;
    text-align: center;
  }
  .leaders {
    font-size: 15px;
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
@media (prefers-reduced-motion: reduce) {
  .horse-body,
  .horse-fx,
  .race-countdown span {
    animation: none !important;
  }
}
</style>
