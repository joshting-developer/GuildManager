<script setup>
import { ref, computed, inject, watch, onUnmounted } from 'vue';
import LeaveCalendar from '../components/LeaveCalendar.vue';
import LeaveSettings from '../components/LeaveSettings.vue';
import AttendanceTable from './AttendanceTable.vue';
const auth=inject('calendarAuth',null);
const isAdmin=computed(()=>auth?.user.value?.role==='admin');
const tab=ref('calendar'),tableVisited=ref(false),settingsOpen=ref(false),settings=ref(null),table=ref(null);
const unregister=inject('registerNavigationGuard',null)?.(()=>settingsOpen.value ? (settings.value?.canClose() ?? true) : (table.value?.canLeave() ?? true));
onUnmounted(()=>unregister?.());
watch(tab,value=>{if(value==='table')tableVisited.value=true;});
function closeSettings(open){if(open){settingsOpen.value=true;return;}if(settings.value?.canClose())settingsOpen.value=false;}
</script>
<template>
  <div>
    <header class="attendance-page-heading"><h1 class="page-title">出勤紀錄</h1><v-btn v-if="isAdmin" variant="outlined" @click="settingsOpen=true">關心提醒設定</v-btn></header>
    <v-tabs v-model="tab" color="primary" aria-label="出勤與請假檢視" class="mb-6">
      <v-tab value="calendar" id="attendance-calendar-tab" aria-controls="attendance-calendar-panel">行事曆</v-tab>
      <v-tab value="table" id="attendance-table-tab" aria-controls="attendance-table-panel">紀錄表格</v-tab>
    </v-tabs>
    <section v-show="tab==='calendar'" id="attendance-calendar-panel" role="tabpanel" aria-labelledby="attendance-calendar-tab"><LeaveCalendar /></section>
    <section v-if="tableVisited" v-show="tab==='table'" id="attendance-table-panel" role="tabpanel" aria-labelledby="attendance-table-tab"><AttendanceTable ref="table" /></section>
    <v-dialog v-if="isAdmin" :model-value="settingsOpen" max-width="720" :persistent="settings?.busy" aria-labelledby="leave-settings-title" @update:model-value="closeSettings">
      <v-card class="pa-6"><LeaveSettings v-if="settingsOpen" ref="settings" @saved="table?.reload()" /><div class="text-right mt-6"><v-btn variant="outlined" :disabled="settings?.busy" @click="closeSettings(false)">關閉</v-btn></div></v-card>
    </v-dialog>
  </div>
</template>
<style scoped>
.attendance-page-heading { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:24px; }
@media(max-width:600px) { .attendance-page-heading { align-items:flex-start; flex-direction:column; } }
</style>
