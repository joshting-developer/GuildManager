<script setup>
import DataLoading from '../components/DataLoading.vue';
import { computed, ref, watch, nextTick } from 'vue';
import { mdiPlus, mdiPencilOutline, mdiRefresh } from '@mdi/js';
import { createDutyClient } from '../api/duties.js';
const props = defineProps({
  duties: { type: Array, default: () => [] },
  disabled: Boolean,
  assignable: Boolean,
  selectedId: String,
});
const emit = defineEmits(['updated', 'select', 'busy-changed', 'unsaved-changed']);
const client = createDutyClient({ source: import.meta.env.VITE_DATA_SOURCE || 'local' });
const heading = ref(null);
const showInactive = ref(false),
  search = ref(''),
  open = ref(false),
  editing = ref(null),
  name = ref(''),
  active = ref(true),
  busy = ref(false),
  refreshing = ref(false),
  error = ref(''),
  notice = ref('');
let baseline = '',
  opener = null,
  createAttempt = null;
const dirty = computed(() => open.value && JSON.stringify([name.value, active.value]) !== baseline);
const visible = computed(() =>
  props.duties.filter(
    (duty) =>
      (showInactive.value || duty.active) && duty.name.includes((search.value || '').trim()),
  ),
);
watch(dirty, (value) => emit('unsaved-changed', value));
watch(busy, (value) => emit('busy-changed', value));
function edit(duty = null) {
  opener = document.activeElement;
  editing.value = duty ? { ...duty } : null;
  name.value = duty?.name || '';
  active.value = duty?.active ?? true;
  baseline = JSON.stringify([name.value, active.value]);
  createAttempt = null;
  error.value = '';
  open.value = true;
}
function close() {
  if (!busy.value && (!dirty.value || window.confirm('職責有尚未儲存的修改，確定要關閉嗎？')))
    open.value = false;
}
function restoreFocus() {
  nextTick(() => {
    if (opener?.isConnected) opener.focus();
    else heading.value?.focus();
  });
}
async function refresh() {
  busy.value = true;
  refreshing.value = true;
  error.value = '';
  try {
    const data = await client.getDuties();
    emit('updated', data.duties);
    notice.value = '職責清單已更新，目前的排表仍保留。';
  } catch (cause) {
    error.value = cause.message;
  } finally {
    busy.value = false;
    refreshing.value = false;
  }
}
async function save() {
  if (!name.value.trim()) {
    error.value = '請填寫職責名稱';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    const title = name.value.trim();
    if (!editing.value && createAttempt?.name !== title)
      createAttempt = { name: title, requestId: crypto.randomUUID() };
    const data = editing.value
      ? await client.updateDuty(editing.value.id, {
          name: title,
          active: active.value,
          revision: editing.value.revision,
        })
      : await client.addDuty(createAttempt);
    if (!data.duty?.id || typeof data.duty.active !== 'boolean')
      throw new Error('職責回應格式不正確，請重試以確認結果');
    const updated = props.duties.filter((duty) => duty.id !== data.duty.id);
    updated.push(data.duty);
    emit('updated', updated);
    open.value = false;
    notice.value = `職責「${data.duty.name}」已${data.duty.active ? '儲存' : '停用'}。`;
  } catch (cause) {
    error.value = cause.message;
  } finally {
    busy.value = false;
  }
}
function drag(event, duty) {
  event.dataTransfer.setData('application/x-guild-duty', duty.id);
  event.dataTransfer.effectAllowed = 'copy';
}
</script>

<template>
  <div class="duty-list">
    <v-card class="lineup-duties-card">
      <div class="lineup-member-heading">
        <h2 ref="heading" tabindex="-1">職責清單</h2>
        <div>
          <v-btn
            variant="text"
            :icon="mdiRefresh"
            aria-label="更新職責清單並保留排表"
            :disabled="disabled || busy"
            :loading="refreshing"
            @click="refresh"
          /><v-btn
            variant="text"
            :icon="mdiPlus"
            aria-label="新增職責"
            :disabled="disabled || busy"
            @click="edit()"
          />
        </div>
      </div>
      <p class="lineup-hint">
        {{
          assignable
            ? '拖曳到任務欄，或點選職責再點位置。同一位置可有多項職責；重複套用不會新增第二份。'
            : '可維護職責清單，選擇可編輯的戰鬥場次後即可分配。'
        }}
      </p>
      <v-alert v-if="error && !open" type="error" variant="tonal" role="alert">{{ error }}</v-alert>
      <p v-if="notice" class="lineup-hint" role="status">{{ notice }}</p>
      <DataLoading v-if="refreshing" compact :spinner="false">正在更新職責清單…</DataLoading>
      <v-text-field
        v-model="search"
        label="搜尋職責"
        variant="outlined"
        hide-details
        clearable
        :disabled="disabled || busy"
      />
      <v-checkbox
        v-model="showInactive"
        label="顯示停用職責"
        hide-details
        :disabled="disabled || busy"
      />
      <div class="duty-token-list">
        <div v-for="duty in visible" :key="duty.id" class="duty-token-row">
          <button
            type="button"
            :class="[
              'duty-token',
              { 'duty-selected': selectedId === duty.id, 'duty-inactive': !duty.active },
            ]"
            :data-duty="duty.id"
            :draggable="assignable && duty.active && !disabled && !busy"
            :disabled="!assignable || !duty.active || disabled || busy"
            :aria-pressed="selectedId === duty.id"
            @dragstart="drag($event, duty)"
            @click="emit('select', selectedId === duty.id ? '' : duty.id)"
          >
            {{ duty.name }}<small v-if="!duty.active">停用</small></button
          ><v-btn
            variant="text"
            :icon="mdiPencilOutline"
            :aria-label="`修改職責：${duty.name}`"
            :disabled="disabled || busy"
            @click="edit(duty)"
          />
        </div>
        <p v-if="!visible.length" class="lineup-hint">沒有符合條件的職責，可清除搜尋或新增。</p>
      </div>
    </v-card>
    <v-dialog
      :model-value="open"
      max-width="480"
      :persistent="busy"
      aria-labelledby="duty-dialog-title"
      @update:model-value="!$event && close()"
      @after-leave="restoreFocus"
    >
      <v-card class="lineup-dialog"
        ><div class="lineup-dialog-content">
          <h2 id="duty-dialog-title">{{ editing ? '修改職責' : '新增職責' }}</h2>
          <v-alert v-if="error" type="error" variant="tonal" role="alert">{{ error }}</v-alert
          ><v-text-field
            v-model="name"
            label="職責名稱"
            maxlength="40"
            variant="outlined"
            :disabled="busy"
            autofocus
          /><v-checkbox
            v-if="editing"
            v-model="active"
            label="啟用職責"
            :disabled="busy"
            hide-details
          />
          <p class="lineup-hint">
            改名不會改變已確認名單。停用後不再供新排表選取，範本套用時會跳過並提醒。
          </p>
        </div>
        <DataLoading v-if="busy" compact :spinner="false">正在儲存職責，請稍候…</DataLoading>
        <div class="lineup-dialog-actions">
          <v-btn variant="outlined" :disabled="busy" @click="close">取消</v-btn
          ><v-btn color="primary" :loading="busy" :disabled="busy" @click="save">{{
            busy ? '儲存中…' : '儲存職責'
          }}</v-btn>
        </div></v-card
      >
    </v-dialog>
  </div>
</template>
