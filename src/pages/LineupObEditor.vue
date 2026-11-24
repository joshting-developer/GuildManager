<script setup>
import { VSwitch } from 'vuetify/components';
const props = defineProps({ modelValue: { type: Object, required: true }, readOnly: Boolean });
const emit = defineEmits(['update:modelValue']);
function update(key, value) {
  if (!props.readOnly) emit('update:modelValue', { ...props.modelValue, [key]: value });
}
</script>

<template>
  <section class="lineup-ob" aria-label="指揮設定">
    <VSwitch density="compact" color="primary" :model-value="modelValue.enabled === 'on'" label="設定指揮" hide-details
      :disabled="readOnly" @update:model-value="update('enabled', $event ? 'on' : 'off')" />
    <template v-if="modelValue.enabled === 'on'">
      <div class="ob-row">
        <VSwitch density="compact" color="primary" :model-value="modelValue.attackMode === 'double'" label="進攻雙指揮" hide-details
          :disabled="readOnly" @update:model-value="update('attackMode', $event ? 'double' : 'single')" />
        <v-text-field :model-value="modelValue.attack" label="進攻指揮" maxlength="64" variant="outlined" density="compact" hide-details
          :disabled="readOnly" @update:model-value="update('attack', $event || '')" />
        <v-text-field v-if="modelValue.attackMode === 'double'" :model-value="modelValue.mobile" label="機動指揮" maxlength="64" variant="outlined" density="compact" hide-details
          :disabled="readOnly" @update:model-value="update('mobile', $event || '')" />
      </div>
      <div class="ob-row">
        <VSwitch density="compact" color="primary" :model-value="modelValue.defenseMode === 'double'" label="防守雙指揮" hide-details
          :disabled="readOnly" @update:model-value="update('defenseMode', $event ? 'double' : 'single')" />
        <v-text-field :model-value="modelValue.defense12" :label="modelValue.defenseMode === 'double' ? '防守12指揮' : '防守指揮'" maxlength="64" variant="outlined" density="compact" hide-details
          :disabled="readOnly" @update:model-value="update('defense12', $event || '')" />
        <v-text-field v-if="modelValue.defenseMode === 'double'" :model-value="modelValue.defense34" label="防守34指揮" maxlength="64" variant="outlined" density="compact" hide-details
          :disabled="readOnly" @update:model-value="update('defense34', $event || '')" />
      </div>
    </template>
  </section>
</template>

<style scoped>
.lineup-ob { margin-block: 16px; padding: 16px 20px; border: 1px solid var(--color-border); border-radius: 16px; background: var(--color-surface); }
.ob-row { display: grid; grid-template-columns: 180px repeat(2, minmax(0, 1fr)); gap: 16px; align-items: center; margin-top: 16px; }
@media (max-width: 768px) { .ob-row { grid-template-columns: minmax(0, 1fr); } }
</style>
