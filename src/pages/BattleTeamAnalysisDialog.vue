<script setup>
import { computed, onUnmounted, ref, useId, watch } from 'vue';
import { VCardText, VCardActions, VSpacer } from 'vuetify/components';
import DataLoading from '../components/DataLoading.vue';
import { createBattleRecordClient } from '../api/battle-records.js';
import { battleDateLabel, battleRoundLabel, sortBattlePlayers } from '../domain/battle-statistics.js';
import { ATTACK_ANALYSIS_METRICS, DEFENSE_ANALYSIS_METRICS } from '../domain/team-battle-analysis.js';

const props = defineProps({ modelValue: Boolean, record: { type: Object, required: true } });
const emit = defineEmits(['update:modelValue', 'closed']);
const client = createBattleRecordClient({ source: import.meta.env.VITE_DATA_SOURCE || 'local' });
const id = useId();
const data = ref(null), loading = ref(false), error = ref('');
const side = ref('red'), tab = ref('attack1'), page = ref(1);
const sortKey = ref(null), sortDirection = ref('desc');
const current = computed(() => data.value?.sides[side.value]);
const group = computed(() => current.value?.groups.find((item) => item.id === tab.value));
const metrics = computed(() => group.value?.attack ? ATTACK_ANALYSIS_METRICS : DEFENSE_ANALYSIS_METRICS);
const rows = computed(() => tab.value === 'unclassified' ? current.value?.unclassified || [] : group.value?.rows || []);
const sortedRows = computed(() => sortKey.value ? sortBattlePlayers(rows.value.map((row) => ({
  ...row, side: side.value, player: row.name,
  ...Object.fromEntries(Object.entries(row.metrics).map(([key, metric]) => [key, metric.value])),
})), side.value, sortKey.value, sortDirection.value) : rows.value);
const pageRows = computed(() => sortedRows.value.slice((page.value - 1) * 20, page.value * 20));
const sideOptions = computed(() => [
  { title: `紅方 · ${data.value?.redTeam || props.record.redTeam}`, value: 'red' },
  { title: `藍方 · ${data.value?.blueTeam || props.record.blueTeam}`, value: 'blue' },
]);
let loadToken = 0;
const numberLabel = (value) => value == null ? '—' : value.toLocaleString('zh-TW');
const percentLabel = (value) => value == null ? '—' : `${value.toLocaleString('zh-TW', { maximumFractionDigits: 2 })}%`;
function toggleSort(key) {
  if (sortKey.value === key) sortDirection.value = sortDirection.value === 'desc' ? 'asc' : 'desc';
  else {
    sortKey.value = key;
    sortDirection.value = ['player', 'profession', 'reason'].includes(key) ? 'asc' : 'desc';
  }
}
const ariaSort = (key) => sortKey.value === key ? (sortDirection.value === 'asc' ? 'ascending' : 'descending') : 'none';
const sortLabel = (label, key) => `${label}，${sortKey.value === key ? (sortDirection.value === 'asc' ? '目前升冪，點擊降冪' : '目前降冪，點擊升冪') : '點擊排序'}`;
const sortIndicator = (key) => sortKey.value === key ? (sortDirection.value === 'asc' ? '↑' : '↓') : '↕';
async function load() {
  if (!props.modelValue) return;
  const token = ++loadToken, recordId = props.record.id;
  loading.value = true;
  error.value = '';
  data.value = null;
  try {
    const result = await client.getTeamAnalysis(recordId);
    if (token !== loadToken || !props.modelValue) return;
    if (result.recordId !== recordId || !['red', 'blue'].every((key) =>
      result.sides?.[key]?.groups?.length === 4 && Array.isArray(result.sides[key].unclassified)))
      throw new Error('團隊分析資料格式不正確，請重新載入');
    data.value = result;
    if (result.unavailable) tab.value = 'unclassified';
  } catch (cause) {
    if (token === loadToken && props.modelValue) error.value = cause.message;
  } finally {
    if (token === loadToken) loading.value = false;
  }
}
watch(() => [props.modelValue, props.record.id], () => {
  loadToken++;
  data.value = null;
  error.value = '';
  side.value = !props.record.isInternal && props.record.ourSide || 'red';
  tab.value = 'attack1';
  page.value = 1;
  sortKey.value = null;
  if (props.modelValue) load();
}, { immediate: true, flush: 'sync' });
watch([side, tab], () => {
  page.value = 1;
  const visibleKeys = ['player', 'profession', ...(tab.value === 'unclassified' ? ['reason'] : metrics.value.map(([, key]) => key))];
  if (!visibleKeys.includes(sortKey.value)) sortKey.value = null;
});
watch([sortKey, sortDirection], () => { page.value = 1; });
onUnmounted(() => { loadToken++; });
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="1440" scrollable :aria-labelledby="`${id}-title`"
    @update:model-value="emit('update:modelValue', $event)" @after-leave="emit('closed')">
    <v-card class="team-analysis-card">
      <div class="team-analysis-heading">
        <div>
          <p class="battle-view-muted">{{ battleDateLabel(record.playedAt) }} · {{ battleRoundLabel(record) }}</p>
          <h2 :id="`${id}-title`">團隊分析</h2>
        </div>
        <v-btn variant="text" :disabled="loading" @click="load">重新載入</v-btn>
      </div>
      <v-card-text class="team-analysis-content" :aria-busy="loading">
        <DataLoading v-if="loading">正在載入排表與團隊戰績…</DataLoading>
        <v-alert v-else-if="error" type="error" variant="tonal" role="alert">
          {{ error }}<v-btn variant="text" @click="load">重試</v-btn>
        </v-alert>
        <template v-else-if="data">
          <v-alert v-if="data.unavailable" type="info" variant="tonal" class="mb-4">{{ data.unavailable }}</v-alert>
          <p v-else class="battle-view-muted mb-4">
            依本活動最後儲存的排表分團（{{ battleDateLabel(data.lineup.savedAt) }}）。重新儲存排表後，分析會隨之更新。
          </p>
          <div class="team-analysis-controls">
            <v-select v-model="side" :items="sideOptions" label="分析陣營" hide-details />
            <p class="battle-view-muted">團內％＝個人 ÷ 本團合計；全場％＝個人 ÷ 同陣營全部玩家合計（含未歸類）。</p>
          </div>
          <v-tabs v-model="tab" color="primary" aria-label="分析團別" class="my-4">
            <v-tab v-for="item in current.groups" :id="`${id}-${item.id}-tab`" :key="item.id"
              :value="item.id" :aria-controls="`${id}-${item.id}-panel`">
              {{ item.name }}（{{ item.rows.length }}）
            </v-tab>
            <v-tab :id="`${id}-unclassified-tab`" value="unclassified" :aria-controls="`${id}-unclassified-panel`">
              未歸類（{{ current.unclassified.length }}）
            </v-tab>
          </v-tabs>
          <div :id="`${id}-${tab}-panel`" role="tabpanel" :aria-labelledby="`${id}-${tab}-tab`">
            <p class="battle-view-muted mb-4">
              {{ tab === 'unclassified' ? '未歸類' : group.name }} {{ rows.length }} 人 · 本陣營 {{ current.count }} 人
              <span v-if="tab === 'unclassified'"> · 不計入四團合計</span>
            </p>
            <p v-if="!rows.length" class="battle-view-state">{{ tab === 'unclassified' ? '本陣營沒有未歸類玩家。' : '本團沒有對應到本場戰績的玩家。' }}</p>
            <template v-else>
              <section v-if="tab !== 'unclassified'" :aria-labelledby="`${id}-summary-title`" class="mb-6">
                <h3 :id="`${id}-summary-title`" class="team-analysis-section-title">本團合計</h3>
                <div class="battle-view-scroll" tabindex="0" aria-label="本團合計表格，可橫向捲動">
                  <table class="battle-view-table team-analysis-table team-analysis-summary">
                    <caption class="sr-only">{{ group.name }}本團合計及占同陣營全場比例</caption>
                    <thead>
                      <tr>
                        <th scope="col">統計</th>
                        <th v-for="[label, key] in metrics" :key="key" scope="col" class="numeric">{{ label }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th scope="row">本團合計</th>
                        <td v-for="[, key] in metrics" :key="key" class="numeric">
                          <strong>{{ numberLabel(group.totals[key].value) }}</strong>
                          <span v-if="group.totals[key].missing" class="team-analysis-percent">部分資料</span>
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">占全場％</th>
                        <td v-for="[, key] in metrics" :key="key" class="numeric">{{ percentLabel(group.totals[key].wholePercent) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p class="battle-view-muted mt-3">占全場％＝本團合計 ÷ 同陣營全部玩家合計（含未歸類）。</p>
              </section>
              <h3 v-if="tab !== 'unclassified'" :id="`${id}-individual-title`" class="team-analysis-section-title">個人明細</h3>
              <div class="battle-view-scroll" tabindex="0" aria-label="團隊分析表格，可橫向捲動">
                <table class="battle-view-table team-analysis-table team-analysis-individual">
                  <caption class="sr-only">{{ tab === 'unclassified' ? '未歸類玩家' : `${group.name}個人數值及團內與全場貢獻` }}</caption>
                  <thead>
                    <tr>
                      <th scope="col" :aria-sort="ariaSort(['player', 'profession'].includes(sortKey) ? sortKey : 'player')">
                        <button v-for="[label, key] in [['角色名稱', 'player'], ['職業', 'profession']]" :key="key"
                          type="button" class="team-analysis-sort" :aria-label="sortLabel(label, key)" @click="toggleSort(key)">
                          {{ label }} <span aria-hidden="true">{{ sortIndicator(key) }}</span>
                        </button>
                      </th>
                      <th v-if="tab === 'unclassified'" scope="col" :aria-sort="ariaSort('reason')">
                        <button type="button" class="team-analysis-sort" :aria-label="sortLabel('未歸類原因', 'reason')" @click="toggleSort('reason')">
                          未歸類原因 <span aria-hidden="true">{{ sortIndicator('reason') }}</span>
                        </button>
                      </th>
                      <template v-else>
                        <th v-for="[label, key] in metrics" :key="key" scope="col" class="numeric" :aria-sort="ariaSort(key)">
                          <button type="button" class="team-analysis-sort" :aria-label="sortLabel(label, key)" @click="toggleSort(key)">
                            {{ label }} <span aria-hidden="true">{{ sortIndicator(key) }}</span>
                          </button>
                        </th>
                      </template>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in pageRows" :key="row.playerIndex">
                      <th scope="row" class="team-analysis-player">
                        <strong>{{ row.name }}</strong><span>{{ row.profession }}</span>
                        <span v-if="row.teamName">{{ row.teamName }}</span>
                      </th>
                      <td v-if="tab === 'unclassified'">{{ row.reason }}</td>
                      <template v-else>
                        <td v-for="[, key] in metrics" :key="key" class="numeric">
                          <strong>{{ numberLabel(row.metrics[key].value) }}</strong>
                          <span class="team-analysis-percent">團內 {{ percentLabel(row.metrics[key].groupPercent) }}</span>
                          <span class="team-analysis-percent">全場 {{ percentLabel(row.metrics[key].wholePercent) }}</span>
                        </td>
                      </template>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
            <p v-if="tab !== 'unclassified' && rows.length" class="battle-view-muted mt-3">
              缺值、合計為 0 或分母資料不完整時，比例顯示 —。重傷比例僅表示次數占比。
            </p>
            <v-pagination v-if="rows.length > 20" v-model="page" :length="Math.ceil(rows.length / 20)" :total-visible="4" aria-label="團隊分析分頁" class="mt-3" />
          </div>
        </template>
      </v-card-text>
      <v-card-actions class="team-analysis-actions">
        <v-spacer />
        <v-btn variant="outlined" @click="emit('update:modelValue', false)">關閉</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.team-analysis-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 24px 24px 16px; }
.team-analysis-heading h2 { font-size: 24px; }
.team-analysis-content { padding: 0 24px 24px; min-height: 160px; }
.team-analysis-controls { display: flex; align-items: center; gap: 20px; }
.team-analysis-controls .v-select { flex: 0 0 300px; }
.team-analysis-table { min-width: 1060px; }
.team-analysis-table th:first-child { min-width: 180px; position: sticky; left: 0; z-index: 1; }
.team-analysis-player { background: white; text-align: left; font-weight: 400; overflow-wrap: anywhere; max-width: 230px; }
.team-analysis-player strong { display: block; color: var(--color-text); }
.team-analysis-player span, .team-analysis-percent { display: block; color: var(--color-text-muted); font-size: 12px; font-weight: 400; line-height: 1.7; }
.team-analysis-section-title { font-size: 18px; margin-bottom: 12px; }
.team-analysis-sort { display: inline-flex; align-items: center; gap: 4px; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; padding: 6px 0; min-height: 44px; }
.team-analysis-sort + .team-analysis-sort { margin-left: 8px; }
.team-analysis-sort span { color: var(--color-primary); }
.team-analysis-summary th:first-child { background: var(--color-muted-surface); }
.team-analysis-actions { justify-content: flex-end; border-top: 1px solid var(--color-border); padding: 16px 24px; }
@media (max-width: 767px) {
  .team-analysis-heading { padding: 16px; }
  .team-analysis-content { padding: 0 16px 16px; }
  .team-analysis-controls { flex-direction: column; align-items: stretch; gap: 12px; }
  .team-analysis-controls .v-select { flex-basis: auto; }
  .team-analysis-actions { padding: 12px 16px; }
}
</style>
