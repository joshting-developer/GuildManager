<script>
// Kept across instances so switching modes or pages can't replay the last ending.
let lastEnding = null;
</script>

<script setup>
// 轉盤玩法。玩法元件共同介面見 modes.js。
import { computed, onUnmounted, ref, watch } from 'vue';
import { WHEEL_ENDINGS, WHEEL_SPIN_MS, planWheel, sliceAt, wheelEase } from '../../domain/lottery-wheel.js';
import { wheelLine } from '../../domain/lottery-commentary.js';

const props = defineProps({ names: { type: Array, default: () => [] }, live: Boolean });
const emit = defineEmits(['say']);

// SVG geometry (viewBox units): the pointer hangs from the top, its tip just inside the rim.
const CX = 500,
  CY = 530,
  RADIUS = 430,
  TIP = 380,
  BASE_Y = 20;
const COLORS = [
  '#bfdbfe',
  '#fde68a',
  '#bbf7d0',
  '#fecaca',
  '#ddd6fe',
  '#fbcfe8',
  '#a5f3fc',
  '#fed7aa',
];

const wheelGroup = ref(null),
  pointerPath = ref(null),
  pointerGroup = ref(null);
const landed = ref(-1),
  lost = ref(-1),
  winnerSlice = ref(-1),
  shaking = ref(false),
  zoom = ref(false),
  bubble = ref(''),
  swapped = ref(null),
  ghosts = ref([]),
  flying = ref([]),
  grow = ref(null);
let rotation = 0,
  frame = 0,
  timers = [],
  disposed = false;

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const point = (angle, radius) => {
  const rad = (angle * Math.PI) / 180;
  return [CX + radius * Math.sin(rad), CY - radius * Math.cos(rad)];
};

const slices = computed(() => {
  const count = props.names.length;
  if (!count) return [];
  const base = 360 / count;
  // Size labels to the slice's width at the label radius, so small rosters get big names.
  const fontSize = Math.max(14, Math.min(52, ((2 * Math.PI * RADIUS * 0.6) / count) * 0.8));
  const maxChars = Math.max(2, Math.floor((RADIUS * 0.72) / fontSize));
  // While a slice grows the others share what is left, in order, clockwise from its far edge.
  const others = grow.value && (360 - 2 * grow.value.half) / (count - 1);
  const span = (index) => {
    if (!grow.value) return [index * base, base];
    const { index: big, half } = grow.value;
    const middle = big * base + base / 2;
    if (index === big) return [middle - half, 2 * half];
    return [middle + half + (((index - big + count) % count) - 1) * others, others];
  };
  const shown = (index) => {
    const [a, b] = swapped.value || [];
    return props.names[index === a ? b : index === b ? a : index];
  };
  return props.names.map((name, index) => {
    const [start, size] = span(index);
    const end = start + size,
      middle = start + size / 2;
    const [x1, y1] = point(start, RADIUS),
      [x2, y2] = point(end, RADIUS);
    const path =
      count === 1
        ? `M${CX - RADIUS},${CY}a${RADIUS},${RADIUS} 0 1,0 ${RADIUS * 2},0a${RADIUS},${RADIUS} 0 1,0 ${-RADIUS * 2},0`
        : `M${CX},${CY}L${x1},${y1}A${RADIUS},${RADIUS} 0 ${size > 180 ? 1 : 0},1 ${x2},${y2}Z`;
    // Labels run along the radius; the left half is flipped so nothing reads upside down.
    const flip = middle > 180 ? 180 : 0;
    const [tx, ty] = point(middle, RADIUS * 0.6);
    return {
      name,
      path,
      // Avoid the last slice matching the first one it touches.
      color:
        COLORS[(index === count - 1 && index % COLORS.length === 0 ? 3 : index) % COLORS.length],
      label: shown(index).length > maxChars ? `${shown(index).slice(0, maxChars - 1)}…` : shown(index),
      textTransform: `rotate(${middle - 90 + flip} ${tx} ${ty})`,
      tx,
      ty,
      fontSize: Math.max(10, fontSize * Math.min(1.25, size / base)),
    };
  });
});

