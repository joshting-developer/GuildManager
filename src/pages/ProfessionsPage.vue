<script setup>
import { computed, inject, onMounted, onUnmounted, ref } from 'vue';
import { VColorPicker } from 'vuetify/components';
import { mdiPlus, mdiRefresh } from '@mdi/js';
import { createMemberClient } from '../api/members.js';
import { validateProfession } from '../domain/professions.js';
import DataLoading from '../components/DataLoading.vue';

const client = createMemberClient();
const professions = ref([]), loading = ref(true), error = ref(''), notice = ref('');
const open = ref(false), editing = ref(null), name = ref(''), colorcode = ref('#4682b4');
const busy = ref(false), formError = ref('');
let baseline = '', createAttempt = null, opener = null, disposed = false;
const dirty = computed(() => open.value && JSON.stringify([name.value, colorcode.value]) !== baseline);
const validColor = computed(() => /^#[a-f\d]{6}$/i.test(colorcode.value));
const registerGuard = inject('registerNavigationGuard', null);
function canLeave() {
  return !busy.value && (!dirty.value || window.confirm('職業有尚未儲存的修改, 確定要離開嗎？'));
}
const unregister = registerGuard?.(canLeave);
function beforeUnload(event) {
  if (dirty.value || busy.value) { event.preventDefault(); event.returnValue = ''; }
}
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await client.getProfessions({ refresh: true });
    if (!disposed) professions.value = data.professions;
  } catch (cause) {
    if (!disposed) error.value = cause.message;
  } finally { if (!disposed) loading.value = false; }
}
function edit(profession = null) {
  opener = document.activeElement;
  editing.value = profession ? { ...profession } : null;
  name.value = profession?.name || '';
  colorcode.value = profession?.colorcode || '#4682b4';
  baseline = JSON.stringify([name.value, colorcode.value]);
  createAttempt = null;
  formError.value = '';
  open.value = true;
}
function close() {
  if (!busy.value && (!dirty.value || window.confirm('職業有尚未儲存的修改, 確定要關閉嗎？'))) open.value = false;
}
async function save() {
  if (busy.value) return;
  formError.value = '';
  try {
    const values = { name: name.value, colorcode: colorcode.value };
    const fingerprint = JSON.stringify(values);
    if (!editing.value && createAttempt?.fingerprint !== fingerprint)
      createAttempt = { fingerprint, requestId: crypto.randomUUID() };
    const input = { ...values, ...(editing.value ? { revision: editing.value.revision } : { requestId: createAttempt.requestId }) };
    validateProfession(input, Boolean(editing.value));
    busy.value = true;
    const data = editing.value
      ? await client.updateProfession(editing.value.job_id, input)
      : await client.addProfession(input);
    if (!data.profession?.job_id) throw new Error('職業回應格式不正確, 請重試以確認結果');
    professions.value = [...professions.value.filter(job => job.job_id !== data.profession.job_id), data.profession]
      .sort((a, b) => a.job_id - b.job_id);
    notice.value = `職業「${data.profession.name}」已儲存`;
    open.value = false;
  } catch (cause) { formError.value = cause.message; }
  finally { busy.value = false; }
}
onMounted(() => { load(); window.addEventListener('beforeunload', beforeUnload); });
onUnmounted(() => { disposed = true; unregister?.(); window.removeEventListener('beforeunload', beforeUnload); });
</script>

