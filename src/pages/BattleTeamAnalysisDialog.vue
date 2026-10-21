<script setup>
import { computed, ref, useId, watch, defineAsyncComponent } from 'vue';
import { VCardText, VCardActions, VSpacer } from 'vuetify/components';
import DataLoading from '../components/DataLoading.vue';
import { battleDateLabel, battleRoundLabel, sortBattlePlayers } from '../domain/battle-statistics.js';
import { ATTACK_ANALYSIS_METRICS, DEFENSE_ANALYSIS_METRICS, defenseComparisonGroups } from '../domain/team-battle-analysis.js';

const TeamComparisonCharts = defineAsyncComponent({ loader: () => import('../components/TeamComparisonCharts.vue'), loadingComponent: DataLoading, delay: 0 });
const props = defineProps({ modelValue: Boolean, record: { type: Object, required: true },
  mode: { type: String, default: 'attack' }, analysis: { type: Object, default: null }, error: { type: String, default: '' } });
const emit = defineEmits(['update:modelValue', 'closed', 'reload']);
const id = useId();
const side = ref('red'), tab = ref('comparison'), page = ref(1), unclassifiedPage = ref(1);
const firstPair = ref(['defense1', 'defense2']);
const sortKey = ref(null), sortDirection = ref('desc');
const unclassifiedSort = ref(null), unclassifiedDirection = ref('asc');
const comparisonTables = [{ key: 'value', label: '數值' }, { key: 'wholePercent', label: '占全場％' }];
const data = computed(() => props.analysis);
const current = computed(() => data.value?.sides[side.value]);
const groups = computed(() => current.value?.groups.filter(group => group.attack === (props.mode === 'attack')) || []);
const group = computed(() => groups.value.find(item => item.id === tab.value));
const metrics = computed(() => props.mode === 'attack' ? ATTACK_ANALYSIS_METRICS : DEFENSE_ANALYSIS_METRICS);
const comparedGroups = computed(() => props.mode === 'attack' ? groups.value : current.value ? defenseComparisonGroups(current.value, firstPair.value) : []);
const rows = computed(() => group.value?.rows || []);
const sortedRows = computed(() => sortKey.value ? sortBattlePlayers(rows.value.map(row => ({
  ...row, side: side.value, player: row.name,
  ...Object.fromEntries(Object.entries(row.metrics).map(([key, metric]) => [key, metric.value])),
})), side.value, sortKey.value, sortDirection.value) : rows.value);
const pageRows = computed(() => sortedRows.value.slice((page.value - 1) * 20, page.value * 20));
const unclassified = computed(() => current.value?.unclassified || []);
const sortedUnclassified = computed(() => unclassifiedSort.value ? sortBattlePlayers(unclassified.value.map(row => ({ ...row, side: side.value, player: row.name })), side.value, unclassifiedSort.value, unclassifiedDirection.value) : unclassified.value);
const unclassifiedRows = computed(() => sortedUnclassified.value.slice((unclassifiedPage.value - 1) * 20, unclassifiedPage.value * 20));
const sideOptions = computed(() => [
  { title: `紅方 · ${props.record.redTeam}`, value: 'red' },
  { title: `藍方 · ${props.record.blueTeam}`, value: 'blue' },
]);
const numberLabel = value => value == null ? '—' : value.toLocaleString('zh-TW');
const percentLabel = value => value == null ? '—' : `${value.toLocaleString('zh-TW', { maximumFractionDigits: 2 })}%`;
function toggleSort(key) {
  if (sortKey.value === key) sortDirection.value = sortDirection.value === 'desc' ? 'asc' : 'desc';
  else { sortKey.value = key; sortDirection.value = ['player', 'profession'].includes(key) ? 'asc' : 'desc'; }
}
function togglePair(groupId, checked) {
  firstPair.value = checked ? [...firstPair.value, groupId] : firstPair.value.filter(value => value !== groupId);
}
function sortUnclassified(key) {
  unclassifiedDirection.value = unclassifiedSort.value === key && unclassifiedDirection.value === 'asc' ? 'desc' : 'asc';
  unclassifiedSort.value = key;
  unclassifiedPage.value = 1;
}
const unclassifiedAriaSort = key => unclassifiedSort.value === key ? (unclassifiedDirection.value === 'asc' ? 'ascending' : 'descending') : 'none';
const ariaSort = key => sortKey.value === key ? (sortDirection.value === 'asc' ? 'ascending' : 'descending') : 'none';
const sortLabel = (label, key) => `${label}，${sortKey.value === key ? (sortDirection.value === 'asc' ? '目前升冪，點擊降冪' : '目前降冪，點擊升冪') : '點擊排序'}`;
const sortIndicator = key => sortKey.value === key ? (sortDirection.value === 'asc' ? '↑' : '↓') : '↕';
watch(() => [props.modelValue, props.record.id, props.mode], () => {
  if (!props.modelValue) return;
  side.value = !props.record.isInternal && props.record.ourSide || 'red';
  tab.value = 'comparison'; page.value = 1; unclassifiedPage.value = 1; sortKey.value = null;
}, { immediate: true });
watch([side, tab, sortKey, sortDirection], () => { page.value = 1; unclassifiedPage.value = 1; });
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="1440" scrollable :aria-labelledby="`${id}-title`"
    @update:model-value="emit('update:modelValue', $event)" @after-leave="emit('closed')">
    <v-card class="team-analysis-card">
      <div class="team-analysis-heading">
        <div><p class="battle-view-muted">{{ battleDateLabel(record.playedAt) }} · {{ battleRoundLabel(record) }}</p>
          <h2 :id="`${id}-title`">{{ mode === 'attack' ? '進攻分析' : '防守分析' }}</h2></div>
        <v-btn variant="text" @click="emit('reload')">重新載入詳情</v-btn>
      </div>
      <v-card-text class="team-analysis-content">
        <v-alert v-if="error || !data" type="error" variant="tonal" role="alert">{{ error || '分團資料未載入，請重新載入對戰詳情。' }}<v-btn variant="text" @click="emit('reload')">重試</v-btn></v-alert>
        <template v-else>
          <v-alert v-if="data.unavailable" type="info" variant="tonal" class="mb-4">{{ data.unavailable }}</v-alert>
          <p v-else class="battle-view-muted mb-4">依詳情載入時的最後儲存排表分團（{{ battleDateLabel(data.lineup.savedAt) }}）。排表另有更新時，請重新載入詳情。</p>
          <div class="team-analysis-controls">
            <v-select v-model="side" :items="sideOptions" label="分析陣營" hide-details />
            <p class="battle-view-muted">團內％＝個人數值 ÷ 所屬團總值；全場％＝個人數值 ÷ 同陣營全部玩家合計（含未歸類）。</p>
          </div>
          <v-tabs v-model="tab" color="primary" :aria-label="mode === 'attack' ? '進攻分析分頁' : '防守分析分頁'" class="my-4">
            <v-tab :id="`${id}-comparison-tab`" value="comparison" :aria-controls="`${id}-comparison-panel`">{{ mode === 'attack' ? '團比較' : '團分析' }}</v-tab>
            <v-tab v-for="item in groups" :id="`${id}-${item.id}-tab`" :key="item.id" :value="item.id" :aria-controls="`${id}-${item.id}-panel`">{{ item.name }}{{ mode === 'attack' ? '個人明細' : '' }}（{{ item.rows.length }}）</v-tab>
          </v-tabs>
          <div :id="`${id}-${tab}-panel`" role="tabpanel" :aria-labelledby="`${id}-${tab}-tab`">
            <template v-if="tab === 'comparison'">
              <section v-for="comparison in comparisonTables" :key="comparison.key" class="mb-6">
                <h3 class="team-analysis-section-title">各{{ mode === 'attack' ? '團' : '隊' }}{{ comparison.label }}</h3>
                <p v-if="comparison.key === 'wholePercent'" class="battle-view-muted mb-3">各指標以同陣營全部玩家的合計為分母，包含未歸類玩家。</p>
                <div class="battle-view-scroll" tabindex="0" :aria-label="`${comparison.label}比較表格，可橫向捲動`">
                  <table class="battle-view-table team-analysis-table team-analysis-summary" :class="`team-analysis-${comparison.key}`">
                    <caption class="sr-only">各{{ mode === 'attack' ? '團' : '隊' }}{{ comparison.label }}</caption>
                    <thead><tr><th scope="col">{{ mode === 'attack' ? '團別' : '隊別' }}</th><th v-for="[label, key] in metrics" :key="key" scope="col" class="numeric">{{ label }}</th></tr></thead>
                    <tbody><tr v-for="item in groups" :key="item.id"><th scope="row"><strong>{{ item.name }}</strong><span class="team-analysis-percent">{{ item.rows.length }} 人</span></th>
                      <td v-for="[, key] in metrics" :key="key" class="numeric"><strong>{{ comparison.key === 'value' ? numberLabel(item.totals[key].value) : percentLabel(item.totals[key].wholePercent) }}</strong><span v-if="comparison.key === 'value' && item.totals[key].missing" class="team-analysis-percent">部分資料</span></td>
                    </tr></tbody>
                  </table>
                </div>
              </section>
              <fieldset v-if="mode === 'defense'" class="defense-pair-controls">
                <legend>比較組 A：選擇兩隊</legend>
                <label v-for="item in groups" :key="item.id"><input type="checkbox" :checked="firstPair.includes(item.id)" :disabled="!firstPair.includes(item.id) && firstPair.length >= 2" @change="togglePair(item.id, $event.target.checked)" />{{ item.name }}</label>
                <p class="battle-view-muted">比較組 B 自動使用其餘兩隊，同一隊只計算一次。</p>
              </fieldset>
              <p v-if="mode === 'defense' && !comparedGroups.length" class="battle-view-state" role="status">請選好兩隊以比較。</p>
              <template v-else>
                <h3 class="team-analysis-section-title">{{ mode === 'attack' ? '兩團指標占比' : '配對指標占比' }}</h3>
                <TeamComparisonCharts v-if="modelValue" :groups="comparedGroups" :metrics="metrics" />
              </template>
              <details v-if="unclassified.length" class="team-unclassified mt-4">
                <summary>未歸類（{{ unclassified.length }} 人）：查看原因</summary>
                <p class="battle-view-muted">未歸類仍列入同陣營全場分母，不填入任何團或隊。</p>
                <div class="battle-view-scroll" tabindex="0" aria-label="未歸類玩家與原因"><table class="battle-view-table"><thead><tr><th scope="col" :aria-sort="unclassifiedAriaSort(unclassifiedSort === 'profession' ? 'profession' : 'player')"><button v-for="[label, key] in [['姓名', 'player'], ['職業', 'profession']]" :key="key" type="button" class="team-analysis-sort" :aria-label="`按${label}排序未歸類玩家`" @click="sortUnclassified(key)">{{ label }} {{ unclassifiedSort === key ? (unclassifiedDirection === 'asc' ? '↑' : '↓') : '↕' }}</button></th><th scope="col" :aria-sort="unclassifiedAriaSort('reason')"><button type="button" class="team-analysis-sort" aria-label="按原因排序未歸類玩家" @click="sortUnclassified('reason')">原因 {{ unclassifiedSort === 'reason' ? (unclassifiedDirection === 'asc' ? '↑' : '↓') : '↕' }}</button></th></tr></thead><tbody><tr v-for="row in unclassifiedRows" :key="row.playerIndex"><th scope="row">{{ row.name }}<span class="team-analysis-percent">{{ row.profession }}</span></th><td>{{ row.reason }}</td></tr></tbody></table></div>
                <v-pagination v-if="unclassified.length > 20" v-model="unclassifiedPage" :length="Math.ceil(unclassified.length / 20)" :total-visible="4" aria-label="未歸類玩家分頁" />
              </details>
            </template>
            <template v-else-if="group">
              <p class="battle-view-muted mb-4">{{ group.name }} {{ rows.length }} 人 · 本陣營 {{ current.count }} 人</p>
              <p v-if="!rows.length" class="battle-view-state">本團沒有對應到本場戰績的玩家。</p>
              <template v-else>
                <h3 class="team-analysis-section-title">個人明細</h3>
                <div class="battle-view-scroll" tabindex="0" aria-label="個人明細表格，可橫向捲動">
                  <table class="battle-view-table team-analysis-table team-analysis-individual">
                    <caption class="sr-only">{{ group.name }}個人數值及團內與全場貢獻</caption>
                    <thead><tr>
                      <th scope="col" :aria-sort="ariaSort(['player', 'profession'].includes(sortKey) ? sortKey : 'player')"><button v-for="[label, key] in [['角色名稱', 'player'], ['職業', 'profession']]" :key="key" type="button" class="team-analysis-sort" :aria-label="sortLabel(label, key)" @click="toggleSort(key)">{{ label }} <span aria-hidden="true">{{ sortIndicator(key) }}</span></button></th>
                      <th v-for="[label, key] in metrics" :key="key" scope="col" class="numeric" :aria-sort="ariaSort(key)"><button type="button" class="team-analysis-sort" :aria-label="sortLabel(label, key)" @click="toggleSort(key)">{{ label }} <span aria-hidden="true">{{ sortIndicator(key) }}</span></button></th>
                    </tr></thead>
                    <tbody><tr v-for="row in pageRows" :key="row.playerIndex"><th scope="row" class="team-analysis-player"><strong>{{ row.name }}</strong><span>{{ row.profession }}</span><span v-if="row.teamName">{{ row.teamName }}</span></th>
                      <td v-for="[, key] in metrics" :key="key" class="numeric"><strong>{{ numberLabel(row.metrics[key].value) }}</strong><span class="team-analysis-percent">團內 {{ percentLabel(row.metrics[key].groupPercent) }}</span><span class="team-analysis-percent">全場 {{ percentLabel(row.metrics[key].wholePercent) }}</span></td>
                    </tr></tbody>
                  </table>
                </div>
                <p class="battle-view-muted mt-3">缺值、合計為 0 或分母資料不完整時，比例顯示 —。重傷比例僅表示次數占比。</p>
                <v-pagination v-if="rows.length > 20" v-model="page" :length="Math.ceil(rows.length / 20)" :total-visible="4" aria-label="個人明細分頁" class="mt-3" />
              </template>
            </template>
          </div>
        </template>
      </v-card-text>
      <v-card-actions class="team-analysis-actions"><v-spacer /><v-btn variant="outlined" @click="emit('update:modelValue', false)">關閉</v-btn></v-card-actions>
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
.team-analysis-player { background: var(--color-surface); text-align: left; font-weight: 400; overflow-wrap: anywhere; max-width: 230px; }
.team-analysis-player strong { display: block; color: var(--color-text); }
.team-analysis-player span, .team-analysis-percent { display: block; color: var(--color-text-muted); font-size: 13px; font-weight: 400; line-height: 1.7; }
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
.defense-pair-controls { border: 1px solid var(--color-border); border-radius: 12px; padding: 16px; margin-bottom: 24px; }
.defense-pair-controls label { display: inline-flex; align-items: center; gap: 8px; margin-right: 20px; min-height: 44px; }
.defense-pair-controls input { width: 22px; height: 22px; }
.team-unclassified summary { cursor: pointer; padding: 12px 0; }
</style>
