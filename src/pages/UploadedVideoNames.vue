<script setup>
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue';
import { createEventVideoClient } from '../api/event-videos.js';
import DataLoading from '../components/DataLoading.vue';

const props = defineProps({ eventId: { type: String, required: true }, professions: { type: Array, default: () => [] } });
const client = createEventVideoClient();
const search = ref(''), page = ref(1), total = ref(0);
const names = shallowRef([]);
const professionId = ref(''), sort = ref('name');
const professionOptions = computed(() => [
  { title: '全部職業', value: '' },
  ...props.professions.map(job => ({ title: job.name, value: String(job.job_id) })),
  { title: '未記錄', value: '0' },
]);
const professionSort = computed(() => sort.value === 'name' ? 'none' : sort.value === 'professionAsc' ? 'ascending' : 'descending');
function toggleProfessionSort() {
  sort.value = sort.value === 'professionAsc' ? 'professionDesc' : 'professionAsc';
}
const loading = ref(false), error = ref('');
let token = 0, timer;
async function load() {
  const current = ++token;
  loading.value = true;
  error.value = '';
  names.value = [];
  try {
    const data = await client.getNames(props.eventId, { search: search.value, page: page.value, professionId: professionId.value, sort: sort.value });
    if (current !== token) return;
    names.value = data.names;
    total.value = data.total;
  } catch (cause) {
    if (current === token) error.value = cause.message;
  } finally {
    if (current === token) loading.value = false;
  }
}
watch([search, professionId, sort], () => {
  clearTimeout(timer);
  token++;
  names.value = [];
  loading.value = true;
  timer = setTimeout(() => { page.value = 1; load(); }, 300);
});
watch(() => props.eventId, () => {
  clearTimeout(timer);
  search.value = '';
  professionId.value = '';
  sort.value = 'name';
  page.value = 1;
  load();
}, { immediate: true });
onUnmounted(() => { token++; clearTimeout(timer); });
function changePage(value) { page.value = value; load(); }
</script>

<template>
  <section aria-label="已上傳影片名單" class="uploaded-video-names">
    <v-text-field :model-value="search" @update:model-value="search = $event || ''" label="搜尋玩家" maxlength="64" variant="outlined"
      density="compact" hide-details clearable />
    <v-select v-model="professionId" :items="professionOptions" label="篩選職業" variant="outlined" density="compact" hide-details />
    <v-btn variant="text" :disabled="loading" @click="load">重新載入名單</v-btn>
    <DataLoading v-if="loading" compact>正在載入已上傳影片名單…</DataLoading>
    <v-alert v-else-if="error" type="error" variant="tonal" role="alert">
      {{ error }}<v-btn variant="text" @click="load">重試</v-btn>
    </v-alert>
    <template v-else>
      <table aria-label="已上傳影片玩家">
        <thead><tr><th scope="col">玩家</th><th scope="col" :aria-sort="professionSort">
          <v-btn variant="text" aria-label="依職業排序" @click="toggleProfessionSort">職業 {{ sort === 'professionAsc' ? '↑' : sort === 'professionDesc' ? '↓' : '↕' }}</v-btn>
        </th></tr></thead>
        <tbody>
          <tr v-for="row in names" :key="row.name"><td>{{ row.name }}</td><td>{{ row.professionName || '未記錄' }}</td></tr>
          <tr v-if="!names.length"><td colspan="2">{{ search || professionId ? '沒有符合的玩家' : '本場尚無已上傳影片' }}</td></tr>
        </tbody>
      </table>
      <p role="status">共 {{ total }} 人</p>
      <v-pagination v-if="total > 20" :model-value="page" :length="Math.ceil(total / 20)"
        :total-visible="3" aria-label="已上傳影片名單分頁" @update:model-value="changePage" />
    </template>
  </section>
</template>

<style scoped>
.uploaded-video-names { display: grid; gap: 12px; min-width: 0; }
.uploaded-video-names table { width: 100%; border-collapse: collapse; }
.uploaded-video-names th, .uploaded-video-names td { padding: 12px 16px; text-align: left; border-bottom: 1px solid var(--color-border); overflow-wrap: anywhere; }
.uploaded-video-names > .v-btn { justify-self: start; }
</style>
