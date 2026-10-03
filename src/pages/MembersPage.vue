<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import {
  mdiAccountGroupOutline,
  mdiPlus,
  mdiRefresh,
  mdiPencilOutline,
  mdiDeleteOutline,
  mdiHistory,
  mdiMagnify,
  mdiClose,
  mdiFileImportOutline,
} from '@mdi/js';
import { createMemberClient } from '../api/members.js';
import './members.css';
import MemberImportDialog from './MemberImportDialog.vue';

const client = createMemberClient({ source: import.meta.env.VITE_DATA_SOURCE || 'local' });
const members = ref([]);
const professions = ref([]);
const loading = ref(true);
const loadError = ref('');
const notice = ref('');
const search = ref('');
const jobFilter = ref(null);
const page = ref(1);
const pageSize = 20;
const filtered = computed(() => {
  const query = (search.value || '').trim().toLocaleLowerCase();
  return members.value.filter(
    (member) =>
      (!jobFilter.value || member.primaryProfessionId === jobFilter.value) &&
      (!query ||
        [member.uid, member.name, ...member.previousNames.map((entry) => entry.name)].some(
          (value) => value.toLocaleLowerCase().includes(query),
        )),
  );
});
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)));
const visibleMembers = computed(() =>
  filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize),
);
watch([search, jobFilter], () => {
  page.value = 1;
});
watch(pageCount, (count) => {
  if (page.value > count) page.value = count;
});
async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    const [memberData, professionData] = await Promise.all([
      client.getMembers(),
      client.getProfessions(),
    ]);
    if (!Array.isArray(memberData?.members) || !Array.isArray(professionData?.professions))
      throw new Error('資料格式不正確，請稍後重試');
    members.value = memberData.members;
    professions.value = professionData.professions;
  } catch (error) {
    loadError.value = error.message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
function clearFilters() {
  search.value = '';
  jobFilter.value = null;
}
function jobColor(id) {
  const color = professions.value.find((job) => job.job_id === id)?.colorcode;
  return /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#64748b';
}
const secondaryOptions = computed(() => [
  { job_id: null, name: '無副職業', colorcode: '#64748b' },
  ...professions.value,
]);
const dialog = ref(false);
const editing = ref(null);
const form = ref({ uid: '', name: '', primaryProfessionId: null, secondaryProfessionId: null });
const baseline = ref('');
const errors = ref({});
const saveError = ref('');
const saving = ref(false);
let opener;
const dirty = computed(() => JSON.stringify(form.value) !== baseline.value);
function openForm(member = null) {
  opener = document.activeElement;
  editing.value = member;
  form.value = {
    uid: member?.uid || '',
    name: member?.name || '',
    primaryProfessionId: member?.primaryProfessionId ?? null,
    secondaryProfessionId: member?.secondaryProfessionId ?? null,
  };
  baseline.value = JSON.stringify(form.value);
  errors.value = {};
  saveError.value = '';
  dialog.value = true;
}
function closeForm(value = false) {
  if (value || saving.value) return;
  if (dirty.value && !window.confirm('放棄尚未儲存的成員資料？')) return;
  dialog.value = false;
}
function restoreFocus() {
  if (opener?.isConnected) opener.focus();
}
async function save() {
  if (saving.value) return;
  errors.value = {};
  if (!form.value.uid.trim()) errors.value.uid = '請填寫 UID';
  if (!form.value.name.trim()) errors.value.name = '請填寫名稱';
  if (!form.value.primaryProfessionId) errors.value.primaryProfessionId = '請選擇主職業';
  if (Object.keys(errors.value).length) return;
  saving.value = true;
  saveError.value = '';
  notice.value = '';
  try {
    const { uid, ...values } = { ...form.value };
    const data = editing.value
      ? await client.updateMember(uid, { ...values, revision: editing.value.revision })
      : await client.addMember({ uid, ...values });
    const index = members.value.findIndex((member) => member.uid === data.member.uid);
    if (index < 0) members.value.push(data.member);
    else members.value[index] = data.member;
    notice.value = editing.value ? '成員資料已儲存' : '成員已加入';
    dialog.value = false;
  } catch (error) {
    errors.value = error.fields || {};
    saveError.value = error.message;
  } finally {
    saving.value = false;
  }
}
const removing = ref(null);
const removeDialog = ref(false);
const deleting = ref(false);
const removeError = ref('');
function openRemove(member) {
  opener = document.activeElement;
  removing.value = member;
  removeError.value = '';
  removeDialog.value = true;
}
async function remove() {
  if (deleting.value) return;
  deleting.value = true;
  removeError.value = '';
  notice.value = '';
  try {
    await client.removeMember(removing.value.uid, removing.value.revision);
    members.value = members.value.filter((member) => member.uid !== removing.value.uid);
    notice.value = '成員已移除，過去名稱已保留';
    removeDialog.value = false;
  } catch (error) {
    removeError.value = error.message;
  } finally {
    deleting.value = false;
  }
}
const history = ref(null);
const historyDialog = ref(false);
function openHistory(member) {
  opener = document.activeElement;
  history.value = member;
  historyDialog.value = true;
}
const importDialog = ref(false);
const importResultDialog = ref(false);
const importSummary = ref(null);
const pendingImportSummary = ref(null);
function openImport() {
  opener = document.activeElement;
  importDialog.value = true;
}
function acceptImport(data) {
  for (const member of data.members) {
    const index = members.value.findIndex((entry) => entry.uid === member.uid);
    if (index < 0) members.value.push(member);
    else members.value[index] = member;
  }
  pendingImportSummary.value = data.summary;
}
function afterImportLeave() {
  if (pendingImportSummary.value) {
    importSummary.value = pendingImportSummary.value;
    pendingImportSummary.value = null;
    importResultDialog.value = true;
  } else restoreFocus();
}
function formatDate(value) {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}
</script>

<template>
  <section class="page-heading" aria-labelledby="members-title">
    <div>
      <p class="eyebrow">GUILD MEMBERS <span class="eyebrow-divider">/</span> 成員管理</p>
      <h1 id="members-title">成員清單<span class="heading-dot">.</span></h1>
      <p class="page-subtitle">管理成員名稱與職業，留存每一次改名。</p>
    </div>
    <div class="member-page-actions">
      <v-btn
        variant="outlined"
        :prepend-icon="mdiFileImportOutline"
        :disabled="loading || !!loadError || !professions.length"
        @click="openImport"
        >匯入成員</v-btn
      >
      <v-btn
        color="primary"
        :prepend-icon="mdiPlus"
        :disabled="loading || !!loadError || !professions.length"
        @click="openForm()"
        >加入成員</v-btn
      >
    </div>
  </section>
  <div class="member-notices" aria-live="polite">
    <v-alert v-if="notice" type="success" variant="tonal" closable @click:close="notice = ''">{{
      notice
    }}</v-alert>
  </div>
  <section class="panel member-panel" aria-label="幫會成員名冊">
    <div class="section-header">
      <div class="member-list-heading">
        <span class="icon-box blue"><v-icon :icon="mdiAccountGroupOutline" size="22" /></span>
        <div>
          <h2>幫會成員</h2>
          <p v-if="!loading && !loadError" class="member-count">共 {{ members.length }} 位成員</p>
        </div>
      </div>
      <v-btn variant="outlined" :prepend-icon="mdiRefresh" :disabled="loading" @click="load"
        >重新載入</v-btn
      >
    </div>
    <div v-if="loading" class="empty-state" role="status">
      <v-skeleton-loader type="table-row, table-row, table-row" />
      <p>正在載入成員與職業…</p>
    </div>
    <div v-else-if="loadError" class="empty-state" role="alert">
      <h3>無法載入成員</h3>
      <p>{{ loadError }}</p>
      <v-btn variant="outlined" @click="load">重試</v-btn>
    </div>
    <template v-else>
      <div class="member-filters">
        <v-text-field
          v-model="search"
          label="搜尋 UID、名稱或過去名稱"
          :prepend-inner-icon="mdiMagnify"
          variant="outlined"
          density="compact"
          hide-details
          clearable
          @click:clear="search = ''"
        />
        <v-select
          v-model="jobFilter"
          :items="professions"
          item-title="name"
          item-value="job_id"
          label="篩選主職業"
          variant="outlined"
          density="compact"
          hide-details
          clearable
        />
        <v-btn variant="text" :disabled="!search && !jobFilter" @click="clearFilters"
          >清除篩選</v-btn
        >
      </div>
      <div v-if="!members.length" class="empty-state">
        <span class="empty-icon"><v-icon :icon="mdiAccountGroupOutline" size="28" /></span>
        <h3>尚無成員</h3>
        <p>從「加入成員」建立第一筆成員資料。</p>
      </div>
      <div v-else-if="!filtered.length" class="empty-state">
        <h3>沒有符合條件的成員</h3>
        <p>試試其他名稱或清除篩選條件。</p>
        <v-btn variant="text" @click="clearFilters">清除篩選</v-btn>
      </div>
      <template v-else>
        <p class="member-result" aria-live="polite">顯示 {{ filtered.length }} 位成員</p>
        <div class="member-table-scroll" tabindex="0" aria-label="成員表格，可左右捲動">
          <table class="member-table">
            <thead>
              <tr>
                <th scope="col">UID</th>
                <th scope="col">名稱</th>
                <th scope="col">主職業</th>
                <th scope="col">副職業</th>
                <th scope="col">過去名稱</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="member in visibleMembers" :key="member.uid">
                <td class="member-uid">{{ member.uid }}</td>
                <td class="member-name">{{ member.name }}</td>
                <td>
                  <span class="profession-label"
                    ><span
                      class="profession-dot"
                      :style="{ backgroundColor: jobColor(member.primaryProfessionId) }"
                    ></span
                    >{{ member.primaryProfession || '—' }}</span
                  >
                </td>
                <td>
                  <span v-if="member.secondaryProfession" class="profession-label"
                    ><span
                      class="profession-dot"
                      :style="{ backgroundColor: jobColor(member.secondaryProfessionId) }"
                    ></span
                    >{{ member.secondaryProfession }}</span
                  ><span v-else class="member-muted">—</span>
                </td>
                <td>
                  <v-btn
                    v-if="member.previousNames.length"
                    variant="text"
                    size="small"
                    :prepend-icon="mdiHistory"
                    :aria-label="`查看 ${member.name} 的過去名稱`"
                    @click="openHistory(member)"
                    >{{ member.previousNames.length }} 筆紀錄</v-btn
                  ><span v-else class="member-muted">—</span>
                </td>
                <td>
                  <div class="member-row-actions">
                    <v-btn
                      variant="text"
                      size="small"
                      :prepend-icon="mdiPencilOutline"
                      :aria-label="`編輯 ${member.name}`"
                      @click="openForm(member)"
                      >編輯</v-btn
                    ><v-btn
                      color="error"
                      variant="text"
                      size="small"
                      :prepend-icon="mdiDeleteOutline"
                      :aria-label="`移除 ${member.name}`"
                      @click="openRemove(member)"
                      >移除</v-btn
                    >
                  </div>
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
          aria-label="成員清單分頁"
        />
      </template>
    </template>
  </section>

  <v-dialog
    :model-value="dialog"
    :persistent="saving"
    max-width="580"
    aria-labelledby="member-form-title"
    @update:model-value="closeForm"
    @after-leave="restoreFocus"
  >
    <v-card class="member-dialog">
      <form @submit.prevent="save">
        <div class="member-dialog-heading">
          <div>
            <p class="eyebrow">MEMBER PROFILE</p>
            <h2 id="member-form-title">{{ editing ? '編輯成員' : '加入成員' }}</h2>
          </div>
          <v-btn
            variant="text"
            :icon="mdiClose"
            aria-label="關閉成員表單"
            :disabled="saving"
            @click="closeForm()"
          />
        </div>
        <p class="member-dialog-description">
          {{
            editing
              ? 'UID 固定不變，改名後會自動保留過去名稱。'
              : '填寫遊戲內 UID、名稱與職業。主職業為必填。'
          }}
        </p>
        <v-alert
          v-if="saveError"
          type="error"
          variant="tonal"
          class="member-form-alert"
          role="alert"
          >{{ saveError
          }}<span v-if="saveError.includes('重新載入')"> 請關閉表單後重新載入清單。</span></v-alert
        >
        <fieldset :disabled="saving" class="member-fields">
          <v-text-field
            v-model="form.uid"
            label="UID（遊戲內 ID）*"
            variant="outlined"
            :disabled="!!editing || saving"
            maxlength="64"
            :error-messages="errors.uid"
            hint="以文字保存，保留前導零"
            persistent-hint
            autocomplete="off"
            @update:model-value="errors.uid = ''"
          />
          <v-text-field
            v-model="form.name"
            label="名稱 *"
            variant="outlined"
            maxlength="64"
            :disabled="saving"
            :error-messages="errors.name"
            autocomplete="off"
            @update:model-value="errors.name = ''"
          />
          <v-select
            v-model="form.primaryProfessionId"
            label="主職業 *"
            :items="professions"
            item-title="name"
            item-value="job_id"
            variant="outlined"
            :disabled="saving"
            :error-messages="errors.primaryProfessionId"
            @update:model-value="errors.primaryProfessionId = ''"
          >
            <template #item="{ props, item }"
              ><v-list-item v-bind="props"
                ><template #prepend
                  ><span
                    class="profession-dot selector-dot"
                    :style="{ backgroundColor: jobColor(item.job_id) }"
                  ></span></template></v-list-item
            ></template>
          </v-select>
          <v-select
            v-model="form.secondaryProfessionId"
            label="副職業"
            :items="secondaryOptions"
            item-title="name"
            item-value="job_id"
            variant="outlined"
            :disabled="saving"
            :error-messages="errors.secondaryProfessionId"
            @update:model-value="errors.secondaryProfessionId = ''"
          >
            <template #item="{ props, item }"
              ><v-list-item v-bind="props"
                ><template #prepend
                  ><span
                    class="profession-dot selector-dot"
                    :style="{ backgroundColor: jobColor(item.job_id) }"
                  ></span></template></v-list-item
            ></template>
          </v-select>
        </fieldset>
        <div class="member-dialog-actions">
          <v-btn variant="outlined" :disabled="saving" @click="closeForm()">取消</v-btn
          ><v-btn type="submit" color="primary" :loading="saving" :disabled="saving">{{
            saving ? '儲存中…' : '儲存'
          }}</v-btn>
        </div>
      </form>
    </v-card>
  </v-dialog>
  <v-dialog
    v-model="removeDialog"
    :persistent="deleting"
    max-width="480"
    aria-labelledby="remove-title"
    @after-leave="restoreFocus"
  >
    <v-card class="member-dialog"
      ><h2 id="remove-title">移除成員</h2>
      <p class="member-dialog-description">
        確定移除 <strong>{{ removing?.name }}</strong
        >？
      </p>
      <p class="member-remove-uid">UID：{{ removing?.uid }}</p>
      <p class="member-dialog-description">
        這位成員將離開清單，過去名稱會保留。日後以相同 UID 加入時可延續紀錄。
      </p>
      <v-alert v-if="removeError" type="error" variant="tonal" role="alert">{{
        removeError
      }}</v-alert>
      <div class="member-dialog-actions">
        <v-btn variant="outlined" :disabled="deleting" @click="removeDialog = false">取消</v-btn
        ><v-btn color="error" :loading="deleting" :disabled="deleting" @click="remove">{{
          deleting ? '移除中…' : '確認移除'
        }}</v-btn>
      </div></v-card
    >
  </v-dialog>
  <v-dialog
    v-model="historyDialog"
    max-width="540"
    aria-labelledby="history-title"
    @after-leave="restoreFocus"
  >
    <v-card class="member-dialog"
      ><div class="member-dialog-heading">
        <h2 id="history-title">過去名稱</h2>
        <v-btn
          variant="text"
          :icon="mdiClose"
          aria-label="關閉過去名稱"
          @click="historyDialog = false"
        />
      </div>
      <p class="member-dialog-description">
        {{ history?.name }} <span class="member-muted">／ {{ history?.uid }}</span>
      </p>
      <ol class="member-history">
        <li v-for="entry in history?.previousNames" :key="entry.id">
          <strong>{{ entry.name }}</strong
          ><time :datetime="entry.changedAt">{{ formatDate(entry.changedAt) }} 改名</time>
        </li>
      </ol>
      <div class="member-dialog-actions">
        <v-btn variant="outlined" @click="historyDialog = false">關閉</v-btn>
      </div></v-card
    >
  </v-dialog>
  <MemberImportDialog
    v-model="importDialog"
    :professions="professions"
    @imported="acceptImport"
    @after-leave="afterImportLeave"
  />
  <v-dialog
    v-model="importResultDialog"
    max-width="500"
    aria-labelledby="import-result-title"
    @after-leave="restoreFocus"
  >
    <v-card class="member-dialog">
      <h2 id="import-result-title">
        {{ importSummary?.added || importSummary?.restored ? '匯入完成' : '沒有新增成員' }}
      </h2>
      <dl class="import-result-counts">
        <div>
          <dt>新增成員</dt>
          <dd>{{ importSummary?.added }} 位</dd>
        </div>
        <div v-if="importSummary?.restored">
          <dt>重新加入</dt>
          <dd>{{ importSummary.restored }} 位</dd>
        </div>
        <div>
          <dt>跳過既有 UID</dt>
          <dd>{{ importSummary?.skipped }} 位</dd>
        </div>
      </dl>
      <p class="member-dialog-description">既有成員的名稱與職業保持原樣。</p>
      <div class="member-dialog-actions">
        <v-btn color="primary" @click="importResultDialog = false">知道了</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>
