<script setup>
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { useDisplay } from 'vuetify';
import { VNavigationDrawer } from 'vuetify/components';
import DataLoading from './DataLoading.vue';
import { createMemberClient } from '../api/members.js';
import { memberEditActions, memberEditFields, formatEditTime, formatEditValue } from '../domain/member-edit-history.js';

const props = defineProps({ modelValue: Boolean, uid: { type: String, default: '' }, name: { type: String, default: '' }, updatedAt: { type: String, default: '' }, professions: { type: Array, default: () => [] } });
const emit = defineEmits(['update:modelValue']);
const client = createMemberClient();
const { width } = useDisplay();
const drawerWidth = computed(() => Math.min(600, width.value));
const items = ref([]), cursor = ref(null), loading = ref(false), error = ref('');
const panel = ref(null), closeButton = ref(null);
const sortedItems = computed(() => [...items.value].sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt)));
let generation = 0, opener;
function close(value = false) { emit('update:modelValue', value); }
async function load() {
  if (loading.value || !props.modelValue || !props.uid) return;
  const current = generation;
  loading.value = true;
  error.value = '';
  try {
    const result = await client.getMemberEditHistory(props.uid, cursor.value);
    if (current !== generation) return;
    if (!Array.isArray(result?.items)) throw new Error('編輯歷程格式不正確，請重試');
    items.value = [...new Map([...items.value, ...result.items].map(item => [item.id, item])).values()];
    cursor.value = result.nextCursor || null;
  } catch (cause) {
    if (current === generation) error.value = cause.message;
  } finally {
    if (current === generation) loading.value = false;
  }
}
watch(() => [props.modelValue, props.uid], async () => {
  generation++;
  items.value = []; cursor.value = null; loading.value = false; error.value = '';
  if (props.modelValue) {
    opener = document.activeElement;
    load();
    await nextTick();
    closeButton.value?.$el?.focus();
  } else if (opener?.isConnected) opener.focus();
}, { immediate: true });
function keys(event) {
  if (event.key === 'Escape') { event.stopPropagation(); close(); }
  if (event.key !== 'Tab') return;
  const buttons = [...panel.value.querySelectorAll('button:not([disabled]),[tabindex="0"]')].filter(el => el.getClientRects().length);
  if (!buttons.length) return;
  if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
  else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
}
onUnmounted(() => { generation++; if (opener?.isConnected) opener.focus(); });
</script>
<template>
  <v-navigation-drawer :model-value="modelValue" location="right" temporary disable-resize-watcher :width="drawerWidth" @update:model-value="close">
    <section ref="panel" class="edit-history" role="dialog" aria-modal="true" aria-labelledby="member-edit-history-title" :aria-busy="loading" @keydown="keys">
      <header><div><h2 id="member-edit-history-title">{{ name || '成員' }}的編輯歷程</h2><p>UID：{{ uid }}</p><p>最後更新時間：{{ formatEditTime(updatedAt) }}<span v-if="updatedAt && sortedItems[0]?.actorName">（{{ sortedItems[0].actorName }}）</span></p></div><v-btn ref="closeButton" variant="text" aria-label="關閉編輯歷程" @click="close()">關閉</v-btn></header>
      <ol v-if="items.length" class="edit-timeline">
        <li v-for="item in sortedItems" :key="item.id">
          <time :datetime="item.changedAt">{{ formatEditTime(item.changedAt) }}</time>
          <strong>{{ memberEditActions[item.action] || item.action }}</strong>
          <p>操作帳號：{{ item.actorName || '—' }}<span v-if="item.actorAccountId != null">（{{ item.actorAccountId }}）</span></p>
          <ul v-if="item.changes?.length"><li v-for="(change, index) in item.changes" :key="index">{{ memberEditFields[change.field] || change.field }}：{{ formatEditValue(change.field, change.before, professions) }} → {{ formatEditValue(change.field, change.after, professions) }}</li></ul>
          <p v-else>此筆操作沒有欄位變更明細。</p>
        </li>
      </ol>
      <DataLoading v-if="loading">正在載入編輯歷程…</DataLoading>
      <v-alert v-else-if="error" type="error" variant="tonal" role="alert">{{ error }}<v-btn variant="text" @click="load">重試</v-btn></v-alert>
      <p v-else-if="!items.length" class="empty-message" role="status">尚無編輯紀錄。此功能上線前的編輯紀錄無法追溯。</p>
      <v-btn v-if="cursor && !error" variant="outlined" :disabled="loading" class="load-more" @click="load">載入更多</v-btn>
    </section>
  </v-navigation-drawer>
</template>
<style scoped>
.edit-history { padding: 24px; overflow-wrap: anywhere; font-size: 14px; }
header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
h2 { font-size: 1.25rem; }
header p, time { color: rgb(var(--v-theme-on-surface-variant)); }
.edit-timeline { list-style: none; padding: 0 0 0 16px; margin-top: 24px; border-left: 2px solid rgba(var(--v-theme-primary), .25); }
.edit-timeline > li { position: relative; display: grid; gap: 8px; padding: 0 0 24px 8px; }
.edit-timeline > li::before { content: ''; position: absolute; left: -22px; top: 5px; width: 10px; height: 10px; border-radius: 50%; background: rgb(var(--v-theme-primary)); }
ul { padding-left: 20px; } ul li { margin-bottom: 6px; }
.edit-history :deep(button) { min-height: 44px; }
.empty-message, .load-more { margin-top: 24px; }
@media(max-width:600px) { .edit-history { padding: 20px 16px; } }
@media(prefers-reduced-motion:reduce) { :deep(.v-navigation-drawer) { transition: none; } }
</style>
