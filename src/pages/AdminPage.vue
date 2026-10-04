<script setup>
import { ref, computed, inject, onMounted, onUnmounted } from 'vue';
import { createAdminClient } from '../api/admin.js';
const client = createAdminClient({ source: import.meta.env.VITE_DATA_SOURCE || 'local' });
const settings = ref(null),
  loading = ref(true),
  busy = ref(false),
  error = ref(''),
  notice = ref('');
const tab = ref('password');
const currentPassword = ref(''),
  password = ref(''),
  passwordConfirm = ref('');
const accountKind = ref('manager');
const accountGroup = computed(() => `${accountKind.value}s`);
const managerOpen = ref(false),
  managerId = ref(null),
  managerRevision = ref(0),
  username = ref(''),
  managerPassword = ref(''),
  managerConfirm = ref('');
const dirty = computed(
  () => !!(currentPassword.value || password.value || passwordConfirm.value || managerOpen.value),
);
const registerGuard = inject('registerNavigationGuard', null);
const unregister = registerGuard?.(
  () => !busy.value && (!dirty.value || window.confirm('有尚未儲存的帳號設定, 確定要離開嗎？')),
);
let disposed = false,
  loadVersion = 0;
async function load() {
  if (busy.value) return;
  const version = ++loadVersion;
  loading.value = true;
  error.value = '';
  try {
    const result = await client.getAccounts();
    if (disposed || version !== loadVersion) return;
    if (
      result.admin?.role !== 'admin' ||
      !Array.isArray(result.managers) ||
      !Array.isArray(result.members)
    )
      throw new Error('帳號資料格式不正確, 請重新載入');
    settings.value = result;
  } catch (cause) {
    if (!disposed && version === loadVersion) error.value = cause.message;
  } finally {
    if (!disposed && version === loadVersion) loading.value = false;
  }
}
function checkPassword(value, confirmation, optional = false) {
  if (optional && !value && !confirmation) return '';
  if (value.length < 12 || value.length > 128) return '密碼長度須為 12–128 個字元';
  if (value !== confirmation) return '兩次輸入的新密碼不一致';
  return '';
}
async function changePassword() {
  if (busy.value || !settings.value) return;
  error.value = !currentPassword.value
    ? '請輸入目前密碼'
    : checkPassword(password.value, passwordConfirm.value);
  notice.value = '';
  if (error.value) return;
  busy.value = true;
  try {
    const result = await client.changePassword({
      currentPassword: currentPassword.value,
      password: password.value,
      revision: settings.value.admin.revision,
    });
    settings.value.admin = result.admin;
    currentPassword.value = password.value = passwordConfirm.value = '';
    notice.value = 'admin 密碼已更新';
  } catch (cause) {
    error.value = cause.message;
  } finally {
    busy.value = false;
  }
}
function openManager(manager = null, kind = 'manager') {
  accountKind.value = kind;
  managerId.value = manager?.id || null;
  managerRevision.value = manager?.revision || 0;
  username.value = manager?.username || '';
  managerPassword.value = managerConfirm.value = '';
  error.value = notice.value = '';
  managerOpen.value = true;
}
function closeManager() {
  if (busy.value) return;
  if (
    (managerPassword.value ||
      managerConfirm.value ||
      username.value !==
        (settings.value?.[accountGroup.value].find((m) => m.id === managerId.value)?.username ||
          '')) &&
    !window.confirm(`有尚未儲存的 ${accountKind.value} 設定, 確定要關閉嗎？`)
  )
    return;
  managerOpen.value = false;
  managerPassword.value = managerConfirm.value = '';
}
async function saveManager() {
  if (busy.value) return;
  error.value = !/^[a-zA-Z0-9_.-]{3,32}$/.test(username.value)
    ? '帳號請使用 3–32 個英數字、底線、點或減號'
    : checkPassword(managerPassword.value, managerConfirm.value, !!managerId.value);
  if (error.value) return;
  busy.value = true;
  try {
    const input = {
      username: username.value,
      password: managerPassword.value,
      revision: managerRevision.value,
    };
    const result =
      accountKind.value === 'member'
        ? managerId.value
          ? await client.updateMember(managerId.value, input)
          : await client.createMember(input)
        : managerId.value
          ? await client.updateManager(managerId.value, input)
          : await client.createManager(input);
    const account = result[accountKind.value];
    const accounts = settings.value[accountGroup.value];
    const index = accounts.findIndex((m) => m.id === account.id);
    if (index < 0) accounts.push(account);
    else accounts[index] = account;
    accounts.sort((a, b) => a.username.localeCompare(b.username));
    managerOpen.value = false;
    managerPassword.value = managerConfirm.value = '';
    notice.value = `${accountKind.value} 帳號已${managerId.value ? '更新' : '建立'}`;
  } catch (cause) {
    error.value = cause.message;
  } finally {
    busy.value = false;
  }
}
onMounted(load);
onUnmounted(() => {
  disposed = true;
  loadVersion++;
  unregister?.();
});
</script>

