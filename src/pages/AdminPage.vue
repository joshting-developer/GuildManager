<script setup>
import DataLoading from '../components/DataLoading.vue';
import { ref, computed, inject, onMounted, onUnmounted } from 'vue';
import { createAdminClient } from '../api/admin.js';
import { createPlatformSettingsClient, readPlatformIcon } from '../api/platform-settings.js';
import { validatePlatformSettings, platformIconSource } from '../domain/platform-settings.js';
const emit = defineEmits(['platform-updated']);
const client = createAdminClient({
  source: import.meta.env.VITE_DATA_SOURCE || 'local',
});
const platformClient = createPlatformSettingsClient({
  source: import.meta.env.VITE_DATA_SOURCE || 'local',
});
const platform = ref(null),
  platformName = ref('');
const iconDraft = ref(undefined),
  iconReading = ref(false),
  iconInput = ref(null);
const iconPreview = computed(() =>
  iconDraft.value === undefined
    ? platform.value?.iconSrc || null
    : platformIconSource(iconDraft.value),
);
const platformDirty = computed(
  () =>
    platform.value &&
    (platformName.value !== platform.value.name ||
      (iconDraft.value !== undefined && iconPreview.value !== (platform.value.iconSrc || null))),
);
let iconReadVersion = 0;
async function chooseIcon(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || busy.value) return;
  const version = ++iconReadVersion;
  iconReading.value = true;
  error.value = notice.value = '';
  try {
    const icon = await readPlatformIcon(file);
    if (!disposed && version === iconReadVersion) iconDraft.value = icon;
  } catch (cause) {
    if (!disposed && version === iconReadVersion) error.value = cause.message;
  } finally {
    if (!disposed && version === iconReadVersion) iconReading.value = false;
  }
}
const settings = ref(null),
  loading = ref(true),
  busy = ref(false),
  error = ref(''),
  notice = ref('');
const tab = ref('password');
const currentPassword = ref(''),
  password = ref(''),
  passwordConfirm = ref('');
const tokenPassword = ref(''),
  tokenConfirm = ref('');
const managerOpen = ref(false),
  managerId = ref(null),
  managerRevision = ref(0),
  username = ref(''),
  managerPassword = ref(''),
  managerConfirm = ref('');
const dirty = computed(
  () =>
    !!(
      currentPassword.value ||
      password.value ||
      passwordConfirm.value ||
      tokenPassword.value ||
      tokenConfirm.value ||
      managerOpen.value ||
      platformDirty.value
    ),
);
const registerGuard = inject('registerNavigationGuard', null);
const unregister = registerGuard?.(
  () =>
    !busy.value &&
    !iconReading.value &&
    (!dirty.value || window.confirm('有尚未儲存的設定, 確定要離開嗎？')),
);
let disposed = false,
  loadVersion = 0;
