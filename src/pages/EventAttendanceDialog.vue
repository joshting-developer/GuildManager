<script setup>
import DataLoading from '../components/DataLoading.vue';
import { computed, onUnmounted, ref, useId, watch } from 'vue';
import { createParticipationClient } from '../api/participation.js';
import { eventDisplayTitle, eventTypeLabel } from '../domain/event-types.js';

const props = defineProps({
  modelValue: Boolean,
  event: { type: Object, required: true },
});
const emit = defineEmits(['update:modelValue', 'closed']);
const client = createParticipationClient({ source: import.meta.env.VITE_DATA_SOURCE || 'local' });
const id = useId();
const tab = ref('leave');
const data = ref(null);
const loading = ref(false);
const error = ref('');
const actionError = ref('');
const notice = ref('');
const saving = ref(null);
const showRegistered = computed(() => props.event.type === 'scrimmage');
const rows = computed(() => data.value?.[tab.value] || []);
let loadToken = 0;

async function load() {
  if (!props.modelValue) return;
  const token = ++loadToken;
  const eventId = props.event.id;
  loading.value = true;
  error.value = '';
  actionError.value = '';
  data.value = null;
  try {
    const result = await client.getAttendance(eventId);
    if (token !== loadToken || !props.modelValue) return;
    if (
      result?.eventId !== eventId ||
      !Array.isArray(result.leave) ||
      !Array.isArray(result.registered) ||
      [...result.leave, ...result.registered].some(
        (row) =>
          !row ||
          ['id', 'name', 'profession', 'colorcode', 'note'].some(
            (key) => typeof row[key] !== 'string',
          ) ||
          !['member', 'registration'].includes(row.source) ||
          !Number.isSafeInteger(row.revision) ||
          row.revision < 1,
      )
    )
      throw new Error('出勤資料格式不正確，請重新載入');
    data.value = result;
  } catch (cause) {
    if (token === loadToken && props.modelValue) error.value = cause.message;
  } finally {
    if (token === loadToken) loading.value = false;
  }
}
async function cancelLeave(row) {
  if (saving.value) return;
  const eventId = props.event.id;
  const token = loadToken;
  saving.value = `${row.source}:${row.id}`;
  actionError.value = '';
  notice.value = '';
  try {
    const result = await client.cancelLeave(eventId, {
      source: row.source,
      id: row.id,
      revision: row.revision,
    });
    if (token !== loadToken || !props.modelValue) return;
    if (result?.eventId !== eventId || result.cancelled !== true)
      throw new Error('取消請假的回應格式不正確，請重新載入確認');
    notice.value = '已取消請假';
    await load();
  } catch (cause) {
    if (token === loadToken && props.modelValue) actionError.value = cause.message;
  } finally {
    saving.value = null;
  }
}
watch(
  () => [props.modelValue, props.event.id],
  () => {
    loadToken++;
    data.value = null;
    error.value = '';
    actionError.value = '';
    notice.value = '';
    tab.value = 'leave';
    if (props.modelValue) load();
  },
  { immediate: true, flush: 'sync' },
);
onUnmounted(() => {
  loadToken++;
});
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    :persistent="!!saving"
    max-width="760"
    :aria-labelledby="`${id}-title`"
    @update:model-value="emit('update:modelValue', $event)"
    @after-leave="emit('closed')"
  >
    <v-card class="attendance-card">
      <div class="attendance-heading">
        <div>
          <p class="attendance-muted">
            {{ event.dates[0].replaceAll('-', '/') }} · {{ eventTypeLabel(event.type) }}
          </p>
          <h2 :id="`${id}-title`">{{ eventDisplayTitle(event) }} · 出勤閱覽</h2>
        </div>
        <v-btn variant="text" :disabled="loading || !!saving" @click="load">重新載入</v-btn>
      </div>
      <v-alert v-if="actionError" type="error" variant="tonal" role="alert" class="my-4">{{
        actionError
      }}</v-alert>
      <v-alert v-if="notice" type="success" variant="tonal" role="status" class="my-4">{{
        notice
      }}</v-alert>
      <DataLoading v-if="loading">正在載入出勤名單…</DataLoading>
      <v-alert v-else-if="error" type="error" variant="tonal" role="alert" class="my-5">
        {{ error }}<v-btn variant="text" @click="load">重試</v-btn>
      </v-alert>
      <template v-else-if="data">
        <DataLoading v-if="saving" compact :spinner="false">正在取消請假，請稍候…</DataLoading>
        <v-tabs v-model="tab" color="primary" aria-label="出勤狀態" :disabled="!!saving">
          <v-tab :id="`${id}-leave-tab`" value="leave" :aria-controls="`${id}-leave-panel`">
            請假（{{ data.leave.length }}）
          </v-tab>
          <v-tab
            v-if="showRegistered"
            :id="`${id}-registered-tab`"
            value="registered"
            :aria-controls="`${id}-registered-panel`"
          >
            報名（{{ data.registered.length }}）
          </v-tab>
        </v-tabs>
        <div :id="`${id}-${tab}-panel`" role="tabpanel" :aria-labelledby="`${id}-${tab}-tab`">
          <p v-if="!rows.length" class="attendance-state">
            {{ tab === 'leave' ? '本場尚無請假人員。' : '本場尚無報名人員。' }}
          </p>
          <div v-else class="attendance-scroll" tabindex="0" aria-label="出勤名單，可捲動查看">
            <table class="attendance-table">
              <caption class="sr-only">
                {{
                  tab === 'leave' ? '請假' : '報名'
                }}人員名單
              </caption>
              <thead>
                <tr>
                  <th scope="col">名稱</th>
                  <th scope="col">職業</th>
                  <th scope="col">備註</th>
                  <th v-if="tab === 'leave'" scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in rows" :key="`${row.source}:${row.id}`">
                  <td>{{ row.name }}</td>
                  <td>
                    <span class="attendance-profession"
                      ><span
                        class="attendance-color"
                        :style="{ backgroundColor: row.colorcode }"
                        aria-hidden="true"
                      ></span
                      >{{ row.profession }}</span
                    >
                  </td>
                  <td class="attendance-note">{{ row.note || '—' }}</td>
                  <td v-if="tab === 'leave'">
                    <v-btn
                      variant="text"
                      color="primary"
                      :loading="saving === `${row.source}:${row.id}`"
                      :disabled="!!saving"
                      :aria-label="`取消 ${row.name} 的請假`"
                      @click="cancelLeave(row)"
                      >取消請假</v-btn
                    >
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
      <div class="attendance-actions">
        <v-btn variant="outlined" :disabled="!!saving" @click="emit('update:modelValue', false)"
          >關閉</v-btn
        >
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.attendance-card {
  padding: 28px;
}
.attendance-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.attendance-heading > div {
  min-width: 0;
}
.attendance-heading h2 {
  font-size: 22px;
  overflow-wrap: anywhere;
}
.attendance-muted {
  color: var(--color-text-muted);
  font-size: 13px;
  margin-bottom: 8px;
}
.attendance-state {
  color: var(--color-text-muted);
  padding: 28px 0;
}
.attendance-scroll {
  overflow: auto;
  max-height: 50vh;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  margin-top: 18px;
}
.attendance-table {
  border-collapse: collapse;
  text-align: left;
  width: 100%;
  min-width: 440px;
  font-size: 14px;
}
.attendance-table th {
  position: sticky;
  top: 0;
  background: var(--color-muted-surface);
  color: var(--color-text-muted);
  font-size: 13px;
}
.attendance-table th,
.attendance-table td {
  padding: 12px 16px;
  vertical-align: top;
}
.attendance-table td {
  border-top: 1px solid var(--color-border);
  overflow-wrap: anywhere;
}
.attendance-table th:first-child {
  width: 30%;
}
.attendance-table th:nth-child(2) {
  width: 100px;
}
.attendance-profession {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.attendance-color {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1px solid #0002;
  flex-shrink: 0;
}
.attendance-note {
  white-space: pre-wrap;
}
.attendance-actions {
  display: flex;
  justify-content: flex-end;
  padding-top: 20px;
  margin-top: 20px;
  border-top: 1px solid var(--color-border);
}
@media (max-width: 767px) {
  .attendance-card {
    padding: 20px;
  }
  .attendance-heading {
    flex-wrap: wrap;
  }
  .attendance-heading h2 {
    font-size: 20px;
  }
}
</style>