function setRotation(value) {
  rotation = value;
  wheelGroup.value?.setAttribute('transform', `rotate(${value} ${CX} ${CY})`);
}
function setPointer(tipAngle, tipRadius, bendAmount = 0) {
  const [tx, ty] = point(tipAngle, tipRadius);
  // The control point drops toward the centre as the pointer bends, giving a noodle curve.
  const controlY = BASE_Y + (TIP - BASE_Y) * 0.25 + bendAmount * 260;
  pointerPath.value?.setAttribute('d', `M${CX},${BASE_Y} Q${CX},${controlY} ${tx},${ty}`);
}
function setTilt(degrees) {
  setPointerGroup(`rotate(${degrees} ${CX} ${BASE_Y})`);
}
function setPointerGroup(transform, opacity = 1) {
  pointerGroup.value?.setAttribute('transform', transform);
  pointerGroup.value?.setAttribute('opacity', String(opacity));
}
function reset() {
  cancelAnimationFrame(frame);
  timers.forEach(clearTimeout);
  timers = [];
  landed.value = lost.value = winnerSlice.value = -1;
  shaking.value = zoom.value = false;
  bubble.value = '';
  swapped.value = grow.value = null;
  ghosts.value = [];
  flying.value = [];
  setRotation(0);
  setPointer(0, TIP);
  setTilt(0);
}
const wait = (ms) =>
  new Promise((resolve) => {
    const id = setTimeout(() => {
      timers = timers.filter((value) => value !== id);
      if (!disposed) resolve();
    }, ms);
    timers.push(id);
  });
function animate(duration, step) {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = (now) => {
      if (disposed) return;
      const progress = Math.min(1, (now - start) / duration);
      step(progress, now);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else resolve();
    };
    frame = requestAnimationFrame(tick);
  });
}
// Elastic overshoot so the stretching / bending pointer looks springy.
const springy = (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p) * Math.cos(p * Math.PI * 3));

