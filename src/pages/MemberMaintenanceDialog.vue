<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { mdiClose, mdiDeleteOutline, mdiPlus } from '@mdi/js';
import DataLoading from '../components/DataLoading.vue';

const props = defineProps({ modelValue: Boolean, member: Object, mode: String, client: Object });
const emit = defineEmits(['update:modelValue', 'saved', 'deleted', 'afterLeave']);
const current = ref(null);
const entries = ref([]);
const confirmUid = ref('');
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const baseline = ref('[]');
const requestId = ref('');
let generation = 0;
const historyMode = computed(() => props.mode === 'history');
const dirty = computed(() => historyMode.value && JSON.stringify(entries.value) !== baseline.value);
const canSave = computed(() => !loading.value && !saving.value && !!current.value &&
  (historyMode.value ? dirty.value && entries.value.every((entry) => entry.name.trim()) : confirmUid.value === current.value.uid));

async function load() {
  const token = ++generation;
  loading.value = true;
  error.value = '';
  current.value = null;
  try {
    const data = await props.client.getMemberMaintenance(props.member.uid);
    if (token !== generation || !props.modelValue) return;
    current.value = data.member;
    entries.value = data.member.previousNames.map(({ id, name }) => ({ id, name }));
    baseline.value = JSON.stringify(entries.value);
    requestId.value = crypto.randomUUID();
  } catch (failure) {
    if (token === generation) error.value = failure.message;
  } finally {
    if (token === generation) loading.value = false;
  }
}
watch(() => [props.modelValue, props.member?.uid, props.mode], ([open]) => {
  generation++;
  if (open) {
    entries.value = [];
    baseline.value = '[]';
    confirmUid.value = '';
    load();
  }
});
watch(entries, () => { requestId.value = crypto.randomUUID(); }, { deep: true });
onBeforeUnmount(() => { generation++; });
function close(open = false) {
  if (open || saving.value) return;
  if (dirty.value && !window.confirm('放棄尚未儲存的過去名稱？')) return;
  emit('update:modelValue', false);
}
async function save() {
  if (!canSave.value) return;
  saving.value = true;
  error.value = '';
  try {
    const common = { revision: current.value.revision, requestId: requestId.value };
    if (historyMode.value) {
      const result = await props.client.saveMemberNameHistory(current.value.uid, { ...common, entries: entries.value });
      emit('saved', result.member);
    } else {
      const result = await props.client.deleteMemberPermanently(current.value.uid, { ...common, confirmUid: confirmUid.value });
      if (!result.deleted) throw new Error('刪除回應不完整，請重試或重新載入確認結果');
      emit('deleted', current.value);
    }
    emit('update:modelValue', false);
  } catch (failure) {
    error.value = failure.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <v-dialog :model-value="modelValue" :persistent="saving" max-width="640"
    aria-labelledby="member-maintenance-title" @update:model-value="close" @after-leave="emit('afterLeave')">
    <v-card class="member-dialog member-maintenance-dialog" :aria-busy="loading || saving">
      <div class="member-dialog-heading">
        <h2 id="member-maintenance-title">{{ historyMode ? '管理過去名稱' : '永久刪除成員' }}</h2>
        <v-btn variant="text" :icon="mdiClose" :disabled="saving" aria-label="關閉成員維護" @click="close()" />
      </div>
      <p class="member-dialog-description">{{ current?.name || member?.name }} ／ {{ current?.uid || member?.uid }}</p>
      <DataLoading v-if="loading">正在讀取最新成員資料…</DataLoading>
      <v-alert v-if="error" type="error" variant="tonal" role="alert">{{ error }}</v-alert>
      <v-btn v-if="error && !current" variant="outlined" :disabled="loading" @click="load">重新載入</v-btn>
      <template v-if="current && !loading">
        <template v-if="historyMode">
          <p class="member-dialog-description">補上或修正舊名；現在名稱保持不變。儲存後可由 admin 預覽戰績同步，確認同名對應。</p>
          <div class="member-history-editor">
            <p v-if="!entries.length" class="member-muted">尚無過去名稱，可新增一筆。</p>
            <div v-for="(entry, index) in entries" :key="entry.id || `new-${index}`" class="member-history-entry">
              <v-text-field v-model="entry.name" :label="`過去名稱 ${index + 1}`" maxlength="64"
                variant="outlined" hide-details="auto" :disabled="saving" />
              <v-btn variant="text" color="error" :icon="mdiDeleteOutline" :disabled="saving"
                :aria-label="`移除過去名稱 ${index + 1}`" @click="entries.splice(index, 1)" />
            </div>
          </div>
          <v-btn class="member-history-add" variant="outlined" :prepend-icon="mdiPlus" :disabled="saving || entries.length >= 500"
            @click="entries.push({ name: '' })">新增過去名稱</v-btn>
        </template>
        <template v-else>
          <v-alert type="warning" variant="tonal">此操作無法復原，請確認這是需要移除的錯誤資料。</v-alert>
          <p class="member-dialog-description">將刪除 1 位成員、{{ current.previousNames.length }} 筆過去名稱及其報名／請假資料，解除個人戰績與排表的成員關聯。原始戰績、數值與排表當時的姓名仍會保留。</p>
          <v-text-field v-model="confirmUid" label="輸入完整 UID 確認刪除" variant="outlined"
            autocomplete="off" :disabled="saving" hide-details="auto" />
        </template>
      </template>
      <DataLoading v-if="saving" compact :spinner="false">{{ historyMode ? '正在儲存過去名稱…' : '正在永久刪除成員…' }}</DataLoading>
      <div class="member-dialog-actions">
        <v-btn variant="outlined" :disabled="saving" @click="close()">{{ historyMode ? '取消' : '保留成員' }}</v-btn>
        <v-btn v-if="current" :color="historyMode ? 'primary' : 'error'" :loading="saving" :disabled="!canSave" @click="save">
          {{ historyMode ? '儲存過去名稱' : '確認永久刪除' }}
        </v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.member-maintenance-dialog { max-height: calc(100dvh - 48px); overflow-y: auto; }
.member-history-editor { display: grid; gap: 16px; max-height: 45dvh; overflow-y: auto; padding: 4px; margin: 16px -4px; }
.member-history-entry { display: flex; gap: 8px; align-items: flex-start; }
.member-history-entry .v-input { min-width: 0; }
.member-history-add { align-self: flex-start; margin-bottom: 16px; }
.member-dialog-actions {
  position: sticky;
  bottom: -24px;
  padding-top: 16px;
  padding-bottom: 8px;
  background: var(--color-surface);
}
</style>
