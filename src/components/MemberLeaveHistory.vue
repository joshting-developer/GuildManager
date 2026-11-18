<script setup>
import { ref, computed, watch, onUnmounted, nextTick } from 'vue';
import { useDisplay } from 'vuetify';
import { VNavigationDrawer } from 'vuetify/components';
import DataLoading from './DataLoading.vue';
import { createAttendanceClient } from '../api/attendance.js';
import { createParticipationClient } from '../api/participation.js';
import { eventDisplayTitle } from '../domain/event-types.js';
const props = defineProps({modelValue:Boolean,uid:{type:String,default:''}});
const emit = defineEmits(['update:modelValue','changed']);
const client = createAttendanceClient(), {width} = useDisplay();
const drawerWidth = computed(() => Math.min(520,width.value));
const participation = createParticipationClient();
const saving = ref(''), actionError = ref(''), notice = ref('');
const requests = new Map();
defineExpose({busy:saving});
function close(open=false) { if (!saving.value) emit('update:modelValue',open); }
const panel=ref(null),closeButton=ref(null);
const data = ref(null), loading = ref(false), error = ref(''), page = ref(1);
const pages = computed(() => Math.min(400,Math.max(1,Math.ceil((data.value?.total || 0)/25))));
let token=0;
async function load(){
  actionError.value='';
  if(!props.modelValue || !props.uid) return;
  const current=++token,uid=props.uid;loading.value=true;error.value='';
  try{const result=await client.getMemberHistory(uid,page.value);if(current!==token||!props.modelValue)return;if(result.member?.uid!==uid||!Array.isArray(result.rows))throw new Error('請假歷史格式不正確');data.value=result;}
  catch(cause){if(current===token)error.value=cause.message;}
  finally{if(current===token)loading.value=false;}
}
async function cancelLeave(row) {
  if (saving.value || loading.value) return;
  const uid=props.uid, current=token, key=row.eventId+':'+uid+':'+row.revision;
  if (!requests.has(key)) requests.set(key,crypto.randomUUID());
  saving.value=key;actionError.value='';notice.value='';
  try {
    const result=await participation.cancelLeave(row.eventId,{source:'member',id:uid,revision:row.revision,requestId:requests.get(key)});
    if (current!==token || !props.modelValue) return;
    if (result?.cancelled!==true || result.eventId!==row.eventId) throw new Error('銷假回應格式不正確, 請重新載入確認');
    requests.delete(key);notice.value='已銷假';page.value=1;
    emit('changed');await load();
  } catch(cause) { if(current===token && props.modelValue) actionError.value=cause.message; }
  finally { saving.value='';await nextTick();if(props.modelValue)closeButton.value?.$el?.focus(); }
}
watch(()=>[props.modelValue,props.uid],()=>{token++;data.value=null;page.value=1;actionError.value='';notice.value='';requests.clear();if(props.modelValue){load();nextTick(()=>closeButton.value?.$el?.focus());}},{immediate:true});
function keys(event){
 if(event.key==='Escape'){event.stopPropagation();close();}
 if(event.key!=='Tab')return;
 const items=[...panel.value.querySelectorAll('button:not([disabled]),[href],input:not([disabled]),[tabindex="0"]')].filter(el=>el.getClientRects().length && el.tabIndex>=0);
 if(!items.length)return;
 if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1).focus();}
 else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0].focus();}
}
onUnmounted(()=>token++);
</script>
<template>
  <v-navigation-drawer :model-value="modelValue" location="right" temporary disable-resize-watcher :width="drawerWidth" aria-labelledby="member-leave-history-title" :persistent="!!saving" @update:model-value="close">
    <section ref="panel" class="member-leave-history" role="dialog" aria-modal="true" aria-labelledby="member-leave-history-title" @keydown="keys">
      <header><h2 id="member-leave-history-title">{{ data?.member.name || '成員' }}的請假歷史</h2><v-btn ref="closeButton" variant="text" aria-label="關閉請假歷史" :disabled="!!saving" @click="close()">關閉</v-btn></header>
      <v-alert v-if="notice" type="success" variant="tonal" role="status" class="my-4">{{ notice }}</v-alert>
      <v-alert v-if="actionError" type="error" variant="tonal" role="alert" class="my-4">{{ actionError }}<v-btn variant="text" :disabled="!!saving" @click="load">重新載入</v-btn></v-alert>
      <DataLoading v-if="loading">正在載入請假歷史…</DataLoading>
      <v-alert v-else-if="error" type="error" variant="tonal" role="alert">{{ error }}<v-btn variant="text" @click="load">重試</v-btn></v-alert>
      <template v-else-if="data">
        <p class="my-4">有效請假共 {{ data.total }} 次</p>
        <p v-if="!data.rows.length" role="status">這位成員目前沒有有效請假紀錄</p>
        <ol v-else class="member-leave-timeline">
          <li v-for="row in data.rows" :key="row.eventId+row.date"><strong>{{ row.date }}</strong><span>{{ eventDisplayTitle(row) }}</span><p>{{ row.note || '未填寫請假原因' }}</p><v-btn class="leave-cancel" variant="outlined" :loading="saving===row.eventId+':'+uid+':'+row.revision" :disabled="!!saving || loading" :aria-label="'銷假：'+row.date+' '+eventDisplayTitle(row)" @click="cancelLeave(row)">銷假</v-btn></li>
        </ol>
        <v-pagination v-if="pages>1" v-model="page" :disabled="!!saving || loading" :length="pages" :total-visible="4" aria-label="個人請假歷史頁碼" @update:model-value="load" />
      </template>
    </section>
  </v-navigation-drawer>
</template>
<style scoped>
.member-leave-history { padding: 24px; }
.member-leave-history header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.member-leave-history h2 { font-size: 1.25rem; }
.leave-cancel { justify-self:end; min-height:44px; }
.member-leave-timeline { list-style: none; padding: 0; }
.member-leave-timeline li { display: grid; gap: 6px; padding: 18px 0; border-bottom: 1px solid rgba(var(--v-theme-on-surface),.12); overflow-wrap: anywhere; }
@media(max-width:600px) { .member-leave-history { padding: 20px 16px; } }
</style>
