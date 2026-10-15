<script setup>
// 賽馬玩法。玩法元件共同介面見 modes.js。
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { commentary as raceLine, mishapFx } from '../../domain/lottery-commentary.js';
import {
  AFTER_MS,
  RACE_ICONS,
  RACE_MS,
  horseClock,
  planRace,
  raceIcon,
} from '../../domain/lottery-race.js';

const props = defineProps({ names: { type: Array, default: () => [] }, live: Boolean });
const emit = defineEmits(['say', 'leader']);
const ICON_STORAGE_KEY = 'guild-lottery-icon';

const iconKey = ref(readIcon()),
  lanes = ref([]),
  countdownText = ref(''),
  running = ref(false);
const track = ref(null);
const horseElements = [],
  runElements = [];
let frame = 0,
  timers = [],
  disposed = false;

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
  const room = props.live ? window.innerHeight - top - 14 : Math.max(360, window.innerHeight - 260);
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

function play(winnerIndex) {
  const names = props.names.slice();
  const winner = names[winnerIndex];
  running.value = true;
  showLanes(names);
  emit('leader', '');
  emit('say', '各就各位…');
  const { plans, rank } = planRace(names, winner);
  // Each runner's own animal picks its lines, so 動物大亂鬥 mixes them naturally.
  const animalOf = (name) => raceIcon(name, iconKey.value);
  let lastSay = -1e9,
    saidSprint = false,
    saidWin = false,
    lastBoard = 0;
  const say = (text, now, force) => {
    // Once the winner crosses, later mishaps of slower runners must not replace that line.
    if (saidWin || (!force && now - lastSay < 1100)) return;
    lastSay = now;
    emit('say', text);
  };
  return new Promise((resolve) => {
    nextTick(() =>
      countdown(() => {
        lanes.value.forEach((lane) => (lane.state = 'gallop'));
        say(raceLine('start', { animal: iconKey.value === 'zoo' ? null : animalOf('') }), 0, true);
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
                  const type =
                    event.start === 0 && event.type === 'sleep' ? 'lateStart' : event.type;
                  say(raceLine(type, { name, animal: animalOf(name) }), t, false);
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
            // Finished runners all sit at 1; their planned rank keeps the leader correct.
            const first = positions
              .map((_x, index) => index)
              .reduce((best, index) =>
                positions[index] > positions[best] ||
                (positions[index] === positions[best] && rank[names[index]] < rank[names[best]])
                  ? index
                  : best,
              );
            emit('leader', names[first]);
            if (!saidSprint && positions[first] > 0.85) {
              saidSprint = true;
              say(
                raceLine('sprint', { name: names[first], animal: animalOf(names[first]) }),
                t,
                true,
              );
            }
          }
          if (!saidWin && t >= RACE_MS) {
            say(raceLine('win', { name: winner, animal: animalOf(winner) }), t, true);
            saidWin = true;
          }
          if (t < RACE_MS + AFTER_MS && done.size < names.length)
            frame = requestAnimationFrame(step);
          else {
            lanes.value.forEach((lane) => (lane.state = ''));
            emit('leader', winner);
            running.value = false;
            resolve();
          }
        };
        frame = requestAnimationFrame(step);
      }),
    );
  });
}

function setHorse(index, element) {
  if (element) horseElements[index] = element;
}
function setRun(index, element) {
  if (element) runElements[index] = element;
}

watch(
  () => props.names.join('\n'),
  () => {
    if (!running.value) showLanes(props.names);
  },
  { immediate: true },
);
watch(
  () => props.live,
  () => nextTick(sizeTrack),
);
const resize = () => sizeTrack();
onMounted(() => window.addEventListener('resize', resize));
onUnmounted(() => {
  disposed = true;
  cancelAnimationFrame(frame);
  timers.forEach(clearTimeout);
  window.removeEventListener('resize', resize);
});
defineExpose({ play });
</script>

<template>
  <div class="race-stage">
    <v-select
      v-if="!live"
      class="icon-select"
      :model-value="iconKey"
      :items="RACE_ICONS.map((icon) => ({ title: icon.label, value: icon.key }))"
      label="賽跑角色"
      variant="outlined"
      density="compact"
      hide-details
      @update:model-value="pickIcon"
    />
    <div ref="track" class="track">
      <p v-if="!lanes.length" class="track-empty">沒有可參賽的人</p>
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
            ><span class="horse-fx">{{ mishapFx(lane.state, raceIcon(lane.name, iconKey)) }}</span>
          </div>
          <span v-if="lane.place" class="place" :class="{ 'place-first': lane.place === 1 }">{{
            lane.place === 1 ? '🏆' : `#${lane.place}`
          }}</span>
        </div>
      </div>
    </div>
    <div v-if="countdownText" class="race-countdown" aria-hidden="true">
      <span :key="countdownText">{{ countdownText }}</span>
    </div>
  </div>
</template>

<style scoped>
.icon-select {
  max-width: 220px;
  margin-bottom: 12px;
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
  padding: 16px 0;
  color: var(--color-text-muted);
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
@media (max-width: 600px) {
  .lane-name {
    width: 90px;
    padding: 0 5px;
  }
  .icon-select {
    max-width: none;
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
