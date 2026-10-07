<script setup>
// Decorative falling snow ported from ../game Theme.html (梨花 petals). Flakes are
// generated once; the parent decides on which pages it is shown.
const count = typeof window !== 'undefined' && window.innerWidth < 620 ? 8 : 14;
const flakes = Array.from({ length: count }, (_value, index) => {
  const size = 6 + Math.random() * 8;
  const fall = 11 + Math.random() * 9;
  const sway = 3 + Math.random() * 3;
  return {
    id: index,
    style: {
      left: `${Math.random() * 100}vw`,
      width: `${size}px`,
      height: `${size}px`,
      '--flake-opacity': (0.55 + Math.random() * 0.35).toFixed(2),
      animationDuration: `${fall}s, ${sway}s`,
      animationDelay: `-${(Math.random() * fall).toFixed(2)}s, -${(Math.random() * sway).toFixed(2)}s`,
    },
  };
});
</script>

<template>
  <div class="snow-field" aria-hidden="true">
    <span v-for="flake in flakes" :key="flake.id" class="snow-flake" :style="flake.style"></span>
  </div>
</template>

<style scoped>
.snow-field {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}
/* White core with a cool edge so flakes stay visible on the light page background. */
.snow-flake {
  position: absolute;
  top: -5vh;
  border-radius: 50%;
  opacity: 0;
  background: radial-gradient(
    circle at 35% 30%,
    #ffffff,
    #e2e8f0 55%,
    rgba(148, 163, 184, 0.6) 80%
  );
  box-shadow: 0 0 4px rgba(100, 116, 139, 0.35);
  animation-name: snow-fall, snow-sway;
  animation-timing-function: linear, ease-in-out;
  animation-iteration-count: infinite, infinite;
}
@keyframes snow-fall {
  0% {
    top: -5vh;
    opacity: 0;
  }
  6% {
    opacity: var(--flake-opacity);
  }
  92% {
    opacity: calc(var(--flake-opacity) * 0.85);
  }
  100% {
    top: 105vh;
    opacity: 0;
  }
}
@keyframes snow-sway {
  0%,
  100% {
    transform: translateX(0);
  }
  50% {
    transform: translateX(38px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .snow-field {
    display: none;
  }
}
</style>
