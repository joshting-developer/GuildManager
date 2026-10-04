<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  mdiArrowLeft,
  mdiArrowRight,
  mdiEqual,
  mdiMinus,
  mdiSort,
  mdiChevronUp,
  mdiChevronDown,
} from '@mdi/js';
import { createBattleRecordClient } from '../api/battle-records.js';
import { createMemberClient } from '../api/members.js';
import { eventTypeLabel } from '../domain/event-types.js';
import {
  battleDateLabel,
  battleResultLabel,
  battleRoundLabel,
  battleSideLabel,
  summarizeBattle,
  sortBattlePlayers,
  battlePlayerValue,
  BATTLE_TABLE_COLUMNS,
} from '../domain/battle-statistics.js';

const props = defineProps({ recordId: { type: String, required: true } });
const source = import.meta.env.VITE_DATA_SOURCE || 'local';
const client = createBattleRecordClient({ source }),
  memberClient = createMemberClient({ source });
const record = ref(null),
  loading = ref(true),
  error = ref('');
const professions = ref([]),
  professionError = ref('');
const activeSide = ref('red'),
  sortKey = ref('kill'),
  sortDirection = ref('desc'),
  page = ref(1);
const tableMode = ref('total'),
  professionFilter = ref('');
const modeOptions = [
  { value: 'total', label: '總計' },
  { value: 'per_life', label: '一命' },
];
const professionOptions = computed(() => [
  { title: '所有職業', value: '' },
  ...[...new Set((record.value?.players || []).map((player) => player.profession).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'))
    .map((name) => ({ title: name, value: name })),
]);
const teamPlayerCount = computed(
  () => record.value?.players.filter((player) => player.side === activeSide.value).length || 0,
);
const statistics = computed(() => summarizeBattle(record.value?.players || []));
const metricCards = computed(() =>
  statistics.value.metrics.map((metric) => {
    let comparison = { icon: mdiMinus, label: '資料不足, 無法比較', color: '' };
    if (!metric.partial && metric.gap != null) {
      comparison =
        metric.red.value > metric.blue.value
          ? { icon: mdiArrowLeft, label: '紅方數值較高', color: 'battle-red-text' }
          : metric.blue.value > metric.red.value
            ? { icon: mdiArrowRight, label: '藍方數值較高', color: 'battle-blue-text' }
            : { icon: mdiEqual, label: '雙方數值相同', color: '' };
    }
    return { ...metric, comparison };
  }),
);
const sortedPlayers = computed(() =>
  sortBattlePlayers(
    record.value?.players || [],
    activeSide.value,
    sortKey.value,
    sortDirection.value,
    { profession: professionFilter.value, mode: tableMode.value },
  ),
);
const pagePlayers = computed(() =>
  sortedPlayers.value.slice((page.value - 1) * 20, page.value * 20),
);
let disposed = false,
  loadToken = 0,
  professionToken = 0;

function numberLabel(value) {
  return value == null ? '—' : value.toLocaleString('zh-TW');
}
function tableColumnLabel(label, key) {
  return tableMode.value === 'per_life' && !['player', 'profession', 'seriousInjury'].includes(key)
    ? `${label}/命`
    : label;
}
function tableValueLabel(player, key) {
  const value = battlePlayerValue(player, key, tableMode.value);
  return value == null
    ? '—'
    : value.toLocaleString('zh-TW', {
        maximumFractionDigits: tableMode.value === 'per_life' ? 2 : 0,
      });
}
function professionColor(name) {
  const canonical = name === '神像' ? '神相' : name;
  const color = professions.value.find((item) => item.name === canonical)?.colorcode;
  return /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#94a3b8';
}
function toggleSort(key) {
  if (sortKey.value === key) sortDirection.value = sortDirection.value === 'desc' ? 'asc' : 'desc';
  else {
    sortKey.value = key;
    sortDirection.value = ['player', 'profession'].includes(key) ? 'asc' : 'desc';
  }
}
function ariaSort(key) {
  return sortKey.value === key
    ? sortDirection.value === 'asc'
      ? 'ascending'
      : 'descending'
    : 'none';
}
async function loadRecord() {
  const token = ++loadToken;
  loading.value = true;
  error.value = '';
  try {
    const data = await client.getRecord(props.recordId);
    if (disposed || token !== loadToken) return;
    if (!Array.isArray(data.record?.players)) throw new Error('戰績資料格式不正確, 請重新載入');
    record.value = data.record;
    activeSide.value = data.record.isInternal ? 'red' : data.record.ourSide || 'red';
    page.value = 1;
  } catch (cause) {
    if (!disposed && token === loadToken) error.value = cause.message;
  } finally {
    if (!disposed && token === loadToken) loading.value = false;
  }
}
async function loadProfessions() {
  const token = ++professionToken;
  professionError.value = '';
  try {
    const data = await memberClient.getProfessions();
    if (!Array.isArray(data.professions)) throw new Error('職業資料格式不正確');
    if (!disposed && token === professionToken) professions.value = data.professions;
  } catch {
    if (!disposed && token === professionToken) professionError.value = '職業色彩載入失敗';
  }
}
watch([activeSide, sortKey, sortDirection, tableMode, professionFilter], () => {
  page.value = 1;
});
onMounted(() => {
  loadRecord();
  loadProfessions();
});
onUnmounted(() => {
  disposed = true;
  loadToken++;
  professionToken++;
});
</script>

<template>
  <section class="page-heading" aria-labelledby="battle-detail-title">
    <div>
      <p class="eyebrow">GUILD MANAGER <span class="eyebrow-divider">/</span> 戰績閱覽</p>
      <h1 id="battle-detail-title">對戰詳情<span class="heading-dot">.</span></h1>
    </div>
    <v-btn variant="outlined" href="#/battle-records" :prepend-icon="mdiArrowLeft">返回清單</v-btn>
  </section>
  <p v-if="loading" role="status" class="battle-view-state">正在載入對戰詳情…</p>
  <v-alert v-else-if="error" type="error" variant="tonal" role="alert"
    >{{ error }}<v-btn variant="text" @click="loadRecord">重試</v-btn></v-alert
  >
  <template v-else-if="record">
    <v-card class="battle-view-card" aria-labelledby="battle-comparison-title">
      <h2 id="battle-comparison-title" class="sr-only">雙方戰績統計</h2>
      <div class="battle-team-overview">
        <section
          v-for="side in ['red', 'blue']"
          :key="side"
          :class="['battle-team-summary', `battle-side-${side}`]"
          :aria-label="`${side === 'red' ? '紅方' : '藍方'}統計`"
        >
          <p class="battle-side-label">{{ battleSideLabel(record, side) }}</p>
          <h3>{{ side === 'red' ? record.redTeam : record.blueTeam }}</h3>
          <p class="battle-view-muted">
            {{ statistics.teams[side].count }} 人
            <span v-if="!record.isInternal && record.winner === side">· 獲勝</span>
          </p>
          <div class="battle-profession-summary">
            <span
              v-for="item in statistics.teams[side].professions"
              :key="item.name"
              class="battle-profession-badge"
              ><span
                class="battle-profession-dot"
                :style="{ backgroundColor: professionColor(item.name) }"
              ></span
              >{{ item.name }} <strong>{{ item.count }}</strong></span
            >
            <span v-if="!statistics.teams[side].count" class="battle-view-muted">沒有玩家資料</span>
          </div>
        </section>
        <div class="battle-match-meta">
          <strong>{{ battleDateLabel(record.playedAt) }}</strong>
          <p>{{ eventTypeLabel(record.type) }} · {{ battleRoundLabel(record) }}</p>
          <p v-if="record.event?.title">{{ record.event.title }}</p>
          <v-chip :color="record.isInternal ? 'warning' : undefined">{{
            battleResultLabel(record)
          }}</v-chip>
          <span v-if="!record.isInternal && !record.ourSide" class="battle-view-muted"
            >我方未指定</span
          >
        </div>
      </div>
      <div class="battle-metrics-grid">
        <article v-for="metric in metricCards" :key="metric.key" class="battle-metric-card">
          <h3>{{ metric.label }}</h3>
          <div class="battle-metric-values">
            <div class="battle-metric-red">
              <span class="battle-red-text">紅方</span
              ><strong :title="numberLabel(metric.red.value)">{{
                numberLabel(metric.red.value)
              }}</strong>
            </div>
            <div
              class="battle-metric-comparison"
              :class="metric.comparison.color"
              role="img"
              :aria-label="metric.comparison.label"
              :title="metric.comparison.label"
            >
              <v-icon :icon="metric.comparison.icon" size="20" aria-hidden="true" />
            </div>
            <div class="battle-metric-blue">
              <span class="battle-blue-text">藍方</span
              ><strong :title="numberLabel(metric.blue.value)">{{
                numberLabel(metric.blue.value)
              }}</strong>
            </div>
          </div>
          <p class="battle-view-muted">
            差距 {{ numberLabel(metric.gap) }}<span v-if="metric.partial"> · 部分資料</span>
          </p>
        </article>
      </div>
      <p v-if="professionError" role="status" class="battle-view-muted mt-4">
        {{ professionError
        }}<v-btn variant="text" size="small" @click="loadProfessions">重試</v-btn>
      </p>
    </v-card>
    <v-card class="battle-view-card battle-detail-table-card" aria-labelledby="battle-player-title">
      <div class="section-header">
        <h2 id="battle-player-title">玩家戰績</h2>
        <span class="battle-view-muted" role="status">{{
          professionFilter
            ? `符合 ${sortedPlayers.length} 人／本方 ${teamPlayerCount} 人`
            : `${sortedPlayers.length} 人`
        }}</span>
      </div>
      <v-tabs v-model="activeSide" aria-label="玩家戰績陣營" class="battle-view-tabs">
        <v-tab v-for="side in ['red', 'blue']" :key="side" :value="side"
          >{{ battleSideLabel(record, side) }} ·
          {{ side === 'red' ? record.redTeam : record.blueTeam }}</v-tab
        >
      </v-tabs>
      <div class="battle-table-controls">
        <v-select
          v-model="professionFilter"
          :items="professionOptions"
          label="職業篩選"
          variant="outlined"
          density="compact"
          hide-details
        />
        <v-btn variant="text" :disabled="!professionFilter" @click="professionFilter = ''"
          >清除篩選</v-btn
        >
        <div class="battle-table-modes" role="group" aria-label="戰績顯示模式">
          <v-btn
            v-for="mode in modeOptions"
            :key="mode.value"
            :variant="tableMode === mode.value ? 'tonal' : 'text'"
            :color="tableMode === mode.value ? 'primary' : undefined"
            :aria-pressed="tableMode === mode.value"
            @click="tableMode = mode.value"
            >{{ mode.label }}</v-btn
          >
        </div>
      </div>
      <p v-if="tableMode === 'per_life'" class="battle-view-muted battle-per-life-note">
        每命貢獻＝總計 ÷ 重傷次數, 0 次重傷以 1 計算；重傷欄保留原次數。
      </p>
      <div
        class="battle-view-scroll"
        tabindex="0"
        :aria-label="`${activeSide === 'red' ? '紅方' : '藍方'}玩家戰績, 可左右捲動`"
      >
        <table class="battle-view-table battle-detail-table">
          <caption class="sr-only">
            {{
              activeSide === 'red' ? record.redTeam : record.blueTeam
            }}玩家戰績, 點擊欄位排序
          </caption>
          <thead>
            <tr>
              <th
                v-for="[label, key] in BATTLE_TABLE_COLUMNS"
                :key="key"
                scope="col"
                :aria-sort="ariaSort(key)"
                :class="{ numeric: !['player', 'profession'].includes(key) }"
              >
                <button
                  type="button"
                  class="battle-sort-button"
                  :aria-label="`${tableColumnLabel(label, key)}, ${sortKey === key ? (sortDirection === 'asc' ? '目前升冪, 點擊降冪' : '目前降冪, 點擊升冪') : '點擊排序'}`"
                  @click="toggleSort(key)"
                >
                  {{ tableColumnLabel(label, key)
                  }}<v-icon
                    :icon="
                      sortKey === key
                        ? sortDirection === 'asc'
                          ? mdiChevronUp
                          : mdiChevronDown
                        : mdiSort
                    "
                    size="16"
                  />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(player, index) in pagePlayers" :key="index">
              <td>
                <a
                  v-if="player.memberUid"
                  :href="`#/member-records/${encodeURIComponent(player.memberUid)}`"
                  :aria-label="`查看 ${player.player} 的個人戰績`"
                  >{{ player.player }}</a
                >
                <span v-else>{{ player.player || '—' }}</span>
              </td>
              <td>
                <span class="battle-profession-cell"
                  ><span
                    class="battle-profession-dot"
                    :style="{ backgroundColor: professionColor(player.profession) }"
                  ></span
                  >{{ player.profession || '—' }}</span
                >
              </td>
              <td
                v-for="[, key] in BATTLE_TABLE_COLUMNS.slice(2)"
                :key="key"
                class="numeric"
                :class="{ 'battle-sorted-cell': sortKey === key }"
              >
                {{ tableValueLabel(player, key) }}
              </td>
            </tr>
            <tr v-if="!pagePlayers.length">
              <td :colspan="BATTLE_TABLE_COLUMNS.length" class="battle-view-state">
                {{ professionFilter ? '沒有符合條件的資料' : '本方沒有玩家資料' }}
                <v-btn v-if="professionFilter" variant="text" @click="professionFilter = ''"
                  >清除職業篩選</v-btn
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <v-pagination
        v-if="sortedPlayers.length > 20"
        v-model="page"
        :length="Math.ceil(sortedPlayers.length / 20)"
        :total-visible="5"
        aria-label="玩家戰績分頁"
        class="mt-4"
      />
    </v-card>
  </template>
</template>
