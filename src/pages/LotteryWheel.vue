<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { WHEEL_SPIN_MS, planWheel, sliceAt, wheelEase } from '../domain/lottery-wheel.js';
import { wheelLine } from '../domain/race-commentary.js';

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
  bubble = ref('');
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
  const size = 360 / count;
  const fontSize = Math.max(12, Math.min(40, ((2 * Math.PI * RADIUS * 0.62) / count) * 0.6));
  const maxChars = Math.max(2, Math.floor((RADIUS * 0.72) / fontSize));
  return props.names.map((name, index) => {
    const start = index * size,
      end = start + size,
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
      label: name.length > maxChars ? `${name.slice(0, maxChars - 1)}…` : name,
      textTransform: `rotate(${middle - 90 + flip} ${tx} ${ty})`,
      tx,
      ty,
      fontSize,
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
  pointerGroup.value?.setAttribute('transform', `rotate(${degrees} ${CX} ${BASE_Y})`);
}
function reset() {
  cancelAnimationFrame(frame);
  timers.forEach(clearTimeout);
  timers = [];
  landed.value = lost.value = winnerSlice.value = -1;
  shaking.value = zoom.value = false;
  bubble.value = '';
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

async function spin(winnerIndex) {
  reset();
  const count = props.names.length;
  const plan = planWheel(count, winnerIndex);
  const fast = reduceMotion();
  const winner = props.names[winnerIndex],
    decoy = props.names[plan.decoy];
  emit('say', wheelLine('spin'));
  let lastSlice = sliceAt(count, 0),
    tilt = 0,
    lastAngle = 0,
    saidSlow = false;
  await animate(fast ? 2500 : WHEEL_SPIN_MS, (progress) => {
    const angle = plan.rotation * wheelEase(progress);
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

  if (plan.ending === 'normal') {
    winnerSlice.value = winnerIndex;
    emit('say', wheelLine('normal', { winner }));
  } else {
    if (!fast) {
      shaking.value = true;
      wait(500).then(() => (shaking.value = false));
    }
    bubble.value = plan.ending === 'extend' ? '!?' : '?!';
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
    bubble.value = '';
    lost.value = plan.decoy;
    landed.value = -1;
    winnerSlice.value = winnerIndex;
    emit('say', wheelLine(plan.ending === 'extend' ? 'extendWin' : 'bendWin', { winner }));
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
defineExpose({ spin, reset });
</script>

<template>
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
      <text v-if="bubble" :x="CX + 70" y="70" class="wheel-bubble">{{ bubble }}</text>
    </svg>
  </div>
</template>

<style scoped>
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