async function play(winnerIndex, ending) {
  reset();
  const count = props.names.length;
  const plan = planWheel(count, winnerIndex, Math.random, { ending, avoid: lastEnding });
  if (!ending) lastEnding = plan.ending;
  const fast = reduceMotion();
  const winner = props.names[winnerIndex],
    decoy = props.names[plan.decoy];
  // Hold still briefly after entering full screen so the eye can settle before it moves.
  emit('say', wheelLine('ready'));
  await wait(fast ? 300 : 1200);
  emit('say', wheelLine('spin'));
  let lastSlice = sliceAt(count, 0),
    tilt = 0,
    lastAngle = 0,
    saidSlow = false;
  await animate(fast ? 2500 : WHEEL_SPIN_MS, (progress) => {
    const angle = plan.stopRotation * wheelEase(progress);
    setRotation(angle);
    const speed = angle - lastAngle;
    lastAngle = angle;
    // Pegs flick the pointer each time a slice passes once the wheel is slow enough to see it.
    const current = sliceAt(count, angle);
    if (current !== lastSlice && speed < 9 && !fast)
      tilt = Math.min(18, 6 + 14 / Math.max(speed, 1));
    lastSlice = current;
    tilt *= 0.82;
    setTilt(tilt);
    if (!saidSlow && progress > 0.55) {
      saidSlow = true;
      emit('say', wheelLine('slow'));
    }
    if (progress > 0.82 && !fast) zoom.value = true;
  });
  setTilt(0);
  landed.value = plan.decoy;
  emit('say', wheelLine('stop', { decoy }));
  await wait(fast ? 500 : 1100);

  const reveal = (key) => {
    bubble.value = '';
    if (plan.decoy !== winnerIndex) lost.value = plan.ending === 'swap' ? winnerIndex : plan.decoy;
    landed.value = -1;
    winnerSlice.value = plan.winnerSlot;
    emit('say', wheelLine(key, { winner }));
  };
  const jolt = (mark) => {
    if (!fast) {
      shaking.value = true;
      wait(500).then(() => (shaking.value = false));
    }
    if (mark) bubble.value = mark;
  };

  if (plan.ending === 'normal') {
    reveal('normal');
  } else if (plan.ending === 'fake') {
    // Every cue of a twist, then nothing changes: "!?" no longer gives the result away.
    jolt('!?');
    emit('say', wheelLine('fake'));
    await animate(fast ? 300 : 1400, (p) => setTilt(Math.sin(p * Math.PI * 12) * 9 * (1 - p)));
    setTilt(0);
    await wait(fast ? 200 : 500);
    reveal('fakeWin');
  } else if (plan.ending === 'slip') {
    emit('say', wheelLine('slip', { winner, decoy }));
    await wait(fast ? 200 : 600);
    let lastSlice = sliceAt(count, plan.stopRotation);
    await animate(fast ? 300 : 1100, (p) => {
      const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const angle = plan.stopRotation + (plan.rotation - plan.stopRotation) * eased;
      setRotation(angle);
      const current = sliceAt(count, angle);
      setTilt(current !== lastSlice ? 14 : 0);
      lastSlice = current;
    });
    setRotation(plan.rotation);
    setTilt(0);
    reveal('slipWin');
  } else if (plan.ending === 'break') {
    jolt('!?');
    emit('say', wheelLine('break', { winner, decoy }));
    await wait(fast ? 200 : 500);
    // The old pointer drops off the top; a new one falls in over the winner, anywhere.
    await animate(fast ? 300 : 800, (p) =>
      setPointerGroup(
        `translate(${p * 70} ${p * p * 700}) rotate(${p * 95} ${CX} ${BASE_Y})`,
        1 - p,
      ),
    );
    setPointer(0, TIP);
    await wait(fast ? 100 : 400);
    await animate(fast ? 300 : 900, (p) => {
      const drop = (1 - springy(p)) * 320;
      setPointerGroup(
        `rotate(${plan.pointerAngle} ${CX} ${CY}) translate(0 ${-drop})`,
        Math.min(1, p * 2),
      );
    });
    setPointerGroup(`rotate(${plan.pointerAngle} ${CX} ${CY})`);
    reveal('breakWin');
  } else if (plan.ending === 'swap') {
    jolt('!?');
    emit('say', wheelLine('swap', { winner, decoy }));
    await wait(fast ? 200 : 700);
    // Both names lift off and pass each other in a curve across the wheel.
    const spot = (index) => point(index * plan.slice + plan.slice / 2 + plan.rotation, RADIUS * 0.6);
    const [ax, ay] = spot(plan.decoy),
      [bx, by] = spot(winnerIndex);
    const length = Math.hypot(bx - ax, by - ay) || 1,
      size = Math.max(36, slices.value[0].fontSize);
    const labels = [slices.value[plan.decoy].label, slices.value[winnerIndex].label];
    flying.value = [plan.decoy, winnerIndex];
    await animate(fast ? 300 : 1400, (p) => {
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const lift = Math.sin(p * Math.PI) * 120;
      const nx = ((by - ay) / length) * lift,
        ny = ((ax - bx) / length) * lift;
      ghosts.value = [
        { label: labels[0], x: ax + (bx - ax) * e + nx, y: ay + (by - ay) * e + ny, size },
        { label: labels[1], x: bx + (ax - bx) * e - nx, y: by + (ay - by) * e - ny, size },
      ];
    });
    swapped.value = [plan.decoy, winnerIndex];
    ghosts.value = [];
    flying.value = [];
    reveal('swapWin');
  } else if (plan.ending === 'grow') {
    jolt('?!');
    emit('say', wheelLine('grow', { winner, decoy }));
    await wait(fast ? 200 : 700);
    const from = plan.slice / 2;
    await animate(fast ? 300 : 1500, (p) => {
      const half = from + (plan.growHalf - from) * springy(p);
      grow.value = { index: winnerIndex, half: Math.min(175, half) };
    });
    grow.value = { index: winnerIndex, half: plan.growHalf };
    reveal('growWin');
  } else {
    jolt(plan.ending === 'extend' ? '!?' : '?!');
    emit('say', wheelLine(plan.ending, { winner, decoy }));
    await wait(fast ? 300 : 700);
    if (plan.ending === 'extend') {
      // Stretch from the top, through the centre, to the slice on the far side.
      await animate(fast ? 300 : 1000, (p) => {
        const length = TIP + springy(p) * TIP * 2;
        // Past the centre the tip continues on the opposite side of the circle.
        setPointer(length > TIP * 2 ? 180 : 0, Math.abs(length - TIP * 2) || 1);
      });
      setPointer(180, TIP);
    } else {
      await animate(fast ? 300 : 1200, (p) => {
        const k = springy(p);
        setPointer(plan.pointerAngle * k, TIP, Math.min(1, Math.abs(k)));
      });
      setPointer(plan.pointerAngle, TIP, 1);
    }
    reveal(plan.ending === 'extend' ? 'extendWin' : 'bendWin');
  }
  await wait(fast ? 600 : 1400);
  zoom.value = false;
  return { ending: plan.ending, decoy };
}

