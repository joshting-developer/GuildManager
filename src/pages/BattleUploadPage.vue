<script setup>
import DataLoading from '../components/DataLoading.vue';
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue';
import { VSwitch } from 'vuetify/components';
import {
  mdiFileUploadOutline,
  mdiFileDelimitedOutline,
  mdiDeleteOutline,
  mdiDownload,
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
import BattleMetadataDialog from './BattleMetadataDialog.vue';
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
const eventsLoading = ref(true);
let eventsToken = 0;
const previewRound = ref(1),
  previewPage = ref(1);
const draggingRound = ref(null),
  roundRecords = ref([]),
  roundsLoading = ref(false),
  roundsError = ref('');
const savedDetails = ref({}),
  savedLoading = ref({}),
  savedErrors = ref({}),
  downloadBusy = ref(false),
  downloadError = ref('');
const busy = computed(() => reading.value || saving.value || downloadBusy.value);
const dirty = computed(() => files.value.length > 0);
const editingRecordId = ref(null);
const editDialog = ref(false);
const savedTokens = {};
function openMetadata(record) {
  editingRecordId.value = record.id;
  editDialog.value = true;
}
function onMetadataUpdated(record) {
  roundRecords.value = roundRecords.value.map((item) => (item.id === record.id ? record : item));
  savedTokens[record.id] = (savedTokens[record.id] || 0) + 1;
  savedLoading.value[record.id] = false;
  savedErrors.value[record.id] = '';
  if (savedDetails.value[record.id])
    savedDetails.value[record.id] = { ...savedDetails.value[record.id], ...record };
  else if (previewSlot.value?.saved?.id === record.id) loadSavedRecord(record);
  internalRounds.value[record.roundNumber] = record.isInternal;
  notice.value = '對戰資訊已更新';
}
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
const previewRecord = computed(() => {
  const slot = previewSlot.value;
  if (slot?.saved) return savedDetails.value[slot.saved.id];
  if (!slot?.file) return null;
  return {
    ...slot.file,
    players: slot.file.parsed.players,
    redCount: slot.file.parsed.redCount,
    blueCount: slot.file.parsed.blueCount,
    isInternal:
      selectedEvent.value?.type === 'scrimmage' && internalRounds.value[previewRound.value],
  };
});
const previewPlayers = computed(
  () =>
    previewRecord.value?.players.slice((previewPage.value - 1) * 20, previewPage.value * 20) || [],
);
watch(
  () => [previewRound.value, previewRecord.value],
  () => {
    previewPage.value = 1;
  },
);
watch(
  () => previewSlot.value?.saved?.id,
  (id) => {
    if (id) loadSavedRecord(previewSlot.value.saved);
  },
);
watch(previewRound, () => {
  downloadError.value = '';
});
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
  roundsToken = 0;
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
  if (value === selectedEventId.value || busy.value || eventsLoading.value || eventError.value) return;
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
  downloadError.value = '';
  selectedEventId.value = value;
  internalRounds.value = { 1: false, 2: false };
  previewRound.value = 1;
}
async function loadRounds() {
  const token = ++roundsToken;
  const eventId = selectedEventId.value;
  roundRecords.value = [];
  savedDetails.value = {};
  savedLoading.value = {};
  savedErrors.value = {};
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
    eventsLoading.value ||
    eventError.value ||
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
  const token = ++eventsToken;
  eventsLoading.value = true;
  eventError.value = '';
  try {
    const result = await eventClient.getEvents();
    if (!Array.isArray(result.events)) throw new Error('場次資料格式不正確, 請重新載入');
    if (!disposed && token === eventsToken) {
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
    if (!disposed && token === eventsToken) eventError.value = `場次清單讀取失敗: ${cause.message}`;
  } finally {
    if (!disposed && token === eventsToken) eventsLoading.value = false;
  }
}
async function submit(roundNumber = null) {
  if (busy.value || eventsLoading.value || eventError.value || roundsLoading.value || roundsError.value) return;
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
    result.records.forEach((record) => {
      if (Array.isArray(record.players)) savedDetails.value[record.id] = record;
    });
    files.value = files.value.filter(
      (file) => !pendingFiles.some((pending) => pending.roundNumber === file.roundNumber),
    );
    attempt = null;
    fileError.value = '';
    notice.value = `上傳成功, 已保存 ${result.records.length} 筆戰績`;
    roundRecords.value = [...roundRecords.value, ...result.records];
    if (files.value.length) previewRound.value = files.value[0].roundNumber;
  } catch (cause) {
    if (!disposed) error.value = cause.message;
    if (!disposed && cause.code === 'BATTLE_ROUND_EXISTS') await loadRounds();
  } finally {
    saving.value = false;
  }
}
async function loadSavedRecord(record) {
  if (!record || savedDetails.value[record.id] || savedLoading.value[record.id]) return;
  const token = roundsToken;
  const detailToken = (savedTokens[record.id] || 0) + 1;
  savedTokens[record.id] = detailToken;
  const eventId = selectedEventId.value;
  savedLoading.value[record.id] = true;
  savedErrors.value[record.id] = '';
  try {
    const result = await client.getRecord(record.id);
    if (result.record?.id !== record.id || !Array.isArray(result.record.players))
      throw new Error('戰績資料格式不正確, 請重試');
    if (
      !disposed &&
      token === roundsToken &&
      detailToken === savedTokens[record.id] &&
      eventId === selectedEventId.value
    )
      savedDetails.value[record.id] = result.record;
  } catch (cause) {
    if (
      !disposed &&
      token === roundsToken &&
      detailToken === savedTokens[record.id] &&
      eventId === selectedEventId.value
    )
      savedErrors.value[record.id] = `戰績資料讀取失敗: ${cause.message}`;
  } finally {
    if (
      !disposed &&
      token === roundsToken &&
      detailToken === savedTokens[record.id] &&
      eventId === selectedEventId.value
    )
      savedLoading.value[record.id] = false;
  }
}
async function download(record, kind) {
  if (busy.value) return;
  downloadBusy.value = true;
  downloadError.value = '';
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
    if (!disposed && previewSlot.value?.saved?.id === record.id) {
      downloadError.value = cause.message;
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
      :disabled="busy || eventsLoading || !!eventError"
      :loading="eventsLoading"
      :aria-busy="eventsLoading"
      no-data-text="尚無戰鬥場次"
      aria-required="true"
      @update:model-value="changeEvent"
    />
    <p class="battle-muted">
      {{
        selectedEvent
          ? `${selectedEvent.dates[0].replaceAll('-', '/')} · ${eventTypeLabel(selectedEvent.type)}`
          : eventsLoading ? '正在載入場次…' : '選擇行事曆已建立的場次, 日期與類型會自動帶入'
      }}
    </p>
  </v-card>
  <v-alert v-if="eventError" type="warning" variant="tonal" role="alert" class="mb-4">
    {{ eventError }}<v-btn variant="text" :disabled="busy || eventsLoading" @click="loadEvents">重新載入場次</v-btn>
  </v-alert>
  <v-alert v-if="fileError" type="error" variant="tonal" role="alert" class="mb-4">{{
    fileError
  }}</v-alert>
  <v-alert v-if="roundsError" type="error" variant="tonal" role="alert" class="mb-4">
    {{ roundsError }}<v-btn variant="text" :disabled="busy" @click="loadRounds">重新載入戰績</v-btn>
  </v-alert>
  <DataLoading v-if="roundsLoading">正在載入本場已上傳戰績…</DataLoading>
  <DataLoading v-if="eventsLoading">正在載入戰鬥場次…</DataLoading>
  <v-card v-else-if="!selectedEvent && !eventError" class="battle-upload-card battle-empty">
    <v-icon :icon="mdiFileDelimitedOutline" size="40" />
    <p>{{ eventOptions.length ? '請先選擇戰鬥場次' : '尚無戰鬥場次，請先建立活動安排' }}</p>
  </v-card>
  <div
    v-else-if="selectedEvent && !eventError && !roundsLoading"
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
          :disabled="busy || roundsLoading"
          :aria-label="`編輯${slot.label}對戰資訊`"
          @click="openMetadata(slot.saved)"
          >編輯對戰資訊</v-btn
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
  <BattleMetadataDialog
    v-if="editingRecordId"
    v-model="editDialog"
    :record-id="editingRecordId"
    @updated="onMetadataUpdated"
  />
  <v-card v-if="selectedEvent && !eventsLoading && !eventError && !roundsLoading" class="battle-upload-card battle-preview-card" aria-labelledby="battle-preview-title">
    <div class="section-header">
      <h2 id="battle-preview-title">戰績資料</h2>
      <v-chip v-if="previewSlot" :color="previewSlot.saved ? 'success' : undefined">{{
        previewSlot.saved ? '已上傳' : previewSlot.file ? '待上傳預覽' : '尚未上傳'
      }}</v-chip>
    </div>
    <v-tabs
      v-if="hasTwoRounds"
      v-model="previewRound"
      aria-label="戰績場次"
      class="battle-preview-tabs"
    >
      <v-tab v-for="slot in uploadSlots" :key="slot.roundNumber" :value="slot.roundNumber">{{
        slot.label
      }}</v-tab>
    </v-tabs>
    <div role="region" :aria-label="`${previewSlot?.label || '戰績'}資料`" aria-live="polite">
      <DataLoading
        v-if="previewSlot?.saved && savedLoading[previewSlot.saved.id]"
      >正在載入{{ previewSlot.label }}戰績…</DataLoading>
      <v-alert
        v-else-if="previewSlot?.saved && savedErrors[previewSlot.saved.id]"
        type="error"
        variant="tonal"
        role="alert"
      >
        {{ savedErrors[previewSlot.saved.id] }}
        <v-btn variant="text" :disabled="busy" @click="loadSavedRecord(previewSlot.saved)"
          >重新載入本場戰績</v-btn
        >
      </v-alert>
      <template v-else-if="previewRecord">
        <div class="battle-preview-summary">
          <strong>{{ previewRecord.filename }}</strong>
          <p>{{ previewRecord.redTeam }} 對 {{ previewRecord.blueTeam }}</p>
          <p class="battle-muted">
            紅方 {{ previewRecord.redCount }} 人／藍方 {{ previewRecord.blueCount }} 人 ·
            {{ winnerLabel(previewRecord) }}
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
              }}玩家戰績
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
                  {{
                    sideLabel(player.side, previewRecord.isInternal ? null : previewRecord.ourSide)
                  }}
                </td>
                <td v-for="[, key] in BATTLE_COLUMNS" :key="key">{{ player[key] ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <v-pagination
          v-if="previewRecord.players.length > 20"
          v-model="previewPage"
          :length="Math.ceil(previewRecord.players.length / 20)"
          aria-label="戰績資料分頁"
        />
        <div v-if="previewSlot.saved" class="battle-data-downloads">
          <v-btn
            variant="outlined"
            :prepend-icon="mdiDownload"
            :disabled="busy"
            @click="download(previewRecord, 'csv')"
            >下載原始 CSV</v-btn
          >
          <v-btn
            v-if="previewRecord.image"
            variant="outlined"
            :prepend-icon="mdiDownload"
            :disabled="busy"
            @click="download(previewRecord, 'image')"
            >下載陣容圖片</v-btn
          >
        </div>
      </template>
      <p v-else class="battle-muted battle-preview-empty">
        {{
          previewSlot ? `${previewSlot.label}尚未加入待上傳 CSV` : '選擇場次並加入 CSV 後即可預覽'
        }}
      </p>
    </div>
    <v-alert v-if="downloadError" type="error" variant="tonal" role="alert" class="mt-4">{{
      downloadError
    }}</v-alert>
  </v-card>
  <div class="battle-upload-footer">
    <v-alert v-if="error" type="error" variant="tonal" role="alert">{{ error }}</v-alert>
    <v-alert v-if="notice" type="success" variant="tonal" role="status">{{ notice }}</v-alert>
    <DataLoading v-if="saving || reading || downloadBusy" compact :spinner="!saving">{{ saving ? '正在上傳戰績，請稍候…' : reading ? '正在讀取戰績檔案…' : '正在準備下載…' }}</DataLoading>
    <div class="battle-upload-actions">
      <template v-if="hasTwoRounds">
        <v-btn
          v-for="slot in uploadSlots"
          :key="slot.roundNumber"
          variant="outlined"
          :disabled="
            busy || eventsLoading || !!eventError || roundsLoading || Boolean(roundsError) || !slot.file || Boolean(slot.saved)
          "
          @click="submit(slot.roundNumber)"
          >上傳{{ slot.label }}</v-btn
        >
      </template>
      <v-btn
        color="primary"
        :prepend-icon="mdiFileUploadOutline"
        :loading="saving"
        :disabled="busy || eventsLoading || !!eventError || roundsLoading || Boolean(roundsError) || !files.length"
        @click="submit()"
        >{{ saving ? '上傳中…' : '上傳戰績' }}</v-btn
      >
    </div>
  </div>
</template>
