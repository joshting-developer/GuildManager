<script setup>
defineProps({ compact: Boolean });
</script>

<template>
  <div :class="['data-loading', { 'data-loading-compact': compact }]" role="status" aria-live="polite">
    <span class="data-loading-spinner" aria-hidden="true"></span>
    <span><slot>正在載入資料…</slot></span>
  </div>
</template>

<style scoped>
.data-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 96px;
  padding: 24px 16px;
  color: var(--color-text-muted);
  text-align: center;
}
.data-loading-spinner {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border: 3px solid #dbeafe;
  border-top-color: var(--color-primary, #1d4ed8);
  border-radius: 50%;
  animation: data-loading-spin 0.8s linear infinite;
}
.data-loading-compact {
  justify-content: flex-start;
  min-height: 44px;
  padding: 8px 16px;
  text-align: left;
  font-size: 14px;
}
.data-loading-compact .data-loading-spinner {
  width: 20px;
  height: 20px;
  border-width: 2px;
}
@keyframes data-loading-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .data-loading-spinner {
    animation: none;
  }
}
</style>
