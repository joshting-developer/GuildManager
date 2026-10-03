<script setup>
import { LINEUP_GROUPS } from '../domain/lineups.js';
const props = defineProps({
  teams: { type: Array, required: true },
  members: { type: Array, default: () => [] },
  professions: { type: Array, default: () => [] },
  readOnly: Boolean,
  snapshots: Boolean,
  selectedUid: String,
});
const emit = defineEmits(['place', 'edit-seat', 'rename-team']);
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
  if (props.selectedUid) emit('place', props.selectedUid, team.id, index);
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
            <span>職業／成員</span><span>任務備註</span>
          </div>
          <div
            v-for="(slot, index) in team.slots"
            :key="index"
            :class="[
              'lineup-seat',
              { occupied: slot.uid, 'seat-target': selectedUid && !readOnly },
            ]"
            :data-seat="`${team.id}-${index}`"
            @dragover.prevent="!readOnly && ($event.dataTransfer.dropEffect = 'move')"
            @drop.prevent="drop($event, team.id, index)"
          >
            <component
              :is="readOnly ? 'div' : 'button'"
              :type="readOnly ? undefined : 'button'"
              class="seat-person"
              :draggable="!readOnly && Boolean(slot.uid)"
              :aria-label="
                readOnly
                  ? undefined
                  : `${group.name} ${team.name} 第 ${index + 1} 位，${person(slot)?.name || '空位'}${selectedUid ? '，安排已選成員' : '，編輯位置'}`
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
            <span class="seat-note">{{ slot.note || '—' }}</span>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>
