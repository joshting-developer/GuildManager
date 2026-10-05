<script setup>
import { computed, onUnmounted, ref, useId, watch } from 'vue';
import DataLoading from '../components/DataLoading.vue';
import { createBattleSyncClient } from '../api/battle-sync.js';

const props = defineProps({ modelValue: Boolean });
const emit = defineEmits(['update:modelValue']);
const client = createBattleSyncClient({ source: import.meta.env.VITE_DATA_SOURCE || 'local' });
const id = useId();
const preview = ref(null);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const stale = ref(false);
const result = ref(null);
const tab = ref('matches');
const page = ref(1);
const rows = computed(() => preview.value?.[tab.value] || []);
const visibleRows = computed(() => rows.value.slice((page.value - 1) * 20, page.value * 20));
let token = 0;
let requestId;
let opener;

function validPlan(value) {
  const counts = ['records', 'players', 'alreadyLinked', 'eligiblePlayers', 'currentNamePlayers',
    'historyNamePlayers', 'conflictPlayers', 'unmatchedPlayers', 'matchedMembers'];
  return value && value.summary && counts.every(key => Number.isSafeInteger(value.summary[key]) && value.summary[key] >= 0)
    && Array.isArray(value.matches) && Array.isArray(value.conflicts)
    && value.matches.every(row => row && typeof row.name === 'string' && typeof row.memberName === 'string'
      && ['current', 'history'].includes(row.matchType) && Number.isSafeInteger(row.count) && row.count > 0)
    && value.conflicts.every(row => row && typeof row.name === 'string' && Number.isSafeInteger(row.count)
      && Array.isArray(row.candidates) && row.candidates.length > 1
      && row.candidates.every(candidate => typeof candidate.memberName === 'string'));
}
async function load() {
  if (saving.value || !props.modelValue) return;
  const current = ++token;
  loading.value = true;
  preview.value = null;
  result.value = null;
  error.value = '';
  stale.value = false;
  requestId = null;
  tab.value = 'matches';
  page.value = 1;
  try {
    const data = await client.preview();
    if (current !== token || !props.modelValue) return;
    if (!validPlan(data) || typeof data.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(data.fingerprint))
      throw new Error('預覽資料格式不正確，請重新預覽');
    preview.value = data;
  } catch (cause) {
    if (current === token && props.modelValue) error.value = cause.message;
  } finally {
    if (current === token) loading.value = false;
  }
}
async function sync() {
  if (saving.value || loading.value || stale.value || result.value || !preview.value?.summary.eligiblePlayers) return;
  const current = token;
  requestId ||= crypto.randomUUID();
  saving.value = true;
  error.value = '';
  try {
    const data = await client.sync({ fingerprint: preview.value.fingerprint, requestId });
    if (current !== token || !props.modelValue) return;
    if (!validPlan(data) || data.linkedPlayers !== preview.value.summary.eligiblePlayers)
      throw new Error('同步回應格式不正確，請重試確認結果');
    result.value = data;
  } catch (cause) {
    if (current === token && props.modelValue) {
      error.value = cause.message;
      stale.value = ['STALE_SYNC_PREVIEW', 'REQUEST_CONFLICT'].includes(cause.code);
    }
  } finally { saving.value = false; }
}
function restoreFocus() {
  if (opener?.isConnected) opener.focus();
}
function leaveWarning(event) {
  if (saving.value) { event.preventDefault(); event.returnValue = ''; }
}
watch(tab, () => { page.value = 1; });
watch(() => props.modelValue, open => {
  token++;
  if (open) { opener = document.activeElement; load(); }
}, { immediate: true });
window.addEventListener('beforeunload', leaveWarning);
onUnmounted(() => { token++; window.removeEventListener('beforeunload', leaveWarning); });
</script>

