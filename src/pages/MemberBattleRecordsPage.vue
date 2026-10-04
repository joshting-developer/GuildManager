<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { createMemberClient } from '../api/members.js';
import { eventTypeLabel } from '../domain/event-types.js';
import {
  battleDateLabel,
  battleRoundLabel,
  battlePlayerValue,
  BATTLE_TABLE_COLUMNS,
} from '../domain/battle-statistics.js';
import './battle-record-view.css';

const props = defineProps({ memberUid: { type: String, required: true } });
const client = createMemberClient({ source: import.meta.env.VITE_DATA_SOURCE || 'local' });
const data = ref(null),
  loading = ref(true),
  error = ref(''),
  page = ref(1);
const summaryMode = ref('total'),
  tableMode = ref('total');
const summaryModes = [
  { value: 'total', label: '合計' },
  { value: 'average', label: '每筆平均' },
  { value: 'perLife', label: '一命貢獻' },
];
const pageCount = computed(() => Math.ceil((data.value?.total || 0) / 20));
let disposed = false,
  version = 0;

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
async function load() {
  const current = ++version;
  loading.value = true;
  error.value = '';
  try {
    const result = await client.getBattleRecords(props.memberUid, page.value);
    if (disposed || current !== version) return;
    if (
      !result.member?.name ||
      !Array.isArray(result.entries) ||
      !Array.isArray(result.summary?.metrics) ||
      !Number.isSafeInteger(result.total)
    )
      throw new Error('個人戰績格式不正確，請重新載入');
    data.value = result;
  } catch (cause) {
    if (!disposed && current === version) error.value = cause.message;
  } finally {
    if (!disposed && current === version) loading.value = false;
  }
}
watch(page, load);
onMounted(load);
onUnmounted(() => {
  disposed = true;
  version++;
});
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
  <p v-if="loading" role="status">正在載入個人戰績…</p>
  <v-alert v-else-if="error" type="error" variant="tonal" role="alert">
    {{ error }}<v-btn variant="text" @click="load">重試</v-btn>
  </v-alert>
  <template v-else-if="data">
    <v-card class="battle-view-card mb-6">
      <div class="section-header">
        <h2>參戰統計</h2>
        <p>{{ data.summary.battleCount }} 場 · {{ data.summary.rowCount }} 筆參戰數據</p>
      </div>
      <p class="personal-result">
        勝 {{ data.summary.wins }} 場 · 敗 {{ data.summary.losses }} 場 · 內推／未判定
        {{ data.summary.unknown }} 場
      </p>
      <p v-if="!data.total" class="battle-view-state">尚無已關聯的個人戰績</p>
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
          <div v-for="metric in data.summary.metrics" :key="metric.key" class="personal-metric">
            <span>{{ metric.label }}</span>
            <strong>{{ numberLabel(metric[summaryMode]) }}</strong>
            <small v-if="missingCount(metric)">缺 {{ missingCount(metric) }} 筆資料</small>
          </div>
        </div>
      </template>
      <p class="battle-view-muted mt-4">
        僅統計上傳時名稱能唯一對應的戰績。舊未關聯紀錄不計入；同場有兩筆數據時均保留，但場數只計一次。
      </p>
    </v-card>
    <v-card v-if="data.total" class="battle-view-card">
      <div class="section-header">
        <h2>各場戰績</h2>
        <div class="personal-actions" role="group" aria-label="個人明細模式">
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
      <div class="battle-view-scroll" tabindex="0" aria-label="個人各場戰績，可左右捲動">
        <table class="battle-view-table">
          <caption class="sr-only">
            各場參戰數據，點擊日期查看對戰詳情
          </caption>
          <thead>
            <tr>
              <th scope="col">場次</th>
              <th scope="col">隊伍／結果</th>
              <th
                v-for="[label, key] in BATTLE_TABLE_COLUMNS"
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
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in data.entries" :key="`${entry.recordId}:${entry.playerIndex}`">
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
              <td v-for="[, key] in BATTLE_TABLE_COLUMNS.slice(2)" :key="key" class="numeric">
                {{ numberLabel(battlePlayerValue(entry.player, key, tableMode)) }}
              </td>
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
  </template>
</template>

<style scoped>
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
  .personal-metrics {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (max-width: 767px) {
  .personal-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
