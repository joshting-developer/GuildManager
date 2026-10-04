<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import {
  mdiAccountGroupOutline,
  mdiPlus,
  mdiRefresh,
  mdiPencilOutline,
  mdiAccountArrowRightOutline,
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
const tab = ref('members');
const memberCount = computed(
  () => members.value.filter((member) => member.isInGuild || member.isInClub).length,
);
const externalCount = computed(() => members.value.length - memberCount.value);
const tabLabel = computed(() => (tab.value === 'members' ? '成員' : '編外人員'));
const categoryMembers = computed(() =>
  members.value.filter((member) =>
    tab.value === 'members'
      ? member.isInGuild || member.isInClub
      : !member.isInGuild && !member.isInClub,
  ),
);
watch(tab, () => {
  membershipFilter.value = 'all';
  page.value = 1;
});
const jobFilter = ref(null);
const membershipFilter = ref('all');
const membershipOptions = [
  { title: '俱樂部', value: 'club' },
  { title: '幫派', value: 'guild' },
  { title: '不篩選', value: 'all' },
];
const page = ref(1);
const pageSize = 20;
const filtered = computed(() => {
  const query = (search.value || '').trim().toLocaleLowerCase();
  return categoryMembers.value.filter(
    (member) =>
      (membershipFilter.value === 'all' ||
        (membershipFilter.value === 'club'
          ? member.isInClub === true
          : member.isInGuild === true)) &&
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
watch([search, jobFilter, membershipFilter], () => {
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
  membershipFilter.value = 'all';
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
const form = ref({
  uid: '',
  name: '',
  primaryProfessionId: null,
  secondaryProfessionId: null,
  isInGuild: true,
  isInClub: false,
});
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
    isInGuild: member?.isInGuild ?? tab.value === 'members',
    isInClub: member?.isInClub ?? false,
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
  else document.getElementById('main')?.focus({ preventScroll: true });
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
    const destination = data.member.isInGuild || data.member.isInClub ? 'members' : 'external';
    tab.value = destination;
    notice.value = editing.value
      ? `人員資料已儲存，顯示於${destination === 'members' ? '成員' : '編外人員'}。`
      : `人員已加入${destination === 'members' ? '成員' : '編外人員'}清單。`;
    dialog.value = false;
  } catch (error) {
    errors.value = error.fields || {};
    saveError.value = error.message;
  } finally {
    saving.value = false;
  }
}
const moving = ref(null);
const moveDialog = ref(false);
const movingBusy = ref(false);
const moveError = ref('');
function openMove(member) {
  opener = document.activeElement;
  moving.value = member;
  moveError.value = '';
  moveDialog.value = true;
}
async function moveToExternal() {
  if (movingBusy.value) return;
  movingBusy.value = true;
  moveError.value = '';
  notice.value = '';
  try {
    const data = await client.removeMember(moving.value.uid, moving.value.revision);
    if (!data?.member || data.member.isInGuild !== false || data.member.isInClub !== false)
      throw new Error('移轉回應不正確，請重試或重新載入確認結果');
    const index = members.value.findIndex((member) => member.uid === data.member.uid);
    if (index >= 0) members.value[index] = data.member;
    notice.value = `「${data.member.name}」已移至編外人員，資料與過去名稱已保留。`;
    moveDialog.value = false;
  } catch (error) {
    moveError.value = error.message;
  } finally {
    movingBusy.value = false;
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
      <p class="page-subtitle">管理成員名稱、職業與幫派／俱樂部狀態，留存每一次改名。</p>
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
  <section class="panel member-panel" aria-label="成員名冊">
    <div class="section-header">
      <div class="member-list-heading">
        <span class="icon-box blue"><v-icon :icon="mdiAccountGroupOutline" size="22" /></span>
        <div>
          <h2>成員名冊</h2>
          <p v-if="!loading && !loadError" class="member-count">
            成員 {{ memberCount }} 位 · 編外 {{ externalCount }} 位
          </p>
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
      <v-tabs v-model="tab" color="primary" class="member-tabs" aria-label="成員分類">
        <v-tab id="member-tab-members" value="members" aria-controls="member-list-members"
          >成員<span class="member-tab-count">{{ memberCount }}</span></v-tab
        >
        <v-tab id="member-tab-external" value="external" aria-controls="member-list-external"
          >編外人員<span class="member-tab-count">{{ externalCount }}</span></v-tab
        >
      </v-tabs>
      <div
        :id="`member-list-${tab}`"
        role="tabpanel"
        :aria-labelledby="`member-tab-${tab}`"
        tabindex="0"
        class="member-tab-panel"
      >
        <p class="member-tab-description">
          {{
            tab === 'members'
              ? '幫派內或俱樂部內至少一項為是的人員。'
              : '幫派內與俱樂部內皆為否的人員，可編輯所屬狀態返回成員清單。'
          }}
        </p>
        <div :class="['member-filters', { 'member-filters-external': tab === 'external' }]">
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
          <v-select
            v-if="tab === 'members'"
            v-model="membershipFilter"
            :items="membershipOptions"
            label="篩選幫派／俱樂部"
            variant="outlined"
            density="compact"
            hide-details
          />
          <v-btn
            variant="text"
            :disabled="!search && !jobFilter && membershipFilter === 'all'"
            @click="clearFilters"
            >清除篩選</v-btn
          >
        </div>
        <div v-if="!categoryMembers.length" class="empty-state">
          <span class="empty-icon"><v-icon :icon="mdiAccountGroupOutline" size="28" /></span>
          <h3>{{ tab === 'members' ? '尚無成員' : '尚無編外人員' }}</h3>
          <p>
            {{
              tab === 'members'
                ? '可加入成員，或在編外人員中編輯所屬狀態。'
                : '將成員移至編外，或新增兩個所屬狀態皆為否的人員。'
            }}
          </p>
        </div>
        <div v-else-if="!filtered.length" class="empty-state">
          <h3>沒有符合條件的{{ tabLabel }}</h3>
          <p>試試其他名稱或清除篩選條件。</p>
          <v-btn variant="text" @click="clearFilters">清除篩選</v-btn>
        </div>
        <template v-else>
          <p class="member-result" aria-live="polite">
            顯示 {{ filtered.length }} 位{{ tabLabel }}
          </p>
          <div class="member-table-scroll" tabindex="0" :aria-label="`${tabLabel}表格，可左右捲動`">
            <table class="member-table">
              <thead>
                <tr>
                  <th scope="col">UID</th>
                  <th scope="col">名稱</th>
                  <th scope="col">主職業</th>
                  <th scope="col">副職業</th>
                  <th scope="col">幫派內</th>
                  <th scope="col">俱樂部內</th>
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
                    <span
                      :class="['membership-status', { 'membership-yes': member.isInGuild }]"
                      :aria-label="`幫派內：${member.isInGuild ? '是' : '否'}`"
                      >{{ member.isInGuild ? '是' : '否' }}</span
                    >
                  </td>
                  <td>
                    <span
                      :class="['membership-status', { 'membership-yes': member.isInClub }]"
                      :aria-label="`俱樂部內：${member.isInClub ? '是' : '否'}`"
                      >{{ member.isInClub ? '是' : '否' }}</span
                    >
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
                        color="primary"
                        :href="`#/member-records/${encodeURIComponent(member.uid)}`"
                        :aria-label="`查看 ${member.name} 的數據`"
                        >查看數據</v-btn
                      >
                      <v-btn
                        variant="text"
                        size="small"
                        :prepend-icon="mdiPencilOutline"
                        :aria-label="`編輯 ${member.name}`"
                        @click="openForm(member)"
                        >編輯</v-btn
                      ><v-btn
                        v-if="tab === 'members'"
                        color="warning"
                        variant="text"
                        size="small"
                        :prepend-icon="mdiAccountArrowRightOutline"
                        :aria-label="`移至編外 ${member.name}`"
                        @click="openMove(member)"
                        >移至編外</v-btn
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
      </div>
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
    <v-card class="member-dialog member-profile-dialog">
      <form class="member-profile-form" @submit.prevent="save">
        <div class="member-profile-content">
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
            }}<span v-if="saveError.includes('重新載入')">
              請關閉表單後重新載入清單。</span
            ></v-alert
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
            <div class="member-membership-fields">
              <h3>所屬狀態</h3>
              <v-checkbox
                v-model="form.isInGuild"
                label="是否在幫派內"
                color="primary"
                :disabled="saving"
                :error-messages="errors.isInGuild"
                hide-details="auto"
                @update:model-value="errors.isInGuild = ''"
              />
              <v-checkbox
                v-model="form.isInClub"
                label="是否在俱樂部內"
                color="primary"
                :disabled="saving"
                :error-messages="errors.isInClub"
                hide-details="auto"
                @update:model-value="errors.isInClub = ''"
              />
              <p>
                兩者可同時勾選或都不勾選，兩者皆否會顯示在編外人員，勾選任一項會顯示在成員清單。
              </p>
            </div>
          </fieldset>
        </div>
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
    v-model="moveDialog"
    :persistent="movingBusy"
    max-width="480"
    aria-labelledby="move-title"
    @after-leave="restoreFocus"
  >
    <v-card class="member-dialog"
      ><h2 id="move-title">移至編外人員</h2>
      <p class="member-dialog-description">
        確定將 <strong>{{ moving?.name }}</strong> 移至編外人員？
      </p>
      <p class="member-remove-uid">UID：{{ moving?.uid }}</p>
      <p class="member-dialog-description">
        「幫派內」與「俱樂部內」都會改為否，資料與過去名稱保留。日後編輯並勾選任一狀態即可返回成員清單。
      </p>
      <v-alert v-if="moveError" type="error" variant="tonal" role="alert">{{ moveError }}</v-alert>
      <div class="member-dialog-actions">
        <v-btn variant="outlined" :disabled="movingBusy" @click="moveDialog = false">取消</v-btn
        ><v-btn
          color="warning"
          :loading="movingBusy"
          :disabled="movingBusy"
          @click="moveToExternal"
          >{{ movingBusy ? '移轉中…' : '確認移至編外' }}</v-btn
        >
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
      <p class="member-dialog-description">
        新匯入人員顯示於成員頁；既有人員（含編外）的名稱、職業與所屬狀態保持原樣。
      </p>
      <div class="member-dialog-actions">
        <v-btn color="primary" @click="importResultDialog = false">知道了</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>
