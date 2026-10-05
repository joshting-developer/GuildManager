<script setup>
import DataLoading from '../components/DataLoading.vue';
import { computed, ref, watch } from 'vue';
import { mdiClose, mdiFileUploadOutline } from '@mdi/js';
import { createMemberClient } from '../api/members.js';
import './member-import.css';

const props = defineProps({ modelValue: Boolean, professions: { type: Array, default: () => [] } });
const emit = defineEmits(['update:modelValue', 'imported', 'after-leave']);
const client = createMemberClient({ source: import.meta.env.VITE_DATA_SOURCE || 'local' });
const text = ref('');
const fileName = ref('');
const fileInput = ref(null);
const preview = ref(null);
const previewPage = ref(1);
const rowErrors = ref([]);
const errorMessage = ref('');
const reading = ref(false);
const previewing = ref(false);
const importing = ref(false);
const busy = computed(() => reading.value || previewing.value || importing.value);
const ready = computed(() => !!preview.value?.fingerprint && !rowErrors.value.length);
const pageCount = computed(() => Math.ceil((preview.value?.rows.length || 0) / 20));
const previewRows = computed(
  () => preview.value?.rows.slice((previewPage.value - 1) * 20, previewPage.value * 20) || [],
);
const actionLabels = { add: '新增', skip: '跳過（UID 已存在）', restore: '重新加入' };
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      text.value = '';
      fileName.value = '';
      preview.value = null;
      rowErrors.value = [];
      errorMessage.value = '';
      previewPage.value = 1;
    }
  },
);
watch(text, () => {
  preview.value = null;
  rowErrors.value = [];
  errorMessage.value = '';
  previewPage.value = 1;
});
function close(value = false) {
  if (value || busy.value) return;
  if (text.value && !window.confirm('放棄尚未匯入的成員資料？')) return;
  emit('update:modelValue', false);
}
async function readFile(event) {
  const file = event.target.files?.[0];
  if (!file || busy.value) return;
  preview.value = null;
  rowErrors.value = [];
  errorMessage.value = '';
  try {
    if (!/\.(?:csv|tsv|txt)$/i.test(file.name))
      throw new Error('請選擇 CSV、TSV 或 TXT 檔案，Excel 請先另存為 UTF-8 CSV');
    if (file.size > 256 * 1024) throw new Error('檔案最多 256 KiB，請分批匯入');
    reading.value = true;
    let content;
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    } catch {
      throw new Error('無法讀取檔案，請確認檔案使用 UTF-8 編碼');
    }
    text.value = content;
    fileName.value = file.name;
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    reading.value = false;
    event.target.value = '';
  }
}
async function buildPreview() {
  if (busy.value) return;
  previewing.value = true;
  preview.value = null;
  rowErrors.value = [];
  errorMessage.value = '';
  try {
    const data = await client.previewMemberImport({ text: text.value });
    if (!Array.isArray(data?.rows) || !Array.isArray(data?.issues) || !data.summary)
      throw new Error('預覽資料格式不正確，請重試');
    preview.value = data;
    rowErrors.value = data.issues;
    previewPage.value = 1;
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    previewing.value = false;
  }
}
async function confirmImport() {
  if (busy.value || !ready.value) return;
  importing.value = true;
  errorMessage.value = '';
  try {
    const data = await client.importMembers({
      text: text.value,
      fingerprint: preview.value.fingerprint,
    });
    emit('imported', data);
    emit('update:modelValue', false);
  } catch (error) {
    errorMessage.value = error.message;
    if (error.code === 'STALE_IMPORT' || error.code === 'IMPORT_INVALID') preview.value = null;
    rowErrors.value = error.rows || [];
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    :persistent="busy"
    max-width="900"
    aria-labelledby="member-import-title"
    @update:model-value="close"
    @after-leave="emit('after-leave')"
  >
    <v-card class="member-dialog import-dialog">
      <div class="import-content">
        <div class="member-dialog-heading">
          <div>
            <p class="eyebrow">IMPORT MEMBERS</p>
            <h2 id="member-import-title">匯入成員</h2>
          </div>
          <v-btn
            variant="text"
            :icon="mdiClose"
            aria-label="關閉匯入成員"
            :disabled="busy"
            @click="close()"
          />
        </div>
        <p class="member-dialog-description">
          貼上名單或讀取 UTF-8 CSV／TSV／TXT，每行一位成員。既有 UID
          會跳過，保留原有名稱、職業與所屬狀態。
        </p>
        <div class="import-format">
          <strong>格式範例</strong>
          <pre>
UID Name 主職業 副職業
001 角色名稱 碎夢 -</pre
          >
          <p>
            職業填名稱，無副職業填「-」或「無副職業」。欄位可用空白、Tab
            或逗號分隔；名稱含空白時請用 Tab 或 CSV 引號。
          </p>
        </div>
        <p class="member-import-membership-note">
          匯入新 UID 預設為「幫派內：是／俱樂部內：否」，會顯示在成員頁。已有
          UID（含編外人員）會跳過，回歸請使用編輯。
        </p>
        <details class="import-jobs">
          <summary>可用職業名稱</summary>
          <p>{{ professions.map((job) => job.name).join('、') }}</p>
        </details>
        <div class="import-file-actions">
          <input
            ref="fileInput"
            type="file"
            accept=".csv,.tsv,.txt"
            hidden
            aria-label="選擇成員匯入檔案"
            @change="readFile"
          /><v-btn
            variant="outlined"
            :prepend-icon="mdiFileUploadOutline"
            :disabled="busy"
            @click="fileInput?.click()"
            >讀取檔案</v-btn
          ><span v-if="fileName" class="member-muted">{{ fileName }}</span
          ><span v-if="reading" role="status">讀取中…</span>
        </div>
        <v-textarea
          v-model="text"
          label="成員匯入資料"
          variant="outlined"
          rows="6"
          :disabled="busy"
          hint="最多 500 位成員、256 KiB；可包含表頭。CSV／TSV 的副職業可留空欄"
          persistent-hint
          spellcheck="false"
        />
        <v-alert
          v-if="errorMessage"
          type="error"
          variant="tonal"
          class="member-form-alert"
          role="alert"
          >{{ errorMessage }}</v-alert
        >
        <div v-if="rowErrors.length" class="import-errors" role="alert">
          <strong>有 {{ rowErrors.length }} 行資料需要修正，尚未匯入任何成員</strong>
          <ul>
            <li v-for="(issue, index) in rowErrors" :key="index">
              第 {{ issue.line }} 行：{{ issue.message }}
            </li>
          </ul>
        </div>
        <section v-if="preview" class="import-preview" aria-label="匯入預覽">
          <h3>匯入預覽</h3>
          <p class="import-summary" aria-live="polite">
            新增 {{ preview.summary.added }} 位<span v-if="preview.summary.restored">
              · 重新加入 {{ preview.summary.restored }} 位</span
            >
            · 跳過 {{ preview.summary.skipped }} 位
          </p>
          <p v-if="preview.summary.restored" class="member-dialog-description">
            重新加入會恢復已移除的成員，並保留過去名稱。
          </p>
          <div
            v-if="preview.rows.length"
            class="member-table-scroll"
            tabindex="0"
            aria-label="匯入預覽表格，可左右捲動"
          >
            <table class="member-table">
              <thead>
                <tr>
                  <th scope="col">行號</th>
                  <th scope="col">UID</th>
                  <th scope="col">名稱</th>
                  <th scope="col">主職業</th>
                  <th scope="col">副職業</th>
                  <th scope="col">處理方式</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in previewRows" :key="row.line">
                  <td>{{ row.line }}</td>
                  <td class="member-uid">{{ row.uid }}</td>
                  <td class="member-name">{{ row.name }}</td>
                  <td>{{ row.primaryProfession }}</td>
                  <td>{{ row.secondaryProfession || '—' }}</td>
                  <td>
                    <span :class="['import-action', row.action]">{{
                      actionLabels[row.action]
                    }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <v-pagination
            v-if="pageCount > 1"
            v-model="previewPage"
            :length="pageCount"
            :total-visible="4"
            :disabled="busy"
            aria-label="匯入預覽分頁"
          />
        </section>
      </div>
      <DataLoading v-if="busy" compact :spinner="!previewing && !importing">{{ importing ? '正在匯入成員，請稍候…' : previewing ? '正在檢查匯入資料…' : '正在讀取檔案…' }}</DataLoading>
      <div class="member-dialog-actions import-actions">
        <v-btn variant="outlined" :disabled="busy" @click="close()">取消</v-btn
        ><v-btn
          variant="outlined"
          :loading="previewing"
          :disabled="busy || !text.trim()"
          @click="buildPreview"
          >預覽資料</v-btn
        ><v-btn
          color="primary"
          :loading="importing"
          :disabled="busy || !ready"
          @click="confirmImport"
          >{{ importing ? '匯入中…' : '確認匯入' }}</v-btn
        >
      </div>
    </v-card>
  </v-dialog>
</template>
