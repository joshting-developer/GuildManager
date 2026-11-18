<script setup>
import { ref, watch, onUnmounted } from 'vue';
const props = defineProps({ messages: { type: Array, default: () => [] } });
const visible = ref([]);
const timers = new Set();
watch(() => props.messages, messages => {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  visible.value = messages.map((text,index) => ({text,id:index}));
  // Distinct dismissal times leave the care message readable after the success notice.
  for (const item of visible.value) {
    const timer = setTimeout(() => { visible.value = visible.value.filter(v => v.id !== item.id); timers.delete(timer); }, item.id ? 10000 : 5000);
    timers.add(timer);
  }
});
onUnmounted(() => { for (const timer of timers) clearTimeout(timer); });
</script>
<template>
  <Teleport to=".v-application">
    <div class="participation-toasts" role="status" aria-live="polite" aria-atomic="true">
      <div v-for="item in visible" :key="item.id" class="participation-toast bg-surface text-on-surface">
        <span>{{ item.text }}</span>
        <v-btn variant="text" size="small" aria-label="關閉提示" @click="visible = visible.filter(v => v.id !== item.id)">關閉</v-btn>
      </div>
    </div>
  </Teleport>
</template>
<style scoped>
.participation-toasts { position: fixed; inset: auto 20px 24px auto; z-index: 2500; display: grid; gap: 12px; width: min(420px, calc(100vw - 40px)); pointer-events: none; }
.participation-toast { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 18px; border-radius: 8px; box-shadow: 0 4px 16px #0003; pointer-events: auto; }
.participation-toast span { overflow-wrap: anywhere; white-space: pre-wrap; }
@media(max-width: 600px) { .participation-toasts { inset: auto 16px 16px; width: auto; } }
</style>
