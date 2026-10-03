<script setup>
import { computed, inject, nextTick, onMounted, onUnmounted, ref } from 'vue';
import {
  mdiFileUploadOutline,
  mdiFileDelimitedOutline,
  mdiDeleteOutline,
  mdiRefresh,
  mdiDownload,
  mdiEyeOutline,
} from '@mdi/js';
import { createBattleRecordClient } from '../api/battle-records.js';
import { createEventClient } from '../api/events.js';
import {
  BATTLE_COLUMNS,
  MAX_CSV_BYTES,
  parseBattleCsv,
  battleFilenameDefaults,
  taipeiBattleTime,
} from '../domain/battle-records.js';
import { eventTypeLabel } from '../domain/event-types.js';
import './battle-upload.css';
const emit = defineEmits(['open-page']);
const props = defineProps({ initialEventId: { type: String, default: null } });

const source = import.meta.env.VITE_DATA_SOURCE || 'local';
const client = createBattleRecordClient({ source }),
  eventClient = createEventClient({ source });
const csvInput = ref(null),
  files = ref([]);
const reading = ref(false),
  saving = ref(false),
  loading = ref(true),
  error = ref(''),
  notice = ref(''),
  fileError = ref(''),
  listError = ref(''),
  eventError = ref('');
const events = ref([]),
  records = ref([]),
  total = ref(0),
  page = ref(1);
const draggingCsv = ref(false);
const detailOpen = ref(false),
  detailTarget = ref(null),
  detail = ref(null),
  detailLoading = ref(false),
  detailError = ref(''),
  downloadBusy = ref(false);
const busy = computed(() => reading.value || saving.value || downloadBusy.value);
const dirty = computed(() => files.value.length > 0);
const selectedEventId = ref(null);
const selectedEvent = computed(() =>
  events.value.find((event) => event.id === selectedEventId.value),
);
const eventOptions = computed(() => [
  ...events.value
    .filter((event) => event.type !== 'activity')
    .map((event) => ({
      title: `${event.dates[0]} · ${eventTypeLabel(event.type)}${event.title ? ` · ${event.title}` : ''}`,
      value: event.id,
    })),
]);
let disposed = false,
  attempt = null,
  listToken = 0,
  detailToken = 0,
  detailOpener;
