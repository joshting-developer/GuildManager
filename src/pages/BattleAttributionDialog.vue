<script setup>
import { computed, nextTick, onMounted, ref, useId } from 'vue';
import { memberAffiliation } from '../domain/battle-attributions.js';
const props = defineProps({ player: { type: Object, required: true }, members: { type: Array, required: true },
  attribution: { type: Object, default: null } });
const emit = defineEmits(['apply', 'close']);
const id = useId(), open = ref(true), selectedUid = ref(props.attribution?.memberUid || null), input = ref(null);
const error = ref(''), opener = document.activeElement;
const options = computed(() => props.members.map(member => ({ value: member.uid,
  title: `${member.name} · ${member.profession} · ${memberAffiliation(member)}` })));
const dirty = computed(() => selectedUid.value !== (props.attribution?.memberUid || null));
function close() {
  if (dirty.value && !window.confirm('放棄尚未套用的數據歸屬？')) return;
  open.value = false;
}
function apply() {
  error.value = '';
  const member = selectedUid.value ? props.members.find(value => value.uid === selectedUid.value) : null;
  if (selectedUid.value && !member) { error.value = '成員資料已變更，請重新選擇'; return; }
  emit('apply', member);
  open.value = false;
}
function closed() {
  emit('close');
  if (opener?.isConnected) opener.focus({ preventScroll: true });
}
onMounted(async () => { await nextTick(); input.value?.$el?.querySelector('input')?.focus(); });
</script>

<template>
  <v-dialog :model-value="open" persistent max-width="560" :aria-labelledby="`${id}-title`"
    @keydown.esc.prevent.stop="close" @click:outside="close" @after-leave="closed">
    <v-card class="battle-attribution-card">
      <h2 :id="`${id}-title`">調整數據歸屬</h2>
      <p>CSV 原角色：<strong>{{ player.player }}</strong> · {{ player.profession }}</p>
      <p class="battle-muted">選擇實際操作的成員，只影響這一場的這筆數據。原角色與數值會保留。</p>
      <v-autocomplete ref="input" v-model="selectedUid" :items="options" label="數據歸屬成員"
        variant="outlined" clearable :error-messages="error" no-data-text="沒有符合的成員"
        hint="同名者請依職業與所屬確認；清除可還原原角色的自動比對。" persistent-hint />
      <div class="battle-attribution-actions">
        <v-btn variant="outlined" @click="close">取消</v-btn>
        <v-btn color="primary" @click="apply">套用歸屬</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.battle-attribution-card { padding: 24px; }
.battle-attribution-card h2 { font-size: 22px; }
.battle-attribution-card p { margin: 12px 0 20px; overflow-wrap: anywhere; }
.battle-attribution-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 12px; margin-top: 24px; }
</style>