watch(
  () => props.names.join('\n'),
  () => reset(),
);
onUnmounted(() => {
  disposed = true;
  cancelAnimationFrame(frame);
  timers.forEach(clearTimeout);
});
defineExpose({ play });

// 本機預覽：只在 vite dev 顯示，不呼叫後端、不消耗獎品。
const PREVIEW_LABELS = {
  normal: '正常', fake: '虛驚一場', extend: '指針變長', bend: '指針彎曲',
  slip: '轉盤滑動', break: '指針斷掉', swap: '格子交換', grow: '格子放大',
};
const previewEndings = import.meta.env.DEV ? WHEEL_ENDINGS : [];
const previewing = ref(false);
async function preview(key) {
  if (previewing.value || !props.names.length) return;
  previewing.value = true;
  await play(Math.floor(Math.random() * props.names.length), key);
  previewing.value = false;
}
</script>

<template>
  <div v-if="previewEndings.length && names.length && !live" class="wheel-preview">
    <button
      v-for="item in previewEndings"
      :key="item.key"
      type="button"
      :disabled="previewing"
      @click="preview(item.key)"
    >
      {{ PREVIEW_LABELS[item.key] }}
    </button>
  </div>
  <div class="wheel-wrap" :class="{ 'wheel-live': live, 'wheel-shake': shaking }">
    <p v-if="!names.length" class="wheel-empty">尚無參加人員</p>
    <svg
      v-else
      class="wheel-svg"
      :class="{ 'wheel-zoom': zoom }"
      viewBox="0 0 1000 1000"
      role="img"
      :aria-label="`抽獎轉盤，共 ${names.length} 人`"
    >
      <defs>
        <marker
          id="wheel-arrow"
          viewBox="0 0 10 10"
          refX="6"
          refY="5"
          markerWidth="4"
          markerHeight="4"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="#b91c1c" />
        </marker>
        <filter id="wheel-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <circle :cx="CX" :cy="CY" :r="RADIUS + 14" fill="#1e293b" />
      <g ref="wheelGroup">
        <g
          v-for="(slice, index) in slices"
          :key="`${slice.name}-${index}`"
          :class="{
            'slice-landed': index === landed,
            'slice-lost': index === lost,
            'slice-winner': index === winnerSlice,
          }"
        >
          <path
            :d="slice.path"
            :fill="index === lost ? '#cbd5e1' : slice.color"
            stroke="#fff"
            stroke-width="2"
            :filter="index === winnerSlice ? 'url(#wheel-glow)' : undefined"
          />
          <text
            :x="slice.tx"
            :y="slice.ty"
            :transform="slice.textTransform"
            :font-size="slice.fontSize"
            text-anchor="middle"
            dominant-baseline="central"
            class="slice-label"
            :opacity="flying.includes(index) ? 0 : 1"
          >
            {{ slice.label }}
          </text>
        </g>
      </g>
      <circle :cx="CX" :cy="CY" r="46" fill="#fff" stroke="#1e293b" stroke-width="8" />
      <g ref="pointerGroup">
        <path
          ref="pointerPath"
          :d="`M${CX},${BASE_Y} Q${CX},${BASE_Y + (TIP - BASE_Y) * 0.25} ${CX},${CY - TIP}`"
          class="wheel-pointer"
          marker-end="url(#wheel-arrow)"
        />
        <circle :cx="CX" :cy="BASE_Y" r="16" fill="#b91c1c" />
      </g>
      <text
        v-for="ghost in ghosts"
        :key="ghost.label"
        :x="ghost.x"
        :y="ghost.y"
        :font-size="ghost.size"
        text-anchor="middle"
        dominant-baseline="central"
        class="slice-ghost"
      >
        {{ ghost.label }}
      </text>
      <text v-if="bubble" :x="CX + 70" y="70" class="wheel-bubble">{{ bubble }}</text>
    </svg>
  </div>
