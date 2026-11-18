<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import MemberLeaveHistory from '../components/MemberLeaveHistory.vue';
import DataLoading from '../components/DataLoading.vue';
import { createAttendanceClient } from '../api/attendance.js';
import { ATTENDANCE_STATUSES } from '../domain/attendance.js';
import { taipeiToday } from '../domain/battle-events.js';
import { eventDisplayTitle } from '../domain/event-types.js';
const client = createAttendanceClient();
const emit = defineEmits(['changed']);
const historyDrawer = ref(null);
const historyUid = ref(''), historyOpen = ref(false);
let historyOpener;
function openHistory(row,event) { historyOpener=event.currentTarget;historyUid.value=row.uid;historyOpen.value=true; }
async function closeHistory(open) { historyOpen.value=open;if(!open){await nextTick();if(historyOpener?.isConnected)historyOpener.focus();else document.querySelector('.attendance-filters button[type=submit]')?.focus();} }
defineExpose({reload:load,canLeave});
const month = ref(taipeiToday().slice(0,7)), eventId = ref(null), uid = ref(null), page = ref(1);
const options = ref({events:[],members:[]}), result = ref(null), loading = ref(false), error = ref(''), notice = ref('');
const edit = ref(null), saving = ref(false), editError = ref(''), attempt = ref(null);
const events = computed(() => options.value.events.map(event => ({...event,key:event.id+':'+event.date,title:event.date+' · '+eventDisplayTitle(event)})));
const filterEvents = computed(() => [...new Map(events.value.map(event => [event.id,{id:event.id,title:eventDisplayTitle(event)}])).values()]);
const pages = computed(() => Math.min(400,Math.max(1,Math.ceil((result.value?.total || 0)/25))));
function canLeave() { return !historyDrawer.value?.busy && !saving.value && (!edit.value || window.confirm('有尚未儲存的出勤紀錄, 確定要離開嗎？')); }
let version = 0, disposed = false, optionsMonth = '';
async function load(reset = false) {
  if (saving.value) return;
  if (reset) page.value = 1;
  const token = ++version, query = {month:month.value,eventId:eventId.value,uid:uid.value,page:page.value,groupBy:'member'};
  loading.value = true; error.value = '';
  try {
    const [history, catalogs] = await Promise.all([client.getHistory(query),optionsMonth === query.month ? null : client.getOptions(query.month)]);
    if (disposed || token !== version) return;
    if (history.month !== query.month || !Array.isArray(history.rows) || !Number.isSafeInteger(history.total) || !history.summary) throw new Error('出勤資料格式不正確, 請重新載入');
    if (catalogs && (!Array.isArray(catalogs.events) || !Array.isArray(catalogs.members))) throw new Error('選單資料格式不正確');
    if (catalogs) { options.value = catalogs; optionsMonth = query.month; }
    result.value = history;
  } catch(cause) { if (!disposed && token === version) error.value = cause.message; }
  finally { if (!disposed && token === version) loading.value = false; }
}
function changeMonth() { eventId.value = null; uid.value = null; result.value = null; optionsMonth = ''; load(true); }
function open(row) {
  const event = row ? events.value.find(e => e.id === row.eventId && e.date === row.date) : null;
  edit.value = {key:event?.key || null,uid:row?.uid || null,status:row?.attendance || 'unrecorded',note:row?.note || '',revision:row?.revision || 0,fixed:!!row,eventId:row?.eventId,date:row?.date};
  attempt.value = null; editError.value = '';
}
async function save() {
  if (saving.value) return;
  const selected = events.value.find(e => e.key === edit.value.key);
  const draft = edit.value;
  const input = {eventId:draft.fixed?draft.eventId:selected?.id,date:draft.fixed?draft.date:selected?.date,uid:draft.uid,status:draft.status,note:draft.note,revision:draft.revision};
  const encoded = JSON.stringify(input);
  if (!attempt.value || attempt.value.encoded !== encoded) attempt.value = {encoded,requestId:crypto.randomUUID()};
  saving.value = true; editError.value = '';
  try {
    await client.saveAttendance({...input,requestId:attempt.value.requestId});
    if (disposed) return;
    edit.value = null; notice.value = '已儲存出勤紀錄';
  } catch(cause) { if (!disposed) editError.value = cause.message; }
  finally { saving.value = false; }
  if (!edit.value && !disposed) await load();
}
async function leaveCancelled() { emit('changed'); await load(true); }
onMounted(() => load());
onUnmounted(() => { disposed = true; version++; });
</script>
<template>
  <div>
    <header class="attendance-title"><h2 class="attendance-table-title">出勤與請假明細</h2><v-btn color="primary" :disabled="loading || saving" @click="open(null)">登記出勤</v-btn></header>
    <form class="attendance-filters" @submit.prevent="load(true)">
      <v-text-field v-model="month" type="month" label="月份" variant="outlined" hide-details :disabled="loading || saving" @change="changeMonth" />
      <v-select v-model="eventId" :items="filterEvents" item-title="title" item-value="id" label="活動" clearable variant="outlined" hide-details :disabled="loading || saving" />
      <v-autocomplete v-model="uid" :items="options.members" item-title="name" item-value="uid" label="成員" clearable variant="outlined" hide-details :disabled="loading || saving" />
      <v-btn type="submit" variant="outlined" :disabled="loading || saving">查詢</v-btn>
    </form>
    <v-alert v-if="notice" type="success" variant="tonal" role="status" class="mb-4">{{ notice }}</v-alert>
    <DataLoading v-if="loading">正在載入出勤與請假紀錄…</DataLoading>
    <v-alert v-else-if="error" type="error" variant="tonal" role="alert">{{ error }}<v-btn variant="text" @click="load()">重試</v-btn></v-alert>
    <template v-else-if="result">
      <p class="attendance-summary">共 {{ result.total }} 人 · 請假 {{ result.summary.leave }} 次</p>
      <p v-if="result.total > 10000" role="status">結果較多, 請選擇活動或成員縮小查詢範圍</p>
      <p v-if="!result.rows.length" class="py-6" role="status">此範圍沒有有效請假的成員</p>
      <ul v-else class="attendance-history" aria-label="出勤與請假紀錄">
        <li v-for="row in result.rows" :key="row.uid">
          <strong class="attendance-identity">{{ row.name }}</strong>
          <div class="attendance-details">
            <span>當月請假 {{ row.monthlyLeaveCount }} 次 <v-chip v-if="result.threshold > 0 && row.monthlyLeaveCount >= result.threshold" size="small" variant="tonal">已達關心門檻</v-chip></span>
            <span>最近一次請假：{{ row.date }} · {{ eventDisplayTitle(row) }}</span>
          </div>
          <v-btn variant="text" :disabled="saving" :aria-label="'看更多：'+row.name+' 的請假歷史'" :aria-expanded="historyOpen && historyUid===row.uid" @click="openHistory(row,$event)">看更多</v-btn>
        </li>
      </ul>
      <v-pagination v-if="pages > 1" v-model="page" :length="pages" :total-visible="5" aria-label="出勤紀錄頁碼" :disabled="loading" @update:model-value="load()" />
    </template>
    <MemberLeaveHistory ref="historyDrawer" @changed="leaveCancelled" :model-value="historyOpen" :uid="historyUid" @update:model-value="closeHistory" />
    <v-dialog :model-value="!!edit" max-width="560" :persistent="saving" aria-labelledby="attendance-edit-title" @update:model-value="!saving && (edit=null)">
      <v-card v-if="edit" class="pa-6">
        <h2 id="attendance-edit-title">登記出勤</h2>
        <form class="attendance-edit" @submit.prevent="save">
          <p v-if="edit.fixed">{{ edit.date }} · {{ options.members.find(m=>m.uid===edit.uid)?.name || '成員' }}</p>
          <template v-else>
            <v-select v-model="edit.key" :items="events" item-title="title" item-value="key" label="場次" variant="outlined" :disabled="saving" />
            <v-autocomplete v-model="edit.uid" :items="options.members" item-title="name" item-value="uid" label="成員" variant="outlined" :disabled="saving" />
          </template>
          <v-select v-model="edit.status" :items="ATTENDANCE_STATUSES" label="實際出勤" variant="outlined" :disabled="saving" />
          <v-text-field v-model="edit.note" maxlength="160" label="出勤備註（選填）" variant="outlined" :disabled="saving" />
          <v-alert v-if="editError" type="error" variant="tonal" role="alert">{{ editError }}<v-btn variant="text" :disabled="saving" @click="edit=null;load()">關閉並重新載入</v-btn></v-alert>
          <div class="attendance-actions"><v-btn variant="text" :disabled="saving" @click="edit=null">取消</v-btn><v-btn type="submit" color="primary" :disabled="saving || !edit.uid || (!edit.fixed && !edit.key)" :loading="saving">儲存出勤</v-btn></div>
        </form>
      </v-card>
    </v-dialog>
  </div>
