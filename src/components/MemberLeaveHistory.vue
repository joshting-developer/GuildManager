<script setup>
import { ref, computed, watch, onUnmounted, nextTick } from 'vue';
import { useDisplay } from 'vuetify';
import { VNavigationDrawer } from 'vuetify/components';
import DataLoading from './DataLoading.vue';
import { createAttendanceClient } from '../api/attendance.js';
import { eventDisplayTitle } from '../domain/event-types.js';
const props = defineProps({modelValue:Boolean,uid:{type:String,default:''}});
const emit = defineEmits(['update:modelValue']);
const client = createAttendanceClient(), {width} = useDisplay();
const drawerWidth = computed(() => Math.min(520,width.value));
const panel=ref(null),closeButton=ref(null);
const data = ref(null), loading = ref(false), error = ref(''), page = ref(1);
const pages = computed(() => Math.min(400,Math.max(1,Math.ceil((data.value?.total || 0)/25))));
let token=0;
async function load(){
  if(!props.modelValue || !props.uid) return;
  const current=++token,uid=props.uid;loading.value=true;error.value='';
  try{const result=await client.getMemberHistory(uid,page.value);if(current!==token||!props.modelValue)return;if(result.member?.uid!==uid||!Array.isArray(result.rows))throw new Error('請假歷史格式不正確');data.value=result;}
  catch(cause){if(current===token)error.value=cause.message;}
  finally{if(current===token)loading.value=false;}
}
watch(()=>[props.modelValue,props.uid],()=>{token++;data.value=null;page.value=1;if(props.modelValue){load();nextTick(()=>closeButton.value?.$el?.focus());}},{immediate:true});
function keys(event){
 if(event.key==='Escape'){event.stopPropagation();emit('update:modelValue',false);}
 if(event.key!=='Tab')return;
 const items=[...panel.value.querySelectorAll('button:not([disabled]),[href],input:not([disabled]),[tabindex="0"]')].filter(el=>el.getClientRects().length && el.tabIndex>=0);
 if(!items.length)return;
 if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1).focus();}
 else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0].focus();}
}
onUnmounted(()=>token++);
</script>
<template>
  <v-navigation-drawer :model-value="modelValue" location="right" temporary disable-resize-watcher :width="drawerWidth" aria-labelledby="member-leave-history-title" @update:model-value="emit('update:modelValue',$event)">
    <section ref="panel" class="member-leave-history" role="dialog" aria-modal="true" aria-labelledby="member-leave-history-title" @keydown="keys">
      <header><h2 id="member-leave-history-title">{{ data?.member.name || '成員' }}的請假歷史</h2><v-btn ref="closeButton" variant="text" aria-label="關閉請假歷史" @click="emit('update:modelValue',false)">關閉</v-btn></header>
      <DataLoading v-if="loading">正在載入請假歷史…</DataLoading>
      <v-alert v-else-if="error" type="error" variant="tonal" role="alert">{{ error }}<v-btn variant="text" @click="load">重試</v-btn></v-alert>
      <template v-else-if="data">
        <p class="my-4">有效請假共 {{ data.total }} 次</p>
        <p v-if="!data.rows.length" role="status">這位成員目前沒有有效請假紀錄</p>
        <ol v-else class="member-leave-timeline">
          <li v-for="row in data.rows" :key="row.eventId+row.date"><strong>{{ row.date }}</strong><span>{{ eventDisplayTitle(row) }}</span><p>{{ row.note || '未填寫請假原因' }}</p></li>
        </ol>
        <v-pagination v-if="pages>1" v-model="page" :length="pages" :total-visible="4" aria-label="個人請假歷史頁碼" @update:model-value="load" />
      </template>
    </section>
  </v-navigation-drawer>
</template>
<style scoped>
.member-leave-history { padding: 24px; }
.member-leave-history header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.member-leave-history h2 { font-size: 1.25rem; }
.member-leave-timeline { list-style: none; padding: 0; }
.member-leave-timeline li { display: grid; gap: 6px; padding: 18px 0; border-bottom: 1px solid rgba(var(--v-theme-on-surface),.12); overflow-wrap: anywhere; }
@media(max-width:600px) { .member-leave-history { padding: 20px 16px; } }
</style>
