<script setup>
import { ref } from 'vue';
import { mdiClose, mdiLogout } from '@mdi/js';

defineProps({
  modelValue: Boolean,
  items: { type: Array, default: () => [] },
  currentPage: String,
  account: String,
  busy: Boolean,
  error: String,
});
const emit = defineEmits(['update:modelValue', 'navigate', 'logout', 'closed']);
const closeButton = ref(null);
function focusClose() {
  closeButton.value?.$el?.focus({ preventScroll: true });
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    class="mobile-navigation-dialog"
    :persistent="busy"
    transition="mobile-drawer"
    aria-labelledby="mobile-navigation-title"
    @update:model-value="emit('update:modelValue', $event)"
    @after-enter="focusClose"
    @after-leave="emit('closed')"
  >
    <div class="mobile-navigation-panel">
      <div class="mobile-navigation-heading">
        <h2 id="mobile-navigation-title">功能選單</h2>
        <v-btn
          ref="closeButton"
          variant="text"
          :icon="mdiClose"
          :disabled="busy"
          aria-label="關閉導覽選單"
          @click="emit('update:modelValue', false)"
        />
      </div>
      <nav id="mobile-navigation" class="mobile-navigation-links" aria-label="手機導覽">
        <template v-for="(item, index) in items" :key="item.page">
        <p
          v-if="item.group === 'battle' && items[index - 1]?.group !== 'battle'"
          class="mobile-navigation-group"
        >戰鬥</p>
        <v-btn
          variant="text"
          :prepend-icon="item.icon"
          :class="{ 'nav-current': currentPage === item.page }"
          :aria-current="currentPage === item.page ? 'page' : undefined"
          :disabled="busy"
          @click="emit('navigate', item.page)"
        >{{ item.label }}</v-btn>
        </template>
      </nav>
      <div class="mobile-navigation-footer">
        <p v-if="account" class="mobile-navigation-account">{{ account }}</p>
        <v-alert v-if="error" type="error" variant="tonal" role="alert" class="mb-3">
          {{ error }}
        </v-alert>
        <v-btn
          block
          variant="tonal"
          :prepend-icon="mdiLogout"
          :loading="busy"
          :disabled="busy"
          @click="emit('logout')"
        >登出</v-btn>
      </div>
    </div>
  </v-dialog>
</template>
