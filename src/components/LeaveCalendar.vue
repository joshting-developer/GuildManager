<script setup>
import { computed, ref, onUnmounted } from 'vue';
import CalendarGrid from '../pages/CalendarGrid.vue';
import DataLoading from './DataLoading.vue';
import { createAttendanceClient } from '../api/attendance.js';
import { eventDisplayTitle } from '../domain/event-types.js';
const client=createAttendanceClient();
const month=ref(''),days=ref([]),loading=ref(false),error=ref(''),selected=ref(null),details=ref(null),detailLoading=ref(false),detailError=ref(''),page=ref(1);
const events=computed(()=>days.value.map(day=>({...day,id:day.date,dates:[day.date]})));
const pages=computed(()=>Math.min(400,Math.max(1,Math.ceil((details.value?.total||0)/25))));
let token=0,detailToken=0;
async function load(value=month.value){
  const current=++token;month.value=value;loading.value=true;error.value='';days.value=[];
  try{const data=await client.getCalendar(value);if(current!==token)return;if(data.month!==value||!Array.isArray(data.days))throw new Error('請假行事曆格式不正確');days.value=data.days;}
  catch(cause){if(current===token)error.value=cause.message;}
  finally{if(current===token)loading.value=false;}
}
async function open(day){selected.value=day.date;page.value=1;await loadDay();}
async function loadDay(){
  const current=++detailToken,date=selected.value;detailLoading.value=true;detailError.value='';details.value=null;
  try{const data=await client.getHistory({month:month.value,date,response:'leave',page:page.value});if(current!==detailToken||selected.value!==date)return;details.value=data;}
  catch(cause){if(current===detailToken)detailError.value=cause.message;}
  finally{if(current===detailToken)detailLoading.value=false;}
}
const summary=(day,events)=>`${day.label}，${events?.[0]?.count || 0} 人請假, 查看請假名單`;
onUnmounted(()=>{token++;detailToken++;});
</script>
<template>
  <section class="leave-calendar" aria-label="請假行事曆">
    <DataLoading v-if="loading" compact>正在載入請假行事曆…</DataLoading>
    <v-alert v-if="error" type="error" variant="tonal" role="alert" class="my-4">{{ error }}<v-btn variant="text" @click="load()">重試</v-btn></v-alert>
    <CalendarGrid browsable :events="events" :disabled="loading" :day-summary="summary" @month-changed="load" @open-day="open">
      <template #day-content="{events}"><span class="calendar-event-count">{{ events[0].count }} 人<span class="leave-calendar-count-label">請假</span></span><span v-for="(name,index) in events[0].names" :key="index" class="leave-calendar-name">{{ name }}</span><span v-if="events[0].count>3" class="leave-calendar-more">另 {{ events[0].count-3 }} 人</span></template>
    </CalendarGrid>
    <p v-if="!loading && !error && !days.length" role="status" class="mt-4">這個月沒有有效請假紀錄</p>
    <v-dialog :model-value="!!selected" max-width="680" aria-labelledby="leave-calendar-day-title" @update:model-value="!$event && (selected=null)">
      <v-card class="pa-6"><h2 id="leave-calendar-day-title">{{ selected }} 的請假名單</h2>
        <DataLoading v-if="detailLoading">正在載入當天請假名單…</DataLoading>
        <v-alert v-else-if="detailError" type="error" variant="tonal" role="alert" class="my-4">{{ detailError }}<v-btn variant="text" @click="loadDay">重試</v-btn></v-alert>
        <ul v-else-if="details" class="leave-day-list"><li v-for="row in details.rows" :key="row.eventId+row.uid"><strong>{{ row.name }}</strong><span>{{ eventDisplayTitle(row) }}</span><p>{{ row.leaveNote || '未填寫請假原因' }}</p></li></ul>
        <v-pagination v-if="pages>1" v-model="page" :length="pages" :total-visible="4" @update:model-value="loadDay" aria-label="當天請假名單頁碼" />
        <div class="text-right mt-4"><v-btn variant="outlined" @click="selected=null">關閉</v-btn></div>
      </v-card>
    </v-dialog>
  </section>
</template>
<style scoped>
.leave-calendar-name { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:.9rem; }
.leave-calendar-more { font-size:.85rem; }
.leave-day-list { list-style:none; padding:0; }
.leave-day-list li { display:grid; gap:6px; padding:18px 0; border-bottom:1px solid rgba(var(--v-theme-on-surface),.12); overflow-wrap:anywhere; }
@media(max-width:600px) { .leave-calendar-name,.leave-calendar-more { font-size:.75rem; } .leave-calendar-count-label { display:none; } }
</style>