</template>

<style scoped>
.wheel-preview {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-bottom: 12px;
}
.wheel-preview button {
  padding: 6px 12px;
  border: 1px solid var(--color-border, #cbd5e1);
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}
.wheel-preview button:disabled {
  opacity: 0.5;
  cursor: wait;
}
.wheel-wrap {
  display: flex;
  justify-content: center;
}
.wheel-empty {
  padding: 24px 0;
  color: var(--color-text-muted);
}
.wheel-svg {
  width: min(100%, 560px);
  height: auto;
  overflow: visible;
  transition: transform 0.9s ease;
}
.wheel-live .wheel-svg {
  width: min(100%, calc(100vh - 210px));
}
.wheel-zoom {
  transform: scale(1.06);
}
.slice-label {
  fill: #0f172a;
  font-weight: 700;
  pointer-events: none;
}
.slice-landed path {
  stroke: #1d4ed8;
  stroke-width: 8;
}
.slice-winner path {
  stroke: #f59e0b;
  stroke-width: 10;
  animation: wheel-pulse 0.8s ease-in-out infinite alternate;
}
.slice-lost .slice-label {
  fill: #64748b;
}
.wheel-pointer {
  fill: none;
  stroke: #b91c1c;
  stroke-width: 18;
  stroke-linecap: round;
}
.slice-ghost {
  fill: #0f172a;
  font-weight: 800;
  stroke: #fff;
  stroke-width: 10;
  paint-order: stroke;
  pointer-events: none;
}
.wheel-bubble {
  transform-box: fill-box;
  transform-origin: center;
  fill: #b91c1c;
  font-size: 90px;
  font-weight: 800;
  animation: wheel-pop 0.4s ease-out both;
}
.wheel-shake {
  animation: wheel-shake 0.5s ease-in-out;
}
@keyframes wheel-pulse {
  from {
    opacity: 1;
  }
  to {
    opacity: 0.75;
  }
}
@keyframes wheel-pop {
  from {
    transform: scale(0.2);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
@keyframes wheel-shake {
  0%,
  100% {
    transform: translate(0, 0);
  }
  20% {
    transform: translate(-12px, 4px);
  }
  40% {
    transform: translate(10px, -6px);
  }
  60% {
    transform: translate(-8px, 6px);
  }
  80% {
    transform: translate(6px, -2px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .wheel-svg,
  .slice-winner path,
  .wheel-bubble {
    transition: none;
    animation: none;
  }
}
</style>
