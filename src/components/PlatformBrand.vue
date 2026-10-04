<script setup>
defineProps({
  name: { type: String, required: true },
  // No placeholder is shown until an admin saves a platform icon.
  iconSrc: { type: String, default: null },
});
defineEmits(['home']);
</script>

<template>
  <button class="brand" type="button" aria-label="回到行事曆首頁" @click="$emit('home')">
    <span v-if="iconSrc" class="brand-mark"><img :src="iconSrc" alt="" /></span>
    <span class="brand-text"><strong :title="name">{{ name }}</strong></span>
  </button>
</template>
