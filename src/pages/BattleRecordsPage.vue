<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { mdiRefresh, mdiArrowRight } from '@mdi/js';
import { createBattleRecordClient } from '../api/battle-records.js';
import { eventTypeLabel } from '../domain/event-types.js';
import {
  battleDateLabel,
  battleResultLabel,
  battleRoundLabel,
} from '../domain/battle-statistics.js';
import BattleRecordDetail from './BattleRecordDetail.vue';
import './battle-record-view.css';

const props = defineProps({ recordId: { type: String, default: null } });
const client = createBattleRecordClient({ source: import.meta.env.VITE_DATA_SOURCE || 'local' });
const records = ref([]),
  total = ref(0),
  page = ref(1),
  pageSize = ref(20);
const loading = ref(false),
  error = ref(''),
  loaded = ref(false);
const pageCount = computed(() => Math.ceil(total.value / pageSize.value));
let disposed = false,
  loadToken = 0,
  lastRecordId = null;

async function loadRecords() {
  const token = ++loadToken;
  loading.value = true;
  error.value = '';
  try {
    const data = await client.getRecords(page.value);
    if (disposed || token !== loadToken) return;
    if (!Array.isArray(data.records) || !Number.isSafeInteger(data.total) || !data.pageSize)
      throw new Error('戰績清單格式不正確, 請重新載入');
    records.value = data.records;
    total.value = data.total;
    pageSize.value = data.pageSize;
    loaded.value = true;
  } catch (cause) {
    if (!disposed && token === loadToken) error.value = cause.message;
  } finally {
    if (!disposed && token === loadToken) loading.value = false;
  }
}
watch(page, loadRecords);
watch(
  () => props.recordId,
  async (id, previous) => {
    if (id) lastRecordId = id;
    else if (!loaded.value) loadRecords();
    else if (previous) {
      await nextTick();
      document.getElementById(`battle-link-${lastRecordId}`)?.focus({ preventScroll: true });
    }
  },
);
onMounted(() => {
  lastRecordId = props.recordId;
  if (!props.recordId) loadRecords();
});
onUnmounted(() => {
  disposed = true;
  loadToken++;
});
</script>

<template>
  <BattleRecordDetail v-if="recordId" :key="recordId" :record-id="recordId" />
  <template v-else>
    <section class="page-heading" aria-labelledby="battle-records-title">
      <div>
        <p class="eyebrow">GUILD MANAGER <span class="eyebrow-divider">/</span> 戰績紀錄</p>
        <h1 id="battle-records-title">戰績閱覽<span class="heading-dot">.</span></h1>
      </div>
      <v-btn variant="outlined" :prepend-icon="mdiRefresh" :disabled="loading" @click="loadRecords"
        >重新載入</v-btn
      >
    </section>
    <v-card class="battle-view-card" aria-labelledby="battle-list-title" :aria-busy="loading">
      <div class="section-header">
        <h2 id="battle-list-title">戰績清單</h2>
        <span v-if="loaded && !error" class="battle-view-muted">共 {{ total }} 場</span>
      </div>
      <p v-if="loading" role="status" class="battle-view-state">正在載入戰績…</p>
      <v-alert v-else-if="error" type="error" variant="tonal" role="alert">
        {{ error }}<v-btn variant="text" @click="loadRecords">重試</v-btn>
      </v-alert>
      <p v-else-if="!records.length" class="battle-view-state">尚無已上傳的戰績</p>
      <template v-else>
        <div class="battle-view-scroll" tabindex="0" aria-label="戰績清單, 可左右捲動">
          <table class="battle-view-table battle-list-table">
            <caption class="sr-only">
              已上傳戰績, 點選對戰名稱查看詳情
            </caption>
            <thead>
              <tr>
                <th scope="col">日期／場次</th>
                <th scope="col">對戰</th>
                <th scope="col">結果</th>
                <th scope="col" class="numeric">人數（紅／藍）</th>
                <th scope="col">詳情</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="record in records" :key="record.id">
                <td>
                  <strong>{{ battleDateLabel(record.playedAt) }}</strong>
                  <p class="battle-view-muted">
                    {{ eventTypeLabel(record.type) }} · {{ battleRoundLabel(record) }}
                  </p>
                </td>
                <td>
                  <a
                    :id="`battle-link-${record.id}`"
                    class="battle-match-link"
                    :href="`#/battle-records/${encodeURIComponent(record.id)}`"
                    >{{ record.redTeam }} <span class="battle-view-muted">對</span>
                    {{ record.blueTeam }}</a
                  >
                  <p v-if="record.event?.title" class="battle-view-muted">
                    {{ record.event.title }}
                  </p>
                </td>
                <td>
                  <v-chip
                    :color="
                      record.isInternal
                        ? 'warning'
                        : record.winner === 'red'
                          ? 'error'
                          : record.winner === 'blue'
                            ? 'primary'
                            : undefined
                    "
                    >{{ battleResultLabel(record) }}</v-chip
                  >
                </td>
                <td class="numeric">{{ record.redCount }}／{{ record.blueCount }}</td>
                <td>
                  <v-btn
                    variant="text"
                    :append-icon="mdiArrowRight"
                    :href="`#/battle-records/${encodeURIComponent(record.id)}`"
                    :aria-label="`查看 ${record.redTeam} 對 ${record.blueTeam} 的${battleRoundLabel(record)}戰績`"
                    >查看</v-btn
                  >
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
          aria-label="戰績清單分頁"
          class="mt-4"
        />
      </template>
    </v-card>
  </template>
</template>
