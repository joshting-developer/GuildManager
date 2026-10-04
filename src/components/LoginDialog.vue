<script setup>
import { ref, watch, nextTick } from 'vue';
import { mdiClose, mdiLogin } from '@mdi/js';
const props = defineProps({
  modelValue: Boolean,
  busy: Boolean,
  error: String,
  source: String,
  initialMode: { type: String, default: 'member' },
});
const emit = defineEmits(['update:modelValue', 'login', 'closed', 'mode-change']);
const mode = ref('member');
const passwordField = ref(null);
const username = ref('');
const password = ref('');
const usernameField = ref(null);
watch(
  () => props.modelValue,
  async (open) => {
    password.value = '';
    if (open) {
      mode.value = props.initialMode;
      await nextTick();
      (mode.value === 'member' ? passwordField.value : usernameField.value)?.focus();
    }
  },
);
watch(mode, async () => {
  password.value = '';
  emit('mode-change');
  await nextTick();
  (mode.value === 'member' ? passwordField.value : usernameField.value)?.focus();
});
function close() {
  if (!props.busy) emit('update:modelValue', false);
}
function submit() {
  if (!props.busy && (mode.value === 'member' || username.value.trim()) && password.value) {
    emit(
      'login',
      mode.value === 'member'
        ? { mode: 'member', password: password.value }
        : { mode: 'manager', username: username.value.trim(), password: password.value },
    );
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
          <h2 id="login-title">登入幫會平台</h2>
          <p>{{ mode === 'member' ? '輸入通行密碼，使用報名與戰績閱覽' : '使用管理者帳號登入' }}</p>
        </div>
        <v-btn
          variant="text"
          :icon="mdiClose"
          aria-label="關閉登入視窗"
          :disabled="busy"
          @click="close"
        />
      </div>
      <v-tabs v-model="mode" color="primary" class="mb-4" :disabled="busy" aria-label="登入方式">
        <v-tab value="member" :disabled="busy">成員登入</v-tab>
        <v-tab value="manager" :disabled="busy">管理者登入</v-tab>
      </v-tabs>
      <form @submit.prevent="submit">
        <v-text-field
          v-if="mode === 'manager'"
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
          ref="passwordField"
          v-model="password"
          :label="mode === 'member' ? '通行密碼' : '密碼'"
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
          :disabled="(mode === 'manager' && !username.trim()) || !password"
          >登入</v-btn
        >
      </form>
    </v-card>
  </v-dialog>
</template>
