<script setup>
import { LINEUP_GROUPS } from '../domain/lineups.js';
const props = defineProps({
  teams: { type: Array, required: true },
  members: { type: Array, default: () => [] },
  professions: { type: Array, default: () => [] },
  duties: { type: Array, default: () => [] },
  readOnly: Boolean,
  snapshots: Boolean,
  selectedUid: String,
  selectedDutyId: String,
});
const emit = defineEmits(['place', 'assign-duty', 'edit-seat', 'rename-team']);
function dutiesFor(slot) {
  return props.snapshots
    ? slot.duties || []
    : (slot.dutyIds || []).map((id) => ({
        id,
        name: props.duties.find((duty) => duty.id === id)?.name || '職責不存在',
        active: props.duties.find((duty) => duty.id === id)?.active,
      }));
}
function dutyDescription(slot) {
  return [...dutiesFor(slot).map((duty) => duty.name), slot.note].filter(Boolean).join(' · ');
}
function person(slot) {
  if (props.snapshots) return slot.member;
  const member = props.members.find((member) => member.uid === slot.uid);
  if (!member) return slot.uid ? { name: `找不到成員（${slot.uid}）` } : null;
  return {
    ...member,
    primaryProfession: props.professions.find((p) => p.job_id === member.primaryProfessionId),
    secondaryProfession: props.professions.find((p) => p.job_id === member.secondaryProfessionId),
  };
}
function job(slot) {
  return person(slot)?.[`${slot.profession}Profession`];
}
function drop(event, teamId, index) {
  if (props.readOnly) return;
  const dutyId = event.dataTransfer.getData('application/x-guild-duty');
  if (dutyId) {
    emit('assign-duty', dutyId, teamId, index);
    return;
  }
  const uid = event.dataTransfer.getData('application/x-guild-member');
  if (uid) emit('place', uid, teamId, index);
}
function drag(event, slot) {
  if (!props.readOnly && slot.uid) {
    event.dataTransfer.setData('application/x-guild-member', slot.uid);
    event.dataTransfer.effectAllowed = 'move';
  }
}
function activate(team, index) {
  if (props.readOnly) return;
  if (props.selectedDutyId) emit('assign-duty', props.selectedDutyId, team.id, index);
  else if (props.selectedUid) emit('place', props.selectedUid, team.id, index);
  else emit('edit-seat', team.id, index);
}
</script>

<template>
  <div class="lineup-board">
    <section
      v-for="group in LINEUP_GROUPS"
      :key="group.id"
      :class="['lineup-group', group.id]"
      :aria-labelledby="`lineup-${group.id}`"
    >
      <h2 :id="`lineup-${group.id}`">
        <span class="group-mark"></span>{{ group.name
        }}<span class="group-capacity">{{ group.teams.length }} 隊 · 每隊 6 人</span>
      </h2>
      <div class="lineup-teams">
        <article
          v-for="team in teams.filter((team) => team.id.startsWith(`${group.id}-`))"
          :key="team.id"
          class="lineup-team"
        >
          <h3 v-if="readOnly" class="lineup-team-title">{{ team.name }}</h3>
          <label v-else class="lineup-team-heading"
            ><span class="sr-only">{{ group.name }}第 {{ team.id.split('-')[1] }} 隊名稱</span
            ><input
              :value="team.name"
              maxlength="40"
              :aria-label="`${group.name}第 ${team.id.split('-')[1]} 隊名稱`"
              @input="emit('rename-team', team.id, $event.target.value)"
          /></label>
          <div class="seat-columns" aria-hidden="true">
            <span>職業／成員</span><span>職責／備註</span>
          </div>
          <div
            v-for="(slot, index) in team.slots"
            :key="index"
            :class="[
              'lineup-seat',
              { occupied: slot.uid, 'seat-target': (selectedUid || selectedDutyId) && !readOnly },
            ]"
            :data-seat="`${team.id}-${index}`"
            @dragover.prevent="
              !readOnly &&
              ($event.dataTransfer.dropEffect = $event.dataTransfer.types.includes(
                'application/x-guild-duty',
              )
                ? 'copy'
                : 'move')
            "
            @drop.prevent="drop($event, team.id, index)"
          >
            <component
              :is="readOnly ? 'div' : 'button'"
              :type="readOnly ? undefined : 'button'"
              class="seat-person"
              :tabindex="readOnly ? 0 : undefined"
              :title="slot.uid ? `${person(slot)?.name || slot.uid}（${slot.uid}）` : '尚未安排'"
              :draggable="!readOnly && Boolean(slot.uid)"
              :aria-label="
                readOnly
                  ? undefined
                  : `${group.name} ${team.name} 第 ${index + 1} 位，${person(slot)?.name || '空位'}${selectedDutyId ? '，分配已選職責' : selectedUid ? '，安排已選成員' : '，編輯位置'}`
              "
              @dragstart="drag($event, slot)"
              @click="activate(team, index)"
            >
              <span class="seat-number">{{ index + 1 }}</span>
              <span v-if="slot.uid" class="seat-identity"
                ><span class="seat-job"
                  ><span
                    class="profession-dot"
                    :style="{ backgroundColor: job(slot)?.colorcode || '#64748b' }"
                  ></span
                  >{{ job(slot)?.name || '職業未設定'
                  }}<small v-if="slot.profession === 'secondary'">副</small></span
                ><strong>{{ person(slot)?.name || slot.uid }}</strong></span
              >
              <span v-else class="empty-seat">{{
                selectedUid && !readOnly ? '點此安排' : '尚未安排'
              }}</span>
            </component>
            <button
              v-if="!readOnly"
              type="button"
              class="seat-note seat-duty-button"
              :title="dutyDescription(slot)"
              :aria-label="`${group.name} ${team.name} 第 ${index + 1} 位職責與備註，${selectedDutyId ? '分配已選職責' : '編輯位置'}`"
              @click="
                selectedDutyId
                  ? emit('assign-duty', selectedDutyId, team.id, index)
                  : emit('edit-seat', team.id, index)
              "
            >
              <span
                v-for="duty in dutiesFor(slot)"
                :key="duty.id"
                class="seat-duty"
                :class="{ 'duty-inactive': !duty.active }"
                >{{ duty.name }}<small v-if="!duty.active">（停用）</small></span
              ><span>{{ slot.note || (dutiesFor(slot).length ? '' : '—') }}</span>
            </button>
            <div v-else class="seat-note" tabindex="0" :title="dutyDescription(slot)">
              <span v-for="duty in dutiesFor(slot)" :key="duty.id" class="seat-duty">{{
                duty.name
              }}</span
              ><span>{{ slot.note || (dutiesFor(slot).length ? '' : '—') }}</span>
            </div>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>
