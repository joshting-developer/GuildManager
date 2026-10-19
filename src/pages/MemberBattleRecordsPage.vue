<script setup>
import DataLoading from '../components/DataLoading.vue';
import { ref, shallowRef, computed, watch, onUnmounted, defineAsyncComponent } from 'vue';
import { mdiClose, mdiChartLine } from '@mdi/js';
import { createMemberClient } from '../api/members.js';
import { validatePersonalBattleFilters, filterPersonalBattles } from '../domain/personal-battle-filters.js';
import { summarizePersonalBattles } from '../domain/personal-battle-statistics.js';
import { personalBattleKey, latestPersonalSelection, selectedPersonalBattles, summarizeKillEfficiency, personalKillEfficiency } from '../domain/personal-battle-selection.js';
import { eventTypeLabel } from '../domain/event-types.js';
import { battleDateLabel, battleRoundLabel, battlePlayerValue, BATTLE_TABLE_COLUMNS } from '../domain/battle-statistics.js';
import './battle-record-view.css';

const PersonalBattleTrend = defineAsyncComponent({
  loader: () => import('../components/PersonalBattleTrend.vue'),
  loadingComponent: DataLoading,
  delay: 0,
});
const props = defineProps({ memberUid: { type: String, required: true } });
const client = createMemberClient({ source: import.meta.env.VITE_DATA_SOURCE || 'local' });
const data = shallowRef(null), loading = ref(true), error = ref(''), page = ref(1);
const selection = shallowRef(new Set());
const trendOpen = ref(false), trendVisited = ref(false);
const trendButton = ref(null), trendClose = ref(null), trendChart = ref(null);
const summaryMode = ref('total'), tableMode = ref('total');
const draftFilters = ref({ startDate: '', endDate: '', profession: '' });
const appliedFilters = ref({}), filterError = ref('');
const professionOptions = computed(() => [
  { title: '所有職業', value: '' },
  ...(data.value?.professions || []).map((name) => ({ title: name, value: name })),
]);
const hasFilters = computed(() => Object.values(appliedFilters.value).some(Boolean));
const entries = computed(() => filterPersonalBattles(data.value?.entries || [], appliedFilters.value));
const selectedEntries = computed(() => selectedPersonalBattles(entries.value, selection.value));
const summary = computed(() => summarizePersonalBattles(selectedEntries.value));
const efficiency = computed(() => summarizeKillEfficiency(selectedEntries.value));
const pageCount = computed(() => Math.ceil(entries.value.length / 20));
const pageEntries = computed(() => entries.value.slice((page.value - 1) * 20, page.value * 20));
const pageSelectedCount = computed(() => pageEntries.value.filter((entry) => selection.value.has(personalBattleKey(entry))).length);
const summaryModes = [
  { value: 'total', label: '合計' },
  { value: 'average', label: '每筆平均' },
  { value: 'perLife', label: '一命貢獻' },
];
let disposed = false, version = 0;
function openTrend() {
  trendVisited.value = true;
  trendOpen.value = true;
}
function focusTrend() {
  trendClose.value?.$el?.focus({ preventScroll: true });
  trendChart.value?.refresh?.();
}
function returnFromTrend() {
  if (!disposed) trendButton.value?.$el?.focus({ preventScroll: true });
}
function numberLabel(value) {
  return value == null ? '—' : value.toLocaleString('zh-TW', { maximumFractionDigits: 2 });
}
function resultLabel(entry) {
  if (entry.isInternal) return '內推';
  if (!['red', 'blue'].includes(entry.winner)) return '結果未填';
  return entry.winner === entry.player.side ? '勝' : '敗';
}
function missingCount(metric) {
  return summaryMode.value === 'perLife' ? metric.perLifeMissing : metric.missing;
}
function toggleEntry(entry, checked) {
  const next = new Set(selection.value), key = personalBattleKey(entry);
  if (checked) next.add(key); else next.delete(key);
  selection.value = next;
}
function togglePage(checked) {
  const next = new Set(selection.value);
  for (const entry of pageEntries.value) {
    const key = personalBattleKey(entry);
    if (checked) next.add(key); else next.delete(key);
  }
  selection.value = next;
}
function selectEntries(latestOnly = false) {
  selection.value = latestOnly ? latestPersonalSelection(entries.value) : new Set(entries.value.map(personalBattleKey));
}
async function load() {
  const current = ++version, previous = data.value;
  loading.value = true;
  error.value = '';
  try {
    const result = await client.getBattleRecords(props.memberUid, 1, { all: true });
    if (disposed || current !== version) return;
    if (!result.member?.name || !Array.isArray(result.entries) || !Array.isArray(result.professions) ||
        !Number.isSafeInteger(result.total) || result.entries.length !== result.total)
      throw new Error('個人戰績未完整載入，請確認程式版本後重新載入');
    data.value = result;
    const keys = new Set(result.entries.map(personalBattleKey));
    selection.value = previous ? new Set([...selection.value].filter((key) => keys.has(key))) : latestPersonalSelection(result.entries);
    page.value = Math.min(page.value, Math.max(pageCount.value, 1));
  } catch (cause) {
    if (!disposed && current === version) error.value = cause.message;
  } finally {
    if (!disposed && current === version) loading.value = false;
  }
}
function applyFilters() {
  if (loading.value) return;
  try {
    const filters = validatePersonalBattleFilters(draftFilters.value);
    filterError.value = '';
    draftFilters.value = { ...filters };
    page.value = 1;
    appliedFilters.value = filters;
  } catch (cause) { filterError.value = cause.message; }
}
function clearFilters() {
  draftFilters.value = { startDate: '', endDate: '', profession: '' };
  applyFilters();
}
watch(() => props.memberUid, () => {
  data.value = null;
  trendOpen.value = false;
  trendVisited.value = false;
  selection.value = new Set();
  page.value = 1;
  draftFilters.value = { startDate: '', endDate: '', profession: '' };
  appliedFilters.value = {};
  filterError.value = '';
  load();
}, { immediate: true });
onUnmounted(() => { disposed = true; version++; });
</script>

