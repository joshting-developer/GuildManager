<script setup>
import DataLoading from '../components/DataLoading.vue';
import { computed, onUnmounted, ref, useId, watch } from 'vue';
import { VSwitch } from 'vuetify/components';
import { createBattleRecordClient } from '../api/battle-records.js';
import { validateBattleMetadata } from '../domain/battle-metadata.js';
import { battleDateLabel, battleRoundLabel } from '../domain/battle-statistics.js';
import { eventTypeLabel } from '../domain/event-types.js';

const props = defineProps({ modelValue: Boolean, recordId: { type: String, required: true } });
const emit = defineEmits(['update:modelValue', 'updated']);
const client = createBattleRecordClient({ source: import.meta.env.VITE_DATA_SOURCE || 'local' });
const id = useId();
const record = ref(null);
const form = ref(null);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const conflict = ref(false);
const baseline = ref('');
const dirty = computed(() => form.value && JSON.stringify(form.value) !== baseline.value);
const sides = computed(() => [
  { title: `紅方 · ${form.value?.redTeam || '紅方'}`, value: 'red' },
  { title: `藍方 · ${form.value?.blueTeam || '藍方'}`, value: 'blue' },
]);
let token = 0;
let opener;
let attempt;
async function load() {
  if (saving.value || !props.modelValue) return;
  if (dirty.value && !window.confirm('重新載入會放棄尚未儲存的對戰資訊，確定嗎？')) return;
  const current = ++token;
  loading.value = true;
  error.value = '';
  conflict.value = false;
  form.value = null;
  record.value = null;
  attempt = null;
  try {
    const result = await client.getRecord(props.recordId);
    if (current !== token || !props.modelValue) return;
    if (result.record?.id !== props.recordId || !Number.isSafeInteger(result.record.revision))
      throw new Error('對戰資訊格式不正確，請重新載入');
    record.value = result.record;
    form.value = {
      redTeam: result.record.redTeam,
      blueTeam: result.record.blueTeam,
      ourSide: result.record.ourSide || null,
      winner: result.record.winner || null,
      isInternal: Boolean(result.record.isInternal),
    };
    baseline.value = JSON.stringify(form.value);
  } catch (cause) {
    if (current === token && props.modelValue) error.value = cause.message;
  } finally {
    if (current === token) loading.value = false;
  }
}
function close() {
  if (saving.value) return;
  if (dirty.value && !window.confirm('放棄尚未儲存的對戰資訊？')) return;
  emit('update:modelValue', false);
}
function restoreFocus() {
  if (opener?.isConnected) opener.focus();
}
async function save() {
  if (saving.value || loading.value || !form.value || conflict.value) return;
  error.value = '';
  const current = token;
  try {
    const values = validateBattleMetadata(
      { ...form.value, revision: record.value.revision, requestId: 'validate' },
      record.value.type,
    );
    const fingerprint = JSON.stringify([record.value.id, record.value.revision, values]);
    if (!attempt || attempt.fingerprint !== fingerprint)
      attempt = { fingerprint, requestId: crypto.randomUUID() };
    saving.value = true;
    const result = await client.updateRecord(record.value.id, {
      ...values,
      revision: record.value.revision,
      requestId: attempt.requestId,
    });
    if (current !== token || !props.modelValue) return;
    if (
      result.record?.id !== record.value.id ||
      result.record.revision !== record.value.revision + 1
    )
      throw new Error('儲存回應格式不正確，請重新載入確認');
    emit('updated', result.record);
    baseline.value = JSON.stringify(form.value);
    emit('update:modelValue', false);
  } catch (cause) {
    if (current === token && props.modelValue) {
      error.value = cause.message;
      conflict.value = cause.code === 'REVISION_CONFLICT';
    }
  } finally {
    saving.value = false;
  }
}
function leaveWarning(event) {
  if (props.modelValue && (dirty.value || saving.value)) {
    event.preventDefault();
    event.returnValue = '';
  }
}
watch(
  () => [props.modelValue, props.recordId],
  () => {
    token++;
    form.value = null;
    record.value = null;
    error.value = '';
    if (props.modelValue) {
      opener = document.activeElement;
      load();
    }
  },
  { immediate: true },
);
window.addEventListener('beforeunload', leaveWarning);
onUnmounted(() => {
  token++;
  window.removeEventListener('beforeunload', leaveWarning);
});
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    persistent
    max-width="600"
    :aria-labelledby="`${id}-title`"
    @click:outside="close"
    @keydown.esc.prevent.stop="close"
    @after-leave="restoreFocus"
  >
    <v-card class="metadata-card">
      <h2 :id="`${id}-title`">編輯對戰資訊</h2>
      <p v-if="record" class="metadata-summary">
        {{ battleDateLabel(record.playedAt) }} · {{ eventTypeLabel(record.type) }} ·
        {{ battleRoundLabel(record) }}
      </p>
      <DataLoading v-if="loading">正在載入對戰資訊…</DataLoading>
      <v-alert v-if="error" type="error" variant="tonal" role="alert" class="my-4"
        >{{ error
        }}<v-btn v-if="conflict || !form" variant="text" :disabled="saving || loading" @click="load"
          >重新載入</v-btn
        ></v-alert
      >
      <form v-if="form" @submit.prevent="save">
        <div class="metadata-fields">
          <v-text-field
            v-model="form.redTeam"
            label="紅方名稱"
            maxlength="120"
            variant="outlined"
            hide-details
            :disabled="saving"
            aria-required="true"
          />
          <v-text-field
            v-model="form.blueTeam"
            label="藍方名稱"
            maxlength="120"
            variant="outlined"
            hide-details
            :disabled="saving"
            aria-required="true"
          />
        </div>
        <v-switch
          v-if="record.type === 'scrimmage'"
          v-model="form.isInternal"
          label="是否為內推"
          color="primary"
          inset
          hide-details
          :disabled="saving"
          class="mt-3"
        />
        <p v-if="form.isInternal" class="metadata-summary">
          內推不區分敵我與勝負，儲存後會清除這兩項設定。
        </p>
        <div v-else class="metadata-fields mt-4">
          <v-select
            v-model="form.ourSide"
            :items="sides"
            label="我方是哪邊（選填）"
            clearable
            variant="outlined"
            hide-details
            :disabled="saving"
          />
          <v-select
            v-model="form.winner"
            :items="sides"
            label="獲勝方（選填）"
            clearable
            variant="outlined"
            hide-details
            :disabled="saving"
          />
        </div>
        <DataLoading v-if="saving" compact>正在儲存對戰資訊，請稍候…</DataLoading>
        <div class="metadata-actions">
          <v-btn variant="outlined" :disabled="saving" @click="close">取消</v-btn>
          <v-btn
            type="submit"
            color="primary"
            :loading="saving"
            :disabled="loading || saving || conflict"
            >儲存對戰資訊</v-btn
          >
        </div>
      </form>
      <div v-else class="metadata-actions">
        <v-btn variant="outlined" :disabled="saving" @click="close">關閉</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.metadata-card {
  padding: 28px;
}
.metadata-card h2 {
  font-size: 22px;
}
.metadata-summary {
  color: var(--color-text-muted);
  margin: 12px 0 20px;
}
.metadata-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.metadata-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
}
@media (max-width: 600px) {
  .metadata-card {
    padding: 20px;
  }
  .metadata-fields {
    grid-template-columns: 1fr;
  }
}
</style>
