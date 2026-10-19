<script setup>
import { computed } from 'vue';

const props = defineProps({
  source: { type: String, default: 'manual' },
  name: { type: String, default: '' },
  memberUid: { type: String, default: null },
  members: { type: Array, default: () => [] },
  professions: { type: Array, default: () => [] },
  disabled: Boolean,
  errorMessages: { type: [String, Array], default: () => [] },
  idPrefix: { type: String, required: true },
});
const emit = defineEmits(['update:source', 'update:name', 'update:memberUid']);
const sources = [
  { value: 'manual', title: '直接輸入名稱' },
  { value: 'guild', title: '幫會成員名單' },
  { value: 'club', title: '龍虎戰成員名單' },
];
const choices = computed(() => props.members.filter((member) =>
  props.source === 'guild' ? member.isInGuild : member.isInClub,
));
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
        <v-autocomplete :model-value="memberUid" :items="choices" item-title="name" item-value="uid"
          :label="source === 'guild' ? '幫會成員' : '龍虎戰成員'" variant="outlined" density="compact"
          :disabled="disabled" :error-messages="errorMessages" hide-details="auto" clearable
          aria-required="true" no-data-text="沒有符合的成員"
          @update:model-value="emit('update:memberUid', $event)">
          <template #item="{ props: itemProps, item }">
            <v-list-item v-bind="itemProps" :subtitle="professions.find(job => job.job_id === item.primaryProfessionId)?.name || '職業未設定'" />
          </template>
        </v-autocomplete>
        <p v-if="!choices.length" class="name-source-empty">{{ source === 'guild' ? '尚無幫會成員' : '尚無龍虎戰成員' }}</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.name-source-picker { min-width: 0; max-width: 100%; }
.name-source-panel { padding-top: 16px; }
.name-source-empty { color: var(--color-text-muted); margin: 8px 0; }
@media (max-width: 600px) {
  .name-source-picker :deep(.v-tab.v-btn) {
    min-width: 0;
    padding-inline: 8px;
    font-size: 13px;
    letter-spacing: 0;
  }
}
</style>