<template>
  <section class="page-heading" aria-labelledby="admin-title">
    <div>
      <p class="eyebrow">ACCOUNT SETTINGS</p>
      <h1 id="admin-title">帳號管理<span class="heading-dot">.</span></h1>
      <p class="page-subtitle">admin 密碼、manager 與 member 帳號設定。</p>
    </div>
    <v-btn variant="outlined" :disabled="busy || loading" @click="load">重新載入</v-btn>
  </section>
  <v-alert v-if="error && !managerOpen" type="error" variant="tonal" role="alert" class="mb-4">{{
    error
  }}</v-alert>
  <v-alert v-if="notice" type="success" variant="tonal" role="status" class="mb-4">{{
    notice
  }}</v-alert>
  <p v-if="loading" role="status">正在載入帳號設定…</p>
  <v-card v-else-if="settings" class="admin-card">
    <v-tabs v-model="tab" aria-label="帳號設定" :disabled="busy">
      <v-tab value="password" id="admin-password-tab" aria-controls="admin-password-panel"
        >admin 密碼</v-tab
      >
      <v-tab value="managers" id="admin-managers-tab" aria-controls="admin-managers-panel"
        >manager 帳號</v-tab
      >
      <v-tab value="members" id="admin-members-tab" aria-controls="admin-members-panel"
        >member 帳號</v-tab
      >
    </v-tabs>
    <section
      v-show="tab === 'password'"
      id="admin-password-panel"
      role="tabpanel"
      aria-labelledby="admin-password-tab"
    >
      <h2 class="admin-section-title">修改 {{ settings.admin.username }} 的密碼</h2>
      <form class="admin-form" @submit.prevent="changePassword">
        <v-text-field
          v-model="currentPassword"
          label="目前密碼"
          type="password"
          autocomplete="current-password"
          maxlength="128"
          variant="outlined"
          hide-details
          :disabled="busy"
          aria-required="true"
        />
        <v-text-field
          v-model="password"
          label="新密碼（12–128 字元）"
          type="password"
          autocomplete="new-password"
          maxlength="128"
          variant="outlined"
          hide-details
          :disabled="busy"
          aria-required="true"
        />
        <v-text-field
          v-model="passwordConfirm"
          label="確認新密碼"
          type="password"
          autocomplete="new-password"
          maxlength="128"
          variant="outlined"
          hide-details
          :disabled="busy"
          aria-required="true"
        />
        <v-btn type="submit" color="primary" :loading="busy" :disabled="busy">修改密碼</v-btn>
      </form>
    </section>
    <section
      v-for="kind in ['manager', 'member']"
      :key="kind"
      v-show="tab === `${kind}s`"
      :id="`admin-${kind}s-panel`"
      role="tabpanel"
      :aria-labelledby="`admin-${kind}s-tab`"
    >
      <div class="section-header admin-section-title">
        <h2>{{ kind }} 帳號</h2>
        <v-btn color="primary" :disabled="busy" @click="openManager(null, kind)"
          >建立 {{ kind }}</v-btn
        >
      </div>
      <p v-if="!settings[`${kind}s`].length">尚無 {{ kind }} 帳號</p>
      <ul v-else class="admin-manager-list">
        <li v-for="manager in settings[`${kind}s`]" :key="manager.id">
          <strong>{{ manager.username }}</strong
          ><v-btn
            variant="outlined"
            :disabled="busy"
            :aria-label="`修改 ${manager.username} 帳號`"
            @click="openManager(manager, kind)"
            >修改</v-btn
          >
        </li>
      </ul>
    </section>
  </v-card>
  <v-dialog
    :model-value="managerOpen"
    max-width="520"
    :persistent="busy"
    aria-labelledby="manager-dialog-title"
    @update:model-value="!$event && closeManager()"
  >
    <v-card class="admin-card">
      <h2 id="manager-dialog-title">{{ managerId ? '修改' : '建立' }} {{ accountKind }}</h2>
      <form class="admin-form" @submit.prevent="saveManager">
        <v-text-field
          v-model="username"
          label="帳號"
          autocomplete="off"
          maxlength="32"
          variant="outlined"
          hide-details
          :disabled="busy"
          aria-required="true"
        />
        <v-text-field
          v-model="managerPassword"
          :label="managerId ? '新密碼（留空保留原密碼）' : '密碼（12–128 字元）'"
          type="password"
          autocomplete="new-password"
          maxlength="128"
          variant="outlined"
          hide-details
          :disabled="busy"
          :aria-required="!managerId"
        />
        <v-text-field
          v-model="managerConfirm"
          label="確認密碼"
          type="password"
          autocomplete="new-password"
          maxlength="128"
          variant="outlined"
          hide-details
          :disabled="busy"
        />
        <v-alert v-if="error" type="error" variant="tonal" role="alert">{{ error }}</v-alert>
        <div class="admin-dialog-actions">
          <v-btn variant="outlined" :disabled="busy" @click="closeManager">取消</v-btn
          ><v-btn type="submit" color="primary" :loading="busy" :disabled="busy">儲存</v-btn>
        </div>
      </form>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.admin-card {
  padding: 24px;
}
.admin-section-title {
  margin: 24px 0;
}
.admin-form {
  display: grid;
  gap: 20px;
  max-width: 520px;
  margin-top: 24px;
}
.admin-form > .v-btn {
  justify-self: start;
}
.admin-manager-list {
  list-style: none;
  padding: 0;
}
.admin-manager-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 0;
  border-bottom: 1px solid var(--color-border);
}
.admin-manager-list strong {
  overflow-wrap: anywhere;
}
.admin-dialog-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 12px;
}
@media (max-width: 767px) {
  .admin-card {
    padding: 16px;
  }
}
</style>
