<script setup>
import { ref, watch, nextTick } from 'vue';
import { mdiClose, mdiLogin } from '@mdi/js';
const props = defineProps({ modelValue: Boolean, busy: Boolean, error: String, source: String });
const emit = defineEmits(['update:modelValue', 'login', 'closed']);
const username = ref('');
const password = ref('');
const usernameField = ref(null);
watch(
  () => props.modelValue,
  async (open) => {
    password.value = '';
    if (open) {
      await nextTick();
      usernameField.value?.focus();
    }
  },
);
function close() {
  if (!props.busy) emit('update:modelValue', false);
}
function submit() {
  if (!props.busy && username.value.trim() && password.value) {
    emit('login', { username: username.value.trim(), password: password.value });
  }
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    :persistent="busy"
    max-width="420"
    aria-labelledby="login-title"
    @update:model-value="close"
    @after-leave="emit('closed')"
  >
    <v-card class="login-card">
      <div class="login-heading">
        <div>
          <h2 id="login-title">登入管理平台</h2>
          <p>登入後即可使用幫會管理功能</p>
        </div>
        <v-btn
          variant="text"
          :icon="mdiClose"
          aria-label="關閉登入視窗"
          :disabled="busy"
          @click="close"
        />
      </div>
      <v-alert v-if="source === 'gas'" type="info" variant="tonal" class="mb-4"
        >Google 登入尚未設定, 請先使用本機開發環境</v-alert
      >
      <form v-else @submit.prevent="submit">
        <v-text-field
          ref="usernameField"
          v-model="username"
          label="帳號"
          name="username"
          autocomplete="username"
          maxlength="32"
          :disabled="busy"
          required
        />
        <v-text-field
          v-model="password"
          label="密碼"
          name="password"
          type="password"
          autocomplete="current-password"
          maxlength="128"
          :disabled="busy"
          required
        />
        <v-alert v-if="error" type="error" variant="tonal" role="alert" class="mb-4">{{
          error
        }}</v-alert>
        <v-btn
          type="submit"
          color="primary"
          :prepend-icon="mdiLogin"
          :loading="busy"
          block
          :disabled="!username.trim() || !password"
          >登入</v-btn
        >
      </form>
    </v-card>
  </v-dialog>
</template>
