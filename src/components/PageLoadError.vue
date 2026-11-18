<script setup>
function reload() {
  window.location.reload();
}
</script>

<template>
  <v-alert type="error" variant="tonal" role="alert">
    頁面載入失敗, 請重新載入後再試
    <v-btn variant="text" @click="reload">重新載入頁面</v-btn>
  </v-alert>
</template>
