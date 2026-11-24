<script setup>
defineProps({
  name: { type: String, required: true },
  loading: Boolean,
  // No placeholder is shown until an admin saves a platform icon.
  iconSrc: { type: String, default: null },
});
defineEmits(['home']);
</script>

<template>
  <a class="brand" href="#/" aria-label="回到行事曆首頁" @click.left.exact.prevent="$emit('home')">
    <span v-if="iconSrc" class="brand-mark"><img :src="iconSrc" alt="" /></span>
    <span class="brand-text">
      <span v-if="loading" class="brand-placeholder" role="status" aria-label="正在載入幫會名稱"></span>
      <strong v-else :title="name">{{ name || '幫會平台' }}</strong>
    </span>
  </a>
</template>