<template>
  <section class="page-heading" aria-labelledby="personal-title">
    <div>
      <p class="eyebrow">PLAYER RECORDS</p>
      <h1 id="personal-title">
        {{ data?.member.name || '個人戰績' }}<span class="heading-dot">.</span>
      </h1>
      <p class="page-subtitle">{{ data?.member.profession || '個人戰績與參戰分析' }}</p>
    </div>
    <div class="personal-actions">
      <v-btn href="#/members" variant="outlined">成員清單</v-btn>
      <v-btn href="#/battle-records" variant="text">戰績清單</v-btn>
      <v-btn variant="outlined" :disabled="loading" @click="load">重新載入</v-btn>
    </div>
  </section>
  <v-card class="battle-view-card personal-filter-card mb-6">
    <form class="personal-filter-form" aria-label="個人戰績篩選" @submit.prevent="applyFilters">
      <v-text-field
        v-model="draftFilters.startDate"
        label="開始日期"
        :disabled="loading"
        type="date"
        min="2000-01-01"
        max="2100-12-31"
        variant="outlined"
        density="compact"
        hide-details
      />
      <v-text-field
        v-model="draftFilters.endDate"
        label="結束日期"
        :disabled="loading"
        type="date"
        min="2000-01-01"
        max="2100-12-31"
        variant="outlined"
        density="compact"
        hide-details
      />
      <v-select
        v-model="draftFilters.profession"
        :items="professionOptions"
        label="職業篩選"
        :loading="loading"
        :disabled="loading || !data"
        :aria-busy="loading"
        variant="outlined"
        density="compact"
        hide-details
      />
      <div class="personal-actions">
        <v-btn type="submit" color="primary" :disabled="loading">套用篩選</v-btn>
        <v-btn variant="text" :disabled="loading" @click="clearFilters">清除篩選</v-btn>
      </div>
    </form>
    <p class="battle-view-muted mt-3">日期包含起訖當天，可只填一邊；職業依各場戰績紀錄篩選。勾選跨頁保留，總覽與走勢只計算勾選且符合篩選的紀錄。</p>
    <v-alert v-if="filterError" type="error" variant="tonal" role="alert" class="mt-3">{{ filterError }}</v-alert>
  </v-card>
  <DataLoading v-if="loading">正在載入個人戰績…</DataLoading>
  <v-alert v-else-if="error" type="error" variant="tonal" role="alert">
    {{ error }}<v-btn variant="text" @click="load">重試</v-btn>
  </v-alert>
  <template v-else-if="data">
    <v-card class="battle-view-card mb-6">
      <div class="section-header">
        <h2>參戰統計</h2>
        <p>{{ summary.battleCount }} 場 · {{ summary.rowCount }} 筆參戰數據</p>
      </div>
      <p class="personal-result">
        勝 {{ summary.wins }} 場 · 敗 {{ summary.losses }} 場 · 內推／未判定
        {{ summary.unknown }} 場
      </p>
      <p v-if="!data.total" class="battle-view-state">{{ hasFilters ? '沒有符合篩選條件的戰績' : '尚無已關聯的個人戰績' }}</p>
      <p v-else-if="!selectedEntries.length" class="battle-view-state">請勾選下方戰績以計算統計。</p>
      <template v-else>
        <div class="personal-actions mb-4" role="group" aria-label="個人統計模式">
          <v-btn
            v-for="mode in summaryModes"
            :key="mode.value"
            :aria-pressed="summaryMode === mode.value"
            :variant="summaryMode === mode.value ? 'tonal' : 'text'"
            :color="summaryMode === mode.value ? 'primary' : undefined"
            @click="summaryMode = mode.value"
            >{{ mode.label }}</v-btn
          >
        </div>
        <p v-if="summaryMode === 'average'" class="battle-view-muted mb-4">
          依各欄有數值的參戰紀錄計算平均，缺值不計為 0。
        </p>
        <p v-if="summaryMode === 'perLife'" class="battle-view-muted mb-4">
          一命貢獻＝有完整數值的紀錄合計 ÷ 各筆 max(重傷次數, 1) 合計；重傷欄保留合計。
        </p>
        <div class="personal-metrics">
          <div v-for="metric in summary.metrics" :key="metric.key" class="personal-metric">
            <span>{{ metric.label }}</span>
            <strong>{{ numberLabel(metric[summaryMode]) }}</strong>
            <small v-if="missingCount(metric)">缺 {{ missingCount(metric) }} 筆資料</small>
          </div>
          <div class="personal-metric">
            <span>擊殺效率（傷害／擊敗）</span>
            <strong>{{ numberLabel(efficiency.value) }}</strong>
            <small v-if="efficiency.missing">缺 {{ efficiency.missing }} 筆完整資料</small>
          </div>
        </div>
        <p class="battle-view-muted mt-4">擊殺效率＝勾選紀錄的對玩家傷害合計 ÷ 擊敗合計（只計兩欄完整的紀錄，含零擊敗的傷害）；零擊敗合計顯示 —，不隨統計模式改變。</p>
      </template>
      <p class="battle-view-muted mt-4">
        統計已關聯的戰績；上傳或新增成員時依唯一同名關聯。未關聯紀錄不計入，同場有兩筆數據時均保留，但場數只計一次。
      </p>
    </v-card>
    <v-card v-if="data.total" class="battle-view-card">
      <div class="section-header">
        <h2>各場戰績</h2>
        <div class="personal-actions" role="group" aria-label="個人明細模式">
          <v-btn ref="trendButton" variant="outlined" color="primary" :prepend-icon="mdiChartLine" aria-haspopup="dialog" aria-controls="personal-trend-panel" :aria-expanded="trendOpen" @click="openTrend">查看走勢</v-btn>
          <v-btn
            :aria-pressed="tableMode === 'total'"
            :variant="tableMode === 'total' ? 'tonal' : 'text'"
            @click="tableMode = 'total'"
            >總計</v-btn
          >
          <v-btn
            :aria-pressed="tableMode === 'per_life'"
            :variant="tableMode === 'per_life' ? 'tonal' : 'text'"
            @click="tableMode = 'per_life'"
            >一命</v-btn
          >
        </div>
      </div>
      <div class="personal-actions mb-4" role="group" aria-label="戰績勾選操作">
        <v-btn variant="outlined" :disabled="!entries.length" @click="selectEntries(true)">勾選最新 10 筆</v-btn>
        <v-btn variant="text" :disabled="!entries.length" @click="selectEntries(false)">勾選全部符合紀錄</v-btn>
        <v-btn variant="text" :disabled="!selection.size" @click="selection = new Set()">清除勾選</v-btn>
      </div>
      <p class="battle-view-muted mb-4" role="status" aria-live="polite">共 {{ data.total }} 筆，符合 {{ entries.length }} 筆，其中已勾選 {{ selectedEntries.length }} 筆；全部已勾選 {{ selection.size }} 筆。預設選取最新 10 筆，重新載入保留勾選。</p>
      <p v-if="!entries.length" class="battle-view-state">沒有符合篩選條件的戰績</p>
      <div v-else class="battle-view-scroll" tabindex="0" aria-label="個人各場戰績，可左右捲動">
        <table class="battle-view-table">
          <caption class="sr-only">
            各場參戰數據，點擊日期查看對戰詳情
          </caption>
          <thead>
            <tr>
              <th scope="col"><input type="checkbox" aria-label="勾選本頁戰績" :checked="pageEntries.length > 0 && pageSelectedCount === pageEntries.length" :indeterminate="pageSelectedCount > 0 && pageSelectedCount < pageEntries.length" @change="togglePage($event.target.checked)" /></th>
              <th scope="col">場次</th>
              <th scope="col">隊伍／結果</th>
              <th
                v-for="[label, key] in BATTLE_TABLE_COLUMNS.filter(([, key]) => key !== 'resource')"
                :key="key"
                scope="col"
                :class="{ numeric: !['player', 'profession'].includes(key) }"
              >
                {{ label
                }}{{
                  tableMode === 'per_life' &&
                  !['player', 'profession', 'seriousInjury'].includes(key)
                    ? '/命'
                    : ''
                }}
              </th>
              <th scope="col" class="numeric">擊殺效率</th>
              <th scope="col" class="numeric">資源{{ tableMode === 'per_life' ? '/命' : '' }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in pageEntries" :key="personalBattleKey(entry)" :class="{ 'personal-row-selected': selection.has(personalBattleKey(entry)) }">
              <td><input type="checkbox" :checked="selection.has(personalBattleKey(entry))" :aria-label="`選取 ${battleDateLabel(entry.playedAt)} ${battleRoundLabel(entry)} ${entry.player.side === 'red' ? '紅方' : '藍方'} ${entry.player.player}`" @change="toggleEntry(entry, $event.target.checked)" /></td>
              <td>
                <a :href="`#/battle-records/${encodeURIComponent(entry.recordId)}`">{{
                  battleDateLabel(entry.playedAt)
                }}</a>
                <p class="battle-view-muted">
                  {{ eventTypeLabel(entry.type) }} · {{ battleRoundLabel(entry) }}
                </p>
              </td>
              <td>
                {{ entry.player.side === 'red' ? '紅方' : '藍方' }} · {{ resultLabel(entry) }}
                <p class="battle-view-muted">{{ entry.redTeam }} 對 {{ entry.blueTeam }}</p>
              </td>
              <td>{{ entry.player.player }}</td>
              <td>{{ entry.player.profession }}</td>
              <td v-for="[, key] in BATTLE_TABLE_COLUMNS.slice(2).filter(([, key]) => key !== 'resource')" :key="key" class="numeric">
                {{ numberLabel(battlePlayerValue(entry.player, key, tableMode)) }}
              </td>
              <td class="numeric">{{ numberLabel(personalKillEfficiency(entry.player)) }}</td>
              <td class="numeric">{{ numberLabel(battlePlayerValue(entry.player, 'resource', tableMode)) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <v-pagination
        v-if="pageCount > 1"
        v-model="page"
        :length="pageCount"
        :total-visible="5"
        aria-label="個人戰績分頁"
        class="mt-4"
      />
    </v-card>
    <v-dialog v-model="trendOpen" eager class="personal-trend-dialog" transition="mobile-drawer" aria-labelledby="personal-trend-title" @after-enter="focusTrend" @after-leave="returnFromTrend">
      <div id="personal-trend-panel" class="personal-trend-panel">
        <header class="personal-trend-heading">
          <div>
            <h2 id="personal-trend-title">數據走勢</h2>
            <p>{{ data.member.name }} · {{ selectedEntries.length }} 筆已選紀錄</p>
          </div>
          <v-btn ref="trendClose" variant="text" :icon="mdiClose" aria-label="關閉數據走勢" @click="trendOpen = false" />
        </header>
        <div class="personal-trend-body">
          <PersonalBattleTrend v-if="trendVisited" ref="trendChart" :entries="selectedEntries" :active="trendOpen" />
        </div>
        <footer class="personal-trend-footer">
          <p class="battle-view-muted">精確數值可在各場戰績表格查看。</p>
          <v-btn variant="outlined" @click="trendOpen = false">返回戰績表格</v-btn>
        </footer>
      </div>
    </v-dialog>
  </template>
</template>

<style scoped>
input[type="checkbox"] { width: 22px; height: 22px; cursor: pointer; accent-color: var(--color-primary, #2563eb); margin: 10px; }
.personal-row-selected { background: var(--color-muted-surface); }

.personal-filter-form {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr auto;
  gap: 12px;
  align-items: center;
}
.personal-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.personal-result {
  margin-bottom: 20px;
  color: var(--color-text-muted);
}
.personal-metrics {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}
.personal-metric {
  padding: 16px;
  background: var(--color-muted-surface);
  border-radius: 16px;
  display: grid;
  gap: 8px;
  overflow-wrap: anywhere;
}
.personal-metric span,
.personal-metric small {
  color: var(--color-text-muted);
}
.personal-metric strong {
  font-size: 20px;
  font-variant-numeric: tabular-nums;
}
@media (max-width: 1023px) {
  .personal-filter-form {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .personal-metrics {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (max-width: 767px) {
  .personal-filter-form {
    grid-template-columns: minmax(0, 1fr);
  }
  .personal-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
