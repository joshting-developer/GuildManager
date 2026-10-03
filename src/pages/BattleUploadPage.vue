<script setup>
import { computed, inject, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { VSwitch } from 'vuetify/components';
import {
  mdiFileUploadOutline,
  mdiFileDelimitedOutline,
  mdiDeleteOutline,
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
} from '../domain/battle-records.js';
import { eventTypeLabel } from '../domain/event-types.js';
import './battle-upload.css';
const emit = defineEmits(['open-page']);
const props = defineProps({ initialEventId: { type: String, default: null } });

const source = import.meta.env.VITE_DATA_SOURCE || 'local';
const client = createBattleRecordClient({ source }),
  eventClient = createEventClient({ source });
const csvInputs = {};
const files = ref([]);
const internalRounds = ref({ 1: false, 2: false });
const reading = ref(false),
  saving = ref(false),
  error = ref(''),
  notice = ref(''),
  fileError = ref(''),
  eventError = ref('');
const events = ref([]);
const previewRound = ref(1),
  previewPage = ref(1);
const draggingRound = ref(null),
  roundRecords = ref([]),
  roundsLoading = ref(false),
  roundsError = ref('');
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
const hasTwoRounds = computed(() => ['scrimmage', 'guild_war'].includes(selectedEvent.value?.type));
const uploadSlots = computed(() =>
  selectedEvent.value
    ? (hasTwoRounds.value ? [1, 2] : [1]).map((roundNumber) => ({
        roundNumber,
        label: hasTwoRounds.value ? `第${roundNumber === 1 ? '一' : '二'}場` : '對戰結果',
        file: files.value.find((file) => file.roundNumber === roundNumber),
        saved: roundRecords.value.find((record) => record.roundNumber === roundNumber),
      }))
    : [],
);
const previewSlot = computed(() =>
  uploadSlots.value.find((slot) => slot.roundNumber === previewRound.value),
);
const previewFile = computed(() => previewSlot.value?.file);
const previewIsInternal = computed(
  () => selectedEvent.value?.type === 'scrimmage' && internalRounds.value[previewRound.value],
);
const previewPlayers = computed(
  () =>
    previewFile.value?.parsed.players.slice((previewPage.value - 1) * 20, previewPage.value * 20) ||
    [],
);
watch(
  () => previewFile.value?.id,
  () => {
    previewPage.value = 1;
  },
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
  detailToken = 0,
  roundsToken = 0,
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
function winnerLabel(record) {
  if (record.isInternal) return '內推';
  if (!record.winner) return '結果未填';
  return `${record.winner === 'red' ? record.redTeam : record.blueTeam} 獲勝`;
}
function sideLabel(side, ourSide) {
  const label = side === 'red' ? '紅方' : '藍方';
  return ourSide ? `${label}（${side === ourSide ? '我方' : '敵方'}）` : label;
}
function removeFile(id) {
  files.value = files.value.filter((file) => file.id !== id);
  fileError.value = '';
  error.value = '';
}
function changeEvent(value) {
  if (value === selectedEventId.value || busy.value) return;
  if (
    dirty.value &&
    !window.confirm('有尚未上傳的戰績, 切換活動會清除檔案與對戰資料, 確定切換嗎？')
  )
    return;
  files.value = [];
  attempt = null;
  fileError.value = '';
  error.value = '';
  notice.value = '';
  selectedEventId.value = value;
  internalRounds.value = { 1: false, 2: false };
  previewRound.value = 1;
}
async function loadRounds() {
  const token = ++roundsToken;
  const eventId = selectedEventId.value;
  roundRecords.value = [];
  roundsError.value = '';
  roundsLoading.value = Boolean(eventId);
  if (!eventId) return;
  try {
    const result = await client.getRecords(1, eventId);
    if (!Array.isArray(result.records)) throw new Error('戰績資料格式不正確');
    if (!disposed && token === roundsToken) {
      roundRecords.value = result.records;
      result.records.forEach((record) => {
        internalRounds.value[record.roundNumber] = record.isInternal;
      });
    }
  } catch (cause) {
    if (!disposed && token === roundsToken)
      roundsError.value = `本場已上傳戰績讀取失敗: ${cause.message}`;
  } finally {
    if (!disposed && token === roundsToken) roundsLoading.value = false;
  }
}
watch(selectedEventId, loadRounds);
async function addFiles(incoming, roundNumber) {
  if (
    busy.value ||
    roundsLoading.value ||
    roundsError.value ||
    !selectedEvent.value ||
    roundRecords.value.some((record) => record.roundNumber === roundNumber)
  )
    return;
  fileError.value = '';
  error.value = '';
  notice.value = '';
  reading.value = true;
  const issues = [];
  try {
    if (incoming.length !== 1) {
      fileError.value = '每一場請選擇一個 CSV';
      return;
    }
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
      if (files.value.some((row) => row.roundNumber !== roundNumber && row.id === id)) {
        issues.push(`${file.name}：已在另一場的待上傳清單`);
        continue;
      }
      try {
        const csvText = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
        const parsed = parseBattleCsv(csvText);
        if (disposed) return;
        const defaults = battleFilenameDefaults(file.name);
        const row = {
          id,
          roundNumber,
          filename: file.name,
          size: file.size,
          csvText,
          parsed,
          redTeam: parsed.redTeam || defaults.redTeam,
          blueTeam: parsed.blueTeam || defaults.blueTeam,
          winner: null,
          ourSide: null,
        };
        files.value = [...files.value.filter((file) => file.roundNumber !== roundNumber), row].sort(
          (a, b) => a.roundNumber - b.roundNumber,
        );
        previewRound.value = roundNumber;
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
function pickedCsv(event, roundNumber) {
  addFiles([...event.target.files], roundNumber);
  event.target.value = '';
}
function dropCsv(event, roundNumber) {
  draggingRound.value = null;
  addFiles([...event.dataTransfer.files], roundNumber);
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
async function submit(roundNumber = null) {
  if (busy.value || roundsLoading.value || roundsError.value) return;
  error.value = '';
  notice.value = '';
  const pendingFiles =
    roundNumber == null
      ? files.value
      : files.value.filter((file) => file.roundNumber === roundNumber);
  if (!pendingFiles.length) {
    error.value = '請先加入至少一個 CSV';
    return;
  }
  if (!selectedEvent.value) {
    error.value = '請選擇行事曆中已建立的戰鬥場次';
    return;
  }
  try {
    for (const [index, row] of pendingFiles.entries()) {
      if (!row.redTeam.trim() || !row.blueTeam.trim())
        throw new Error(`第 ${index + 1} 筆請填寫紅方與藍方名稱`);
      if (roundRecords.value.some((record) => record.roundNumber === row.roundNumber))
        throw new Error('這一場已有戰績, 請移除待上傳檔案後查看已上傳戰績');
    }
  } catch (cause) {
    error.value = cause.message;
    return;
  }
  saving.value = true;
  try {
    const input = {
      records: pendingFiles.map(
        ({ filename, csvText, roundNumber, redTeam, blueTeam, winner, ourSide }) => ({
          filename,
          csvText,
          datetime: selectedEvent.value.dates[0],
          roundNumber,
          redTeam,
          blueTeam,
          winner:
            selectedEvent.value.type === 'scrimmage' && internalRounds.value[roundNumber]
              ? null
              : winner,
          ourSide:
            selectedEvent.value.type === 'scrimmage' && internalRounds.value[roundNumber]
              ? null
              : ourSide,
          isInternal: selectedEvent.value.type === 'scrimmage' && internalRounds.value[roundNumber],
          type: selectedEvent.value.type,
          eventId: selectedEvent.value.id,
        }),
      ),
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
    files.value = files.value.filter(
      (file) => !pendingFiles.some((pending) => pending.roundNumber === file.roundNumber),
    );
    attempt = null;
    fileError.value = '';
    notice.value = `上傳成功, 已保存 ${result.records.length} 筆戰績`;
    roundRecords.value = [...roundRecords.value, ...result.records];
    previewRound.value = files.value[0]?.roundNumber || 1;
  } catch (cause) {
    if (!disposed) error.value = cause.message;
    if (!disposed && cause.code === 'BATTLE_ROUND_EXISTS') await loadRounds();
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
      detailError.value = cause.message;
    }
  } finally {
    downloadBusy.value = false;
  }
}
onMounted(() => {
  window.addEventListener('beforeunload', leaveWarning);
  loadEvents();
});
onUnmounted(() => {
  disposed = true;
  detailToken++;
  roundsToken++;
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
  </section>
  <v-card class="battle-upload-card battle-event-card">
    <v-select
      :model-value="selectedEventId"
      :items="eventOptions"
      label="戰鬥場次"
      variant="outlined"
      density="compact"
      hide-details
      :disabled="busy"
      aria-required="true"
      @update:model-value="changeEvent"
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
  <v-alert v-if="eventError" type="warning" variant="tonal" role="alert" class="mb-4">
    {{ eventError }}<v-btn variant="text" :disabled="busy" @click="loadEvents">重新載入場次</v-btn>
  </v-alert>
  <v-alert v-if="fileError" type="error" variant="tonal" role="alert" class="mb-4">{{
    fileError
  }}</v-alert>
  <v-alert v-if="roundsError" type="error" variant="tonal" role="alert" class="mb-4">
    {{ roundsError }}<v-btn variant="text" :disabled="busy" @click="loadRounds">重新載入戰績</v-btn>
  </v-alert>
  <p v-if="roundsLoading" role="status" class="battle-muted mb-4">正在載入本場已上傳戰績…</p>
  <v-card v-if="!selectedEvent" class="battle-upload-card battle-empty">
    <v-icon :icon="mdiFileDelimitedOutline" size="40" />
    <p>請先選擇戰鬥場次</p>
  </v-card>
  <div
    v-else
    class="battle-upload-grid"
    :class="{ 'battle-single-round': uploadSlots.length === 1 }"
  >
    <v-card
      v-for="slot in uploadSlots"
      :key="slot.roundNumber"
      class="battle-upload-card battle-round-card"
      :aria-label="slot.label"
    >
      <div class="section-header">
        <h2><v-icon :icon="mdiFileDelimitedOutline" size="22" /> {{ slot.label }}</h2>
        <v-chip :color="slot.saved ? 'success' : undefined">{{
          slot.saved ? '已上傳' : slot.file ? '待上傳' : '尚未上傳'
        }}</v-chip>
      </div>
      <v-switch
        v-if="selectedEvent.type === 'scrimmage' && !slot.saved"
        v-model="internalRounds[slot.roundNumber]"
        label="是否為內推"
        :aria-label="`${slot.label}是否為內推`"
        color="primary"
        inset
        density="compact"
        hide-details
        :disabled="busy || roundsLoading || Boolean(roundsError)"
        class="battle-internal-switch"
      />
      <template v-if="slot.saved">
        <p class="battle-saved-summary">{{ slot.saved.redTeam }} 對 {{ slot.saved.blueTeam }}</p>
        <p class="battle-muted">
          {{ winnerLabel(slot.saved) }} · {{ slot.saved.redCount }}／{{ slot.saved.blueCount }} 人
        </p>
        <v-btn
          variant="outlined"
          :prepend-icon="mdiEyeOutline"
          :disabled="busy"
          @click="openDetail(slot.saved)"
          >查看戰績</v-btn
        >
      </template>
      <template v-else>
        <input
          :ref="(el) => (csvInputs[slot.roundNumber] = el)"
          class="sr-only"
          type="file"
          accept=".csv,text/csv"
          tabindex="-1"
          :aria-label="`選擇${slot.label} CSV`"
          :disabled="busy || roundsLoading || Boolean(roundsError)"
          @change="pickedCsv($event, slot.roundNumber)"
        />
        <button
          type="button"
          class="battle-dropzone"
          :class="{ 'battle-drop-active': draggingRound === slot.roundNumber }"
          :disabled="busy || roundsLoading || Boolean(roundsError)"
          @click="csvInputs[slot.roundNumber].click()"
          @dragenter.prevent="draggingRound = slot.roundNumber"
          @dragover.prevent
          @dragleave.prevent="draggingRound = null"
          @drop.prevent="dropCsv($event, slot.roundNumber)"
        >
          <v-icon :icon="mdiFileUploadOutline" size="32" />
          <strong>{{ slot.file ? '重新選擇或拖曳 CSV' : '選擇或拖曳 CSV' }}</strong>
          <span>一場一個 CSV · UTF-8 · 最多 1 MB</span>
        </button>
      </template>
      <template v-if="slot.file">
        <div class="battle-file-item">
          <div>
            <strong :title="slot.file.filename">{{ slot.file.filename }}</strong>
            <span
              >{{ sizeLabel(slot.file.size) }} · 紅方 {{ slot.file.parsed.redCount }} 人／藍方
              {{ slot.file.parsed.blueCount }} 人</span
            >
          </div>
          <v-btn
            variant="text"
            :icon="mdiDeleteOutline"
            :aria-label="`移除${slot.label} CSV`"
            :disabled="busy"
            @click="removeFile(slot.file.id)"
          />
        </div>
        <form class="battle-match-form" @submit.prevent="submit(slot.roundNumber)">
          <div class="battle-match-fields">
            <v-text-field
              v-model="slot.file.redTeam"
              label="紅方名稱"
              maxlength="120"
              variant="outlined"
              density="compact"
              hide-details
              :disabled="busy"
              aria-required="true"
            />
            <v-text-field
              v-model="slot.file.blueTeam"
              label="藍方名稱"
              maxlength="120"
              variant="outlined"
              density="compact"
              hide-details
              :disabled="busy"
              aria-required="true"
            />
          </div>
          <div
            v-if="!internalRounds[slot.roundNumber] || selectedEvent.type !== 'scrimmage'"
            class="battle-match-fields"
          >
            <v-select
              v-model="slot.file.ourSide"
              :items="[
                { title: `紅方 · ${slot.file.redTeam}`, value: 'red' },
                { title: `藍方 · ${slot.file.blueTeam}`, value: 'blue' },
              ]"
              label="我方是哪邊（選填）"
              clearable
              variant="outlined"
              density="compact"
              hide-details
              :disabled="busy"
            />
            <v-select
              v-model="slot.file.winner"
              :items="[
                { title: `紅方 · ${slot.file.redTeam}`, value: 'red' },
                { title: `藍方 · ${slot.file.blueTeam}`, value: 'blue' },
              ]"
              label="獲勝方（選填）"
              clearable
              variant="outlined"
              density="compact"
              hide-details
              :disabled="busy"
            />
          </div>
          <button type="submit" class="sr-only" tabindex="-1">上傳{{ slot.label }}</button>
        </form>
      </template>
    </v-card>
  </div>
  <v-card class="battle-upload-card battle-preview-card" aria-labelledby="battle-preview-title">
    <div class="section-header">
      <h2 id="battle-preview-title">上傳預覽</h2>
      <span class="battle-muted">已選擇 {{ files.length }} 份 CSV</span>
    </div>
    <v-tabs
      v-if="hasTwoRounds"
      v-model="previewRound"
      aria-label="待上傳場次預覽"
      class="battle-preview-tabs"
    >
      <v-tab v-for="slot in uploadSlots" :key="slot.roundNumber" :value="slot.roundNumber">{{
        slot.label
      }}</v-tab>
    </v-tabs>
    <div role="region" :aria-label="`${previewSlot?.label || '戰績'}預覽`" aria-live="polite">
      <template v-if="previewFile">
        <div class="battle-preview-summary">
          <strong>{{ previewFile.filename }}</strong>
          <p>{{ previewFile.redTeam }} 對 {{ previewFile.blueTeam }}</p>
          <p class="battle-muted">
            紅方 {{ previewFile.parsed.redCount }} 人／藍方 {{ previewFile.parsed.blueCount }} 人 ·
            {{ winnerLabel({ ...previewFile, isInternal: previewIsInternal }) }}
          </p>
        </div>
        <div
          class="battle-table-wrap"
          tabindex="0"
          :aria-label="`${previewSlot.label}玩家戰績, 可左右捲動`"
        >
          <table class="battle-record-table battle-player-table">
            <caption class="sr-only">
              {{
                previewSlot.label
              }}待上傳玩家戰績
            </caption>
            <thead>
              <tr>
                <th scope="col">陣營</th>
                <th v-for="[label, key] in BATTLE_COLUMNS" :key="key" scope="col">{{ label }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(player, index) in previewPlayers" :key="index">
                <td>
                  {{ sideLabel(player.side, previewIsInternal ? null : previewFile.ourSide) }}
                </td>
                <td v-for="[, key] in BATTLE_COLUMNS" :key="key">{{ player[key] ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <v-pagination
          v-if="previewFile.parsed.players.length > 20"
          v-model="previewPage"
          :length="Math.ceil(previewFile.parsed.players.length / 20)"
          aria-label="上傳預覽分頁"
        />
      </template>
      <p v-else class="battle-muted battle-preview-empty">
        {{
          previewSlot ? `${previewSlot.label}尚未加入待上傳 CSV` : '選擇場次並加入 CSV 後即可預覽'
        }}
      </p>
    </div>
  </v-card>
  <div class="battle-upload-footer">
    <v-alert v-if="error" type="error" variant="tonal" role="alert">{{ error }}</v-alert>
    <v-alert v-if="notice" type="success" variant="tonal" role="status">{{ notice }}</v-alert>
    <div class="battle-upload-actions">
      <template v-if="hasTwoRounds">
        <v-btn
          v-for="slot in uploadSlots"
          :key="slot.roundNumber"
          variant="outlined"
          :disabled="
            busy || roundsLoading || Boolean(roundsError) || !slot.file || Boolean(slot.saved)
          "
          @click="submit(slot.roundNumber)"
          >上傳{{ slot.label }}</v-btn
        >
      </template>
      <v-btn
        color="primary"
        :prepend-icon="mdiFileUploadOutline"
        :loading="saving"
        :disabled="busy || roundsLoading || Boolean(roundsError) || !files.length"
        @click="submit()"
        >{{ saving ? '上傳中…' : '上傳戰績' }}</v-btn
      >
    </div>
  </div>
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
            {{ detail.playedAt.slice(0, 19).replace('T', ' ') }} ·
            {{
              detail.roundNumber == null
                ? '場序未指定'
                : detail.type !== 'dragon_tiger'
                  ? `第${detail.roundNumber === 1 ? '一' : '二'}場`
                  : '單場'
            }}
            · {{ detail.redTeam }} 對 {{ detail.blueTeam }} ·
            {{ winnerLabel(detail) }}
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
                  <td>{{ sideLabel(player.side, detail.ourSide) }}</td>
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