async function load() {
  if (busy.value || iconReading.value) return;
  if (dirty.value && !window.confirm('有尚未儲存的設定，確定要重新載入嗎？')) return;
  const version = ++loadVersion;
  loading.value = true;
  error.value = '';
  try {
    const [result, platformResult] = await Promise.all([
      client.getAccounts(),
      platformClient.getSettings(),
    ]);
    if (disposed || version !== loadVersion) return;
    if (
      result.admin?.role !== 'admin' ||
      !Array.isArray(result.managers) ||
      typeof result.memberToken?.configured !== 'boolean'
    )
      throw new Error('帳號資料格式不正確, 請重新載入');
    settings.value = result;
    platform.value = platformResult.platform;
    platformName.value = platform.value.name;
    iconDraft.value = undefined;
    emit('platform-updated', platform.value);
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
async function savePlatform() {
  if (busy.value || iconReading.value || !platform.value) return;
  error.value = notice.value = '';
  try {
    validatePlatformSettings(
      { name: platformName.value, revision: platform.value.revision },
      platform.value,
    );
  } catch (cause) {
    error.value = cause.message;
    return;
  }
  busy.value = true;
  try {
    const result = await platformClient.updateSettings({
      name: platformName.value,
      revision: platform.value.revision,
      ...(iconDraft.value !== undefined ? { icon: iconDraft.value } : {}),
    });
    platform.value = result.platform;
    platformName.value = result.platform.name;
    iconDraft.value = undefined;
    emit('platform-updated', result.platform);
    notice.value = '平台設定已更新';
  } catch (cause) {
    error.value = cause.message;
  } finally {
    busy.value = false;
  }
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
function openManager(manager = null) {
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
        (settings.value?.managers.find((m) => m.id === managerId.value)?.username || '')) &&
    !window.confirm(`有尚未儲存的 manager 設定, 確定要關閉嗎？`)
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
    const result = managerId.value
      ? await client.updateManager(managerId.value, input)
      : await client.createManager(input);
    const account = result.manager;
    const accounts = settings.value.managers;
    const index = accounts.findIndex((m) => m.id === account.id);
    if (index < 0) accounts.push(account);
    else accounts[index] = account;
    accounts.sort((a, b) => a.username.localeCompare(b.username));
    managerOpen.value = false;
    managerPassword.value = managerConfirm.value = '';
    notice.value = `manager 帳號已${managerId.value ? '更新' : '建立'}`;
  } catch (cause) {
    error.value = cause.message;
  } finally {
    busy.value = false;
  }
}
async function saveToken() {
  if (busy.value || !settings.value) return;
  error.value = !/^[a-zA-Z0-9]{6,128}$/.test(tokenPassword.value)
    ? '通行密碼須為 6–128 個英文字母或數字'
    : tokenPassword.value !== tokenConfirm.value
      ? '兩次輸入的通行密碼不一致'
      : '';
  notice.value = '';
  if (error.value) return;
  busy.value = true;
  try {
    const result = await client.setMemberToken({
      password: tokenPassword.value,
      revision: settings.value.memberToken.revision,
    });
    settings.value.memberToken = result.memberToken;
    tokenPassword.value = tokenConfirm.value = '';
    notice.value = '成員通行密碼已更新';
  } catch (cause) {
    error.value = cause.message;
  } finally {
    busy.value = false;
  }
}
onMounted(load);
onUnmounted(() => {
  disposed = true;
  iconReadVersion++;
  loadVersion++;
  unregister?.();
});
</script>

<template>
  <section class="page-heading" aria-labelledby="admin-title">
    <div>
      <p class="eyebrow">ACCOUNT SETTINGS</p>
      <h1 id="admin-title">帳號管理<span class="heading-dot">.</span></h1>
      <p class="page-subtitle">平台名稱與圖示、admin 密碼、manager 帳號與成員通行密碼。</p>
    </div>
    <v-btn variant="outlined" :disabled="busy || loading || iconReading" @click="load"
      >重新載入</v-btn
    >
  </section>
  <v-alert v-if="error && !managerOpen" type="error" variant="tonal" role="alert" class="mb-4">{{
    error
  }}</v-alert>
  <v-alert v-if="notice" type="success" variant="tonal" role="status" class="mb-4">{{
    notice
  }}</v-alert>
  <DataLoading v-if="loading">正在載入帳號設定…</DataLoading>
  <v-card v-else-if="settings" class="admin-card">
    <DataLoading v-if="busy && !managerOpen" compact>正在儲存帳號或平台設定，請稍候…</DataLoading>
    <v-tabs v-model="tab" aria-label="帳號設定" :disabled="busy">
      <v-tab value="platform" id="admin-platform-tab" aria-controls="admin-platform-panel"
        >平台設定</v-tab
      >
      <v-tab value="password" id="admin-password-tab" aria-controls="admin-password-panel"
        >admin 密碼</v-tab
      >
      <v-tab value="managers" id="admin-managers-tab" aria-controls="admin-managers-panel"
        >manager 帳號</v-tab
      >
      <v-tab value="members" id="admin-members-tab" aria-controls="admin-members-panel"
        >成員通行密碼</v-tab
      >
    </v-tabs>
    <section
      v-show="tab === 'platform'"
      id="admin-platform-panel"
      role="tabpanel"
      aria-labelledby="admin-platform-tab"
    >
      <h2 class="admin-section-title">平台名稱與圖示</h2>
      <form class="admin-form" @submit.prevent="savePlatform">
        <v-text-field
          v-model="platformName"
          label="平台名稱"
          hint="顯示於左上角、頁尾與網頁標題，最多 30 個字。"
          persistent-hint
          variant="outlined"
          :disabled="busy"
          aria-required="true"
          autocomplete="off"
        />
        <div class="platform-icon-field">
          <h3>平台圖示</h3>
          <div class="platform-icon-preview">
            <img v-if="iconPreview" :src="iconPreview" alt="平台圖示預覽" />
            <span v-else>尚未設定圖示</span>
          </div>
          <p class="platform-icon-hint">PNG／JPEG／WebP，最多 256 KB，建議使用正方形圖片。</p>
          <input
            ref="iconInput"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="選擇平台圖示"
            hidden
            @change="chooseIcon"
          />
          <div class="platform-icon-actions">
            <v-btn
              variant="outlined"
              :disabled="busy || iconReading"
              :loading="iconReading"
              @click="iconInput.click()"
              >選擇圖片</v-btn
            >
            <v-btn
              variant="text"
              :disabled="busy || iconReading || !iconPreview"
              @click="iconDraft = null"
              >移除圖示</v-btn
            >
            <v-btn
              v-if="iconDraft !== undefined"
              variant="text"
              :disabled="busy || iconReading"
              @click="iconDraft = undefined"
              >還原圖示</v-btn
            >
          </div>
        </div>
        <v-btn
          type="submit"
          color="primary"
          :loading="busy"
          :disabled="busy || iconReading || !platformDirty"
          >儲存設定</v-btn
        >
      </form>
    </section>
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
      v-show="tab === 'managers'"
      id="admin-managers-panel"
      role="tabpanel"
      aria-labelledby="admin-managers-tab"
    >
      <div class="section-header admin-section-title">
        <h2>manager 帳號</h2>
        <v-btn color="primary" :disabled="busy" @click="openManager()">建立 manager</v-btn>
      </div>
      <p v-if="!settings.managers.length">尚無 manager 帳號</p>
      <ul v-else class="admin-manager-list">
        <li v-for="manager in settings.managers" :key="manager.id">
          <strong>{{ manager.username }}</strong
          ><v-btn
            variant="outlined"
            :disabled="busy"
            :aria-label="`修改 ${manager.username} 帳號`"
            @click="openManager(manager)"
            >修改</v-btn
          >
        </li>
      </ul>
    </section>
    <section
      v-show="tab === 'members'"
      id="admin-members-panel"
      role="tabpanel"
      aria-labelledby="admin-members-tab"
    >
      <h2 class="admin-section-title">成員通行密碼</h2>
      <p>
        {{ settings.memberToken.configured ? '已設定通行密碼' : '尚未設定通行密碼' }}
      </p>
      <form class="admin-form" @submit.prevent="saveToken">
        <v-text-field
          v-model="tokenPassword"
          label="新通行密碼（至少 6 個英數字）"
          type="password"
          inputmode="text"
          autocomplete="new-password"
          maxlength="128"
          variant="outlined"
          hide-details
          :disabled="busy"
          aria-required="true"
        />
        <v-text-field
          v-model="tokenConfirm"
          label="確認通行密碼"
          type="password"
          inputmode="text"
          autocomplete="new-password"
          maxlength="128"
          variant="outlined"
          hide-details
          :disabled="busy"
          aria-required="true"
        />
        <v-btn type="submit" color="primary" :loading="busy" :disabled="busy">{{
          settings.memberToken.configured ? '修改通行密碼' : '設定通行密碼'
        }}</v-btn>
      </form>
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
      <h2 id="manager-dialog-title">{{ managerId ? '修改' : '建立' }} manager</h2>
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
        <DataLoading v-if="busy" compact>正在儲存 manager 帳號，請稍候…</DataLoading>
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
.platform-icon-field {
  display: grid;
  gap: 12px;
  min-width: 0;
}
.platform-icon-field h3 {
  font-size: 16px;
}
.platform-icon-preview {
  display: flex;
  align-items: center;
  min-height: 88px;
  color: var(--color-text-muted);
}
.platform-icon-preview img {
  width: 88px;
  height: 88px;
  object-fit: contain;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  background: var(--color-muted-surface);
}
.platform-icon-hint {
  color: var(--color-text-muted);
  font-size: 13px;
}
.platform-icon-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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