const registerGuard = inject('registerNavigationGuard', null);
const unregisterGuard = registerGuard?.(
  () => !busy.value && (!dirty.value || window.confirm('有尚未上傳的戰績, 確定要離開嗎？')),
);
function leaveWarning(event) {
  if (dirty.value || busy.value) {
    event.preventDefault();
    event.returnValue = '';
  }
}
function sizeLabel(bytes) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function removeFile(id) {
  files.value = files.value.filter((file) => file.id !== id);
  fileError.value = '';
  error.value = '';
}
async function addFiles(incoming) {
  if (busy.value) return;
  fileError.value = '';
  error.value = '';
  notice.value = '';
  reading.value = true;
  const issues = [];
  try {
    for (const file of incoming) {
      if (!/\.csv$/i.test(file.name)) {
        issues.push(`${file.name}：只支援 CSV`);
        continue;
      }
      if (file.size > MAX_CSV_BYTES) {
        issues.push(`${file.name}：不可超過 1 MB`);
        continue;
      }
      const id = `${file.name}-${file.size}-${file.lastModified}`;
      if (files.value.some((row) => row.id === id)) {
        issues.push(`${file.name}：已在待上傳清單`);
        continue;
      }
      if (files.value.length >= 2) {
        issues.push('每次最多 2 個 CSV, 請先移除檔案或送出');
        break;
      }
      try {
        const csvText = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
        const parsed = parseBattleCsv(csvText);
        if (disposed) return;
        files.value.push({
          id,
          filename: file.name,
          size: file.size,
          csvText,
          parsed,
          ...battleFilenameDefaults(file.name),
          time: battleFilenameDefaults(file.name).datetime.split('T')[1] || '',
          winner: '',
        });
      } catch (cause) {
        issues.push(
          `${file.name}：${cause instanceof TypeError ? '請使用 UTF-8 編碼' : cause.message}`,
        );
      }
    }
    fileError.value = issues.join('；');
  } finally {
    reading.value = false;
  }
}
function pickedCsv(event) {
  addFiles([...event.target.files]);
  event.target.value = '';
}
function dropCsv(event) {
  draggingCsv.value = false;
  addFiles([...event.dataTransfer.files]);
}
async function loadEvents() {
  eventError.value = '';
  try {
    const result = await eventClient.getEvents();
    if (!Array.isArray(result.events)) throw new Error('場次資料格式不正確, 請重新載入');
    if (!disposed) {
      events.value = result.events;
      if (
        !selectedEventId.value &&
        result.events.some(
          (event) => event.id === props.initialEventId && event.type !== 'activity',
        )
      )
        selectedEventId.value = props.initialEventId;
    }
  } catch (cause) {
    if (!disposed) eventError.value = `場次清單讀取失敗: ${cause.message}`;
  }
}
async function loadRecords() {
  const token = ++listToken;
  loading.value = true;
  listError.value = '';
  try {
    const result = await client.getRecords(page.value);
    if (disposed || token !== listToken) return;
    if (!Array.isArray(result.records) || !Number.isSafeInteger(result.total))
      throw new Error('戰績清單格式不正確, 請重新載入');
    records.value = result.records;
    total.value = result.total;
  } catch (cause) {
    if (!disposed && token === listToken) listError.value = cause.message;
  } finally {
    if (!disposed && token === listToken) loading.value = false;
  }
}
function changePage(value) {
  page.value = value;
  loadRecords();
}
async function submit() {
  if (busy.value) return;
  error.value = '';
  notice.value = '';
  if (!files.value.length) {
    error.value = '請先加入至少一個 CSV';
    return;
  }
  if (!selectedEvent.value) {
    error.value = '請選擇行事曆中已建立的戰鬥場次';
    return;
  }
  try {
    for (const [index, row] of files.value.entries()) {
      if (!row.redTeam.trim() || !row.blueTeam.trim() || !row.winner)
        throw new Error(`第 ${index + 1} 筆請填寫紅方、藍方與獲勝方`);
      taipeiBattleTime(`${selectedEvent.value.dates[0]}${row.time ? `T${row.time}` : ''}`);
    }
  } catch (cause) {
    error.value = cause.message;
    return;
  }
  saving.value = true;
  try {
    const input = {
      records: files.value.map(({ filename, csvText, time, redTeam, blueTeam, winner }) => ({
        filename,
        csvText,
        datetime: `${selectedEvent.value.dates[0]}${time ? `T${time}` : ''}`,
        redTeam,
        blueTeam,
        winner,
        type: selectedEvent.value.type,
        eventId: selectedEvent.value.id,
      })),
      image: null,
    };
    const encoded = JSON.stringify(input);
    if (attempt?.encoded !== encoded) attempt = { encoded, requestId: crypto.randomUUID() };
    const result = await client.saveRecords({ ...input, requestId: attempt.requestId });
    if (disposed) return;
    if (
      !Array.isArray(result.records) ||
      result.records.length !== input.records.length ||
      result.records.some((row) => !row.id)
    )
      throw new Error('上傳回應格式不正確, 請重試以確認結果');
    files.value = [];
    attempt = null;
    fileError.value = '';
    notice.value = `上傳成功, 已保存 ${result.records.length} 筆戰績`;
    page.value = 1;
    await loadRecords();
  } catch (cause) {
    if (!disposed) error.value = cause.message;
  } finally {
    saving.value = false;
  }
}
async function openDetail(record) {
  if (!detailOpen.value) detailOpener = document.activeElement;
  detailTarget.value = record;
  detailOpen.value = true;
  detail.value = null;
  detailError.value = '';
  detailLoading.value = true;
  const token = ++detailToken;
  try {
    const result = await client.getRecord(record.id);
    if (!Array.isArray(result.record?.players)) throw new Error('戰績詳情格式不正確, 請重試');
    if (!disposed && token === detailToken) detail.value = result.record;
  } catch (cause) {
    if (!disposed && token === detailToken) detailError.value = cause.message;
  } finally {
    if (!disposed && token === detailToken) detailLoading.value = false;
  }
}
function closeDetail() {
  if (downloadBusy.value) return;
  detailOpen.value = false;
  detailToken++;
}
function restoreDetailFocus() {
  nextTick(() => detailOpener?.isConnected && detailOpener.focus());
}
async function download(record, kind) {
  if (busy.value) return;
  downloadBusy.value = true;
  detailError.value = '';
  listError.value = '';
  try {
    const blob = await client.getAttachment(record.id, kind);
    if (disposed) return;
    const url = URL.createObjectURL(blob),
      link = document.createElement('a');
    link.href = url;
    link.download = kind === 'csv' ? record.filename : record.image.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (cause) {
    if (!disposed) {
      if (detailOpen.value) detailError.value = cause.message;
      else listError.value = cause.message;
    }
  } finally {
    downloadBusy.value = false;
  }
}
onMounted(() => {
  window.addEventListener('beforeunload', leaveWarning);
  loadEvents();
  loadRecords();
});
onUnmounted(() => {
  disposed = true;
  listToken++;
  detailToken++;
  unregisterGuard?.();
  window.removeEventListener('beforeunload', leaveWarning);
});
</script>

<template>
  <section class="page-heading" aria-labelledby="battle-upload-title">
    <div>
      <p class="eyebrow">GUILD MANAGER <span class="eyebrow-divider">/</span> 戰績紀錄</p>
      <h1 id="battle-upload-title">戰績上傳<span class="heading-dot">.</span></h1>
      <p class="page-subtitle">匯入遊戲戰績, 保存每一次對戰結果。</p>
    </div>
    <v-btn
      color="primary"
      :prepend-icon="mdiFileUploadOutline"
      :loading="saving"
      :disabled="busy"
      @click="submit"
      >{{ saving ? '上傳中…' : '上傳戰績' }}</v-btn
    >
  </section>
  <v-alert v-if="error" type="error" variant="tonal" role="alert" class="mb-4">{{ error }}</v-alert>
  <v-alert v-if="notice" type="success" variant="tonal" role="status" class="mb-4">{{
    notice
  }}</v-alert>
  <v-card class="battle-upload-card battle-event-card">
    <v-select
      v-model="selectedEventId"
      :items="eventOptions"
      label="戰鬥場次"
      variant="outlined"
      density="compact"
      hide-details
      :disabled="busy"
      aria-required="true"
      @update:model-value="error = ''"
    />
    <p class="battle-muted">
      {{
        selectedEvent
          ? `${selectedEvent.dates[0].replaceAll('-', '/')} · ${eventTypeLabel(selectedEvent.type)}`
          : '選擇行事曆已建立的場次, 日期與類型會自動帶入'
      }}
    </p>
    <v-btn variant="text" :disabled="busy" @click="emit('open-page', 'events')">活動安排</v-btn>
  </v-card>
  <div class="battle-upload-grid">
    <v-card class="battle-upload-card">
      <div class="section-header">
        <h2><v-icon :icon="mdiFileDelimitedOutline" size="22" /> 對戰結果 CSV</h2>
        <v-chip>{{ files.length }} / 2</v-chip>
      </div>
      <input
        ref="csvInput"
        class="sr-only"
        type="file"
        accept=".csv,text/csv"
        multiple
        aria-label="選擇戰績 CSV"
        tabindex="-1"
        :disabled="busy"
        @change="pickedCsv"
      />
      <button
        type="button"
        class="battle-dropzone"
        :class="{ 'battle-drop-active': draggingCsv }"
        :disabled="busy"
        @click="csvInput.click()"
        @dragenter.prevent="draggingCsv = true"
        @dragover.prevent
        @dragleave.prevent="draggingCsv = false"
        @drop.prevent="dropCsv"
      >
        <v-icon :icon="mdiFileUploadOutline" size="32" /><strong>選擇或拖曳 CSV 檔案</strong
        ><span>UTF-8 · 每次最多 2 個 · 每檔 1 MB</span>
      </button>
      <p v-if="reading" role="status" class="battle-muted">正在讀取檔案…</p>
      <v-alert v-if="fileError" type="error" variant="tonal" role="alert" class="mt-4">{{
        fileError
      }}</v-alert>
      <div v-for="file in files" :key="file.id" class="battle-file-item">
        <div>
          <strong :title="file.filename">{{ file.filename }}</strong
          ><span
            >{{ sizeLabel(file.size) }} · 紅方 {{ file.parsed.redCount }} 人／藍方
            {{ file.parsed.blueCount }} 人</span
          >
        </div>
        <v-btn
          variant="text"
          :icon="mdiDeleteOutline"
          :aria-label="`移除 ${file.filename}`"
          :disabled="busy"
          @click="removeFile(file.id)"
        />
      </div>
      <p v-if="!files.length" class="battle-muted">加入 CSV 後, 右側會產生對戰資料。</p>
    </v-card>
    <v-card class="battle-upload-card battle-match-card">
      <div class="section-header">
        <h2>對戰資料</h2>
        <span class="battle-muted">時間以台北時區保存</span>
      </div>
      <v-alert v-if="eventError" type="warning" variant="tonal" role="alert" class="mb-4"
        >{{ eventError
        }}<v-btn variant="text" :disabled="busy" @click="loadEvents">重新載入場次</v-btn></v-alert
      >
      <div v-if="!files.length" class="battle-empty">
        <v-icon :icon="mdiFileDelimitedOutline" size="40" />
        <p>尚未加入戰績 CSV</p>
        <span>檔名中的時間與紅／藍方會自動帶入, 上傳前可修改。</span>
      </div>
      <form
        v-for="(row, index) in files"
        :key="row.id"
        class="battle-match-form"
        @submit.prevent="submit"
      >
        <div class="battle-match-title">
          <v-chip color="primary">第 {{ index + 1 }} 筆</v-chip
          ><strong :title="row.filename">{{ row.filename }}</strong>
        </div>
        <div class="battle-match-fields">
          <v-text-field
            v-model="row.redTeam"
            label="紅方名稱"
            maxlength="120"
            variant="outlined"
            density="compact"
            hide-details
            :disabled="busy"
            aria-required="true"
          /><v-text-field
            v-model="row.blueTeam"
            label="藍方名稱"
            maxlength="120"
            variant="outlined"
            density="compact"
            hide-details
            :disabled="busy"
            aria-required="true"
          />
        </div>
        <v-select
          v-model="row.winner"
          :items="[
            { title: '紅方', value: 'red' },
            { title: '藍方', value: 'blue' },
          ]"
          label="獲勝方"
          variant="outlined"
          density="compact"
          hide-details
          :disabled="busy"
          aria-required="true"
        />
        <v-text-field
          v-model="row.time"
          type="time"
          step="1"
          label="對戰時間（選填）"
          variant="outlined"
          density="compact"
          hide-details
          :disabled="busy"
        />
        <p class="battle-muted">
          已解析 {{ row.parsed.players.length }} 筆玩家戰績 · 第一段表頭為紅方, 第二段為藍方
        </p>
        <button type="submit" class="sr-only" tabindex="-1">上傳戰績</button>
      </form>
    </v-card>
  </div>
  <v-card class="battle-upload-card battle-record-list">
    <div class="section-header">
      <div>
        <h2>已上傳戰績</h2>
        <p class="battle-muted">共 {{ total }} 筆</p>
      </div>
      <v-btn
        variant="outlined"
        :prepend-icon="mdiRefresh"
        :disabled="loading || busy"
        @click="loadRecords"
        >重新載入</v-btn
      >
    </div>
    <p v-if="loading" role="status">正在載入戰績…</p>
    <v-alert v-else-if="listError" type="error" variant="tonal" role="alert"
      >{{ listError
      }}<v-btn variant="text" :disabled="busy" @click="loadRecords">重試</v-btn></v-alert
    >
    <p v-else-if="!records.length" class="battle-muted">尚無已上傳的戰績</p>
    <template v-else
      ><div class="battle-table-wrap">
        <table class="battle-record-table">
          <thead>
            <tr>
              <th>對戰時間／類型</th>
              <th>紅方</th>
              <th>藍方</th>
              <th>獲勝方</th>
              <th>人數</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="record in records" :key="record.id">
              <td>
                {{ record.playedAt.slice(0, 19).replace('T', ' ').replaceAll('-', '/')
                }}<small
                  >{{ eventTypeLabel(record.type)
                  }}{{
                    record.event ? ` · ${record.event.title || '已關聯場次'}` : ' · 獨立上傳'
                  }}</small
                >
              </td>
              <td>{{ record.redTeam }}</td>
              <td>{{ record.blueTeam }}</td>
              <td>
                <v-chip :color="record.winner === 'red' ? 'error' : 'primary'">{{
                  record.winner === 'red' ? '紅方' : '藍方'
                }}</v-chip>
              </td>
              <td>{{ record.redCount }}／{{ record.blueCount }}</td>
              <td>
                <div class="battle-record-actions">
                  <v-btn
                    variant="text"
                    :prepend-icon="mdiEyeOutline"
                    :aria-label="`查看 ${record.redTeam} 對 ${record.blueTeam} 戰績`"
                    :disabled="busy"
                    @click="openDetail(record)"
                    >查看</v-btn
                  ><v-btn
                    variant="text"
                    :icon="mdiDownload"
                    :aria-label="`下載 ${record.filename}`"
                    :disabled="busy"
                    @click="download(record, 'csv')"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <v-pagination
        v-if="total > 20"
        :model-value="page"
        :length="Math.ceil(total / 20)"
        :disabled="loading || busy"
        aria-label="戰績清單分頁"
        @update:model-value="changePage"
    /></template>
  </v-card>
  <v-dialog
    :model-value="detailOpen"
    max-width="1100"
    :persistent="downloadBusy"
    aria-labelledby="battle-detail-title"
    @update:model-value="!$event && closeDetail()"
    @after-leave="restoreDetailFocus"
  >
    <v-card class="battle-detail-card"
      ><div class="battle-detail-content">
        <h2 id="battle-detail-title">戰績詳情</h2>
        <p v-if="detailLoading" role="status">正在載入戰績…</p>
        <v-alert v-if="detailError" type="error" variant="tonal" role="alert"
          >{{ detailError
          }}<v-btn v-if="!detail && !detailLoading" variant="text" @click="openDetail(detailTarget)"
            >重試</v-btn
          ></v-alert
        ><template v-if="detail"
          ><p>
            {{ detail.playedAt.slice(0, 19).replace('T', ' ') }} · {{ detail.redTeam }} 對
            {{ detail.blueTeam }} · {{ detail.winner === 'red' ? '紅方勝' : '藍方勝' }}
          </p>
          <div class="battle-table-wrap">
            <table class="battle-record-table battle-player-table">
              <thead>
                <tr>
                  <th>陣營</th>
                  <th v-for="[label, key] in BATTLE_COLUMNS" :key="key">{{ label }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(player, index) in detail.players" :key="index">
                  <td>{{ player.side === 'red' ? '紅方' : '藍方' }}</td>
                  <td v-for="[, key] in BATTLE_COLUMNS" :key="key">{{ player[key] ?? '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="battle-detail-downloads">
            <v-btn
              variant="outlined"
              :prepend-icon="mdiDownload"
              :disabled="busy"
              @click="download(detail, 'csv')"
              >下載原始 CSV</v-btn
            ><v-btn
              v-if="detail.image"
              variant="outlined"
              :prepend-icon="mdiDownload"
              :disabled="busy"
              @click="download(detail, 'image')"
              >下載陣容圖片</v-btn
            >
          </div></template
        >
      </div>
      <div class="battle-detail-footer">
        <v-btn variant="outlined" :disabled="downloadBusy" @click="closeDetail">關閉</v-btn>
      </div></v-card
    >
  </v-dialog>
</template>
