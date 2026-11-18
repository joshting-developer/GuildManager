<script setup>
import { computed } from 'vue';
import { inNameSource, memberChoices } from '../domain/member-choices.js';

const props = defineProps({
  source: { type: String, default: 'manual' },
  name: { type: String, default: '' },
  memberUid: { type: String, default: null },
  members: { type: Array, default: () => [] },
  professions: { type: Array, default: () => [] },
  disabled: Boolean,
  errorMessages: { type: [String, Array], default: () => [] },
  idPrefix: { type: String, required: true },
  // Registration picks a profession first and lists members whose primary or secondary matches.
  filterByProfession: Boolean,
  professionId: { type: [Number, String], default: null },
});
const emit = defineEmits(['update:source', 'update:name', 'update:memberUid', 'update:professionId']);
const sources = computed(() => [
  ...(props.filterByProfession ? [] : [{ value: 'manual', title: '直接輸入名稱' }]),
  { value: 'guild', title: '幫會成員名單' },
  { value: 'club', title: '龍虎戰成員名單' },
]);
const sourceMembers = computed(() => props.members.filter((member) => inNameSource(member, props.source)));
const choices = computed(() => props.filterByProfession
  ? memberChoices(props.members, props.source, props.professionId)
  : sourceMembers.value);
const professionName = (id) => props.professions.find((job) => job.job_id === id)?.name;
const memberLabel = computed(() => props.source === 'guild' ? '幫會成員' : '龍虎戰成員');
const emptyText = computed(() => {
  if (!sourceMembers.value.length) return `尚無${memberLabel.value}`;
  if (!props.filterByProfession || choices.value.length) return '';
  if (props.professionId == null) return '請先選擇職業, 再選擇成員';
  return `${memberLabel.value}中沒有主職業或副職業為「${professionName(props.professionId) || '此職業'}」的成員`;
});
function subtitle(member) {
  const primary = professionName(member.primaryProfessionId) || '職業未設定';
  const secondary = professionName(member.secondaryProfessionId);
  return props.filterByProfession && secondary ? `${primary}／副 ${secondary}` : primary;
}
</script>

<template>
  <div class="name-source-picker">
    <v-tabs :model-value="source" aria-label="選擇名稱方式" @update:model-value="emit('update:source', $event)">
      <v-tab v-for="item in sources" :key="item.value" :value="item.value"
        :id="`${idPrefix}-${item.value}-tab`" :aria-controls="`${idPrefix}-${item.value}-panel`"
        :disabled="disabled">{{ item.title }}</v-tab>
    </v-tabs>
    <div :id="`${idPrefix}-${source}-panel`" role="tabpanel"
      :aria-labelledby="`${idPrefix}-${source}-tab`" class="name-source-panel">
      <v-text-field v-if="source === 'manual'" :model-value="name" label="角色名稱"
        maxlength="64" variant="outlined" density="compact" :disabled="disabled"
        :error-messages="errorMessages" hide-details="auto" aria-required="true"
        @update:model-value="emit('update:name', $event)" />
      <template v-else>
        <v-select v-if="filterByProfession" :model-value="professionId" :items="professions"
          item-title="name" item-value="job_id" label="職業" variant="outlined" density="compact"
          :disabled="disabled" hide-details aria-required="true" class="name-source-profession"
          @update:model-value="emit('update:professionId', $event)" />
        <v-autocomplete :model-value="memberUid" :items="choices" item-title="name" item-value="uid"
          :label="memberLabel" variant="outlined" density="compact"
          :disabled="disabled || (filterByProfession && professionId == null)"
          :error-messages="errorMessages" hide-details="auto" clearable
          aria-required="true" no-data-text="沒有符合的成員"
          :aria-describedby="emptyText ? `${idPrefix}-empty` : undefined"
          @update:model-value="emit('update:memberUid', $event)">
          <template #item="{ props: itemProps, item }">
            <v-list-item v-bind="itemProps" :subtitle="subtitle(item.raw ?? item)" />
          </template>
        </v-autocomplete>
        <p v-if="emptyText" :id="`${idPrefix}-empty`" class="name-source-empty">{{ emptyText }}</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.name-source-picker { min-width: 0; max-width: 100%; }
.name-source-panel { padding-top: 16px; }
.name-source-empty { color: var(--color-text-muted); margin: 8px 0; }
.name-source-profession { margin-bottom: 16px; }
@media (max-width: 600px) {
  .name-source-picker :deep(.v-tab.v-btn) {
    min-width: 0;
    padding-inline: 8px;
    font-size: 13px;
    letter-spacing: 0;
  }
}
</style>