<template>
  <v-dialog :model-value="modelValue" :persistent="saving" max-width="800"
    :aria-labelledby="`${id}-title`" @update:model-value="emit('update:modelValue', $event)" @after-leave="restoreFocus">
    <v-card class="sync-card">
      <div class="sync-heading">
        <h2 :id="`${id}-title`">同步歷史戰績</h2>
        <v-btn variant="text" :disabled="loading || saving" @click="load">重新預覽</v-btn>
      </div>
      <div class="sync-body" :aria-busy="loading || saving">
        <p class="sync-muted">依成員目前名稱與過去名稱，補上尚未歸屬的歷史戰績。已歸屬的戰績保持原樣。</p>
        <DataLoading v-if="loading">正在比對成員與歷史戰績…</DataLoading>
        <v-alert v-if="error" type="error" variant="tonal" role="alert" class="my-4">
          {{ error }}<v-btn v-if="!preview || stale" variant="text" :disabled="loading || saving" @click="load">重新預覽</v-btn>
        </v-alert>
        <v-alert v-if="result" type="success" variant="tonal" role="status" class="my-4">
          同步完成，已將 {{ result.linkedPlayers }} 筆玩家戰績歸屬至 {{ result.summary.matchedMembers }} 位成員。
        </v-alert>
        <template v-if="preview && !loading">
          <div class="sync-summary">
            <strong>{{ result ? '本次已同步' : '可同步' }} {{ preview.summary.eligiblePlayers }} 筆</strong>
            <span>現在名稱 {{ preview.summary.currentNamePlayers }} 筆 · 過去名稱 {{ preview.summary.historyNamePlayers }} 筆</span>
            <span>已歸屬 {{ preview.summary.alreadyLinked }} 筆 · 同名衝突 {{ preview.summary.conflictPlayers }} 筆 · 未匹配 {{ preview.summary.unmatchedPlayers }} 筆</span>
          </div>
          <p class="sync-muted my-4">請核對過去名稱的對應。若舊同名者未記錄在名冊或名稱歷史中，僅靠戰績名稱無法辨識。</p>
          <DataLoading v-if="saving" compact>正在同步歷史戰績，請稍候…</DataLoading>
          <v-tabs v-model="tab" color="primary" aria-label="同步比對結果" :disabled="saving">
            <v-tab :id="`${id}-matches-tab`" value="matches" :aria-controls="`${id}-matches-panel`">{{ result ? '已同步對應' : '待同步對應' }}（{{ preview.matches.length }}）</v-tab>
            <v-tab :id="`${id}-conflicts-tab`" value="conflicts" :aria-controls="`${id}-conflicts-panel`">同名跳過（{{ preview.conflicts.length }}）</v-tab>
          </v-tabs>
          <div :id="`${id}-${tab}-panel`" role="tabpanel" :aria-labelledby="`${id}-${tab}-tab`">
            <p v-if="!rows.length" class="sync-empty">{{ tab === 'matches' ? '沒有需要同步的戰績。' : '沒有跨成員的同名衝突。' }}</p>
            <div v-else class="sync-scroll" tabindex="0" aria-label="名稱比對表，可捲動查看">
              <table class="sync-table">
                <caption class="sr-only">{{ tab === 'matches' ? '戰績與成員名稱對應' : '同名衝突，不會同步' }}</caption>
                <thead><tr><th scope="col">戰績名稱</th><th scope="col">{{ tab === 'matches' ? '現在成員名稱' : '同名成員' }}</th><th scope="col">{{ tab === 'matches' ? '比對方式' : '處理' }}</th><th scope="col">筆數</th></tr></thead>
                <tbody><tr v-for="row in visibleRows" :key="row.name">
                  <td>{{ row.name }}</td>
                  <td>{{ tab === 'matches' ? row.memberName : `${row.candidates.length} 位：${row.candidates.map(candidate => candidate.memberName).join('、')}` }}</td>
                  <td>{{ tab === 'matches' ? (row.matchType === 'history' ? '過去名稱' : '現在名稱') : '跳過' }}</td>
                  <td>{{ row.count }}</td>
                </tr></tbody>
              </table>
            </div>
            <v-pagination v-if="rows.length > 20" v-model="page" :length="Math.ceil(rows.length / 20)" :total-visible="4" :disabled="saving" class="mt-3" />
          </div>
        </template>
      </div>
      <div class="sync-actions">
        <v-btn variant="outlined" :disabled="saving" @click="emit('update:modelValue', false)">關閉</v-btn>
        <v-btn v-if="!result" color="primary" :loading="saving" :disabled="loading || stale || !preview?.summary.eligiblePlayers" @click="sync">確認同步{{ preview ? ` ${preview.summary.eligiblePlayers} 筆` : '' }}</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.sync-card { padding: 28px; }
.sync-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 16px; flex-wrap: wrap; }
.sync-heading h2 { font-size: 22px; }
.sync-body { overflow: auto; }
.sync-muted { color: var(--color-text-muted); font-size: 14px; line-height: 1.7; }
.sync-summary { display: grid; gap: 6px; padding: 16px; margin-top: 16px; background: var(--color-muted-surface); border-radius: 14px; font-size: 14px; }
.sync-summary strong { font-size: 18px; }
.sync-empty { padding: 24px 0; color: var(--color-text-muted); }
.sync-scroll { overflow: auto; border: 1px solid var(--color-border); border-radius: 14px; margin-top: 16px; }
.sync-table { width: 100%; min-width: 480px; border-collapse: collapse; text-align: left; font-size: 14px; }
.sync-table th { background: var(--color-muted-surface); color: var(--color-text-muted); font-size: 13px; }
.sync-table th, .sync-table td { padding: 12px 16px; vertical-align: top; }
.sync-table td { border-top: 1px solid var(--color-border); overflow-wrap: anywhere; max-width: 240px; }
.sync-table th:last-child, .sync-table td:last-child { text-align: right; }
.sync-actions { display: flex; justify-content: flex-end; gap: 12px; padding-top: 20px; margin-top: 20px; border-top: 1px solid var(--color-border); flex-wrap: wrap; }
@media (max-width: 767px) { .sync-card { padding: 20px; } .sync-heading h2 { font-size: 20px; } }
</style>