<template>
  <section class="professions-page" aria-labelledby="professions-title">
    <div class="professions-heading">
      <h1 id="professions-title">職業管理</h1>
      <div class="profession-actions">
        <v-btn variant="text" :prepend-icon="mdiRefresh" :disabled="loading" @click="load">重新載入</v-btn>
        <v-btn color="primary" variant="flat" :prepend-icon="mdiPlus" :disabled="loading || Boolean(error)" @click="edit()">新增職業</v-btn>
      </div>
    </div>
    <v-alert v-if="notice" type="success" variant="tonal" role="status" class="mb-4">{{ notice }}</v-alert>
    <v-alert v-if="error" type="error" variant="tonal" role="alert">
      {{ error }}<v-btn variant="text" :disabled="loading" @click="load">重試</v-btn>
    </v-alert>
    <DataLoading v-if="loading">正在載入職業清單…</DataLoading>
    <div v-else-if="!error" class="profession-list">
      <div class="profession-list-heading"><h2>職業清單</h2><span>{{ professions.length }} 個職業</span></div>
      <div v-for="profession in professions" :key="profession.job_id" class="profession-row">
        <span class="profession-swatch" :style="{ backgroundColor: profession.colorcode }" aria-hidden="true" />
        <span class="profession-name">{{ profession.name }}</span>
        <code>{{ profession.colorcode.toUpperCase() }}</code>
        <v-btn variant="text" :aria-label="`修改職業：${profession.name}`" @click="edit(profession)">修改</v-btn>
      </div>
      <p v-if="!professions.length" class="pa-5">尚未建立職業</p>
    </div>
  </section>
  <v-dialog :model-value="open" max-width="440" :persistent="busy" aria-labelledby="profession-dialog-title"
    @update:model-value="!$event && close()" @after-leave="opener?.isConnected && opener.focus()">
    <v-card class="profession-dialog">
      <form @submit.prevent="save">
        <h2 id="profession-dialog-title">{{ editing ? '修改職業' : '新增職業' }}</h2>
        <v-alert v-if="formError" type="error" variant="tonal" role="alert" class="mb-4">{{ formError }}</v-alert>
        <v-text-field v-model="name" label="職業名稱" variant="outlined" maxlength="64" :disabled="busy" autofocus />
        <p id="profession-color-label" class="mb-2">職業顏色</p>
        <VColorPicker :model-value="validColor ? colorcode : '#4682b4'" mode="hex" :modes="['hex']" hide-inputs
          :disabled="busy" width="100%" aria-labelledby="profession-color-label"
          @update:model-value="colorcode = $event" />
        <v-text-field v-model="colorcode" label="HEX 色碼" variant="outlined" :disabled="busy" maxlength="7"
          :error-messages="validColor ? [] : ['請填寫 # 加上六位英數色碼']" class="mt-4" />
        <div class="profession-preview"><span class="profession-swatch" :style="{ backgroundColor: validColor ? colorcode : 'transparent' }" aria-hidden="true" /><span>{{ name.trim() || '顏色預覽' }}</span></div>
        <div class="profession-dialog-actions">
          <v-btn variant="text" :disabled="busy" @click="close">取消</v-btn>
          <v-btn type="submit" color="primary" variant="flat" :loading="busy" :disabled="busy || !validColor || !name.trim()">儲存</v-btn>
        </div>
      </form>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.professions-page { max-width: 880px; margin: 0 auto; }
.professions-heading, .profession-actions, .profession-list-heading, .profession-preview, .profession-dialog-actions { display: flex; align-items: center; gap: 12px; }
.professions-heading { justify-content: space-between; margin-bottom: 24px; flex-wrap: wrap; }
.professions-heading h1 { font-size: 28px; font-weight: 600; }
.profession-list { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden; }
.profession-list-heading { justify-content: space-between; padding: 20px 24px; }
.profession-list-heading h2 { font-size: 16px; }
.profession-list-heading span, .profession-row code { color: var(--color-text-secondary); font-size: 14px; }
.profession-row { display: grid; grid-template-columns: 32px 1fr 100px auto; gap: 16px; align-items: center; padding: 12px 24px; border-top: 1px solid var(--color-border); }
.profession-swatch { display: inline-block; width: 32px; height: 32px; border-radius: 6px; border: 1px solid var(--color-border); }
.profession-name { overflow-wrap: anywhere; }
.profession-dialog { padding: 24px; }
.profession-dialog h2 { font-size: 22px; margin-bottom: 24px; }
.profession-dialog-actions { justify-content: flex-end; margin-top: 24px; }
.profession-preview { min-height: 44px; overflow-wrap: anywhere; }
@media (max-width: 600px) {
  .professions-heading h1 { font-size: 24px; }
  .profession-actions { flex-wrap: wrap; gap: 4px; }
  .profession-row { grid-template-columns: 32px 1fr auto; gap: 12px; padding: 12px 16px; }
  .profession-row code { grid-column: 2; grid-row: 2; }
  .profession-row .v-btn { grid-column: 3; grid-row: 1 / 3; }
  .profession-row .profession-swatch { grid-row: 1 / 3; }
  .profession-list-heading { padding: 16px; }
  .profession-dialog { padding: 20px; }
}
</style>