</template>
<style scoped>
.attendance-title { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.attendance-filters { display: grid; grid-template-columns: 180px minmax(200px,1fr) minmax(160px,1fr) auto; align-items: center; gap: 16px; margin-bottom: 24px; }
.attendance-summary { margin-bottom: 16px; }
.attendance-history { list-style: none; padding: 0; }
.attendance-history > li { display: grid; grid-template-columns: minmax(140px,1fr) minmax(180px,2fr) auto; gap: 20px; align-items: center; padding: 18px 0; border-bottom: 1px solid rgba(var(--v-theme-on-surface),.12); }
.attendance-table-title { font-size:1.1rem; }
.attendance-identity,.attendance-details { display: grid; gap: 6px; overflow-wrap: anywhere; }
.attendance-identity span { font-size: .9rem; }
.attendance-edit { display: grid; gap: 12px; margin-top: 24px; }
.attendance-actions { display: flex; justify-content: flex-end; gap: 12px; }
@media(max-width: 1100px) { .attendance-filters { grid-template-columns: 1fr 1fr; } }
@media(max-width: 600px) { .attendance-title { align-items: flex-start; } .attendance-filters { grid-template-columns: 1fr; } .attendance-history > li { grid-template-columns: 1fr; gap: 12px; } .attendance-history > li > .v-btn { justify-self: end; } }
</style>
